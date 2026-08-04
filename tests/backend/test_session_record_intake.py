import subprocess
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.pickers import ConfiguredPicker
from vidscribe.transcription import DeterministicTranscriber


def create_request(client: TestClient, *, session_date: str | None = None):
    source = client.post("/api/pickers/source", json={}).json()
    destination = client.post("/api/pickers/destination", json={}).json()
    body = {
        "source_selection_id": source["selection_id"],
        "destination_selection_id": destination["selection_id"],
    }
    if session_date is not None:
        body["session_date"] = session_date
    return client.post("/api/sessions", json=body)


def make_recording(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "-y", str(path),
        ],
        check=True,
    )


def test_session_date_uses_a_valid_filename_before_user_confirmation(tmp_path: Path) -> None:
    source = tmp_path / "planning-2026-07-31.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        response = create_request(client)

    assert response.status_code == 201
    assert response.json()["session_date"] == "2026-07-31"


def test_session_date_defaults_to_creation_day_when_source_has_no_reliable_date(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    source.write_bytes(b"recording")
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        missing = create_request(client)

    confirmed_source = tmp_path / "confirmed-recording.wav"
    confirmed_source.write_bytes(b"confirmed recording")
    settings.test_source_path = confirmed_source

    with TestClient(create_app(settings)) as client:
        confirmed = create_request(client, session_date="2026-08-01")

    assert missing.status_code == 201
    assert missing.json()["session_date"] == date.today().isoformat()
    assert confirmed.status_code == 201
    assert confirmed.json()["session_date"] == "2026-08-01"


class CapturingAnalyzer:
    model = "deterministic-analysis"
    effort = "medium"

    def __init__(self) -> None:
        self.input = None

    def stream(self, audio_path: Path, analysis_input):
        del audio_path
        self.input = analysis_input
        yield (
            '{"session_record_markdown":"# Record","short_name":"Record Sync",'
            '"session_date":"07-31-2026","speaker_labels":["Speaker 1"]}'
        )


def test_attached_context_remains_in_place_and_is_passed_to_analysis(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    attachment = tmp_path / "project-glossary.md"
    attachment.write_text("Use Vidscribe, never VidScribe.")
    analyzer = CapturingAnalyzer()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True)

    with TestClient(
        create_app(
            settings,
            picker=ConfiguredPicker(source, destination, [attachment]),
            transcriber=DeterministicTranscriber(),
            analyzer=analyzer,
        )
    ) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        attachments = client.post("/api/pickers/attachments", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
                "attachment_selection_ids": [attachments[0]["selection_id"]],
            },
        )
        session_id = created.json()["id"]
        client.post(f"/api/sessions/{session_id}/execute")

    assert created.status_code == 201
    assert attachment.is_file()
    assert created.json()["attachment_paths"] == [str(attachment)]
    assert analyzer.input.attached_context == [("project-glossary.md", "Use Vidscribe, never VidScribe.")]
