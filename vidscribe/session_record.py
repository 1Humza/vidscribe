import re

from vidscribe.models import (
    AnalysisPlan,
    AnalysisResult,
    ExtractionOptions,
    Mention,
)
from vidscribe.snapshots import SnapshotCue
from vidscribe.transcription import SILENCE_THRESHOLD_SECONDS, WordTiming


_SECTION_NAMES = (
    "Input Context|Recall Brief|Highlights|Action Summary|Topics|Chapters|Snapshots|Transcript"
)

_ACTION_SUMMARY_WORD_LIMIT = 350


def _clock(seconds: float) -> str:
    whole_seconds = max(0, int(seconds))
    minutes, remaining_seconds = divmod(whole_seconds, 60)
    return f"{minutes:02d}:{remaining_seconds:02d}"


def _word_text(tokens: list[str]) -> str:
    text = ""
    closing_punctuation = set(".,!?;:%)]}")
    for token in tokens:
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


def _require_index(index: int, words: list[WordTiming], field: str) -> None:
    if index >= len(words):
        raise ValueError(f"{field} exceeds canonical Whisper word range")


def _speaker_label(index: int, labels: list[str], field: str) -> str:
    if index >= len(labels):
        raise ValueError(f"{field} references an unknown speaker")
    return labels[index]


def _speaker_for_word(plan: AnalysisPlan, word_index: int) -> str:
    for turn in plan.turns:
        if turn.source_word_start <= word_index <= turn.source_word_end:
            return _speaker_label(turn.speaker_index, plan.speaker_labels, "Highlight")
    raise ValueError("Highlight is not covered by a Transcript turn")


def _validate_plan(plan: AnalysisPlan, words: list[WordTiming], options: ExtractionOptions) -> None:
    if not words:
        if plan.turns:
            raise ValueError("Transcript turns require canonical Whisper words")
        return
    if not plan.turns:
        raise ValueError("Analysis Plan must cover the canonical Whisper transcript")
    expected_start = 0
    for turn in plan.turns:
        _require_index(turn.source_word_end, words, "Transcript turn")
        _speaker_label(turn.speaker_index, plan.speaker_labels, "Transcript turn")
        if turn.source_word_start != expected_start:
            raise ValueError("Transcript turns must be ordered and cover every canonical Whisper word")
        expected_start = turn.source_word_end + 1
    if expected_start != len(words):
        raise ValueError("Transcript turns must cover every canonical Whisper word")

    previous_end = -1
    for edit in plan.edits:
        _require_index(edit.source_word_end, words, "Transcript edit")
        if edit.source_word_start <= previous_end:
            raise ValueError("Transcript edits must be ordered and non-overlapping")
        previous_end = edit.source_word_end

    if options.action_summary:
        if plan.topics.strip():
            raise ValueError("Analysis Plan includes Topics when Action Summary is selected")
        if len(re.findall(r"[^\W_]+(?:['’][^\W_]+)?", plan.action_summary)) > _ACTION_SUMMARY_WORD_LIMIT:
            raise ValueError("Action Summary must not exceed 350 words")
    elif plan.action_summary.strip():
        raise ValueError("Analysis Plan includes Action Summary when Topics is selected")

    if options.chapters:
        if plan.chapters and len(plan.chapters) < 3:
            raise ValueError("Chapters require at least three entries")
        if plan.chapters and plan.chapters[0].anchor_word_index != 0:
            raise ValueError("The first Chapter must anchor the first canonical Whisper word")
        previous_index = -1
        for chapter in plan.chapters:
            _require_index(chapter.anchor_word_index, words, "Chapter")
            if chapter.anchor_word_index <= previous_index:
                raise ValueError("Chapters must use ascending canonical Whisper word indexes")
            previous_index = chapter.anchor_word_index
        for current, following in zip(plan.chapters, plan.chapters[1:]):
            if words[following.anchor_word_index].start - words[current.anchor_word_index].start < 10:
                raise ValueError("Chapters must span at least ten seconds")
        if plan.chapters and words[-1].end - words[plan.chapters[-1].anchor_word_index].start < 10:
            raise ValueError("Chapters must span at least ten seconds")
    elif plan.chapters:
        raise ValueError("Analysis Plan includes Chapters when Chapters are unselected")

    if not options.highlights and plan.highlights:
        raise ValueError("Analysis Plan includes Highlights when Highlights are unselected")
    for highlight in plan.highlights:
        _require_index(highlight.source_word_end, words, "Highlight")
    for mention in plan.mentions:
        _require_index(mention.source_word_end, words, "Mention")
        _speaker_label(mention.speaker_index, plan.speaker_labels, "Mention")
    for cue in plan.snapshot_cues:
        _require_index(cue.source_word_end, words, "Snapshot Cue")
        _require_index(cue.anchor_word_index, words, "Snapshot Cue")
        _speaker_label(cue.speaker_index, plan.speaker_labels, "Snapshot Cue")
        if not cue.source_word_start <= cue.anchor_word_index <= cue.source_word_end:
            raise ValueError("Snapshot Cue anchor must be within its source range")


