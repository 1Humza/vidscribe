from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from vidscribe.analysis import Analyzer, DEFAULT_SYSTEM_PROMPT, DeterministicAnalyzer, GeminiAnalyzer, analysis_response_json_schema
from vidscribe.config import Settings
from vidscribe.database import SessionRepository
from vidscribe.fingerprints import source_fingerprint
from vidscribe.finalization import DestinationConflict, FinalizationError, SessionFinalizer
from vidscribe.session_manifest import SessionManifestError
from vidscribe.media import FFmpegMediaPreparer, probe_duration
from vidscribe.models import (
    CreateSessionRequest,
    DestinationSelectionRequest,
    ExecuteSessionRequest,
    OpenCompletedSessionRequest,
    OpenSourceSessionRequest,
    SessionIntakeUpdateRequest,
    PathSelectionRequest,
    PickerRequest,
    PickerSelection,
    ReviewUpdate,
    ResolvedSessionIntake,
    SessionView,
    SystemPromptUpdate,
    SystemPromptView,
)
from vidscribe.pickers import Picker, picker_for
from vidscribe.pipeline import SessionPipeline
from vidscribe.review import apply_review_update
from vidscribe.selections import SelectionRegistry
from vidscribe.session_dates import infer_session_date
from vidscribe.prompts import SystemPromptStore
from vidscribe.transcription import DeterministicTranscriber, GroqWhisperTranscriber, Transcriber


