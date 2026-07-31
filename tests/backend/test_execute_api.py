import hashlib
import json
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.analysis import DeterministicAnalyzer
from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.transcription import DeterministicTranscriber


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
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=mono:sample_rate=48000:duration=16",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=1",
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
            "-map",
            "[out]",
            str(path),
        ],
        check=True,
    )


def parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = block.splitlines()
        event = next(line[7:] for line in lines if line.startswith("event: "))
        data = next(line[6:] for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


def create_session(client: TestClient, source: Path, destination: Path) -> str:
    selected_source = client.post("/api/pickers/source", json={}).json()
    selected_destination = client.post("/api/pickers/destination", json={}).json()
    response = client.post(
        "/api/sessions",
        json={
            "source_selection_id": selected_source["selection_id"],
            "destination_selection_id": selected_destination["selection_id"],
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_execute_streams_real_media_pipeline_and_persists_review(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    make_recording(source)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    destination = tmp_path / "destination"
    destination.mkdir()
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            test_mode=True,
            test_source_path=source,
            test_destination_path=destination,
        ),
        transcriber=DeterministicTranscriber(),
        analyzer=DeterministicAnalyzer(delay_seconds=0),
    )

    with TestClient(app) as client:
        session_id = create_session(client, source, destination)
        streamed = client.post(f"/api/sessions/{session_id}/execute")
        restored = client.get(f"/api/sessions/{session_id}").json()

    assert streamed.status_code == 200
    events = parse_sse(streamed.text)
    assert [name for name, _ in events] == [
        "session",
        "session",
        "session",
        "analysis_delta",
        "analysis_delta",
        "complete",
    ]
    assert events[0][1]["stage"] == "preparing"
    assert events[1][1]["stage"] == "transcribing"
    assert events[2][1]["stage"] == "analyzing"
    assert restored["status"] == "review"
    assert restored["stage"] == "review"
    assert restored["progress"] == 100
    assert Path(restored["analysis_audio_path"]).is_file()
    assert "[00:00] Speaker 1: Before" in restored["transcript"]
    assert "(Silence 00:16)" in restored["transcript"]
    assert "[00:17] Speaker 1: After" in restored["transcript"]
    assert restored["attempts"][0]["status"] == "completed"
    assert "After" in restored["attempts"][0]["result"]["session_record_markdown"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    assert source.is_file()


def test_generation_failure_streams_error_and_persists_visible_partial(
    tmp_path: Path,
) -> None:
    source = tmp_path / "recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            test_mode=True,
            test_source_path=source,
            test_destination_path=destination,
        ),
        transcriber=DeterministicTranscriber(),
        analyzer=DeterministicAnalyzer(delay_seconds=0, fail_after_first=True),
    )

    with TestClient(app) as client:
        session_id = create_session(client, source, destination)
        events = parse_sse(client.post(f"/api/sessions/{session_id}/execute").text)
        restored = client.get(f"/api/sessions/{session_id}").json()

    names = [name for name, _ in events]
    assert names[-2:] == ["analysis_error", "session"]
    assert "analysis_delta" in names
    error = next(data for name, data in events if name == "analysis_error")
    assert error["raw_stream"]
    assert error["message"] == "Analysis generation stopped. Partial output was preserved."
    assert restored["status"] == "error"
    assert restored["attempts"][0]["status"] == "error"
    assert restored["attempts"][0]["raw_stream"] == error["raw_stream"]
    assert restored["attempts"][0]["error"] == error["message"]


class CountingTranscriber(DeterministicTranscriber):
    def __init__(self):
        self.calls = 0

    def transcribe(self, audio_path: Path):
        self.calls += 1
        return super().transcribe(audio_path)


def test_reexecution_reuses_valid_audio_and_transcript(tmp_path: Path) -> None:
    source = tmp_path / "recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    transcriber = CountingTranscriber()
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            test_mode=True,
            test_source_path=source,
            test_destination_path=destination,
        ),
        transcriber=transcriber,
        analyzer=DeterministicAnalyzer(delay_seconds=0),
    )

    with TestClient(app) as client:
        session_id = create_session(client, source, destination)
        client.post(f"/api/sessions/{session_id}/execute")
        first = client.get(f"/api/sessions/{session_id}").json()
        audio_mtime = Path(first["analysis_audio_path"]).stat().st_mtime_ns
        client.post(f"/api/sessions/{session_id}/execute")
        second = client.get(f"/api/sessions/{session_id}").json()

    assert transcriber.calls == 1
    assert second["transcript"] == first["transcript"]
    assert Path(second["analysis_audio_path"]).stat().st_mtime_ns == audio_mtime