def _corrected_tokens(words: list[WordTiming], plan: AnalysisPlan) -> list[str]:
    tokens = [word.word for word in words]
    for edit in plan.edits:
        tokens[edit.source_word_start] = edit.text
        for index in range(edit.source_word_start + 1, edit.source_word_end + 1):
            tokens[index] = ""
    return tokens


def _render_transcript(plan: AnalysisPlan, words: list[WordTiming], tokens: list[str]) -> str:
    if not words:
        return ""
    lines: list[str] = []
    for turn in plan.turns:
        speaker = _speaker_label(turn.speaker_index, plan.speaker_labels, "Transcript turn")
        start = turn.source_word_start
        for index in range(turn.source_word_start + 1, turn.source_word_end + 1):
            if words[index].start - words[index - 1].end >= SILENCE_THRESHOLD_SECONDS:
                text = _word_text(tokens[start:index])
                if text:
                    lines.append(f"[{_clock(words[start].start)}] {speaker}: {text}")
                lines.append(f"(Silence {_clock(words[index].start - words[index - 1].end)})")
                start = index
        text = _word_text(tokens[start : turn.source_word_end + 1])
        if text:
            lines.append(f"[{_clock(words[start].start)}] {speaker}: {text}")
    return "\n".join(lines)


def render_analysis_plan(
    plan: AnalysisPlan,
    words: list[WordTiming],
    options: ExtractionOptions,
    *,
    source_media_has_video: bool,
) -> AnalysisResult:
    """Render a plan against canonical Whisper words; all time is server-owned."""
    _validate_plan(plan, words, options)
    tokens = _corrected_tokens(words, plan)
    header = f"📝 **{plan.short_name.strip()}** · {plan.session_date}"
    parts = [header, "## Recall Brief", plan.recall_brief.strip()]
    if options.highlights:
        highlight_lines = [
            f"- [{_clock(words[item.source_word_start].start)}] "
            f"{_speaker_for_word(plan, item.source_word_start)}: "
            f"{item.label} — \"{_word_text(tokens[item.source_word_start : item.source_word_end + 1])}\""
            for item in plan.highlights
        ]
        parts.extend(["## Highlights", "\n".join(highlight_lines) or "No Highlights qualify."])
    if options.action_summary:
        parts.extend(["## Action Summary", f"{header}\n\n{plan.action_summary.strip() or 'No Action Summary qualifies.'}"])
    else:
        parts.extend(["## Topics", plan.topics.strip() or "No Topics qualify."])
    if options.chapters:
        chapter_lines = [
            f"{'00:00' if item.anchor_word_index == 0 else _clock(words[item.anchor_word_index].start)} {item.title.strip()}"
            for item in plan.chapters
        ]
        parts.extend(["## Chapters", "\n".join(chapter_lines) or "No chapter boundaries qualify for this Session."])
    parts.extend(["## Snapshots", "No Snapshot qualified for this video Session." if source_media_has_video else "Source Media was audio."])
    parts.extend(["## Transcript", _render_transcript(plan, words, tokens)])
    snapshot_cues = [
        SnapshotCue(
            subject=cue.subject,
            cue_phrase=_word_text([word.word for word in words[cue.source_word_start : cue.source_word_end + 1]]),
            anchor_word=words[cue.anchor_word_index].word,
            anchor_word_index=cue.anchor_word_index,
            speaker_label=_speaker_label(cue.speaker_index, plan.speaker_labels, "Snapshot Cue"),
            kind=cue.kind,
        )
        for cue in plan.snapshot_cues
    ]
    return AnalysisResult(
        session_record_markdown="\n\n".join(parts).strip(),
        short_name=plan.short_name.strip(),
        session_date=plan.session_date,
        speaker_labels=[label.strip() for label in plan.speaker_labels],
        consulted_attachment_filenames=plan.consulted_attachment_filenames,
        mentions=[
            Mention(
                source_word_start=item.source_word_start,
                source_word_end=item.source_word_end,
                speaker_label=_speaker_label(item.speaker_index, plan.speaker_labels, "Mention"),
                replacement=next(
                    (
                        edit.text
                        for edit in plan.edits
                        if edit.source_word_start == item.source_word_start
                        and edit.source_word_end == item.source_word_end
                    ),
                    None,
                ),
            )
            for item in plan.mentions
        ],
        snapshot_cues=snapshot_cues,
        source_media_has_video=source_media_has_video,
    )


