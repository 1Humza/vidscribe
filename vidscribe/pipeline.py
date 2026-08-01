import json
from itertools import chain
from pathlib import Path
from typing import Iterator

from pydantic import ValidationError

from vidscribe.analysis import AnalysisInput, Analyzer
from vidscribe.database import SessionRepository
from vidscribe.media import FFmpegMediaPreparer
from vidscribe.models import AnalysisResult, SessionView
from vidscribe.session_record import validate_session_record
from vidscribe.transcription import TranscriptFormatter, Transcriber


def _read_attached_context(paths: list[str]) -> list[tuple[str, str]]:
    context: list[tuple[str, str]] = []
    for raw_path in paths:
        path = Path(raw_path)
        try:
            content = path.read_text(encoding="utf-8", errors="replace")[:100_000]
        except OSError:
            continue
        context.append((path.name, content))
    return context


def _with_input_context(
    markdown: str, extra_instructions: str, attachment_paths: list[str], consulted: list[str]
) -> str:
    if not extra_instructions and not attachment_paths:
        return markdown
    allowed = {Path(path).name for path in attachment_paths}
    consulted_names = [name for name in consulted if name in allowed]
    lines = ["## Input Context", ""]
    if extra_instructions:
        lines.extend(["### Extra Instructions", "", extra_instructions, ""])
    if consulted_names:
        lines.extend(["### Attached Context", "", *[f"- {name}" for name in consulted_names], ""])
    return "\n".join(lines) + markdown


class SessionPipeline:
    def __init__(
        self,
        repository: SessionRepository,
        workspace_path: Path,
        media_preparer: FFmpegMediaPreparer,
        transcriber: Transcriber | None,
        analyzer: Analyzer | None,
    ):
        self.repository = repository
        self.workspace_path = workspace_path
        self.media_preparer = media_preparer
        self.transcriber = transcriber
        self.analyzer = analyzer

    def execute(self, session_id: str) -> Iterator[str]:
        session = self.repository.get(session_id)
        if self.transcriber is None or self.analyzer is None:
            yield self._event(
                "pipeline_error",
                {"message": "Configure GROQ_API_KEY and GEMINI_API_KEY before processing."},
            )
            return

        session = self.repository.update_session(
            session_id, status="processing", stage="preparing", progress=10
        )
        yield self._session_event(session)
        artifact_dir = self.workspace_path / session_id
        audio_path = artifact_dir / "analysis.24k.ogg"
        try:
            prepared = self.media_preparer.prepare(Path(session.source_path), audio_path)
            session = self.repository.update_session(
                session_id,
                stage="transcribing",
                progress=40,
                analysis_audio_path=str(prepared),
            )
            yield self._session_event(session)

            if session.transcript is None:
                transcription = self.transcriber.transcribe(prepared)
                transcript = TranscriptFormatter().format(transcription)
                session = self.repository.update_session(
                    session_id,
                    transcript=transcript,
                    transcript_word_timings=[word.model_dump() for word in transcription.words],
                    progress=65,
                )
            assert session.transcript is not None

            attempt_id = self.repository.create_attempt(
                session_id, self.analyzer.model, self.analyzer.effort
            )
            analysis_input = AnalysisInput(
                transcript=session.transcript,
                extra_instructions="\n".join(
                    part
                    for part in (
                        session.extra_instructions,
                        f"Speaker hints: {', '.join(session.speaker_hints)}" if session.speaker_hints else "",
                    )
                    if part
                ),
                extraction_options=session.extraction_options,
                session_date=session.session_date.isoformat(),
                attached_context=_read_attached_context(session.attachment_paths),
                canonical_word_count=len(session.transcript_word_timings),
            )
            stream = iter(self.analyzer.stream(prepared, analysis_input))
            raw_stream = ""
            first_chunk = next(stream)
            session = self.repository.update_session(
                session_id, stage="analyzing", progress=70
            )
            yield self._session_event(session)
            for chunk in chain((first_chunk,), stream):
                raw_stream += chunk
                self.repository.append_attempt_stream(attempt_id, chunk)
                yield self._event(
                    "analysis_delta",
                    {
                        "attempt_id": attempt_id,
                        "delta": chunk,
                        "raw_stream": raw_stream,
                    },
                )
            result = AnalysisResult.model_validate_json(raw_stream)
            if any(
                turn.source_word_end >= len(session.transcript_word_timings)
                for turn in result.corrected_transcript_turns
            ):
                raise ValueError("Corrected Transcript turn exceeds canonical Whisper word range")
            result.session_record_markdown = _with_input_context(
                result.session_record_markdown,
                session.extra_instructions,
                session.attachment_paths,
                result.consulted_attachment_filenames,
            )
            validate_session_record(result.session_record_markdown, session.extraction_options)
            self.repository.complete_attempt(attempt_id, result.model_dump_json())
            completed = self.repository.update_session(
                session_id, status="review", stage="review", progress=100
            )
            yield self._event("complete", completed.model_dump(mode="json"))
        except Exception:
            message = "Analysis generation stopped. Partial output was preserved."
            if "attempt_id" in locals():
                self.repository.fail_attempt(attempt_id, message)
                failed = self.repository.update_session(
                    session_id, status="error", stage="analyzing"
                )
                yield self._event(
                    "analysis_error",
                    {
                        "attempt_id": attempt_id,
                        "message": message,
                        "raw_stream": raw_stream,
                    },
                )
                yield self._session_event(failed)
            else:
                failed = self.repository.update_session(session_id, status="error")
                yield self._event(
                    "pipeline_error",
                    {"message": "Source Media could not be processed."},
                )
                yield self._session_event(failed)

    def _session_event(self, session: SessionView) -> str:
        return self._event("session", session.model_dump(mode="json"))

    def _event(self, event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
