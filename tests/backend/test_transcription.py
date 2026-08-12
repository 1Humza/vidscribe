import json
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from vidscribe.transcription import (
    GroqWhisperTranscriber,
    SegmentTiming,
    TranscriptFormatter,
    Transcription,
    WordTiming,
)


def test_complete_transcript_keeps_speech_after_long_pause_and_marks_silence() -> None:
    transcription = Transcription(
        text="Before After",
        words=[
            WordTiming(word="Before", start=0.1, end=0.6),
            WordTiming(word="After", start=10.6, end=11.1),
        ],
        segments=[
            SegmentTiming(text="Before", start=0.1, end=0.6),
            SegmentTiming(text="After", start=10.6, end=11.1),
        ],
    )

    transcript = TranscriptFormatter().format(transcription)

    assert transcript == (
        "[00:00] Speaker 1: Before\n"
        "(Silence 00:10)\n"
        "[00:10] Speaker 1: After"
    )


def test_word_chronology_splits_a_provider_segment_that_spans_long_silence() -> None:
    transcription = Transcription(
        text="Before After",
        words=[
            WordTiming(word="Before", start=0.1, end=0.6),
            WordTiming(word="After", start=10.6, end=11.1),
        ],
        segments=[
            SegmentTiming(text="Before After", start=0.1, end=11.1),
        ],
    )

    transcript = TranscriptFormatter().format(transcription)

    assert transcript == (
        "[00:00] Speaker 1: Before\n"
        "(Silence 00:10)\n"
        "[00:10] Speaker 1: After"
    )


def test_groq_adapter_requests_and_returns_word_and_segment_timing(tmp_path: Path) -> None:
    audio = tmp_path / "analysis.24k.ogg"
    audio.write_bytes(b"OggS")

    def groq(request: httpx.Request) -> httpx.Response:
        body = request.read()
        assert b'name="response_format"' in body and b"verbose_json" in body
        assert body.count(b'name="timestamp_granularities[]"') == 2
        assert b"word" in body and b"segment" in body
        return httpx.Response(
            200,
            json={
                "text": "One two",
                "words": [
                    {"word": "One", "start": 0.0, "end": 0.4},
                    {"word": "two", "start": 0.5, "end": 0.9},
                ],
                "segments": [
                    {"text": "One two", "start": 0.0, "end": 0.9}
                ],
            },
        )

    transcriber = GroqWhisperTranscriber(
        api_key="secret",
        client=httpx.Client(transport=httpx.MockTransport(groq)),
    )

    result = transcriber.transcribe(audio)

    assert json.loads(result.model_dump_json()) == {
        "text": "One two",
        "words": [
            {"word": "One", "start": 0.0, "end": 0.4},
            {"word": "two", "start": 0.5, "end": 0.9},
        ],
        "segments": [{"text": "One two", "start": 0.0, "end": 0.9}],
    }


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_groq_chunks_oversized_audio_and_offsets_all_later_timing(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "long-analysis.24k.ogg"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.4",
            "-ac",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "24k",
            "-vbr",
            "off",
            str(audio),
        ],
        check=True,
    )
    temporary_root = tmp_path / "groq-chunks"
    temporary_root.mkdir()
    requests = 0

    def groq(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        word = "Early" if requests == 1 else "Later"
        return httpx.Response(
            200,
            json={
                "text": word,
                "words": [{"word": word, "start": 0.2, "end": 0.6}],
                "segments": [{"text": word, "start": 0.2, "end": 0.6}],
            },
        )

    transcriber = GroqWhisperTranscriber(
        api_key="secret",
        client=httpx.Client(transport=httpx.MockTransport(groq)),
        max_upload_bytes=4_000,
        chunk_duration_seconds=1.0,
        overlap_seconds=0.2,
        temporary_root=temporary_root,
    )

    result = transcriber.transcribe(audio)

    assert requests == 2
    assert result.text == "Early Later"
    assert [(word.word, word.start, word.end) for word in result.words] == [
        ("Early", 0.2, 0.6),
        ("Later", 1.0, 1.4),
    ]
    assert [(segment.text, segment.start, segment.end) for segment in result.segments] == [
        ("Early", 0.2, 0.6),
        ("Later", 1.0, 1.4),
    ]
    assert list(temporary_root.iterdir()) == []


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_groq_overlap_keeps_boundary_and_later_words_once_with_absolute_timing(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "boundary-analysis.24k.ogg"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.4",
            "-ac",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "24k",
            "-vbr",
            "off",
            str(audio),
        ],
        check=True,
    )
    temporary_root = tmp_path / "overlap-chunks"
    temporary_root.mkdir()
    responses = [
        {
            "text": "Early Boundary",
            "words": [
                {"word": "Early", "start": 0.1, "end": 0.3},
                {"word": "Boundary", "start": 0.85, "end": 0.95},
            ],
            "segments": [
                {"text": "Early", "start": 0.1, "end": 0.3},
                {"text": "Boundary", "start": 0.85, "end": 0.95},
            ],
        },
        {
            "text": "Recovered Boundary Later",
            "words": [
                {"word": "Recovered", "start": 0.01, "end": 0.04},
                {"word": "Boundary", "start": 0.05, "end": 0.15},
                {"word": "Later", "start": 0.35, "end": 0.55},
            ],
            "segments": [
                {"text": "Recovered", "start": 0.01, "end": 0.04},
                {"text": "Boundary", "start": 0.05, "end": 0.15},
                {"text": "Later", "start": 0.35, "end": 0.55},
            ],
        },
    ]

    def groq(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=responses.pop(0))

    result = GroqWhisperTranscriber(
        api_key="secret",
        client=httpx.Client(transport=httpx.MockTransport(groq)),
        max_upload_bytes=4_000,
        chunk_duration_seconds=1.0,
        overlap_seconds=0.2,
        temporary_root=temporary_root,
    ).transcribe(audio)

    assert responses == []
    assert result.text == "Early Recovered Boundary Later"
    assert [(word.word, word.start, word.end) for word in result.words] == [
        ("Early", 0.1, 0.3),
        ("Recovered", 0.81, 0.84),
        ("Boundary", 0.85, 0.95),
        ("Later", 1.15, 1.35),
    ]
    assert [segment.text for segment in result.segments] == [
        "Early",
        "Recovered",
        "Boundary",
        "Later",
    ]
    assert list(temporary_root.iterdir()) == []