def normalize_session_record_headings(markdown: str) -> str:
    """Canonicalize provider section labels before enforcing the record contract."""
    return re.sub(
        rf"(?m)^[ \t]*(?:#{{2,6}}[ \t]+)?(?:\*\*)?({_SECTION_NAMES})(?:\*\*)?[ \t]*:?[ \t]*$",
        r"## \1",
        markdown,
    )


def validate_session_record(markdown: str, options: ExtractionOptions) -> None:
    """Enforce the stable, user-visible Session Record contract at the provider boundary."""
    header = re.search(r"^📝 \*\*.+\*\* · \d{2}-\d{2}-\d{4}", markdown, re.MULTILINE)
    if header is None or (header.start() and not markdown.startswith("## Input Context\n")):
        raise ValueError("Session Record must begin with the canonical header")
    required = ["Recall Brief", "Snapshots", "Transcript"]
    selected = [
        *( ["Highlights"] if options.highlights else [] ),
        "Action Summary" if options.action_summary else "Topics",
        *( ["Chapters"] if options.chapters else [] ),
    ]
    omitted = [
        *( ["Highlights"] if not options.highlights else [] ),
        "Topics" if options.action_summary else "Action Summary",
        *( ["Chapters"] if not options.chapters else [] ),
    ]
    headings = [
        heading.strip().strip("*").strip()
        for heading in re.findall(r"^#{2,6}\s+(.+)$", markdown, re.MULTILINE)
    ]
    for heading in [*required, *selected]:
        if heading not in headings:
            raise ValueError(f"Session Record is missing {heading}")
    if any(heading in headings for heading in omitted):
        raise ValueError("Session Record includes an unselected extraction")
    if options.action_summary:
        action_summary_match = re.search(
            r"^#{2,6}\s+Action Summary\s*$([\s\S]*?)(?=^#{2,6}\s+|\Z)",
            markdown,
            re.MULTILINE,
        )
        assert action_summary_match is not None
        word_count = len(re.findall(r"[^\W_]+(?:['’][^\W_]+)?", action_summary_match.group(1)))
        if word_count > _ACTION_SUMMARY_WORD_LIMIT:
            raise ValueError("Action Summary must not exceed 350 words")
    expected = ["Recall Brief", *selected, "Snapshots", "Transcript"]
    positions = [headings.index(heading) for heading in expected]
    if positions != sorted(positions) or headings[-1] != "Transcript":
        raise ValueError("Session Record sections are out of order")
    if options.chapters:
        chapter_match = re.search(
            r"^#{2,6}\s+Chapters\s*$([\s\S]*?)(?=^#{2,6}\s+Snapshots\s*$)",
            markdown,
            re.MULTILINE,
        )
        if chapter_match is None:
            raise ValueError("Session Record is missing Chapters")
        chapter_content = chapter_match.group(1)
        timestamps = re.findall(r"(?m)^\d{1,2}:\d{2}(?::\d{2})? .+", chapter_content)
        if timestamps and len(timestamps) < 3:
            raise ValueError("Chapters require at least three timestamped entries")
