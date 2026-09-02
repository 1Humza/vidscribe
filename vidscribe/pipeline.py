import json
import re
from itertools import chain
from pathlib import Path
from typing import Iterator

from pydantic import ValidationError

from vidscribe.analysis import AnalysisInput, Analyzer, parse_provider_analysis_result
from vidscribe.database import SessionRepository
from vidscribe.media import FFmpegMediaPreparer
from vidscribe.models import AnalysisPlan, SessionView
from vidscribe.session_record import render_analysis_plan, validate_session_record
from vidscribe.snapshots import (
    FFmpegSnapshotExtractor,
    SnapshotError,
    materialize_snapshot_proposals,
    render_snapshot_section,
    source_has_video,
)
from vidscribe.transcription import TranscriptFormatter, Transcriber, WordTiming


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


def _record_naming_hint(path: Path) -> str:
    """Extract a tiny context hint without sending a prior transcript to Gemini."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")[:8_000]
    except OSError:
        return ""

    if "## Recall Brief" in content:
        hint = content.split("## Recall Brief", 1)[1].split("##", 1)[0]
    elif "\nTranscript" in content:
        hint = content.split("\nTranscript", 1)[0]
    elif content.startswith("Context"):
        hint = content
    else:
        return ""
    return re.sub(r"\s+", " ", hint).strip()[:240]


def _read_naming_precedents(destination_path: str | None, limit: int = 80) -> list[tuple[str, str]]:
    """Read committed names plus small context hints, never prior meeting transcripts."""
    if destination_path is None:
        return []
    destination = Path(destination_path)
    try:
        entries = list(destination.iterdir())
    except OSError:
        return []

    precedents: dict[str, str] = {}
    record_suffixes = {".md", ".txt"}
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_file() and entry.suffix.lower() in record_suffixes:
            candidate = entry.stem.strip()
            hint = _record_naming_hint(entry)
        elif entry.is_dir():
            try:
                record_paths = [
                    child
                    for child in entry.iterdir()
                    if child.is_file() and child.suffix.lower() in record_suffixes
                ]
            except OSError:
                continue
            if not record_paths:
                continue
            candidate = entry.name.strip()
            record_path = next(
                (path for path in record_paths if path.suffix.lower() == ".md"),
                sorted(record_paths, key=lambda path: path.name.casefold())[0],
            )
            hint = _record_naming_hint(record_path)
        else:
            continue
        if candidate and "\x00" not in candidate:
            precedents.setdefault(candidate[:160], hint)

    return sorted(precedents.items(), key=lambda item: item[0].casefold())[:limit]


def _with_input_context(
    markdown: str, extra_instructions: str, attachment_paths: list[str], consulted: list[str]
) -> str:
    if not extra_instructions and not attachment_paths:
        return markdown
    allowed = {Path(path).name for path in attachment_paths}
    consulted_names = [name for name in consulted if name in allowed]
    lines = ["## Input Context", ""]
    if extra_instructions:
        lines.extend([extra_instructions, ""])
    if consulted_names:
        lines.extend(["### Attached Context", "", *[f"- {name}" for name in consulted_names], ""])
    return "\n".join(lines) + "\n" + markdown


class SessionPipeline:
    def __init__(
        self,
        repository: SessionRepository,
        workspace_path: Path,
        media_preparer: FFmpegMediaPreparer,
        transcriber: Transcriber | None,
        analyzer: Analyzer | None,
        system_prompt_provider=lambda: "",
    ):
        self.repository = repository
        self.workspace_path = workspace_path
        self.media_preparer = media_preparer
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.system_prompt_provider = system_prompt_provider

    def _has_reusable_preparation(self, session: SessionView) -> bool:
        if not session.analysis_audio_path or not session.transcript:
            return False
        audio_path = Path(session.analysis_audio_path)
        if not self.media_preparer.is_valid(audio_path):
            return False
        try:
            [WordTiming.model_validate(word) for word in session.transcript_word_timings]
        except (TypeError, ValueError):
            return False
        return bool(session.transcript_word_timings)

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
        raw_stream = ""
        failure_stage = "preparing"
        try:
            if self._has_reusable_preparation(session):
                prepared = Path(session.analysis_audio_path)
            else:
                failure_stage = "transcribing"
                prepared = self.media_preparer.prepare(Path(session.source_path), audio_path)
                session = self.repository.update_session(
                    session_id,
                    stage="transcribing",
                    progress=40,
                    analysis_audio_path=str(prepared),
                )
                yield self._session_event(session)

                transcription = self.transcriber.transcribe(prepared)
                transcript = TranscriptFormatter().format(transcription)
                session = self.repository.update_session(
                    session_id,
                    transcript=transcript,
                    transcript_word_timings=[word.model_dump() for word in transcription.words],
                    progress=65,
                )
            assert session.transcript is not None

            attempt_id = self.repository.create_attempt(session_id, session.model, session.effort)
            failure_stage = "analyzing"
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
                naming_precedents=_read_naming_precedents(session.destination_path),
                source_words=[
                    (index, str(word["word"]))
                    for index, word in enumerate(session.transcript_word_timings)
                ],
                source_media_has_video=source_has_video(
                    Path(session.source_path), self.media_preparer.ffprobe_path
                ),
                model=session.model,
                effort=session.effort,
                system_prompt=self.system_prompt_provider(),
            )
            stream = iter(self.analyzer.stream(prepared, analysis_input))
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
            media_is_video = analysis_input.source_media_has_video
            words = [WordTiming.model_validate(word) for word in session.transcript_word_timings]
            provider_result = parse_provider_analysis_result(raw_stream)
            if isinstance(provider_result, AnalysisPlan):
                provider_result = provider_result.model_copy(
                    update={"session_date": session.session_date.strftime("%m-%d-%Y")}
                )
                result = render_analysis_plan(
                    provider_result,
                    words,
                    session.extraction_options,
                    source_media_has_video=media_is_video,
                )
            else:
                # Existing unfinished Sessions retain their old provider result format.
                result = provider_result
                if any(mention.source_word_end >= len(words) for mention in result.mentions):
                    raise ValueError("Mention exceeds canonical Whisper word range")
                result.source_media_has_video = media_is_video
            if media_is_video:
                result.snapshots = materialize_snapshot_proposals(
                    result.snapshot_cues,
                    words,
                    Path(session.source_path),
                    artifact_dir / "snapshots",
                    FFmpegSnapshotExtractor(
                        self.media_preparer.ffmpeg_path, self.media_preparer.ffprobe_path
                    ),
                )
            else:
                result.snapshot_cues = []
                result.snapshots = []
            result.session_record_markdown = _with_input_context(
                result.session_record_markdown,
                session.extra_instructions,
                session.attachment_paths,
                result.consulted_attachment_filenames,
            )
            result.session_record_markdown = render_snapshot_section(
                result.session_record_markdown, media_is_video, result.snapshots
            )
            validate_session_record(result.session_record_markdown, session.extraction_options)
            self.repository.complete_attempt(attempt_id, result.model_dump_json())
            completed = self.repository.update_session(
                session_id, status="review", stage="review", progress=100
            )
            yield self._event("complete", completed.model_dump(mode="json"))
        except Exception as error:
            detail = str(error).strip() or "an unexpected local error occurred"
            output_status = "Partial output was preserved." if raw_stream else "No analysis output was received."
            message = f"Analysis generation stopped: {detail}. {output_status}"
            if "attempt_id" in locals():
                self.repository.fail_attempt(attempt_id, message)
                failed = self.repository.update_session(
                    session_id, status="error", stage=failure_stage
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
