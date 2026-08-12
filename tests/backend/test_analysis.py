import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from vidscribe.analysis import (
    AnalysisGenerationError,
    AnalysisInput,
    GeminiAnalyzer,
    analysis_response_json_schema,
    parse_provider_analysis_result,
)
from vidscribe.models import AnalysisResult, ExtractionOptions
from vidscribe.session_record import normalize_session_record_headings, validate_session_record


class FakeFiles:
    def __init__(self):
        self.uploaded: str | None = None
        self.deleted: list[str] = []

    def upload(self, *, file: str):
        self.uploaded = file
        return SimpleNamespace(
            name="files/analysis-audio", uri="files/audio", mime_type="audio/ogg"
        )

    def delete(self, *, name: str) -> None:
        self.deleted.append(name)


class FakeModels:
    def __init__(self):
        self.request = None

    def generate_content_stream(self, **request):
        self.request = request
        yield SimpleNamespace(text='{"session_record_markdown":"# Record",')
        yield SimpleNamespace(
            text='"short_name":"Demo Sync","session_date":"07-31-2026","speaker_labels":["Speaker 1"]}'
        )


def test_gemini_receives_analysis_audio_timed_whisper_words_and_medium_effort(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "analysis.24k.ogg"
    audio.write_bytes(b"OggS")
    client = SimpleNamespace(files=FakeFiles(), models=FakeModels())
    analyzer = GeminiAnalyzer(api_key="secret", client=client)
    analysis_input = AnalysisInput(
        transcript="[00:00] Speaker 1: Before\n\n(Silence 00:16)\n\n[00:17] Speaker 1: After",
        extra_instructions="Keep product names.",
        extraction_options=ExtractionOptions(),
        source_words=[(0, "Before"), (1, "After")],
    )

    raw = "".join(analyzer.stream(audio, analysis_input))

    result = AnalysisResult.model_validate_json(raw)
    request = client.models.request
    assert client.files.uploaded == str(audio)
    assert request["model"] == "gemini-3-flash-preview"
    assert request["config"]["thinking_config"]["thinking_level"] == "medium"
    assert request["config"]["response_mime_type"] == "application/json"
    assert request["config"]["response_json_schema"] == analysis_response_json_schema()
    assert "session_record_markdown" not in request["config"]["response_json_schema"]["properties"]
    assert "snapshots" not in request["config"]["response_json_schema"]["properties"]
    assert "source_media_has_video" not in request["config"]["response_json_schema"]["properties"]
    assert "response_schema" not in request["config"]
    assert "[0, \"Before\"]" in request["contents"][0]
    assert "[1, \"After\"]" in request["contents"][0]
    assert analysis_input.transcript not in request["contents"][0]
    assert "[00:00] Speaker 1:" not in request["contents"][0]
    assert "no more than 350 words" in request["contents"][0]
    assert "context-appropriate emoji-led discussion topics" in request["contents"][0]
    assert "Never use checkbox or todo syntax" in request["contents"][0]
    assert "Never calculate or return time" in request["contents"][0]
    assert "do not repeat unchanged speech" in request["contents"][0]
    assert "major navigational segments" in request["contents"][0]
    assert "scan forward to the earliest visible completion" in request["contents"][0]
    assert "Return every distinct mention once" in request["contents"][0]
    assert "Return only the requested AnalysisPlan JSON object" in request["contents"][0]
    assert request["contents"][1].uri == "files/audio"
    assert result.short_name == "Demo Sync"
    assert client.files.deleted == ["files/analysis-audio"]


def test_gemini_prefers_the_saved_system_prompt_over_the_default_intro(tmp_path: Path) -> None:
    audio = tmp_path / "analysis.24k.ogg"
    audio.write_bytes(b"OggS")
    client = SimpleNamespace(files=FakeFiles(), models=FakeModels())
    analyzer = GeminiAnalyzer(api_key="secret", client=client)

    list(analyzer.stream(audio, AnalysisInput(
        transcript="[00:00] Speaker 1: Hello",
        extraction_options=ExtractionOptions(),
        system_prompt="Use the Acme file naming formula: YYYY-MM-DD-title.md.",
    )))

    prompt = client.models.request["contents"][0]
    assert prompt.startswith("Use the Acme file naming formula: YYYY-MM-DD-title.md.")
    assert "no more than 350 words total" not in prompt
    assert "Session Date:" in prompt


def test_provider_legacy_snapshot_paths_are_ignored_before_validation() -> None:
    raw = json.dumps(
        {
            "session_record_markdown": "# Record",
            "short_name": "Demo Sync",
            "session_date": "07-31-2026",
            "snapshots": [{"filename": "snapshots/snapshot_1.png"}],
            "corrected_transcript_turns": [
                {"speaker_label": "Speaker 1", "text": "obsolete", "source_word_start": 0, "source_word_end": 0}
            ],
            "snapshot_cues": [
                {"subject": "Door code", "cue_phrase": "door code", "source_word_index": 4}
            ],
        }
    )

    result = parse_provider_analysis_result(raw)

    assert result.snapshot_cues[0].subject == "Door code"
    assert result.snapshots == []
    assert "corrected_transcript_turns" not in result.model_dump()


def test_persisted_legacy_corrected_turns_remain_readable() -> None:
    result = AnalysisResult.model_validate(
        {
            "session_record_markdown": "# Record",
            "short_name": "Demo Sync",
            "session_date": "07-31-2026",
            "corrected_transcript_turns": [
                {"speaker_label": "Speaker 1", "text": "obsolete", "source_word_start": 0, "source_word_end": 0}
            ],
        }
    )

    assert "corrected_transcript_turns" not in result.model_dump()


class FailingModels:
    def generate_content_stream(self, **request):
        yield SimpleNamespace(text='{"session_record_markdown":"partial')
        raise RuntimeError("provider disconnected")


def test_gemini_deletes_uploaded_analysis_audio_after_stream_failure(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "analysis.24k.ogg"
    audio.write_bytes(b"OggS")
    client = SimpleNamespace(files=FakeFiles(), models=FailingModels())
    analyzer = GeminiAnalyzer(api_key="secret", client=client)
    analysis_input = AnalysisInput(
        transcript="[00:00] Speaker 1: Before",
        extraction_options=ExtractionOptions(),
    )

    with pytest.raises(AnalysisGenerationError):
        list(analyzer.stream(audio, analysis_input))

    assert client.files.deleted == ["files/analysis-audio"]


def test_session_record_accepts_provider_section_depth_without_losing_order() -> None:
    markdown = """📝 **Demo Sync** · 07-31-2026

### Recall Brief

Grounded recall.

### Action Summary

📝 **Demo Sync** · 07-31-2026

Grounded recall.

### Chapters

00:00 Opening
00:10 Review
00:20 Close

### Snapshots

Source Media was audio.

### Transcript

[00:00] Speaker 1: Hello
"""

    validate_session_record(markdown, ExtractionOptions())


def test_session_record_accepts_an_explicit_empty_chapters_section() -> None:
    markdown = """📝 **Demo Sync** · 07-31-2026

## Recall Brief

Grounded recall.

## Action Summary

📝 **Demo Sync** · 07-31-2026

Grounded recall.

## Chapters

No chapter boundaries qualify for this Session.

## Snapshots

Source Media was audio.

## Transcript

[00:00] Speaker 1: Hello
"""

    validate_session_record(markdown, ExtractionOptions())


def test_session_record_rejects_an_action_summary_over_350_words() -> None:
    markdown = """📝 **Demo Sync** · 07-31-2026

## Recall Brief

Distinct context.

## Action Summary

""" + " ".join(["word"] * 351) + """

## Chapters

00:00 Opening
00:10 Review
00:20 Close

## Snapshots

Source Media was audio.

## Transcript

[00:00] Speaker 1: Hello
"""

    with pytest.raises(ValueError, match="Action Summary must not exceed 350 words"):
        validate_session_record(markdown, ExtractionOptions())


def test_session_record_normalizes_plain_provider_section_labels() -> None:
    markdown = """📝 **Demo Sync** · 07-31-2026

Recall Brief

Grounded recall.

Action Summary:

📝 **Demo Sync** · 07-31-2026

Grounded recall.

Chapters

00:00 Opening
00:10 Review
00:20 Close

Snapshots

No Snapshot qualified for this video Session.

Transcript

[00:00] Speaker 1: Hello
"""

    normalized = normalize_session_record_headings(markdown)

    validate_session_record(normalized, ExtractionOptions())


def test_session_record_normalization_keeps_adjacent_headings_separate() -> None:
    markdown = "### Action Summary\n\n### Recall Brief\n"

    normalized = normalize_session_record_headings(markdown)

    assert normalized == "## Action Summary\n\n## Recall Brief\n"
