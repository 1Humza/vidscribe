import json
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.review import _replacement_with_source_capitalization
from vidscribe.config import Settings
from vidscribe.snapshots import SnapshotProposal, render_snapshot_section
from vidscribe.transcription import DeterministicTranscriber, Transcription, WordTiming


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
                    "Before is ready for review.\n\n"
                    "## Chapters\n\n00:00 Opening\n00:10 Review\n00:20 Close\n\n"
                    "## Snapshots\n\nSource Media was audio.\n\n"
                    "## Transcript\n\n[00:00] Speaker 1: Before\n\n[00:01] Speaker 2: After"
                ),
                "short_name": "Pipeline Test Sync",
                "session_date": "07-31-2026",
                "speaker_labels": ["Speaker 1", "Speaker 2"],
                "mentions": [{"source_word_start": 0, "source_word_end": 0, "speaker_label": "Speaker 1"}],
            },
            separators=(",", ":"),
        )


class RepeatedMentionTranscriber:
    def transcribe(self, audio_path: Path) -> Transcription:
        del audio_path
        return Transcription(
            text="Slab. slab Slab.",
            words=[
                WordTiming(word="Slab.", start=0.0, end=0.1),
                WordTiming(word="slab", start=0.1, end=0.2),
                WordTiming(word="Slab.", start=0.2, end=0.3),
            ],
            segments=[],
        )


class RepeatedMentionAnalyzer:
    model = "deterministic-analysis"
    effort = "medium"

    def stream(self, audio_path: Path, analysis_input):
        del audio_path, analysis_input
        yield json.dumps(
            {
                "session_record_markdown": (
                    "📝 **Repeated Mention Test** · 07-31-2026\n\n"
                    "## Recall Brief\n\nA repeated phrase.\n\n"
                    "## Action Summary\n\n📝 **Repeated Mention Test** · 07-31-2026\n\n"
                    "A repeated phrase.\n\n"
                    "## Chapters\n\n00:00 Opening\n00:01 Review\n00:02 Close\n\n"
                    "## Snapshots\n\nSource Media was audio.\n\n"
                    "## Transcript\n\n[00:00] Speaker 1: Slab. slab Slab."
                ),
                "short_name": "Repeated Mention Test",
                "session_date": "07-31-2026",
                "speaker_labels": ["Speaker 1"],
                "mentions": [
                    {"source_word_start": 0, "source_word_end": 0, "speaker_label": "Speaker 1"},
                ],
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
                "session_time": "14:30",
                "short_name": "Roadmap Sync",
                "speaker_renames": {"Speaker 1": "Ada", "Speaker 2": "Ben"},
                "phrase_corrections": [
                    {"source_word_start": 0, "source_word_end": 0, "replacement": "Earlier"}
                ],
            },
        )
        restored = client.get(f"/api/sessions/{session_id}").json()

    assert response.status_code == 200
    result = restored["attempts"][0]["result"]
    assert restored["session_date"] == "2026-08-01"
    assert restored["session_time"] == "14:30:00"
    assert result["short_name"] == "Roadmap Sync"
    assert result["session_date"] == "08-01-2026"
    assert result["speaker_labels"] == ["Ada", "Ben"]
    assert "📝 **Roadmap Sync** · 08-01-2026" in result["session_record_markdown"]
    assert "Speaker 1" not in result["session_record_markdown"]
    assert "Speaker 2" not in result["session_record_markdown"]
    assert "[00:00] Ada: Earlier" in result["session_record_markdown"]
    assert "[00:01] Ben: After" in result["session_record_markdown"]
    assert result["mentions"] == [
        {"source_word_start": 0, "source_word_end": 0, "speaker_label": "Ada", "replacement": "Earlier"}
    ]


def test_phrase_correction_propagates_through_the_session_record_and_snapshot_metadata(
    tmp_path: Path,
) -> None:
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
    app = create_app(settings, transcriber=DeterministicTranscriber(), analyzer=TwoSpeakerAnalyzer())

    with TestClient(app) as client:
        session_id = create_completed_session(client)
        stored = app.state.sessions.get(session_id)
        attempt_id = stored.attempts[0].id
        assert stored.attempts[0].result is not None
        result = stored.attempts[0].result.model_copy(deep=True)
        result.source_media_has_video = True
        result.snapshots = [
            SnapshotProposal(
                filename="01-before-state.jpg",
                cue_phrase="See Before now",
                anchor_word="Before",
                speaker_label="Speaker 1",
                subject="Before state",
                source_word_index=0,
                timestamp_seconds=0,
                image_path=str(tmp_path / "before-state.jpg"),
            )
        ]
        result.session_record_markdown = render_snapshot_section(
            result.session_record_markdown, True, result.snapshots
        )
        app.state.sessions.update_attempt_result(session_id, attempt_id, result)

        response = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"phrase_corrections": [{"source_word_start": 0, "source_word_end": 0, "replacement": "Earlier"}]},
        )

    assert response.status_code == 200
    result = response.json()["attempts"][0]["result"]
    assert "Before" not in result["session_record_markdown"]
    assert "Earlier is ready for review." in result["session_record_markdown"]
    snapshot = result["snapshots"][0]
    assert snapshot["subject"] == "Earlier state"
    assert snapshot["cue_phrase"] == "See Earlier now"
    assert snapshot["anchor_word"] == "Earlier"
    assert snapshot["filename"] == "01-earlier-state.jpg"


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


def test_grouped_mention_correction_preserves_initial_case_per_occurrence() -> None:
    assert _replacement_with_source_capitalization("Slab", "surface") == "Surface"
    assert _replacement_with_source_capitalization("slab", "surface") == "surface"
    assert _replacement_with_source_capitalization("SLAB", "surface") == "surface"


def test_reloaded_mention_can_be_corrected_again(tmp_path: Path) -> None:
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
        first = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"phrase_corrections": [{"source_word_start": 0, "source_word_end": 0, "replacement": "Earlier"}]},
        )
        second = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"phrase_corrections": [{"source_word_start": 0, "source_word_end": 0, "replacement": "Previously"}]},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    result = second.json()["attempts"][0]["result"]
    assert "[00:00] Speaker 1: Previously" in result["session_record_markdown"]
    assert result["mentions"][0]["replacement"] == "Previously"


def test_grouped_mention_edit_updates_every_occurrence_despite_punctuation(tmp_path: Path) -> None:
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
        create_app(settings, transcriber=RepeatedMentionTranscriber(), analyzer=RepeatedMentionAnalyzer())
    ) as client:
        session_id = create_completed_session(client)
        attempt_id = client.get(f"/api/sessions/{session_id}").json()["attempts"][0]["id"]
        response = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={
                "phrase_corrections": [
                    {"source_word_start": 0, "source_word_end": 0, "replacement": "surface"},
                    {"source_word_start": 1, "source_word_end": 1, "replacement": "surface"},
                    {"source_word_start": 2, "source_word_end": 2, "replacement": "surface"},
                ]
            },
        )

    assert response.status_code == 200
    result = response.json()["attempts"][0]["result"]
    assert "[00:00] Speaker 1: Surface. surface Surface." in result["session_record_markdown"]
    assert [mention["replacement"] for mention in result["mentions"]] == [
        "Surface",
        "surface",
        "Surface",
    ]
