import os
from pathlib import Path

import pytest

from vidscribe.analysis import AnalysisInput, GeminiAnalyzer
from vidscribe.models import AnalysisResult, ExtractionOptions
from vidscribe.transcription import GroqWhisperTranscriber, TranscriptFormatter


RUN_LIVE = os.getenv("VIDSCRIBE_RUN_LIVE_TESTS") == "1"
AUDIO_PATH = Path(os.getenv("VIDSCRIBE_LIVE_AUDIO_PATH", ""))


@pytest.mark.live
@pytest.mark.skipif(not RUN_LIVE, reason="live provider tests are opt-in")
def test_live_groq_returns_complete_word_and_segment_timing() -> None:
    api_key = os.environ["GROQ_API_KEY"]
    assert AUDIO_PATH.is_file()

    result = GroqWhisperTranscriber(api_key).transcribe(AUDIO_PATH)

    assert result.words
    assert result.segments
    assert result.text.strip()


@pytest.mark.live
@pytest.mark.skipif(not RUN_LIVE, reason="live provider tests are opt-in")
def test_live_gemini_streams_schema_valid_analysis() -> None:
    groq_key = os.environ["GROQ_API_KEY"]
    gemini_key = os.environ["GEMINI_API_KEY"]
    assert AUDIO_PATH.is_file()
    transcription = GroqWhisperTranscriber(groq_key).transcribe(AUDIO_PATH)
    transcript = TranscriptFormatter().format(transcription)

    raw = "".join(
        GeminiAnalyzer(gemini_key).stream(
            AUDIO_PATH,
            AnalysisInput(
                transcript=transcript,
                extraction_options=ExtractionOptions(),
            ),
        )
    )

    assert AnalysisResult.model_validate_json(raw).session_record_markdown
