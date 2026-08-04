import json
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from vidscribe.transcription import WordTiming


class SnapshotError(ValueError):
    """A proposed Snapshot cannot be safely grounded or materialized."""


class SnapshotCue(BaseModel):
    subject: str = Field(min_length=1, max_length=80)
    cue_phrase: str = Field(min_length=1)
    anchor_word: str = Field(min_length=1)
    anchor_word_index: int = Field(ge=0)
    speaker_label: str = ""
    kind: Literal["overview", "detail"] = "detail"

    @model_validator(mode="before")
    @classmethod
    def migrate_phrase_start_anchor(cls, value: object) -> object:
        if not isinstance(value, dict) or "source_word_index" not in value:
            return value
        migrated = dict(value)
        migrated.setdefault("anchor_word_index", migrated["source_word_index"])
        migrated.setdefault("anchor_word", migrated.get("cue_phrase", "").split()[0])
        migrated.pop("source_word_index", None)
        return migrated


class SnapshotProposal(BaseModel):
    filename: str
    cue_phrase: str
    anchor_word: str = ""
    speaker_label: str = ""
    kind: Literal["overview", "detail"] = "detail"
    subject: str
    source_word_index: int = Field(ge=0)
    timestamp_seconds: float = Field(ge=0)
    image_path: str
    kept: bool = True

    @model_validator(mode="after")
    def uses_a_root_level_jpeg_name(self) -> "SnapshotProposal":
        path = Path(self.filename)
        if path.name != self.filename or path.suffix.lower() != ".jpg":
            raise ValueError("Snapshot filename must be a root-level JPEG")
        return self


@dataclass(frozen=True)
class ResolvedSnapshotCue:
    seconds: float
    source_word_index: int


@dataclass(frozen=True)
class SnapshotAsset:
    path: Path
    seconds: float


def _tokens(value: str) -> list[str]:
    return re.findall(r"[^\W_]+(?:['’][^\W_]+)?", value.casefold())


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", normalized.casefold()).strip("-")


def resolve_snapshot_cue(cue: SnapshotCue, words: list[WordTiming]) -> ResolvedSnapshotCue:
    phrase = _tokens(cue.cue_phrase)
    anchor = _tokens(cue.anchor_word)
    if not phrase:
        raise SnapshotError("Snapshot Cue must contain spoken words")
    if len(anchor) != 1:
        raise SnapshotError("Snapshot Cue anchor must be one spoken word")
    if cue.anchor_word_index >= len(words):
        raise SnapshotError("Snapshot Cue exceeds canonical Whisper word range")
    if _tokens(words[cue.anchor_word_index].word) != anchor:
        raise SnapshotError("Snapshot Cue anchor does not match the selected canonical Whisper word")
    for offset, token in enumerate(phrase):
        start = cue.anchor_word_index - offset
        if token != anchor[0] or start < 0:
            continue
        candidate = [item for word in words[start : start + len(phrase)] for item in _tokens(word.word)]
        if candidate == phrase:
            return ResolvedSnapshotCue(words[cue.anchor_word_index].start, cue.anchor_word_index)
    raise SnapshotError("Snapshot Cue phrase does not contain the selected canonical Whisper anchor")


def source_has_video(source: Path, ffprobe_path: str = "ffprobe") -> bool:
    try:
        completed = subprocess.run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
                str(source),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return any(stream.get("codec_type") == "video" for stream in json.loads(completed.stdout).get("streams", []))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return False


