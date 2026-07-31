import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from vidscribe.analysis import AnalysisGenerationError, AnalysisInput, GeminiAnalyzer
from vidscribe.models import AnalysisResult, ExtractionOptions


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


def test_gemini_receives_analysis_audio_complete_transcript_and_medium_effort(
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
    )

    raw = "".join(analyzer.stream(audio, analysis_input))

    result = AnalysisResult.model_validate_json(raw)
    request = client.models.request
    assert client.files.uploaded == str(audio)
    assert request["model"] == "gemini-3-flash-preview"
    assert request["config"]["thinking_config"]["thinking_level"] == "medium"
    assert request["config"]["response_mime_type"] == "application/json"
    assert request["config"]["response_json_schema"] == AnalysisResult.model_json_schema()
    assert "response_schema" not in request["config"]
    assert "Before" in request["contents"][0]
    assert "After" in request["contents"][0]
    assert request["contents"][1].uri == "files/audio"
    assert result.short_name == "Demo Sync"
    assert client.files.deleted == ["files/analysis-audio"]


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
