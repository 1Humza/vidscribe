import re
from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from vidscribe.analysis import Analyzer, DeterministicAnalyzer, GeminiAnalyzer
from vidscribe.config import Settings
from vidscribe.database import SessionRepository
from vidscribe.fingerprints import source_fingerprint
from vidscribe.finalization import DestinationConflict, FinalizationError, SessionFinalizer
from vidscribe.media import FFmpegMediaPreparer
from vidscribe.models import (
    CreateSessionRequest,
    ExecuteSessionRequest,
    Mention,
    OpenCompletedSessionRequest,
    OpenSourceSessionRequest,
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
from vidscribe.snapshots import render_snapshot_section
from vidscribe.transcription import DeterministicTranscriber, GroqWhisperTranscriber, Transcriber


def _replacement_with_source_capitalization(source: str, replacement: str) -> str:
    """Keep an initial sentence capital when a grouped mention is corrected."""
    source_letter = next((character for character in source if character.isalpha()), "")
    replacement_index = next(
        (index for index, character in enumerate(replacement) if character.isalpha()),
        None,
    )
    if (
        not source_letter
        or replacement_index is None
        or not source_letter.isupper()
        or source.upper() == source
    ):
        return replacement
    return (
        replacement[:replacement_index]
        + replacement[replacement_index].upper()
        + replacement[replacement_index + 1 :]
    )


def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    """Match words despite Whisper/Markdown boundary punctuation differences."""
    words = re.findall(r"[^\W_]+(?:['’][^\W_]+)?", phrase)
    if not words:
        raise ValueError("Phrase Correction must contain a spoken word")
    joined_words = r"[\W_]+".join(re.escape(word) for word in words)
    return re.compile(rf"(?<!\w){joined_words}(?!\w)", flags=re.IGNORECASE)


def _replace_phrase_everywhere(text: str, phrase: str, replacement: str) -> tuple[str, int]:
    """Replace a reviewed phrase while retaining each occurrence's sentence case."""
    pattern = _phrase_pattern(phrase)
    return pattern.subn(
        lambda match: _replacement_with_source_capitalization(match.group(0), replacement),
        text,
    )


def _snapshot_filename_for_subject(filename: str, subject: str) -> str:
    """Keep the generated sequence while deriving the readable filename from its subject."""
    sequence, separator, _ = filename.partition("-")
    if not separator:
        return filename
    slug = re.sub(r"[^a-z0-9]+", "-", subject.casefold()).strip("-")
    return f"{sequence}-{slug}.jpg" if slug else filename


def _propagate_phrase_correction(result, markdown: str, phrase: str, replacement: str) -> tuple[str, int]:
    """Keep every reviewed representation of a mention synchronized from one edit."""
    markdown, replacement_count = _replace_phrase_everywhere(markdown, phrase, replacement)
    for snapshot in result.snapshots:
        snapshot.subject, subject_count = _replace_phrase_everywhere(
            snapshot.subject, phrase, replacement
        )
        snapshot.cue_phrase, cue_count = _replace_phrase_everywhere(
            snapshot.cue_phrase, phrase, replacement
        )
        snapshot.anchor_word, anchor_count = _replace_phrase_everywhere(
            snapshot.anchor_word, phrase, replacement
        )
        replacement_count += subject_count + cue_count + anchor_count
        if subject_count:
            snapshot.filename = _snapshot_filename_for_subject(
                snapshot.filename, snapshot.subject
            )
    return markdown, replacement_count


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
    app.state.finalizer = finalizer or SessionFinalizer()
    app.state.service_id = str(uuid4())

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
                source_fingerprint=source_fingerprint(source),
                destination_path=str(destination),
                extra_instructions=request.extra_instructions,
                speaker_hints=request.speaker_hints,
                extraction_options=request.extraction_options,
                model=request.model,
                effort=request.effort,
                session_date=session_date,
                attachment_paths=[str(attachment) for attachment in attachments],
            )
        )

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
        if not selected.is_file():
            raise HTTPException(status_code=422, detail="Selected Source Media is not a file or folder")
        audio_extensions = {".aac", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
        return PickerSelection(
            selection_id=selections.issue("source", selected),
            path=str(selected.resolve()),
            name=selected.name,
            media_kind="audio" if selected.suffix.lower() in audio_extensions else "video",
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
        for mention in result.mentions:
            if mention.speaker_label in update.speaker_renames:
                mention.speaker_label = update.speaker_renames[mention.speaker_label].strip()
        for snapshot in result.snapshots:
            if snapshot.speaker_label in update.speaker_renames:
                snapshot.speaker_label = update.speaker_renames[snapshot.speaker_label].strip()
        result.speaker_labels = labels
        processed_phrase_corrections: set[tuple[str, str]] = set()
        for correction in update.phrase_corrections:
            matching_mention = next(
                (
                    mention
                    for mention in result.mentions
                    if (
                        mention.source_word_start == correction.source_word_start
                        and mention.source_word_end == correction.source_word_end
                    )
                ),
                None,
            )
            words = session.transcript_word_timings[
                correction.source_word_start : correction.source_word_end + 1
            ]
            if len(words) != correction.source_word_end - correction.source_word_start + 1:
                raise HTTPException(status_code=422, detail="Phrase Correction exceeds canonical Whisper word range")
            heard_phrase = " ".join(str(word["word"]).strip() for word in words).strip()
            current_phrase = (
                matching_mention.replacement or heard_phrase
                if matching_mention is not None
                else heard_phrase
            )
            try:
                correction_key = (
                    " ".join(re.findall(r"[^\W_]+(?:['’][^\W_]+)?", current_phrase)).casefold(),
                    correction.replacement.strip().casefold(),
                )
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            if correction_key not in processed_phrase_corrections:
                try:
                    markdown, replacement_count = _propagate_phrase_correction(
                        result, markdown, current_phrase, correction.replacement.strip()
                    )
                except ValueError as error:
                    raise HTTPException(status_code=422, detail=str(error)) from error
                if replacement_count == 0:
                    raise HTTPException(
                        status_code=422,
                        detail="Phrase Correction text is no longer present in this Session",
                    )
                processed_phrase_corrections.add(correction_key)
            replacement = _replacement_with_source_capitalization(
                heard_phrase, correction.replacement.strip()
            )
            if matching_mention is not None:
                matching_mention.replacement = replacement
            else:
                result.mentions.append(
                    Mention(
                        source_word_start=correction.source_word_start,
                        source_word_end=correction.source_word_end,
                        replacement=replacement,
                    )
                )
        known_snapshot_names = {snapshot.filename for snapshot in result.snapshots}
        unknown_snapshot_names = set(update.snapshot_keeps) - known_snapshot_names
        if unknown_snapshot_names:
            raise HTTPException(status_code=422, detail="Snapshot is not proposed for this Session")
        for snapshot in result.snapshots:
            if snapshot.filename in update.snapshot_keeps:
                snapshot.kept = update.snapshot_keeps[snapshot.filename]
        markdown = render_snapshot_section(
            markdown,
            result.source_media_has_video,
            result.snapshots,
        )
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

    @app.post(
        "/api/sessions/{session_id}/attempts/{attempt_id}/commit",
        response_model=SessionView,
    )
    def commit_session(session_id: str, attempt_id: str) -> SessionView:
        try:
            current = repository.get(session_id)
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
        if session.status == "completed" or session.completed_folder_path is not None:
            attempt = next(item for item in session.attempts if item.id == attempt_id)
            assert attempt.result is not None
            try:
                assets = app.state.finalizer.overwrite_completed_record(session, attempt.result)
            except FinalizationError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            return repository.update_session(
                session_id,
                status="completed",
                stage="completed",
                progress=100,
                source_path=str(assets.source_path),
                analysis_audio_path=str(assets.analysis_audio_path),
                completed_folder_path=str(assets.folder_path),
                finalizing_attempt_id=None,
                finalizing_service_id=None,
                finalizing_cross_volume=None,
            )
        attempt = next(item for item in session.attempts if item.id == attempt_id)
        assert attempt.result is not None
        if claim.resumes_finalization:
            try:
                assets = app.state.finalizer.recover_published(
                    session, attempt.result, cross_volume=bool(claim.cross_volume)
                )
            except FinalizationError as error:
                repository.update_session(
                    session_id, status="needs_attention", stage="review", progress=100
                )
                raise HTTPException(status_code=422, detail=str(error)) from error
            return repository.update_session(
                session_id,
                status="completed",
                stage="completed",
                progress=100,
                source_path=str(assets.source_path),
                analysis_audio_path=str(assets.analysis_audio_path),
                completed_folder_path=str(assets.folder_path),
                finalizing_attempt_id=None,
                finalizing_service_id=None,
                finalizing_cross_volume=None,
            )
        try:
            assets = app.state.finalizer.finalize(session, attempt.result)
        except DestinationConflict as error:
            return repository.update_session(
                session_id, status="needs_attention", stage="review", progress=100
            )
        except FinalizationError as error:
            repository.update_session(session_id, status="needs_attention", stage="review", progress=100)
            raise HTTPException(status_code=422, detail=str(error)) from error
        return repository.update_session(
            session_id,
            status="completed",
            stage="completed",
            progress=100,
            source_path=str(assets.source_path),
            analysis_audio_path=str(assets.analysis_audio_path),
            completed_folder_path=str(assets.folder_path),
            finalizing_attempt_id=None,
            finalizing_service_id=None,
            finalizing_cross_volume=None,
        )

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
        if request.model is not None and request.effort is not None:
            repository.update_session(session_id, model=request.model, effort=request.effort)
        return StreamingResponse(
            pipeline.execute(session_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
