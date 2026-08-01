import json
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

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
            "-c:a",
            "pcm_s16le",
            "-y",
            str(path),
        ],
        check=True,
    )


class TwoSpeakerAnalyzer:
    model = "deterministic-analysis"
    effort = "medium"

    def stream(self, audio_path: Path, analysis_input):
        del audio_path, analysis_input
        yield json.dumps(
            {
                "session_record_markdown": (
                    "📝 **Pipeline Test Sync** · 07-31-2026\n\n"
                    "## Recall Brief\n\nA deterministic recording.\n\n"
                    "## Action Summary\n\n"
                    "📝 **Pipeline Test Sync** · 07-31-2026\n\n"
                    "A deterministic recording.\n\n"
                    "## Chapters\n\n00:00 Opening\n00:10 Review\n00:20 Close\n\n"
                    "## Snapshots\n\nSource Media was audio.\n\n"
                    "## Transcript\n\n[00:00] Speaker 1: Before\n\n[00:01] Speaker 2: After"
                ),
                "short_name": "Pipeline Test Sync",
                "session_date": "07-31-2026",
                "speaker_labels": ["Speaker 1", "Speaker 2"],
            },
            separators=(",", ":"),
        )


def create_completed_session(client: TestClient) -> str:
    source = client.post("/api/pickers/source", json={}).json()
    destination = client.post("/api/pickers/destination", json={}).json()
    created = client.post(
        "/api/sessions",
        json={
            "source_selection_id": source["selection_id"],
            "destination_selection_id": destination["selection_id"],
        },
    )
    assert created.status_code == 201
    session_id = created.json()["id"]
    assert client.post(f"/api/sessions/{session_id}/execute").status_code == 200
    return session_id


def test_review_edits_persist_identity_and_global_speaker_renames(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(
        create_app(settings, transcriber=DeterministicTranscriber(), analyzer=TwoSpeakerAnalyzer())
    ) as client:
        session_id = create_completed_session(client)
        original = client.get(f"/api/sessions/{session_id}").json()
        attempt_id = original["attempts"][0]["id"]

        response = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={
                "session_record_markdown": original["attempts"][0]["result"]["session_record_markdown"],
                "session_date": "2026-08-01",
                "short_name": "Roadmap Sync",
                "speaker_renames": {"Speaker 1": "Ada", "Speaker 2": "Ben"},
            },
        )
        restored = client.get(f"/api/sessions/{session_id}").json()

    assert response.status_code == 200
    result = restored["attempts"][0]["result"]
    assert result["short_name"] == "Roadmap Sync"
    assert result["session_date"] == "08-01-2026"
    assert result["speaker_labels"] == ["Ada", "Ben"]
    assert "📝 **Roadmap Sync** · 08-01-2026" in result["session_record_markdown"]
    assert "Speaker 1" not in result["session_record_markdown"]
    assert "Speaker 2" not in result["session_record_markdown"]
    assert "[00:00] Ada: Before" in result["session_record_markdown"]
    assert "[00:01] Ben: After" in result["session_record_markdown"]


def test_review_rejects_duplicate_speaker_labels(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(
        create_app(settings, transcriber=DeterministicTranscriber(), analyzer=TwoSpeakerAnalyzer())
    ) as client:
        session_id = create_completed_session(client)
        attempt_id = client.get(f"/api/sessions/{session_id}").json()["attempts"][0]["id"]
        response = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"speaker_renames": {"Speaker 1": "Speaker 2"}},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == "Speaker Labels must be unique"
