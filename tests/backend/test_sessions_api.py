import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.analysis import DeterministicAnalyzer
from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.media import FFmpegMediaPreparer
from vidscribe.transcription import DeterministicTranscriber


def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_path=tmp_path / "state.sqlite3",
        workspace_path=tmp_path / "workspace",
        test_mode=True,
    )


def make_recording(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "-y", str(path),
        ],
        check=True,
    )


class CountingTranscriber(DeterministicTranscriber):
    def __init__(self) -> None:
        self.calls = 0

    def transcribe(self, audio_path: Path):
        self.calls += 1
        return super().transcribe(audio_path)


class CountingMediaPreparer(FFmpegMediaPreparer):
    def __init__(self) -> None:
        super().__init__()
        self.calls = 0

    def prepare(self, source: Path, output: Path) -> Path:
        self.calls += 1
        return super().prepare(source, output)


def test_session_intake_survives_service_restart(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    source.write_bytes(b"recording")
    destination = tmp_path / "sessions"
    destination.mkdir()
    app_settings = settings(tmp_path)
    app_settings.test_source_path = source
    app_settings.test_destination_path = destination

    with TestClient(create_app(app_settings)) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
                "extra_instructions": "Preserve product names.",
                "speaker_hints": ["Alex", "Sam"],
                "session_date": "2026-07-31",
                "extraction_options": {
                    "action_summary": True,
                    "topics": False,
                    "chapters": True,
                    "highlights": False,
                },
            },
        )
        assert created.status_code == 201
        session_id = created.json()["id"]

    with TestClient(create_app(app_settings)) as restarted_client:
        restored = restarted_client.get(f"/api/sessions/{session_id}")

    assert restored.status_code == 200
    assert restored.json() == {
        "id": session_id,
        "status": "ready",
        "stage": "intake",
        "progress": 0,
        "source_path": str(source.resolve()),
        "destination_path": str(destination.resolve()),
        "extra_instructions": "Preserve product names.",
        "speaker_hints": ["Alex", "Sam"],
        "extraction_options": {
            "action_summary": True,
            "topics": False,
            "chapters": True,
            "highlights": False,
        },
        "analysis_audio_path": None,
        "transcript": None,
        "session_date": "2026-07-31",
        "attachment_paths": [],
        "transcript_word_timings": [],
        "completed_folder_path": None,
        "attempts": [],
        "created_at": restored.json()["created_at"],
        "updated_at": restored.json()["updated_at"],
    }


def test_reselecting_renamed_source_restores_its_session(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    source.write_bytes(b"recording")
    destination = tmp_path / "sessions"
    destination.mkdir()
    app_settings = settings(tmp_path)
    app_settings.test_source_path = source
    app_settings.test_destination_path = destination

    with TestClient(create_app(app_settings)) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
                "extra_instructions": "Keep this intake.",
                "session_date": "2026-07-31",
            },
        ).json()

    renamed_source = tmp_path / "renamed-recording.wav"
    source.rename(renamed_source)
    app_settings.test_source_path = renamed_source

    with TestClient(create_app(app_settings)) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        restored = client.post(
            "/api/sessions/open-source",
            json={"source_selection_id": source_selection["selection_id"]},
        )

    assert restored.status_code == 200
    assert restored.json()["id"] == created["id"]
    assert restored.json()["source_path"] == str(renamed_source.resolve())
    assert restored.json()["extra_instructions"] == "Keep this intake."


def test_service_restart_recovers_processing_session_for_reexecution(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    make_recording(source)
    destination = tmp_path / "sessions"
    destination.mkdir()
    app_settings = settings(tmp_path)
    app_settings.test_source_path = source
    app_settings.test_destination_path = destination
    transcriber = CountingTranscriber()
    media_preparer = CountingMediaPreparer()

    with TestClient(
        create_app(
            app_settings,
            transcriber=transcriber,
            analyzer=DeterministicAnalyzer(delay_seconds=0),
            media_preparer=media_preparer,
        )
    ) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
                "session_date": "2026-07-31",
            },
        ).json()
        repository = client.app.state.sessions
        assert client.post(f"/api/sessions/{created['id']}/execute").status_code == 200
        prepared = client.get(f"/api/sessions/{created['id']}").json()
        interrupted_attempt_id = repository.create_attempt(
            created["id"], "deterministic-analysis", "medium"
        )
        repository.append_attempt_stream(interrupted_attempt_id, '{"partial":"kept"}')
        repository.update_session(
            created["id"],
            status="processing",
            stage="analyzing",
            progress=70,
        )

    with TestClient(
        create_app(
            app_settings,
            transcriber=transcriber,
            analyzer=DeterministicAnalyzer(delay_seconds=0),
            media_preparer=media_preparer,
        )
    ) as restarted_client:
        recovered = restarted_client.get(f"/api/sessions/{created['id']}")
        rerun = restarted_client.post(f"/api/sessions/{created['id']}/execute")

    assert recovered.status_code == 200
    assert recovered.json()["status"] == "ready"
    assert recovered.json()["stage"] == "intake"
    assert recovered.json()["progress"] == 0
    assert recovered.json()["analysis_audio_path"] == prepared["analysis_audio_path"]
    assert recovered.json()["transcript"] == prepared["transcript"]
    interrupted_attempt = next(
        attempt
        for attempt in recovered.json()["attempts"]
        if attempt["id"] == interrupted_attempt_id
    )
    assert interrupted_attempt == {
        "id": interrupted_attempt_id,
        "status": "error",
        "model": "deterministic-analysis",
        "effort": "medium",
        "raw_stream": '{"partial":"kept"}',
        "result": None,
        "error": "Analysis generation was interrupted. Execute again to retry.",
    }
    assert rerun.status_code == 200
    assert media_preparer.calls == 1
    assert transcriber.calls == 1


def test_remote_host_header_is_rejected(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/api/sessions/not-real", headers={"host": "example.com"})

    assert response.status_code == 421


def test_health_reports_local_service_ready(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
