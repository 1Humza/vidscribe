import pytest
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.analysis import analysis_response_json_schema, parse_provider_analysis_result
from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.models import AnalysisPlan, ExtractionOptions
from vidscribe.session_record import render_analysis_plan
from vidscribe.transcription import WordTiming


def words() -> list[WordTiming]:
    return [
        WordTiming(word="First", start=0.0, end=0.4),
        WordTiming(word="wierd", start=9.7, end=9.9),
        WordTiming(word="phrase.", start=10.0, end=10.4),
        WordTiming(word="Middle.", start=19.7, end=19.9),
        WordTiming(word="Close.", start=20.0, end=20.4),
        WordTiming(word="Done.", start=30.0, end=30.4),
    ]


def plan_payload() -> dict:
    return {
        "short_name": "Timing plan",
        "session_date": "08-12-2026",
        "speaker_labels": ["Ada"],
        "recall_brief": "A source-aligned timing check.",
        "turns": [{"s": 0, "e": 5, "p": 0}],
        "edits": [{"s": 1, "e": 2, "text": "corrected phrase."}],
        "action_summary": "[🧭] *Timing*\n\nThe transcript is rendered from canonical words.",
        "chapters": [
            {"i": 0, "title": "Opening"},
            {"i": 2, "title": "Correction"},
            {"i": 4, "title": "Close"},
        ],
        "highlights": [{"s": 1, "e": 2, "label": "Corrected terminology"}],
        "mentions": [{"s": 1, "e": 2, "p": 0}],
    }


def test_plan_schema_uses_compact_indexes_and_excludes_server_owned_record_fields() -> None:
    schema = analysis_response_json_schema()

    assert "session_record_markdown" not in schema["properties"]
    assert "session_date" not in schema["required"]
    assert "turns" in schema["properties"]
    assert {"s", "e", "p"} <= set(schema["$defs"]["TranscriptTurn"]["properties"])
    assert "timestamp_seconds" not in str(schema)


def test_server_renders_transcript_and_chapters_from_canonical_word_times() -> None:
    plan = AnalysisPlan.model_validate(plan_payload())

    result = render_analysis_plan(
        plan,
        words(),
        ExtractionOptions(highlights=True),
        source_media_has_video=False,
    )

    record = result.session_record_markdown
    assert "00:00 Opening" in record
    assert "00:10 Correction" in record
    assert "00:20 Close" in record
    assert "[00:00] Ada: First corrected phrase. Middle. Close. Done." in record
    assert "[00:09] Ada: Corrected terminology — \"corrected phrase.\"" in record
    assert record.count("📝 **Timing plan** · 08-12-2026") == 1
    assert record.index("📝 **Timing plan** · 08-12-2026") > record.index("## Action Summary")
    assert "15:47" not in record
    assert result.mentions[0].replacement == "corrected phrase."


def test_server_normalizes_literal_escaped_newlines_in_action_summary() -> None:
    payload = plan_payload()
    payload["action_summary"] = r"[🧭] *Timing*\n\nFirst line\nSecond line"

    result = render_analysis_plan(
        AnalysisPlan.model_validate(payload),
        words(),
        ExtractionOptions(highlights=True),
        source_media_has_video=False,
    )

    assert "[🧭] *Timing*\n\nFirst line\nSecond line" in result.session_record_markdown
    assert r"\n" not in result.session_record_markdown


def test_server_omits_chapter_boundaries_that_are_too_close_to_render() -> None:
    payload = plan_payload()
    payload["chapters"].insert(1, {"i": 1, "title": "Too soon"})

    result = render_analysis_plan(
        AnalysisPlan.model_validate(payload),
        words(),
        ExtractionOptions(highlights=True),
        source_media_has_video=False,
    )

    assert "Too soon" not in result.session_record_markdown
    assert "00:10 Correction" in result.session_record_markdown


def test_server_renders_ten_second_silence_markers_on_single_lines() -> None:
    payload = plan_payload()
    payload.update({"turns": [{"s": 0, "e": 1, "p": 0}], "edits": [], "chapters": [], "highlights": [], "mentions": []})
    result = render_analysis_plan(
        AnalysisPlan.model_validate(payload),
        [
            WordTiming(word="Before", start=0.0, end=0.5),
            WordTiming(word="After", start=10.5, end=11.0),
        ],
        ExtractionOptions(chapters=False),
        source_media_has_video=False,
    )

    assert "## Transcript\n\n[00:00] Ada: Before\n(Silence 00:10)\n[00:10] Ada: After" in result.session_record_markdown


def test_plan_rejects_out_of_range_or_incomplete_transcript_references() -> None:
    out_of_range = plan_payload()
    out_of_range["chapters"][2]["i"] = 99
    with pytest.raises(ValueError, match="Chapter exceeds canonical Whisper word range"):
        render_analysis_plan(
            AnalysisPlan.model_validate(out_of_range),
            words(),
            ExtractionOptions(),
            source_media_has_video=False,
        )

    incomplete = plan_payload()
    incomplete["turns"] = [{"s": 0, "e": 4, "p": 0}]
    with pytest.raises(ValueError, match="cover every canonical Whisper word"):
        render_analysis_plan(
            AnalysisPlan.model_validate(incomplete),
            words(),
            ExtractionOptions(),
            source_media_has_video=False,
        )


def test_parser_accepts_the_new_plan_without_a_markdown_record() -> None:
    plan = parse_provider_analysis_result(__import__("json").dumps(plan_payload()))

    assert isinstance(plan, AnalysisPlan)
    assert plan.turns[0].source_word_start == 0
    assert plan.chapters[1].anchor_word_index == 2


class PlanAnalyzer:
    model = "plan-test"
    effort = "minimal"

    def stream(self, audio_path, analysis_input):
        del audio_path, analysis_input
        yield __import__("json").dumps(
            {
                "short_name": "Plan Sync",
                "speaker_labels": ["Speaker 1"],
                "recall_brief": "A server-rendered plan.",
                "turns": [{"s": 0, "e": 1, "p": 0}],
                "action_summary": "[🧭] *Plan*\n\nThe server owns the record clock.",
            }
        )


def test_pipeline_uses_the_intake_owned_date_for_a_provider_plan(tmp_path: Path) -> None:
    source = tmp_path / "2026-08-06-recording.wav"
    destination = tmp_path / "destination"
    destination.mkdir()
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "-y", str(source),
        ],
        check=True,
    )
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )
    from vidscribe.transcription import DeterministicTranscriber

    with TestClient(create_app(settings, transcriber=DeterministicTranscriber(), analyzer=PlanAnalyzer())) as client:
        source_selection = client.post("/api/pickers/source", json={}).json()
        destination_selection = client.post("/api/pickers/destination", json={}).json()
        created = client.post(
            "/api/sessions",
            json={
                "source_selection_id": source_selection["selection_id"],
                "destination_selection_id": destination_selection["selection_id"],
            },
        ).json()
        assert client.post(f"/api/sessions/{created['id']}/execute").status_code == 200
        result = client.get(f"/api/sessions/{created['id']}").json()["attempts"][0]["result"]

    assert result["session_date"] == "08-06-2026"
    assert "📝 **Plan Sync** · 08-06-2026" in result["session_record_markdown"]
