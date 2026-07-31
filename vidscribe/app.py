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
    ResolvedSessionIntake,
    SessionView,
)
from vidscribe.pickers import Picker, picker_for
from vidscribe.pipeline import SessionPipeline
from vidscribe.selections import SelectionRegistry
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
        allow_methods=["GET", "POST", "OPTIONS"],
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
        except KeyError as error:
            raise HTTPException(
                status_code=422, detail="Picker selection is invalid or expired"
            ) from error
        if not source.is_file():
            raise HTTPException(status_code=422, detail="Source Media must be an existing file")
        if not destination.is_dir():
            raise HTTPException(status_code=422, detail="Destination must be an existing directory")
        return repository.create(
            ResolvedSessionIntake(
                source_path=str(source),
                destination_path=str(destination),
                extra_instructions=request.extra_instructions,
                extraction_options=request.extraction_options,
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

    @app.get("/api/sessions/{session_id}", response_model=SessionView)
    def get_session(session_id: str) -> SessionView:
        try:
            return repository.get(session_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error

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
