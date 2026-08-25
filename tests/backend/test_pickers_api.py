from pathlib import Path
import shutil
import subprocess
from subprocess import CalledProcessError, CompletedProcess

from fastapi.testclient import TestClient
import pytest

from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.pickers import MacOSPicker


class FixedPicker:
    def __init__(self, source: Path, destination: Path):
        self.source = source
        self.destination = destination

    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        return self.source

    def choose_completed_session_folder(self, initial_path: Path | None = None) -> Path | None:
        return None

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self.destination


class BrokenSourcePicker(FixedPicker):
    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        raise RuntimeError("The macOS picker could not open")


class CompletedSessionPicker(FixedPicker):
    def __init__(self, source: Path, destination: Path, completed_folder: Path):
        super().__init__(source, destination)
        self.completed_folder = completed_folder

    def choose_completed_session_folder(self, initial_path: Path | None = None) -> Path | None:
        return self.completed_folder


def test_service_owned_picker_capabilities_are_required_for_session_paths(
    tmp_path: Path,
) -> None:
    source = tmp_path / "capture.mp4"
    source.write_bytes(b"video")
    destination = tmp_path / "records"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data")

    with TestClient(
        create_app(settings, picker=FixedPicker(source, destination))
    ) as client:
        selected_source = client.post("/api/pickers/source", json={})
        selected_destination = client.post("/api/pickers/destination", json={})
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": selected_source.json()["selection_id"],
                "destination_selection_id": selected_destination.json()["selection_id"],
                "session_date": "2026-07-31",
            },
        )
        forged = client.post(
            "/api/sessions",
            json={
                "source_selection_id": "forged-source-capability",
                "destination_selection_id": selected_destination.json()["selection_id"],
            },
        )
        raw_paths = client.post(
            "/api/sessions",
            json={
                "source_path": str(source),
                "destination_path": str(destination),
            },
        )

    assert selected_source.status_code == 200
    source_payload = selected_source.json()
    source_selection_id = source_payload.pop("selection_id")
    assert len(source_selection_id) >= 32
    assert source_payload == {
        "path": str(source.resolve()),
        "name": "capture.mp4",
        "media_kind": "video",
        "size_bytes": 5,
        "duration_seconds": None,
        "source_date": None,
    }
    assert selected_destination.status_code == 200
    destination_payload = selected_destination.json()
    destination_selection_id = destination_payload.pop("selection_id")
    assert len(destination_selection_id) >= 32
    assert destination_payload == {
        "path": str(destination.resolve()),
        "name": "records",
    }
    assert created.status_code == 201
    assert created.json()["source_path"] == str(source.resolve())
    assert created.json()["destination_path"] == str(destination.resolve())
    assert forged.status_code == 422
    assert raw_paths.status_code == 422


def test_session_can_be_created_before_an_output_folder_is_selected(tmp_path: Path) -> None:
    source = tmp_path / "capture.mp4"
    source.write_bytes(b"video")
    destination = tmp_path / "records"
    destination.mkdir()

    with TestClient(
        create_app(Settings(data_dir=tmp_path / "data"), picker=FixedPicker(source, destination))
    ) as client:
        selected_source = client.post("/api/pickers/source", json={}).json()
        created = client.post(
            "/api/sessions",
            json={"source_selection_id": selected_source["selection_id"], "session_date": "2026-07-31"},
        )
        blocked_commit = client.post(
            f"/api/sessions/{created.json()['id']}/attempts/missing/commit"
        )
        selected_destination = client.post("/api/pickers/destination", json={}).json()
        assigned = client.put(
            f"/api/sessions/{created.json()['id']}/destination",
            json={"destination_selection_id": selected_destination["selection_id"]},
        )

    assert created.status_code == 201
    assert created.json()["destination_path"] is None
    assert blocked_commit.status_code == 422
    assert blocked_commit.json()["detail"] == "Select an Output Folder before committing"
    assert assigned.status_code == 200
    assert assigned.json()["destination_path"] == str(destination.resolve())


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_source_picker_returns_size_and_duration_before_session_creation(tmp_path: Path) -> None:
    source = tmp_path / "2026-08-11 16-59-57.wav"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1.25", "-y", str(source),
        ],
        check=True,
    )
    destination = tmp_path / "records"
    destination.mkdir()

    with TestClient(
        create_app(Settings(data_dir=tmp_path / "data"), picker=FixedPicker(source, destination))
    ) as client:
        selected = client.post("/api/pickers/source", json={})
        created = client.post(
            "/api/sessions",
            json={"source_selection_id": selected.json()["selection_id"], "session_date": "2026-07-31"},
        )
        hydrated = client.get(f"/api/sessions/{created.json()['id']}")

    payload = selected.json()
    assert selected.status_code == 200
    assert payload["size_bytes"] == source.stat().st_size
    assert payload["duration_seconds"] == pytest.approx(1.25, abs=0.05)
    assert payload["source_date"] == "2026-08-11"
    assert hydrated.json()["source_size_bytes"] == source.stat().st_size
    assert hydrated.json()["source_duration_seconds"] == pytest.approx(1.25, abs=0.05)
    assert hydrated.json()["source_date"] == "2026-08-11"


