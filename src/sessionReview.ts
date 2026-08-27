import { snapshotUrl } from './api';
import type { AnalysisResultDto, DistillationResult, FileTreeNode, SessionViewDto } from './types';

export const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) || path;

function formatTimestamp(sessionDate: string, createdAt: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sessionDate)
    ? new Date(`${sessionDate}T12:00:00`)
    : /^\d{2}-\d{2}-\d{4}$/.test(sessionDate)
      ? new Date(`${sessionDate.slice(6)}-${sessionDate.slice(0, 2)}-${sessionDate.slice(3, 5)}T12:00:00`)
      : null;
  const readableDate = date
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
    : sessionDate;
  const created = new Date(createdAt);
  const readableTime = Number.isNaN(created.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(created);
  return [readableDate, readableTime].filter(Boolean).join(' · ');
}

function completedBasename(session: SessionViewDto, result: AnalysisResultDto) {
  const title = result.short_name.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/g, ' - ');
  return `[${session.session_date}] ${title || 'Session'}`;
}

function sourceExtension(path: string) {
  const name = fileName(path);
  const extensionAt = name.lastIndexOf('.');
  return extensionAt === -1 ? '' : name.slice(extensionAt);
}

function filesystemPreview(session: SessionViewDto, result: AnalysisResultDto, markdown: string): FileTreeNode[] {
  const basename = completedBasename(session, result);
  const folderName = session.completed_folder_path ? fileName(session.completed_folder_path) : basename;
  return [{
    name: folderName,
    type: 'directory',
    children: [
      { name: `${basename}.md`, type: 'file', content: markdown },
      { name: `${basename}.24k.ogg`, type: 'file' },
      { name: `${basename}${sourceExtension(session.source_path)}`, type: 'file' },
      ...(result.snapshots || []).filter((snapshot) => snapshot.kept).map((snapshot) => ({ name: snapshot.filename, type: 'file' as const })),
    ],
  }];
}

function cleanMentionTag(value: string): string {
  return value.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/\s+/g, ' ');
}

function mentionTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.map((token) => token.toLocaleLowerCase()) || [];
}

export function matchingMentionRanges(
  words: NonNullable<SessionViewDto['transcript_word_timings']>,
  tag: string,
): Array<{ sourceWordStart: number; sourceWordEnd: number }> {
  const phrase = mentionTokens(tag);
  if (!phrase.length) return [];
  const wordTokens = words.map((word) => mentionTokens(word.word));
  const ranges: Array<{ sourceWordStart: number; sourceWordEnd: number }> = [];
  for (let start = 0; start <= wordTokens.length - phrase.length; start += 1) {
    if (phrase.every((token, offset) => wordTokens[start + offset].length === 1 && wordTokens[start + offset][0] === token)) {
      ranges.push({ sourceWordStart: start, sourceWordEnd: start + phrase.length - 1 });
    }
  }
  return ranges;
}

function uniqueMentionRanges(ranges: Array<{ sourceWordStart: number; sourceWordEnd: number }>) {
  return ranges.filter((range, index) => ranges.findIndex((candidate) => (
    candidate.sourceWordStart === range.sourceWordStart && candidate.sourceWordEnd === range.sourceWordEnd
  )) === index);
}

function mentionContext(words: NonNullable<SessionViewDto['transcript_word_timings']>, start: number, end: number): string {
  return words.slice(Math.max(0, start - 6), Math.min(words.length, end + 7)).map((word) => word.word.trim()).join(' ').trim();
}

function startsWithSentenceCapital(value: string): boolean {
  const firstLetter = value.match(/\p{L}/u)?.[0];
  return Boolean(firstLetter && firstLetter === firstLetter.toLocaleUpperCase() && value !== value.toLocaleUpperCase());
}

export function toReview(
  session: SessionViewDto,
  result: AnalysisResultDto,
  markdown: string,
  attemptId: string,
): DistillationResult {
  const canonicalWords = session.transcript_word_timings || [];
  const mentions = new Map<string, DistillationResult['mentions'][number]>();
  for (const mention of result.mentions || []) {
    const words = canonicalWords.slice(mention.source_word_start, mention.source_word_end + 1);
    if (!words.length) continue;
    const tag = cleanMentionTag(mention.replacement || words.map((word) => word.word).join(' '));
    const dedupeKey = tag.toLocaleLowerCase();
    if (!tag) continue;
    const range = { sourceWordStart: mention.source_word_start, sourceWordEnd: mention.source_word_end };
    const matchingRanges = uniqueMentionRanges([range, ...matchingMentionRanges(canonicalWords, tag)]);
    const existing = mentions.get(dedupeKey);
    if (existing) {
      existing.sourceRanges = uniqueMentionRanges([...existing.sourceRanges, ...matchingRanges]);
      if (!startsWithSentenceCapital(existing.tag) && startsWithSentenceCapital(tag)) existing.tag = tag;
      continue;
    }
    const seconds = Math.floor(words[0].start);
    mentions.set(dedupeKey, {
      id: dedupeKey,
      tag,
      time: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
      context: mentionContext(canonicalWords, mention.source_word_start, mention.source_word_end),
      speakerLabel: mention.speaker_label || 'Unknown speaker',
      sourceRanges: matchingRanges,
    });
  }
  return {
    title: result.short_name,
    timestamp: formatTimestamp(result.session_date, session.created_at),
    sessionDate: result.session_date,
    sessionTime: session.session_time,
    markdown,
    speakers: result.speaker_labels.map((name, index) => ({
      id: `speaker-${index + 1}`,
      name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    })),
    mentions: [...mentions.values()],
    agentNotes: [],
    filesystem: filesystemPreview(session, result, markdown),
    snapshots: (result.snapshots || []).map((snapshot) => ({
      filename: snapshot.filename,
      time: `${String(Math.floor(snapshot.timestamp_seconds / 60)).padStart(2, '0')}:${String(Math.floor(snapshot.timestamp_seconds % 60)).padStart(2, '0')}`,
      subject: snapshot.subject,
      cuePhrase: snapshot.cue_phrase,
      anchorWord: snapshot.anchor_word || cleanMentionTag(session.transcript_word_timings?.[snapshot.source_word_index]?.word || ''),
      sourceWordIndex: snapshot.source_word_index,
      speakerLabel: snapshot.speaker_label || 'Unknown speaker',
      kind: snapshot.kind || 'detail',
      imageUrl: snapshotUrl(session.id, attemptId, snapshot.filename),
      kept: snapshot.kept,
    })),
  };
}