def create_app(
    settings: Settings | None = None,
    *,
    picker: Picker | None = None,
    transcriber: Transcriber | None = None,
    analyzer: Analyzer | None = None,
    media_preparer: FFmpegMediaPreparer | None = None,
    finalizer: SessionFinalizer | None = None,
) -> FastAPI:
    app_settings = settings or Settings()
    assert app_settings.database_path is not None
    assert app_settings.workspace_path is not None
    app_settings.workspace_path.mkdir(parents=True, exist_ok=True)
    repository = SessionRepository(app_settings.database_path)
    repository.recover_interrupted_sessions()
    repository.purge_expired_raw_streams()
    app = FastAPI(title="Vidscribe", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.state.settings = app_settings
    app.state.sessions = repository
    app.state.picker = picker or picker_for(app_settings)
    selections = SelectionRegistry()
    app.state.selections = selections
    assert app_settings.system_prompt_path is not None
    app.state.system_prompt = SystemPromptStore(
        app_settings.system_prompt_path, DEFAULT_SYSTEM_PROMPT
    )
    active_transcriber = transcriber
    active_analyzer = analyzer
    if active_transcriber is None and app_settings.test_mode:
        active_transcriber = DeterministicTranscriber()
    elif active_transcriber is None and app_settings.groq_api_key:
        active_transcriber = GroqWhisperTranscriber(
            app_settings.groq_api_key,
            app_settings.groq_model,
            ffmpeg_path=app_settings.ffmpeg_path,
            ffprobe_path=app_settings.ffprobe_path,
        )
    if active_analyzer is None and app_settings.test_mode:
        active_analyzer = DeterministicAnalyzer(
            fail_after_first=app_settings.test_analysis_failure
        )
    elif active_analyzer is None and app_settings.gemini_api_key:
        active_analyzer = GeminiAnalyzer(
            app_settings.gemini_api_key,
            app_settings.gemini_model,
            app_settings.gemini_effort,
        )
    pipeline = SessionPipeline(
        repository,
        app_settings.workspace_path,
        media_preparer
        or FFmpegMediaPreparer(app_settings.ffmpeg_path, app_settings.ffprobe_path),
        active_transcriber,
        active_analyzer,
        system_prompt_provider=app.state.system_prompt.get,
    )
    app.state.pipeline = pipeline
    app.state.finalizer = finalizer or SessionFinalizer()
    app.state.service_id = str(uuid4())
    app.state.last_raw_stream_cleanup = datetime.now(UTC)

    def add_source_metadata(session: SessionView) -> SessionView:
        source = Path(session.source_path)
        try:
            if not source.is_file():
                return session
            return session.model_copy(
                update={
                    "source_size_bytes": source.stat().st_size,
                    "source_duration_seconds": probe_duration(source, app_settings.ffprobe_path),
                    "source_date": infer_session_date(source, app_settings.ffprobe_path),
                }
            )
        except OSError:
            return session

    def pasted_path(raw_path: str) -> Path:
        value = raw_path.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            # Shell-style quoting is common when copying paths with spaces from Finder or Terminal.
            value = value[1:-1].strip()
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise HTTPException(status_code=422, detail="Pasted path must be absolute")
        try:
            return path.resolve()
        except OSError as error:
            raise HTTPException(status_code=422, detail="Pasted path could not be resolved") from error

    def source_file_selection(selected: Path) -> PickerSelection:
        if not selected.is_file():
            raise HTTPException(status_code=422, detail="Source Media must be an existing file")
        audio_extensions = {".aac", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
        return PickerSelection(
            selection_id=selections.issue("source", selected),
            path=str(selected),
            name=selected.name,
            media_kind="audio" if selected.suffix.lower() in audio_extensions else "video",
            size_bytes=selected.stat().st_size,
            duration_seconds=probe_duration(selected, app_settings.ffprobe_path),
            source_date=infer_session_date(selected, app_settings.ffprobe_path),
        )

    @app.middleware("http")
    async def enforce_loopback_host(request: Request, call_next):
        hostname = (request.url.hostname or "").lower()
        if hostname not in {"127.0.0.1", "localhost", "::1", "testserver"}:
            return JSONResponse(
                status_code=421,
                content={"detail": "Vidscribe accepts loopback requests only"},
            )
        now = datetime.now(UTC)
        if now - app.state.last_raw_stream_cleanup >= timedelta(days=1):
            repository.purge_expired_raw_streams(now=now)
            app.state.last_raw_stream_cleanup = now
        return await call_next(request)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/system-prompt", response_model=SystemPromptView)
    def get_system_prompt() -> SystemPromptView:
        return SystemPromptView(
            prompt=app.state.system_prompt.get(),
            locked_contract=analysis_response_json_schema(),
        )

    @app.put("/api/system-prompt", response_model=SystemPromptView)
    def update_system_prompt(request: SystemPromptUpdate) -> SystemPromptView:
        try:
            prompt = app.state.system_prompt.save(request.prompt)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return SystemPromptView(prompt=prompt, locked_contract=analysis_response_json_schema())

    @app.post("/api/sessions", response_model=SessionView, status_code=201)
    def create_session(request: CreateSessionRequest) -> SessionView:
        try:
            source = selections.resolve(request.source_selection_id, "source")
            destination = (
                selections.resolve(request.destination_selection_id, "destination")
                if request.destination_selection_id
                else None
            )
            attachments = [
                selections.resolve(selection_id, "attachment")
                for selection_id in request.attachment_selection_ids or []
            ]
        except KeyError as error:
            raise HTTPException(
                status_code=422, detail="Picker selection is invalid or expired"
            ) from error
        if not source.is_file():
            raise HTTPException(status_code=422, detail="Source Media must be an existing file")
        if destination is not None and not destination.is_dir():
            raise HTTPException(status_code=422, detail="Destination must be an existing directory")
        if any(not attachment.is_file() for attachment in attachments):
            raise HTTPException(status_code=422, detail="Attached Context must be existing files")
        session_date = (
            infer_session_date(source, app_settings.ffprobe_path)
            or request.session_date
            or date.today()
        )
        return repository.create(
            ResolvedSessionIntake(
                source_path=str(source),
                source_fingerprint=source_fingerprint(source),
                destination_path=str(destination) if destination is not None else None,
                extra_instructions=request.extra_instructions,
                speaker_hints=request.speaker_hints,
                extraction_options=request.extraction_options,
                model=request.model,
                effort=request.effort,
                session_date=session_date,
                attachment_paths=[str(attachment) for attachment in attachments],
            )
        )

    @app.put("/api/sessions/{session_id}/destination", response_model=SessionView)
    def update_session_destination(session_id: str, request: DestinationSelectionRequest) -> SessionView:
        try:
            session = repository.get(session_id)
            destination = selections.resolve(request.destination_selection_id, "destination")
        except KeyError as error:
            raise HTTPException(status_code=422, detail="Picker selection is invalid or expired") from error
        if session.status in {"processing", "finalizing", "completed"}:
            raise HTTPException(status_code=409, detail="Output Folder cannot be changed while this Session is active")
        if not destination.is_dir():
            raise HTTPException(status_code=422, detail="Destination must be an existing directory")
        return repository.update_session(session_id, destination_path=str(destination.resolve()))

    @app.patch("/api/sessions/{session_id}/intake", response_model=SessionView)
    def update_session_intake(session_id: str, request: SessionIntakeUpdateRequest) -> SessionView:
        try:
            session = repository.get(session_id)
            attachments = [
                selections.resolve(selection_id, "attachment")
                for selection_id in request.attachment_selection_ids or []
            ]
        except KeyError as error:
            raise HTTPException(status_code=422, detail="Picker selection is invalid or expired") from error
        if session.status in {"processing", "finalizing"}:
            raise HTTPException(status_code=409, detail="Session intake cannot be changed while this Session is active")
        if any(not attachment.is_file() for attachment in attachments):
            raise HTTPException(status_code=422, detail="Attached Context must be existing files")
        changes: dict[str, object] = {
            "extra_instructions": request.extra_instructions,
            "speaker_hints": request.speaker_hints,
            "extraction_options": request.extraction_options.model_dump(),
        }
        if request.attachment_selection_ids is not None:
            changes["attachment_paths"] = [str(attachment) for attachment in attachments]
        return repository.update_session(session_id, **changes)

    @app.post("/api/sessions/open-source", response_model=SessionView)
    def open_source_session(request: OpenSourceSessionRequest) -> SessionView:
        try:
            source = selections.resolve(request.source_selection_id, "source")
        except KeyError as error:
            raise HTTPException(
                status_code=422, detail="Picker selection is invalid or expired"
            ) from error
        if not source.is_file():
            raise HTTPException(status_code=422, detail="Source Media must be an existing file")
        try:
            return repository.get_by_source_fingerprint(source_fingerprint(source), source)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found for Source Media") from error

    @app.post("/api/pickers/source", response_model=PickerSelection)
    def choose_source(request: PickerRequest) -> PickerSelection:
        try:
            selected = app.state.picker.choose_source(
                Path(request.initial_path) if request.initial_path else None
            )
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        if selected is None:
            raise HTTPException(status_code=409, detail="Source Media selection cancelled")
        if selected.is_dir():
            return PickerSelection(
                selection_id=selections.issue("source", selected),
                path=str(selected.resolve()),
                name=selected.name,
                media_kind=None,
            )
        return source_file_selection(selected.resolve())

    @app.post("/api/pickers/source-path", response_model=PickerSelection)
    def choose_source_path(request: PathSelectionRequest) -> PickerSelection:
        selected = pasted_path(request.path)
        if selected.is_dir():
            return PickerSelection(
                selection_id=selections.issue("source", selected),
                path=str(selected),
                name=selected.name,
                media_kind=None,
            )
        return source_file_selection(selected)

    @app.post(
        "/api/pickers/attachment-path",
        response_model=PickerSelection,
        response_model_exclude_none=True,
    )
    def choose_attachment_path(request: PathSelectionRequest) -> PickerSelection:
        selected = pasted_path(request.path)
        if not selected.is_file():
            raise HTTPException(status_code=422, detail="Attached Context must be an existing file")
        return PickerSelection(
            selection_id=selections.issue("attachment", selected),
            path=str(selected),
            name=selected.name,
        )

    @app.post("/api/sessions/open-completed", response_model=SessionView)
    def open_completed_session(request: OpenCompletedSessionRequest) -> SessionView:
        try:
            folder = selections.resolve(request.source_selection_id, "source")
        except KeyError as error:
            raise HTTPException(
                status_code=422, detail="Picker selection is invalid or expired"
            ) from error
        if not folder.is_dir():
            raise HTTPException(status_code=422, detail="Select a Completed Session Folder")
        try:
            return repository.get_by_completed_folder(folder)
        except SessionManifestError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Completed Session not found") from error

    @app.post("/api/pickers/completed-session", response_model=PickerSelection)
    def choose_completed_session(request: PickerRequest) -> PickerSelection:
        try:
            selected = app.state.picker.choose_completed_session_folder(
                Path(request.initial_path) if request.initial_path else None
            )
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        if selected is None:
            raise HTTPException(status_code=409, detail="Completed Session selection cancelled")
        if not selected.is_dir():
            raise HTTPException(status_code=422, detail="Selected Completed Session is not a folder")
        return PickerSelection(
            selection_id=selections.issue("source", selected),
            path=str(selected.resolve()),
            name=selected.name,
            media_kind=None,
        )

    @app.post(
        "/api/pickers/destination",
        response_model=PickerSelection,
        response_model_exclude_none=True,
    )
    def choose_destination(request: PickerRequest) -> PickerSelection:
        selected = app.state.picker.choose_destination(
            Path(request.initial_path) if request.initial_path else None
        )
        if selected is None:
            raise HTTPException(status_code=409, detail="Destination selection cancelled")
        if not selected.is_dir():
            raise HTTPException(status_code=422, detail="Selected Destination is not a directory")
        return PickerSelection(
            selection_id=selections.issue("destination", selected),
            path=str(selected.resolve()),
            name=selected.name,
        )

    @app.post("/api/pickers/destination-path", response_model=PickerSelection)
    def choose_destination_path(request: PathSelectionRequest) -> PickerSelection:
        selected = pasted_path(request.path)
        if not selected.is_dir():
            raise HTTPException(status_code=422, detail="Destination must be an existing directory")
        return PickerSelection(
            selection_id=selections.issue("destination", selected),
            path=str(selected),
            name=selected.name,
        )

    @app.post("/api/pickers/attachments", response_model=list[PickerSelection])
    def choose_attachments(request: PickerRequest) -> list[PickerSelection]:
        selected = app.state.picker.choose_attachments(
            Path(request.initial_path) if request.initial_path else None
        )
        if selected is None:
            raise HTTPException(status_code=409, detail="Attached Context selection cancelled")
        if any(not path.is_file() for path in selected):
            raise HTTPException(status_code=422, detail="Attached Context must be files")
        return [
            PickerSelection(
                selection_id=selections.issue("attachment", path),
                path=str(path.resolve()),
                name=path.name,
            )
            for path in selected
        ]

    @app.get("/api/sessions/{session_id}", response_model=SessionView)
    def get_session(session_id: str) -> SessionView:
        try:
            return add_source_metadata(repository.get(session_id))
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error

    @app.get("/api/sessions/{session_id}/attempts/{attempt_id}/snapshots/{filename}")
    def get_snapshot_preview(session_id: str, attempt_id: str, filename: str) -> FileResponse:
        try:
            session = repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error
        attempt = next((item for item in session.attempts if item.id == attempt_id), None)
        if attempt is None or attempt.result is None:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found")
        snapshot = next(
            (item for item in attempt.result.snapshots if item.filename == filename), None
        )
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        image_path = Path(snapshot.image_path)
        if not image_path.is_file():
            raise HTTPException(status_code=404, detail="Snapshot image is unavailable")
        return FileResponse(image_path, media_type="image/jpeg", filename=snapshot.filename)

    @app.patch(
        "/api/sessions/{session_id}/attempts/{attempt_id}/review",
        response_model=SessionView,
    )
    def update_review(
        session_id: str, attempt_id: str, update: ReviewUpdate
    ) -> SessionView:
        try:
            session = repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error
        if session.status == "finalizing":
            raise HTTPException(status_code=409, detail="Session commit is in progress")
        attempt = next((item for item in session.attempts if item.id == attempt_id), None)
        if attempt is None or attempt.result is None:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found")

        try:
            result = apply_review_update(session, attempt.result, update)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        try:
            return repository.update_attempt_result(
                session_id, attempt_id, result, update.session_date, update.session_time
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found") from error

    @app.post(
        "/api/sessions/{session_id}/attempts/{attempt_id}/commit",
        response_model=SessionView,
    )
    def commit_session(session_id: str, attempt_id: str) -> SessionView:
        def complete(assets):
            return repository.mark_commit_complete(
                session_id,
                source_path=str(assets.source_path),
                analysis_audio_path=str(assets.analysis_audio_path),
                completed_folder_path=str(assets.folder_path),
            )

        try:
            current = repository.get(session_id)
            if current.destination_path is None:
                raise HTTPException(status_code=422, detail="Select an Output Folder before committing")
            cross_volume = False
            if current.status in {"review", "needs_attention"}:
                cross_volume = not app.state.finalizer.paths_share_volume(
                    Path(current.source_path), Path(current.destination_path)
                )
            claim = repository.claim_commit(
                session_id,
                attempt_id,
                service_id=app.state.service_id,
                cross_volume=cross_volume,
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error
        except LookupError as error:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found") from error
        except RuntimeError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        session = claim.session
        if session.status == "completed" or (
            session.completed_folder_path is not None and not claim.resumes_finalization
        ):
            attempt = next(item for item in session.attempts if item.id == attempt_id)
            assert attempt.result is not None
            try:
                assets = app.state.finalizer.overwrite_completed_record(
                    session, attempt.result, committed_attempt_id=attempt_id
                )
            except FinalizationError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            return complete(assets)
        attempt = next(item for item in session.attempts if item.id == attempt_id)
        assert attempt.result is not None
        if claim.resumes_finalization:
            try:
                assets = app.state.finalizer.recover_published(
                    session,
                    attempt.result,
                    cross_volume=bool(claim.cross_volume),
                )
            except FinalizationError as error:
                repository.update_session(
                    session_id, status="needs_attention", stage="review", progress=100
                )
                raise HTTPException(status_code=422, detail=str(error)) from error
            return complete(assets)
        try:
            assets = app.state.finalizer.finalize(
                session, attempt.result, committed_attempt_id=attempt_id
            )
        except DestinationConflict as error:
            return repository.update_session(
                session_id, status="needs_attention", stage="review", progress=100
            )
        except FinalizationError as error:
            repository.update_session(session_id, status="needs_attention", stage="review", progress=100)
            raise HTTPException(status_code=422, detail=str(error)) from error
        return complete(assets)

    @app.post("/api/sessions/{session_id}/execute")
    def execute_session(
        session_id: str, request: ExecuteSessionRequest = ExecuteSessionRequest()
    ) -> StreamingResponse:
        try:
            session = repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error
        if session.status in {"processing", "finalizing"}:
            raise HTTPException(status_code=409, detail="Session is already processing or committing")
        changes: dict[str, object] = {}
        if request.model is not None and request.effort is not None:
            changes.update(model=request.model, effort=request.effort)
        if request.extra_instructions is not None:
            changes["extra_instructions"] = request.extra_instructions
        if request.speaker_hints is not None:
            changes["speaker_hints"] = request.speaker_hints
        if request.extraction_options is not None:
            changes["extraction_options"] = request.extraction_options.model_dump()
        if changes:
            repository.update_session(session_id, **changes)
        return StreamingResponse(
            pipeline.execute(session_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
