import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel


class WordTiming(BaseModel):
    word: str
    start: float
    end: float


class SegmentTiming(BaseModel):
    text: str
    start: float
    end: float


class Transcription(BaseModel):
    text: str
    words: list[WordTiming]
    segments: list[SegmentTiming]


class Transcriber(Protocol):
    def transcribe(self, audio_path: Path) -> Transcription: ...


class TranscriptionError(RuntimeError):
    pass


class GroqWhisperTranscriber:
    endpoint = "https://api.groq.com/openai/v1/audio/transcriptions"
    default_max_upload_bytes = 20 * 1024 * 1024
    default_chunk_duration_seconds = 60 * 60
    default_overlap_seconds = 5.0

    def __init__(
        self,
        api_key: str,
        model: str = "whisper-large-v3-turbo",
        client: httpx.Client | None = None,
        max_upload_bytes: int = default_max_upload_bytes,
        chunk_duration_seconds: float = default_chunk_duration_seconds,
        overlap_seconds: float = default_overlap_seconds,
        deduplication_tolerance_seconds: float = 0.15,
        ffmpeg_path: str = "ffmpeg",
        ffprobe_path: str = "ffprobe",
        temporary_root: Path | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.client = client or httpx.Client(timeout=300)
        self.max_upload_bytes = max_upload_bytes
        self.chunk_duration_seconds = chunk_duration_seconds
        self.overlap_seconds = overlap_seconds
        self.deduplication_tolerance_seconds = deduplication_tolerance_seconds
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self.temporary_root = temporary_root
        if self.chunk_duration_seconds <= 0:
            raise ValueError("chunk_duration_seconds must be positive")
        if not 0 <= self.overlap_seconds < self.chunk_duration_seconds:
            raise ValueError("overlap_seconds must be smaller than each chunk")

    def transcribe(self, audio_path: Path) -> Transcription:
        if audio_path.stat().st_size <= self.max_upload_bytes:
            return self._transcribe_one(audio_path)
        return self._transcribe_chunks(audio_path)

    def _transcribe_one(self, audio_path: Path) -> Transcription:
        try:
            with audio_path.open("rb") as audio:
                response = self.client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    data={
                        "model": self.model,
                        "response_format": "verbose_json",
                        "temperature": "0",
                        "timestamp_granularities[]": ["word", "segment"],
                    },
                    files={"file": (audio_path.name, audio, "audio/ogg")},
                )
            response.raise_for_status()
            payload = response.json()
            if "words" not in payload or "segments" not in payload:
                raise TranscriptionError("Groq response omitted required timing data")
            return Transcription.model_validate(payload)
        except TranscriptionError:
            raise
        except (OSError, httpx.HTTPError, ValueError) as error:
            raise TranscriptionError("Groq could not transcribe Analysis Audio") from error

    def _transcribe_chunks(self, audio_path: Path) -> Transcription:
        temporary_parent = str(self.temporary_root) if self.temporary_root else None
        with tempfile.TemporaryDirectory(
            prefix="vidscribe-groq-", dir=temporary_parent
        ) as directory:
            chunks = self._chunk_audio(audio_path, Path(directory))
            chunk_results = [
                (self._transcribe_one(path), offset) for path, offset in chunks
            ]
        words: list[WordTiming] = []
        segments: list[SegmentTiming] = []
        for result, offset in chunk_results:
            words.extend(
                word.model_copy(
                    update={
                        "start": round(word.start + offset, 6),
                        "end": round(word.end + offset, 6),
                    }
                )
                for word in result.words
            )
            segments.extend(
                segment.model_copy(
                    update={
                        "start": round(segment.start + offset, 6),
                        "end": round(segment.end + offset, 6),
                    }
                )
                for segment in result.segments
            )
        merged_words = self._deduplicate_words(words)
        merged_segments = self._deduplicate_segments(segments)
        return Transcription(
            text=self._word_text(merged_words)
            if merged_words
            else " ".join(segment.text.strip() for segment in merged_segments),
            words=merged_words,
            segments=merged_segments,
        )

    def _chunk_audio(
        self, audio_path: Path, directory: Path
    ) -> list[tuple[Path, float]]:
        duration = self._probe_duration(audio_path)
        step = self.chunk_duration_seconds - self.overlap_seconds
        chunks: list[tuple[Path, float]] = []
        start = 0.0
        index = 0
        while start < duration:
            output = directory / f"chunk-{index:05d}.ogg"
            window_duration = min(self.chunk_duration_seconds, duration - start)
            self._extract_window(audio_path, output, start, window_duration)
            if output.stat().st_size > self.max_upload_bytes:
                raise TranscriptionError(
                    "An Analysis Audio chunk exceeds the Groq upload limit"
                )
            chunks.append((output, start))
            if start + self.chunk_duration_seconds >= duration:
                break
            start = round(start + step, 6)
            index += 1
        if not chunks:
            raise TranscriptionError("Analysis Audio chunking produced no audio")
        return chunks

    def _probe_duration(self, audio_path: Path) -> float:
        try:
            completed = subprocess.run(
                [
                    self.ffprobe_path,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(audio_path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            duration = float(completed.stdout.strip())
            if duration <= 0:
                raise ValueError
            return duration
        except (subprocess.CalledProcessError, ValueError) as error:
            raise TranscriptionError("Analysis Audio duration could not be read") from error

    def _extract_window(
        self,
        audio_path: Path,
        output: Path,
        start: float,
        duration: float,
    ) -> None:
        try:
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-y",
                    "-i",
                    str(audio_path),
                    "-ss",
                    f"{start:.6f}",
                    "-t",
                    f"{duration:.6f}",
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "24k",
                    "-vbr",
                    "off",
                    "-application",
                    "audio",
                    "-f",
                    "ogg",
                    str(output),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        except subprocess.CalledProcessError as error:
            raise TranscriptionError("Analysis Audio could not be split for Groq") from error

    def _deduplicate_words(self, words: list[WordTiming]) -> list[WordTiming]:
        deduplicated: list[WordTiming] = []
        for word in sorted(words, key=lambda item: (item.start, item.end)):
            if not self._is_duplicate(word, deduplicated):
                deduplicated.append(word)
        return deduplicated

    def _deduplicate_segments(
        self, segments: list[SegmentTiming]
    ) -> list[SegmentTiming]:
        deduplicated: list[SegmentTiming] = []
        for segment in sorted(segments, key=lambda item: (item.start, item.end)):
            if not self._is_duplicate(segment, deduplicated):
                deduplicated.append(segment)
        return deduplicated

    def _is_duplicate(self, candidate, accepted) -> bool:
        candidate_text = self._normalized_timed_text(candidate)
        if not candidate_text:
            return False
        for existing in reversed(accepted):
            if (
                candidate.start - existing.start
                > self.deduplication_tolerance_seconds
            ):
                break
            if (
                self._normalized_timed_text(existing) == candidate_text
                and abs(existing.start - candidate.start)
                <= self.deduplication_tolerance_seconds
                and abs(existing.end - candidate.end)
                <= self.deduplication_tolerance_seconds
                and min(existing.end, candidate.end)
                > max(existing.start, candidate.start)
            ):
                return True
        return False

    def _normalized_timed_text(self, item) -> str:
        value = item.word if isinstance(item, WordTiming) else item.text
        return re.sub(r"\W+", " ", value.casefold()).strip()

    def _word_text(self, words: list[WordTiming]) -> str:
        text = ""
        punctuation = set(".,!?;:%)]}")
        for word in words:
            token = word.word
            stripped = token.strip()
            if not stripped:
                continue
            if not text:
                text = stripped
            elif token[0].isspace() or stripped[0] in punctuation:
                text += token.rstrip()
            else:
                text += f" {stripped}"
        return text


class DeterministicTranscriber:
    def transcribe(self, audio_path: Path) -> Transcription:
        return Transcription(
            text="Before After",
            words=[
                WordTiming(word="Before", start=0.1, end=0.6),
                WordTiming(word="After", start=17.1, end=17.6),
            ],
            segments=[
                SegmentTiming(text="Before", start=0.1, end=0.6),
                SegmentTiming(text="After", start=17.1, end=17.6),
            ],
        )


SILENCE_THRESHOLD_SECONDS = 10.0


class TranscriptFormatter:
    silence_threshold_seconds = SILENCE_THRESHOLD_SECONDS

    def format(self, transcription: Transcription) -> str:
        words = sorted(transcription.words, key=lambda word: (word.start, word.end))
        segments = sorted(
            transcription.segments, key=lambda segment: (segment.start, segment.end)
        )
        if not words:
            return "\n".join(
                f"[{self._clock(segment.start)}] Speaker 1: {segment.text.strip()}"
                for segment in segments
            )

        lines: list[str] = []
        turn: list[WordTiming] = []
        turn_segment: int | None = None

        def flush_turn() -> None:
            if not turn:
                return
            lines.append(
                f"[{self._clock(turn[0].start)}] Speaker 1: {self._word_text(turn)}"
            )
            turn.clear()

        previous: WordTiming | None = None
        for word in words:
            segment_index = self._segment_index(word, segments)
            if previous is not None:
                gap = word.start - previous.end
                if gap >= self.silence_threshold_seconds:
                    flush_turn()
                    lines.append(f"(Silence {self._clock(gap)})")
                    turn_segment = segment_index
                elif (
                    turn
                    and turn_segment is not None
                    and segment_index is not None
                    and segment_index != turn_segment
                ):
                    flush_turn()
                    turn_segment = segment_index
            if not turn:
                turn_segment = segment_index
            turn.append(word)
            previous = word
        flush_turn()
        return "\n".join(lines)

    def _segment_index(
        self, word: WordTiming, segments: list[SegmentTiming]
    ) -> int | None:
        midpoint = (word.start + word.end) / 2
        for index, segment in enumerate(segments):
            if segment.start - 0.001 <= midpoint <= segment.end + 0.001:
                return index
        return None

    def _word_text(self, words: list[WordTiming]) -> str:
        text = ""
        closing_punctuation = set(".,!?;:%)]}")
        for word in words:
            token = word.word
            stripped = token.strip()
            if not stripped:
                continue
            if not text:
                text = stripped
            elif token[0].isspace() or stripped[0] in closing_punctuation:
                text += token.rstrip()
            else:
                text += f" {stripped}"
        return text

    def _clock(self, seconds: float) -> str:
        whole_seconds = max(0, math.floor(seconds))
        minutes, remaining_seconds = divmod(whole_seconds, 60)
        return f"{minutes:02d}:{remaining_seconds:02d}"
