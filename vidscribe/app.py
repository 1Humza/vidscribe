import re
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from vidscribe.analysis import Analyzer, DeterministicAnalyzer, GeminiAnalyzer
from vidscribe.config import Settings
from vidscribe.database import SessionRepository
from vidscribe.media import FFmpegMediaPreparer
from vidscribe.models import (
    CreateSessionRequest,
    PickerRequest,
    PickerSelection,
    ReviewUpdate,
    ResolvedSessionIntake,
    SessionView,
)
from vidscribe.pickers import Picker, picker_for
from vidscribe.pipeline import SessionPipeline
from vidscribe.selections import SelectionRegistry
from vidscribe.session_dates import infer_session_date
from vidscribe.session_record import validate_session_record
from vidscribe.transcription import DeterministicTranscriber, GroqWhisperTranscriber, Transcriber


def create_app(
    settings: Settings | None = None,
    *,
    picker: Picker | None = None,
    transcriber: Transcriber | None = None,
    analyzer: Analyzer | None = None,
    media_preparer: FFmpegMediaPreparer | None = None,
) -> FastAPI:
    app_settings = settings or Settings()
    assert app_settings.database_path is not None
    assert app_settings.workspace_path is not None
    app_settings.workspace_path.mkdir(parents=True, exist_ok=True)
    repository = SessionRepository(app_settings.database_path)
    app = FastAPI(title="Vidscribe", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.state.settings = app_settings
    app.state.sessions = repository
    app.state.picker = picker or picker_for(app_settings)
    selections = SelectionRegistry()
    app.state.selections = selections
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
    )
    app.state.pipeline = pipeline

    @app.middleware("http")
    async def enforce_loopback_host(request: Request, call_next):
        hostname = (request.url.hostname or "").lower()
        if hostname not in {"127.0.0.1", "localhost", "::1", "testserver"}:
            return JSONResponse(
                status_code=421,
                content={"detail": "Vidscribe accepts loopback requests only"},
            )
        return await call_next(request)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/sessions", response_model=SessionView, status_code=201)
    def create_session(request: CreateSessionRequest) -> SessionView:
        try:
            source = selections.resolve(request.source_selection_id, "source")
            destination = selections.resolve(
                request.destination_selection_id, "destination"
            )
            attachments = [
                selections.resolve(selection_id, "attachment")
                for selection_id in request.attachment_selection_ids
            ]
        except KeyError as error:
            raise HTTPException(
                status_code=422, detail="Picker selection is invalid or expired"
            ) from error
        if not source.is_file():
            raise HTTPException(status_code=422, detail="Source Media must be an existing file")
        if not destination.is_dir():
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
                destination_path=str(destination),
                extra_instructions=request.extra_instructions,
                speaker_hints=request.speaker_hints,
                extraction_options=request.extraction_options,
                session_date=session_date,
                attachment_paths=[str(attachment) for attachment in attachments],
            )
        )

    @app.post("/api/pickers/source", response_model=PickerSelection)
    def choose_source(request: PickerRequest) -> PickerSelection:
        selected = app.state.picker.choose_source(
            Path(request.initial_path) if request.initial_path else None
        )
        if selected is None:
            raise HTTPException(status_code=409, detail="Source Media selection cancelled")
        if not selected.is_file():
            raise HTTPException(status_code=422, detail="Selected Source Media is not a file")
        audio_extensions = {".aac", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
        return PickerSelection(
            selection_id=selections.issue("source", selected),
            path=str(selected.resolve()),
            name=selected.name,
            media_kind="audio" if selected.suffix.lower() in audio_extensions else "video",
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
            return repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error

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
        attempt = next((item for item in session.attempts if item.id == attempt_id), None)
        if attempt is None or attempt.result is None:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found")

        result = attempt.result.model_copy(deep=True)
        markdown = update.session_record_markdown or result.session_record_markdown
        previous_date = result.session_date
        previous_title = result.short_name
        if update.session_date is not None:
            result.session_date = update.session_date.strftime("%m-%d-%Y")
        if update.short_name is not None:
            result.short_name = update.short_name.strip()
        markdown = markdown.replace(previous_date, result.session_date)
        markdown = markdown.replace(previous_title, result.short_name)

        labels = list(result.speaker_labels)
        unknown_labels = set(update.speaker_renames) - set(labels)
        if unknown_labels:
            raise HTTPException(status_code=422, detail="Speaker Label is not in this Session")
        for index, label in enumerate(labels):
            replacement = update.speaker_renames.get(label)
            if replacement is not None:
                labels[index] = replacement.strip()
        if len({label.casefold() for label in labels}) != len(labels):
            raise HTTPException(status_code=422, detail="Speaker Labels must be unique")
        for old, new in update.speaker_renames.items():
            markdown = re.sub(rf"(?<!\\w){re.escape(old)}(?!\\w)", new.strip(), markdown)
        for turn in result.corrected_transcript_turns:
            if turn.speaker_label in update.speaker_renames:
                turn.speaker_label = update.speaker_renames[turn.speaker_label].strip()
        result.speaker_labels = labels
        result.session_record_markdown = markdown
        try:
            validate_session_record(markdown, session.extraction_options)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        try:
            return repository.update_attempt_result(
                session_id, attempt_id, result, update.session_date
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Completed Analysis Attempt not found") from error

    @app.post("/api/sessions/{session_id}/execute")
    def execute_session(session_id: str) -> StreamingResponse:
        try:
            repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error
        return StreamingResponse(
            pipeline.execute(session_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
