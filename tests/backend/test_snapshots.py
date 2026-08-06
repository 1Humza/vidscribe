import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.snapshots import (
    FFmpegSnapshotExtractor,
    SnapshotCue,
    materialize_snapshot_proposals,
    resolve_snapshot_cue,
    render_snapshot_section,
    snapshot_section_body,
)
from vidscribe.transcription import Transcription, WordTiming


def test_resolves_exact_cue_phrase_at_its_canonical_whisper_word() -> None:
    words = [
        WordTiming(word="We", start=0.00, end=0.12),
        WordTiming(word="will", start=0.12, end=0.22),
        WordTiming(word="see", start=1.04, end=1.16),
        WordTiming(word="this", start=1.16, end=1.27),
        WordTiming(word="door", start=1.27, end=1.42),
    ]

    timing = resolve_snapshot_cue(
        SnapshotCue(subject="door state", cue_phrase="see this door", source_word_index=2),
        words,
    )

    assert timing.seconds == 1.04


def test_snapshot_uses_the_selected_anchor_word_inside_its_phrase() -> None:
    words = [
        WordTiming(word="look", start=1.00, end=1.10),
        WordTiming(word="here", start=1.28, end=1.40),
        WordTiming(word="now", start=1.42, end=1.54),
    ]

    resolved = resolve_snapshot_cue(
        SnapshotCue(
            subject="visible control",
            cue_phrase="look here now",
            anchor_word="here",
            anchor_word_index=1,
        ),
        words,
    )

    assert resolved.seconds == 1.28
    assert resolved.source_word_index == 1


def test_snapshot_section_states_when_audio_or_video_has_no_qualifying_snapshot() -> None:
    assert snapshot_section_body(False, []) == "Source Media was audio."
    assert snapshot_section_body(True, []) == "No Snapshot qualified for this video Session."


def test_rendering_the_snapshot_section_repeatedly_does_not_grow_blank_lines() -> None:
    markdown = "## Snapshots\n\nNo Snapshot qualified for this video Session.\n\n## Transcript\n\n[00:00] Speaker 1: Hello\n"

    once = render_snapshot_section(markdown, True, [])
    twice = render_snapshot_section(once, True, [])

    assert twice == once
    assert "Session.\n\n## Transcript" in twice


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_real_ffmpeg_extracts_a_jpeg_within_100ms_of_the_selected_word(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=25:duration=2",
            "-c:v",
            "mpeg4",
            "-y",
            str(source),
        ],
        check=True,
    )

    asset = FFmpegSnapshotExtractor().extract(source, 1.04, tmp_path / "01-door-state.jpg")

    assert asset.path.is_file()
    assert asset.path.suffix == ".jpg"
    assert abs(asset.seconds - 1.04) <= 0.1


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_duplicate_snapshot_subjects_are_filtered_before_frame_extraction(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc2=size=160x90:rate=25:duration=2", "-c:v", "mpeg4",
            "-y", str(source),
        ],
        check=True,
    )
    words = [
        WordTiming(word="see", start=0.40, end=0.50),
        WordTiming(word="door", start=0.50, end=0.60),
        WordTiming(word="show", start=1.04, end=1.16),
        WordTiming(word="door", start=1.16, end=1.28),
    ]

    snapshots = materialize_snapshot_proposals(
        [
            SnapshotCue(subject="door state", cue_phrase="see door", source_word_index=0),
            SnapshotCue(subject="door state", cue_phrase="show door", source_word_index=2),
        ],
        words,
        source,
        tmp_path / "snapshots",
        FFmpegSnapshotExtractor(),
    )

    assert [snapshot.filename for snapshot in snapshots] == ["01-door-state.jpg"]


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_only_one_overview_snapshot_is_materialized(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc2=size=160x90:rate=25:duration=2", "-c:v", "mpeg4",
            "-y", str(source),
        ],
        check=True,
    )
    words = [
        WordTiming(word="show", start=0.40, end=0.50),
        WordTiming(word="overview", start=0.50, end=0.60),
        WordTiming(word="show", start=1.04, end=1.16),
        WordTiming(word="details", start=1.16, end=1.28),
    ]

    snapshots = materialize_snapshot_proposals(
        [
            SnapshotCue(subject="first overview", cue_phrase="show overview", source_word_index=0, kind="overview"),
            SnapshotCue(subject="second overview", cue_phrase="show details", source_word_index=2, kind="overview"),
        ],
        words,
        source,
        tmp_path / "snapshots",
        FFmpegSnapshotExtractor(),
    )

    assert [(snapshot.subject, snapshot.kind) for snapshot in snapshots] == [
        ("first overview", "overview")
    ]


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_unresolvable_model_cue_does_not_discard_other_anchored_snapshots(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc2=size=160x90:rate=25:duration=2", "-c:v", "mpeg4",
            "-y", str(source),
        ],
        check=True,
    )
    words = [
        WordTiming(word="show", start=0.40, end=0.50),
        WordTiming(word="door", start=0.50, end=0.60),
        WordTiming(word="copy", start=1.04, end=1.16),
        WordTiming(word="attributes", start=1.16, end=1.28),
    ]

    snapshots = materialize_snapshot_proposals(
        [
            SnapshotCue(subject="door state", cue_phrase="show door", source_word_index=0),
            SnapshotCue(subject="copied attributes", cue_phrase="I copied attributes", source_word_index=2),
        ],
        words,
        source,
        tmp_path / "snapshots",
        FFmpegSnapshotExtractor(),
    )

    assert [snapshot.filename for snapshot in snapshots] == ["01-door-state.jpg"]