class FFmpegSnapshotExtractor:
    def __init__(self, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe"):
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path

    def extract(self, source: Path, target_seconds: float, output: Path) -> SnapshotAsset:
        source = source.resolve()
        output = output.resolve()
        if not source.is_file() or not source_has_video(source, self.ffprobe_path):
            raise SnapshotError("Snapshot extraction requires video Source Media")
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.stem}.{uuid4().hex}.tmp.jpg")
        try:
            completed = subprocess.run(
                [
                    self.ffmpeg_path,
                    "-hide_banner",
                    "-nostdin",
                    "-ss",
                    f"{max(0.0, target_seconds - 0.1):.6f}",
                    "-copyts",
                    "-i",
                    str(source),
                    "-vf",
                    f"select=gte(t\\,{target_seconds:.6f}),showinfo",
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    "-y",
                    str(temporary),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            match = re.search(r"pts_time:([0-9.]+)", completed.stderr)
            if match is None:
                raise SnapshotError("FFmpeg could not verify the Snapshot frame timestamp")
            frame_seconds = float(match.group(1))
            if abs(frame_seconds - target_seconds) > 0.1:
                raise SnapshotError("No video frame is available within 100 milliseconds of the Snapshot Cue")
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise SnapshotError("FFmpeg did not produce a Snapshot JPEG")
            temporary.replace(output)
            return SnapshotAsset(output, frame_seconds)
        except subprocess.CalledProcessError as error:
            raise SnapshotError(error.stderr.strip() or "FFmpeg could not extract the Snapshot") from error
        finally:
            temporary.unlink(missing_ok=True)

def materialize_snapshot_proposals(
    cues: list[SnapshotCue],
    words: list[WordTiming],
    source: Path,
    artifact_dir: Path,
    extractor: FFmpegSnapshotExtractor,
) -> list[SnapshotProposal]:
    proposals: list[SnapshotProposal] = []
    used_subjects: set[str] = set()
    overview_used = False
    for cue in cues:
        if cue.kind == "overview" and overview_used:
            continue
        subject = _slug(cue.subject)
        if not subject or subject in used_subjects:
            continue
        filename = f"{len(proposals) + 1:02d}-{subject}.jpg"
        try:
            resolved = resolve_snapshot_cue(cue, words)
            asset = extractor.extract(source, resolved.seconds, artifact_dir / filename)
        except SnapshotError:
            continue
        used_subjects.add(subject)
        overview_used = overview_used or cue.kind == "overview"
        proposals.append(
            SnapshotProposal(
                filename=filename,
                cue_phrase=cue.cue_phrase,
                anchor_word=cue.anchor_word,
                speaker_label=cue.speaker_label.strip(),
                kind=cue.kind,
                subject=cue.subject.strip(),
                source_word_index=resolved.source_word_index,
                timestamp_seconds=asset.seconds,
                image_path=str(asset.path),
            )
        )
    return proposals


def snapshot_section_body(media_is_video: bool, snapshots: list[SnapshotProposal]) -> str:
    kept = [snapshot for snapshot in snapshots if snapshot.kept]
    if not media_is_video:
        return "Source Media was audio."
    if not kept:
        return "No Snapshot qualified for this video Session."
    return "\n".join(
        f"- {int(snapshot.timestamp_seconds // 60):02d}:{int(snapshot.timestamp_seconds % 60):02d} — "
        f"[{snapshot.filename}]({snapshot.filename}) — {snapshot.subject}"
        for snapshot in kept
    )


def render_snapshot_section(markdown: str, media_is_video: bool, snapshots: list[SnapshotProposal]) -> str:
    heading = re.compile(r"^(#{2,6}[ \t]+Snapshots[ \t]*)$", re.MULTILINE)
    match = heading.search(markdown)
    if match is None:
        raise SnapshotError("Session Record is missing Snapshots")
    content_start = match.end()
    next_heading = re.search(r"^#{2,6}\s+.+$", markdown[content_start:], re.MULTILINE)
    content_end = content_start + next_heading.start() if next_heading else len(markdown)
    # The next heading starts after the existing blank separator.  Replace that
    # entire section boundary so each review save is idempotent instead of
    # growing an extra empty line below Snapshots.
    remainder = markdown[content_end:].lstrip("\n")
    return f"{markdown[:content_start]}\n\n{snapshot_section_body(media_is_video, snapshots)}\n\n{remainder}"


def validate_snapshot_section(markdown: str, media_is_video: bool, snapshots: list[SnapshotProposal]) -> None:
    expected = snapshot_section_body(media_is_video, snapshots)
    heading = re.compile(r"^#{2,6}[ \t]+Snapshots[ \t]*$([\s\S]*?)(?=^#{2,6}[ \t]+|\Z)", re.MULTILINE)
    match = heading.search(markdown)
    if match is None or match.group(1).strip() != expected:
        raise SnapshotError("Session Record Snapshot references do not match the reviewed Snapshots")
