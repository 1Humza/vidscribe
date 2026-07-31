from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.config import Settings


def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_path=tmp_path / "state.sqlite3",
        workspace_path=tmp_path / "workspace",
        test_mode=True,
    )


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
        "extraction_options": {
            "action_summary": True,
            "topics": False,
            "chapters": True,
            "highlights": False,
        },
        "analysis_audio_path": None,
        "transcript": None,
        "attempts": [],
        "created_at": restored.json()["created_at"],
        "updated_at": restored.json()["updated_at"],
    }


def test_remote_host_header_is_rejected(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/api/sessions/not-real", headers={"host": "example.com"})

    assert response.status_code == 421


def test_health_reports_local_service_ready(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