class SnapshotTranscriber:
    def transcribe(self, audio_path: Path) -> Transcription:
        del audio_path
        return Transcription(
            text="Please see this door status.",
            words=[
                WordTiming(word="Please", start=0.00, end=0.12),
                WordTiming(word="see", start=1.04, end=1.16),
                WordTiming(word="this", start=1.16, end=1.28),
                WordTiming(word="door", start=1.28, end=1.40),
                WordTiming(word="status", start=1.40, end=1.60),
            ],
            segments=[],
        )


class SnapshotAnalyzer:
    model = "snapshot-test"
    effort = "medium"

    def stream(self, audio_path: Path, analysis_input):
        del audio_path, analysis_input
        yield json.dumps(
            {
                "session_record_markdown": (
                    "📝 **Door System Tutorial** · 06-25-2026\n\n"
                    "## Recall Brief\n\nA door status was demonstrated.\n\n"
                    "## Action Summary\n\n📝 **Door System Tutorial** · 06-25-2026\n\n"
                    "A door status was demonstrated.\n\n"
                    "## Chapters\n\n00:00 Opening\n00:01 Door status\n00:02 Close\n\n"
                    "## Snapshots\n\nNo Snapshot qualified for this video Session.\n\n"
                    "## Transcript\n\n[00:00] Speaker 1: Please see this door status."
                ),
                "short_name": "Door System Tutorial",
                "session_date": "06-25-2026",
                "speaker_labels": ["Speaker 1"],
                "snapshot_cues": [
                    {
                        "subject": "door status",
                        "cue_phrase": "see this door",
                        "source_word_index": 1,
                    }
                ],
            },
            separators=(",", ":"),
        )


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_video_session_materializes_an_anchored_snapshot_proposal(tmp_path: Path) -> None:
    source = tmp_path / "2026-06-25.mp4"
    destination = tmp_path / "destination"
    destination.mkdir()
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=25:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-shortest",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-y",
            str(source),
        ],
        check=True,
    )
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(
        create_app(settings, transcriber=SnapshotTranscriber(), analyzer=SnapshotAnalyzer())
    ) as client:
        picked_source = client.post("/api/pickers/source", json={}).json()
        picked_destination = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": picked_source["selection_id"],
                "destination_selection_id": picked_destination["selection_id"],
            },
        )
        assert created.status_code == 201
        session_id = created.json()["id"]
        assert client.post(f"/api/sessions/{session_id}/execute").status_code == 200
        reviewed = client.get(f"/api/sessions/{session_id}").json()
        attempt_id = reviewed["attempts"][0]["id"]
        result = reviewed["attempts"][0]["result"]
        preview = client.get(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/snapshots/01-door-status.jpg"
        )
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
        completed_folder = destination / "2026-06-25-door-system-tutorial"
        assert (completed_folder / "01-door-status.jpg").is_file()
        removed = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"snapshot_keeps": {"01-door-status.jpg": False}},
        )
        recommitted = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert result["snapshots"] == [
        {
            "filename": "01-door-status.jpg",
            "cue_phrase": "see this door",
            "anchor_word": "see",
            "speaker_label": "",
            "kind": "detail",
            "subject": "door status",
            "source_word_index": 1,
            "timestamp_seconds": 1.04,
            "image_path": result["snapshots"][0]["image_path"],
            "kept": True,
        }
    ]
    assert Path(result["snapshots"][0]["image_path"]).is_file()
    assert "[01-door-status.jpg](01-door-status.jpg)" in result["session_record_markdown"]
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/jpeg"
    assert committed.status_code == 200
    assert removed.status_code == 200
    assert recommitted.status_code == 200
    assert not (completed_folder / "01-door-status.jpg").exists()


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg is required")
def test_final_review_can_remove_a_snapshot_and_updates_the_session_record(tmp_path: Path) -> None:
    source = tmp_path / "2026-06-25.mp4"
    destination = tmp_path / "destination"
    destination.mkdir()
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc2=size=160x90:rate=25:duration=2", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "mpeg4",
            "-c:a", "aac", "-y", str(source),
        ],
        check=True,
    )
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(
        create_app(settings, transcriber=SnapshotTranscriber(), analyzer=SnapshotAnalyzer())
    ) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
            },
        )
        session_id = created.json()["id"]
        assert client.post(f"/api/sessions/{session_id}/execute").status_code == 200
        attempt_id = client.get(f"/api/sessions/{session_id}").json()["attempts"][0]["id"]
        reviewed = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"snapshot_keeps": {"01-door-status.jpg": False}},
        )

    assert reviewed.status_code == 200
    result = reviewed.json()["attempts"][0]["result"]
    assert result["snapshots"][0]["kept"] is False
    assert "No Snapshot qualified for this video Session." in result["session_record_markdown"]
    assert "01-door-status.jpg" not in result["session_record_markdown"]
