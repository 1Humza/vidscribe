import re

from vidscribe.models import AnalysisResult, Mention, ReviewUpdate, SessionView
from vidscribe.session_record import validate_session_record
from vidscribe.snapshots import render_snapshot_section


def _replacement_with_source_capitalization(source: str, replacement: str) -> str:
    """Keep an initial sentence capital when a grouped mention is corrected."""
    source_letter = next((character for character in source if character.isalpha()), "")
    replacement_index = next(
        (index for index, character in enumerate(replacement) if character.isalpha()), None
    )
    if not source_letter or replacement_index is None or not source_letter.isupper() or source.upper() == source:
        return replacement
    return replacement[:replacement_index] + replacement[replacement_index].upper() + replacement[replacement_index + 1 :]


def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    words = re.findall(r"[^\W_]+(?:['’][^\W_]+)?", phrase)
    if not words:
        raise ValueError("Phrase Correction must contain a spoken word")
    return re.compile(rf"(?<!\w){r'[\W_]+'.join(re.escape(word) for word in words)}(?!\w)", re.IGNORECASE)


def _replace_phrase_everywhere(text: str, phrase: str, replacement: str) -> tuple[str, int]:
    return _phrase_pattern(phrase).subn(
        lambda match: _replacement_with_source_capitalization(match.group(0), replacement), text
    )


def _propagate_phrase_correction(
    result: AnalysisResult, markdown: str, phrase: str, replacement: str
) -> tuple[str, int]:
    markdown, replacement_count = _replace_phrase_everywhere(markdown, phrase, replacement)
    for snapshot in result.snapshots:
        snapshot.subject, subject_count = _replace_phrase_everywhere(snapshot.subject, phrase, replacement)
        snapshot.cue_phrase, cue_count = _replace_phrase_everywhere(snapshot.cue_phrase, phrase, replacement)
        snapshot.anchor_word, anchor_count = _replace_phrase_everywhere(snapshot.anchor_word, phrase, replacement)
        replacement_count += subject_count + cue_count + anchor_count
        if subject_count:
            sequence, separator, _ = snapshot.filename.partition("-")
            slug = re.sub(r"[^a-z0-9]+", "-", snapshot.subject.casefold()).strip("-")
            if separator and slug:
                snapshot.filename = f"{sequence}-{slug}.jpg"
    return markdown, replacement_count


def apply_review_update(
    session: SessionView, original: AnalysisResult, update: ReviewUpdate
) -> AnalysisResult:
    """Apply a review edit while preserving record, metadata, and snapshot invariants."""
    result = original.model_copy(deep=True)
    markdown = update.session_record_markdown or result.session_record_markdown
    previous_date, previous_title = result.session_date, result.short_name
    if update.session_date is not None:
        result.session_date = update.session_date.strftime("%m-%d-%Y")
    if update.short_name is not None:
        result.short_name = update.short_name.strip()
    markdown = markdown.replace(previous_date, result.session_date).replace(previous_title, result.short_name)

    labels = list(result.speaker_labels)
    if set(update.speaker_renames) - set(labels):
        raise ValueError("Speaker Label is not in this Session")
    for index, label in enumerate(labels):
        if label in update.speaker_renames:
            labels[index] = update.speaker_renames[label].strip()
    if len({label.casefold() for label in labels}) != len(labels):
        raise ValueError("Speaker Labels must be unique")
    for old, new in update.speaker_renames.items():
        markdown = re.sub(rf"(?<!\w){re.escape(old)}(?!\w)", new.strip(), markdown)
    for mention in result.mentions:
        if mention.speaker_label in update.speaker_renames:
            mention.speaker_label = update.speaker_renames[mention.speaker_label].strip()
    for snapshot in result.snapshots:
        if snapshot.speaker_label in update.speaker_renames:
            snapshot.speaker_label = update.speaker_renames[snapshot.speaker_label].strip()
    result.speaker_labels = labels

    processed: set[tuple[str, str]] = set()
    for correction in update.phrase_corrections:
        mention = next((item for item in result.mentions if item.source_word_start == correction.source_word_start and item.source_word_end == correction.source_word_end), None)
        words = session.transcript_word_timings[correction.source_word_start : correction.source_word_end + 1]
        if len(words) != correction.source_word_end - correction.source_word_start + 1:
            raise ValueError("Phrase Correction exceeds canonical Whisper word range")
        heard = " ".join(str(word["word"]).strip() for word in words).strip()
        current = mention.replacement or heard if mention is not None else heard
        key = (" ".join(re.findall(r"[^\W_]+(?:['’][^\W_]+)?", current)).casefold(), correction.replacement.strip().casefold())
        if key not in processed:
            markdown, replacements = _propagate_phrase_correction(result, markdown, current, correction.replacement.strip())
            if replacements == 0:
                raise ValueError("Phrase Correction text is no longer present in this Session")
            processed.add(key)
        replacement = _replacement_with_source_capitalization(heard, correction.replacement.strip())
        if mention is not None:
            mention.replacement = replacement
        else:
            result.mentions.append(Mention(source_word_start=correction.source_word_start, source_word_end=correction.source_word_end, replacement=replacement))

    unknown_snapshots = set(update.snapshot_keeps) - {snapshot.filename for snapshot in result.snapshots}
    if unknown_snapshots:
        raise ValueError("Snapshot is not proposed for this Session")
    for snapshot in result.snapshots:
        if snapshot.filename in update.snapshot_keeps:
            snapshot.kept = update.snapshot_keeps[snapshot.filename]
    result.session_record_markdown = render_snapshot_section(markdown, result.source_media_has_video, result.snapshots)
    validate_session_record(result.session_record_markdown, session.extraction_options)
    return result
