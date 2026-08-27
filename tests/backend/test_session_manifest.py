import json
import shutil
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.config import Settings


def make_recording(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(path),
        ],
        check=True,
    )


def test_completed_session_manifest_survives_folder_move_and_fresh_database(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "original-data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
            },
        ).json()
        session_id = created["id"]
        assert client.post(f"/api/sessions/{session_id}/execute").status_code == 200
        attempt_id = client.get(f"/api/sessions/{session_id}").json()["attempts"][0]["id"]
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    completed_folder = Path(committed.json()["completed_folder_path"])
    manifest = json.loads((completed_folder / "session.json").read_text(encoding="utf-8"))
    assert manifest["format"] == "speech-distiller.session"
    assert manifest["schema_version"] == 1
    assert not Path(manifest["session"]["source_path"]).is_absolute()
    assert manifest["assets"]["source_media"]["path"] == manifest["session"]["source_path"]

    moved_destination = tmp_path / "moved-destination"
    moved_destination.mkdir()
    moved_folder = moved_destination / completed_folder.name
    shutil.move(str(completed_folder), str(moved_folder))

    fresh_settings = Settings(
        data_dir=tmp_path / "fresh-data",
        test_mode=True,
        test_source_path=moved_folder,
        test_destination_path=moved_destination,
    )
    with TestClient(create_app(fresh_settings)) as client:
        selection = client.post("/api/pickers/source", json={}).json()
        reopened = client.post(
            "/api/sessions/open-completed",
            json={"source_selection_id": selection["selection_id"]},
        )
        restored = client.get(f"/api/sessions/{session_id}")

    assert reopened.status_code == 200
    assert restored.status_code == 200
    assert restored.json()["id"] == session_id
    assert restored.json()["attempts"][0]["result"]["session_record_markdown"]
    assert restored.json()["source_path"] == str(
        (moved_folder / manifest["session"]["source_path"]).resolve()
    )