def test_test_mode_picker_uses_explicit_environment_paths(tmp_path: Path) -> None:
    source = tmp_path / "fixture.wav"
    source.write_bytes(b"audio")
    destination = tmp_path / "output"
    destination.mkdir()

    with TestClient(
        create_app(
            Settings(
                data_dir=tmp_path / "data",
                test_mode=True,
                test_source_path=source,
                test_destination_path=destination,
            )
        )
    ) as client:
        selected = client.post("/api/pickers/source", json={})

    assert selected.json()["path"] == str(source.resolve())


def test_source_picker_failure_returns_a_service_error_instead_of_a_500(tmp_path: Path) -> None:
    source = tmp_path / "fixture.wav"
    source.write_bytes(b"audio")
    destination = tmp_path / "output"
    destination.mkdir()

    with TestClient(
        create_app(Settings(data_dir=tmp_path / "data"), picker=BrokenSourcePicker(source, destination))
    ) as client:
        selected = client.post("/api/pickers/source", json={})

    assert selected.status_code == 503
    assert selected.json()["detail"] == "The macOS picker could not open"


def test_native_source_picker_wraps_subprocess_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("vidscribe.pickers.platform.system", lambda: "Darwin")
    monkeypatch.setattr(
        MacOSPicker,
        "_source_picker_executable",
        lambda _picker: Path("/tmp/vidscribe-source-picker"),
    )

    def fail_picker(*_args: object, **_kwargs: object) -> None:
        raise CalledProcessError(1, ["osascript"], stderr="JXA panel failure")

    monkeypatch.setattr("vidscribe.pickers.subprocess.run", fail_picker)

    with pytest.raises(RuntimeError, match="Native picker failed: JXA panel failure"):
        MacOSPicker().choose_source()


def test_native_source_picker_uses_the_combined_appkit_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    executable = Path("/tmp/vidscribe-source-picker")
    monkeypatch.setattr("vidscribe.pickers.platform.system", lambda: "Darwin")
    monkeypatch.setattr(MacOSPicker, "_source_picker_executable", lambda _picker: executable)
    monkeypatch.setattr(
        "vidscribe.pickers.subprocess.run",
        lambda command, **_kwargs: CompletedProcess(command, 0, stdout="/tmp/completed-session\n"),
    )

    selected = MacOSPicker().choose_source(Path("/tmp"))

    assert selected == Path("/tmp/completed-session").resolve()


def test_completed_session_picker_issues_a_source_selection_for_a_folder(tmp_path: Path) -> None:
    source = tmp_path / "fixture.wav"
    source.write_bytes(b"audio")
    destination = tmp_path / "output"
    destination.mkdir()
    completed_folder = destination / "2026-07-31-team-sync"
    completed_folder.mkdir()

    with TestClient(
        create_app(
            Settings(data_dir=tmp_path / "data"),
            picker=CompletedSessionPicker(source, destination, completed_folder),
        )
    ) as client:
        selected = client.post("/api/pickers/completed-session", json={})

    assert selected.status_code == 200
    payload = selected.json()
    assert len(payload.pop("selection_id")) >= 32
    assert payload == {
        "path": str(completed_folder.resolve()),
        "name": "2026-07-31-team-sync",
        "media_kind": None,
        "size_bytes": None,
        "duration_seconds": None,
        "source_date": None,
    }
