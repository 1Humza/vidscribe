import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { commitSession, createSession, executeSession, getSession, openCompletedSession, pickAttachments, pickDestination, pickSource, snapshotUrl, updateReview, type SessionEvent } from './api';
import IntakePanel from './components/IntakePanel';
import DistillationPanel from './components/DistillationPanel';
import InsightsPanel from './components/InsightsPanel';
import GlassModal from './components/GlassModal';
import type {
  AnalysisResultDto,
  DistillationResult,
  ExtractionOptionsDto,
  FileTreeNode,
  SelectedDestination,
  SelectedAttachment,
  SelectedSource,
  SessionViewDto,
} from './types';

const ACTIVE_SESSION_KEY = 'vidscribe.activeSessionId';
const AUDIO_EXTENSIONS = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);

const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) || path;
const mediaKindForPath = (path: string): 'audio' | 'video' => {
  const extension = path.split('.').at(-1)?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'video';
};

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

function intakeFromSession(extraInstructions: string, speakerHints: string[] | undefined) {
  if (speakerHints?.length) {
    return { context: extraInstructions, speakers: speakerHints.join(', ') };
  }
  const legacyHints = extraInstructions.match(/(?:^|\n)Speaker hints:\s*([^\n]+)\s*$/);
  return legacyHints
    ? {
      context: extraInstructions.slice(0, legacyHints.index).trimEnd(),
      speakers: legacyHints[1],
    }
    : { context: extraInstructions, speakers: '' };
}

function completedBasename(session: SessionViewDto, result: AnalysisResultDto) {
  const asciiTitle = result.short_name.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const slug = asciiTitle.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${session.session_date}-${slug || 'session'}`;
}

function sourceExtension(path: string) {
  const name = fileName(path);
  const extensionAt = name.lastIndexOf('.');
  return extensionAt === -1 ? '' : name.slice(extensionAt);
}

function filesystemPreview(
  session: SessionViewDto,
  result: AnalysisResultDto,
  markdown: string,
): FileTreeNode[] {
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
  return value
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

function mentionTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)
    ?.map((token) => token.toLocaleLowerCase()) || [];
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
    const matches = phrase.every((token, offset) => (
      wordTokens[start + offset].length === 1 && wordTokens[start + offset][0] === token
    ));
    if (matches) ranges.push({ sourceWordStart: start, sourceWordEnd: start + phrase.length - 1 });
  }
  return ranges;
}

function uniqueMentionRanges(ranges: Array<{ sourceWordStart: number; sourceWordEnd: number }>) {
  return ranges.filter((range, index) => (
    ranges.findIndex((candidate) => (
      candidate.sourceWordStart === range.sourceWordStart
      && candidate.sourceWordEnd === range.sourceWordEnd
    )) === index
  ));
}

function mentionContext(
  words: NonNullable<SessionViewDto['transcript_word_timings']>,
  start: number,
  end: number,
): string {
  return words
    .slice(Math.max(0, start - 6), Math.min(words.length, end + 7))
    .map((word) => word.word.trim())
    .join(' ')
    .trim();
}

function startsWithSentenceCapital(value: string): boolean {
  const firstLetter = value.match(/\p{L}/u)?.[0];
  return Boolean(firstLetter && firstLetter === firstLetter.toLocaleUpperCase() && value !== value.toLocaleUpperCase());
}

function toReview(
  session: SessionViewDto,
  result: AnalysisResultDto,
  markdown: string,
  attemptId: string,
): DistillationResult {
  return {
    title: result.short_name,
    timestamp: formatTimestamp(result.session_date, session.created_at),
    markdown,
    speakers: result.speaker_labels.map((name, index) => ({
      id: `speaker-${index + 1}`,
      name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    })),
    mentions: (() => {
      const canonicalWords = session.transcript_word_timings || [];
      const grouped = new Map<string, DistillationResult['mentions'][number]>();
      for (const mention of result.mentions || []) {
        const words = canonicalWords.slice(mention.source_word_start, mention.source_word_end + 1);
        if (!words.length) continue;
        const tag = cleanMentionTag(mention.replacement || words.map((word) => word.word).join(' '));
        const dedupeKey = tag.toLocaleLowerCase();
        if (!tag) continue;
        const seconds = Math.floor(words[0].start);
        const range = { sourceWordStart: mention.source_word_start, sourceWordEnd: mention.source_word_end };
        const matchingRanges = uniqueMentionRanges([range, ...matchingMentionRanges(canonicalWords, tag)]);
        const existing = grouped.get(dedupeKey);
        if (existing) {
          existing.sourceRanges = uniqueMentionRanges([...existing.sourceRanges, ...matchingRanges]);
          if (!startsWithSentenceCapital(existing.tag) && startsWithSentenceCapital(tag)) existing.tag = tag;
          continue;
        }
        grouped.set(dedupeKey, {
          id: dedupeKey,
          tag,
          time: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
          context: mentionContext(canonicalWords, mention.source_word_start, mention.source_word_end),
          speakerLabel: mention.speaker_label || 'Unknown speaker',
          sourceRanges: matchingRanges,
        });
      }
      return [...grouped.values()];
    })(),
    agentNotes: [],
    filesystem: filesystemPreview(session, result, markdown),
    snapshots: (result.snapshots || []).map((snapshot) => ({
      filename: snapshot.filename,
      time: `${String(Math.floor(snapshot.timestamp_seconds / 60)).padStart(2, '0')}:${String(Math.floor(snapshot.timestamp_seconds % 60)).padStart(2, '0')}`,
      subject: snapshot.subject,
      cuePhrase: snapshot.cue_phrase,
      anchorWord: snapshot.anchor_word || cleanMentionTag(session.transcript_word_timings?.[snapshot.source_word_index]?.word || ''),
      speakerLabel: snapshot.speaker_label || 'Unknown speaker',
      kind: snapshot.kind || 'detail',
      imageUrl: snapshotUrl(session.id, attemptId, snapshot.filename),
      kept: snapshot.kept,
    })),
  };
}

const latestResult = (session: SessionViewDto | null) => session?.attempts.at(-1)?.result || null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [source, setSource] = useState<SelectedSource | null>(null);
  const [destination, setDestination] = useState<SelectedDestination | null>(null);
  const [context, setContext] = useState('');
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [speakers, setSpeakers] = useState('');
  const [extractionOptions, setExtractionOptions] = useState<ExtractionOptionsDto>({
    action_summary: true,
    topics: false,
    chapters: true,
    highlights: false,
  });
  const [session, setSession] = useState<SessionViewDto | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState('');
  const [reviewMarkdown, setReviewMarkdown] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processTime, setProcessTime] = useState('00:00');
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState<'source' | 'destination' | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'fading'>('idle');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [activeMentionPhrase, setActiveMentionPhrase] = useState<string | null>(null);
  const executeAbortRef = useRef<AbortController | null>(null);
  const reviewSaveQueueRef = useRef(Promise.resolve());
  const pendingReviewSavesRef = useRef(0);
  const markdownVersionRef = useRef(0);
  const intakeRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLElement>(null);

  const validatedResult = !isRestarting && session && ['review', 'needs_attention', 'completed'].includes(session.status)
    ? latestResult(session)
    : null;
  const review = useMemo(
    () => session && validatedResult && session.attempts.at(-1)
      ? toReview(session, validatedResult, reviewMarkdown || validatedResult.session_record_markdown, session.attempts.at(-1)!.id)
      : null,
    [session, validatedResult, reviewMarkdown],
  );
  const hasOutput = Boolean(analysisPreview || review);
  const isReviewReadOnly = session?.status === 'finalizing';
  const canCommit = Boolean(
    session && validatedResult && ['review', 'needs_attention', 'completed'].includes(session.status),
  );

  const applySession = (
    next: SessionViewDto,
    selectedSource?: SelectedSource,
    preserveMarkdownDraft = false,
    clearAnalysisPreview = false,
  ) => {
    setSession(next);
    setSource((current) => ({
      selectionId: selectedSource?.path === next.source_path ? selectedSource.selectionId : current?.path === next.source_path ? current.selectionId : undefined,
      path: next.source_path,
      name: fileName(next.source_path),
      mediaKind: selectedSource?.path === next.source_path ? selectedSource.mediaKind : current?.path === next.source_path ? current.mediaKind : mediaKindForPath(next.source_path),
    }));
    setDestination((current) => ({
      selectionId: current?.path === next.destination_path ? current.selectionId : undefined,
      path: next.destination_path,
      name: fileName(next.destination_path),
    }));
    const intake = intakeFromSession(next.extra_instructions || '', next.speaker_hints);
    setContext(intake.context);
    setSpeakers(intake.speakers);
    setAttachments((next.attachment_paths || []).map((path) => ({ path, name: fileName(path) })));
    setExtractionOptions(next.extraction_options);
    const attempt = next.attempts.at(-1);
    if (attempt?.result) {
      if (!preserveMarkdownDraft) setReviewMarkdown(attempt.result.session_record_markdown);
      setAnalysisPreview('');
    } else if (attempt?.raw_stream && !clearAnalysisPreview) {
      setAnalysisPreview(attempt.raw_stream);
    } else if (clearAnalysisPreview) {
      setAnalysisPreview('');
    }
    window.localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (!isProcessing) return;
    const started = Date.now();
    const update = () => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setProcessTime(`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isProcessing]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const fade = window.setTimeout(() => setSaveStatus('fading'), 1800);
    const dismiss = window.setTimeout(() => setSaveStatus('idle'), 2400);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(dismiss);
    };
  }, [saveStatus]);

  useEffect(() => {
    if (!errorNotice) return;
    const dismiss = window.setTimeout(() => setErrorNotice(null), 6000);
    return () => window.clearTimeout(dismiss);
  }, [errorNotice]);

  const selectSource = async () => {
    setPickerBusy('source');
    setErrorNotice(null);
    try {
      const selected = await pickSource(source?.path);
      if (selected.media_kind === null) {
        applySession(await openCompletedSession(selected.selection_id));
        return;
      }
      const selectedSource = { selectionId: selected.selection_id, path: selected.path, name: selected.name, mediaKind: selected.media_kind };
      setSource(selectedSource);
      setSession(null);
      setAnalysisPreview('');
      setReviewMarkdown('');
      setContext('');
      setSpeakers('');
      setAttachments([]);
      setSaveStatus('idle');
      const savedSessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!savedSessionId) return;
      const savedSession = await getSession(savedSessionId);
      if (savedSession.source_path === selected.path) {
        applySession(savedSession, selectedSource);
      } else {
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The source picker failed.'));
    } finally {
      setPickerBusy(null);
    }
  };

  const selectDestination = async () => {
    setPickerBusy('destination');
    setErrorNotice(null);
    try {
      const selected = await pickDestination(destination?.path);
      setDestination({ selectionId: selected.selection_id, path: selected.path, name: selected.name });
      setSession(null);
      setAnalysisPreview('');
      setReviewMarkdown('');
      setAttachments([]);
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The destination picker failed.'));
    } finally {
      setPickerBusy(null);
    }
  };

  const clearSource = () => {
    setSource(null);
    setSession(null);
    setAnalysisPreview('');
    setReviewMarkdown('');
    setContext('');
    setSpeakers('');
    setAttachments([]);
    setSaveStatus('idle');
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  };

  const handleEvent = (event: SessionEvent) => {
    if (event.type === 'session' || event.type === 'complete') {
      if (event.data.status === 'processing') setIsRestarting(false);
      applySession(event.data, undefined, false, event.type === 'session' && event.data.status === 'processing');
      if (event.type === 'complete') setIsProcessing(false);
      return;
    }
    if (event.type === 'analysis_delta') {
      const delta = event.data;
      if (delta.raw_stream) setAnalysisPreview(delta.raw_stream);
      else setAnalysisPreview((current) => `${current}${delta.delta}`);
      return;
    }
    if (event.type === 'analysis_error') {
      const failure = event.data;
      if (failure.raw_stream) setAnalysisPreview(failure.raw_stream);
      setErrorNotice(failure.message);
      setIsProcessing(false);
      return;
    }
    if (event.type === 'pipeline_error') {
      setErrorNotice(event.data.message);
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
    if (!source || !destination || isProcessing) return;
    if (!session && (!source.selectionId || !destination.selectionId)) {
      setErrorNotice('Select Source and Destination again before creating a new session.');
      return;
    }
    setErrorNotice(null);
    setAnalysisPreview('');
    setReviewMarkdown('');
    setIsRestarting(Boolean(session));
    setIsProcessing(true);
    setProcessTime('00:00');
    requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: 'smooth' }));
    try {
      const active = session || await createSession({
        sourceSelectionId: source.selectionId!,
        destinationSelectionId: destination.selectionId!,
        extraInstructions: context,
        speakerHints: speakers.split(',').map((speaker) => speaker.trim()).filter(Boolean),
        extractionOptions,
        attachmentSelectionIds: attachments.map((attachment) => attachment.selectionId).filter((id): id is string => Boolean(id)),
      });
      applySession(active);
      const controller = new AbortController();
      executeAbortRef.current = controller;
      await executeSession(active.id, handleEvent, controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setErrorNotice(errorMessage(error, 'The session could not be executed.'));
    } finally {
      executeAbortRef.current = null;
      setIsProcessing(false);
    }
  };

  const selectAttachments = async () => {
    try {
      const selected = await pickAttachments();
      setAttachments((current) => [...current, ...selected.map((item) => ({
        selectionId: item.selection_id, path: item.path, name: item.name,
      }))]);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'Attached Context could not be selected.'));
    }
  };

  const saveReview = async (update: Parameters<typeof updateReview>[2], markdownVersion?: number) => {
    const attempt = session?.attempts.at(-1);
    if (!session || !attempt?.result) return;
    pendingReviewSavesRef.current += 1;
    setSaveStatus('saving');
    const persist = async () => {
      try {
        const updated = await updateReview(session.id, attempt.id, update);
        const hasNewerMarkdownDraft = markdownVersion !== undefined && markdownVersionRef.current !== markdownVersion;
        applySession(updated, undefined, hasNewerMarkdownDraft);
        if (pendingReviewSavesRef.current === 1) {
          setSaveStatus(hasNewerMarkdownDraft ? 'idle' : 'saved');
        }
      } catch (error) {
        if (pendingReviewSavesRef.current === 1) {
          setSaveStatus('idle');
          setErrorNotice(errorMessage(error, 'Review edits could not be saved.'));
        }
      } finally {
        pendingReviewSavesRef.current -= 1;
      }
    };
    reviewSaveQueueRef.current = reviewSaveQueueRef.current.then(persist, persist);
    await reviewSaveQueueRef.current;
  };

  const handleAbort = () => {
    executeAbortRef.current?.abort();
    setIsProcessing(false);
    setErrorNotice('Execution was stopped. The source media remains untouched.');
  };

  const commitReview = async () => {
    const attempt = session?.attempts.at(-1);
    if (!session || !attempt?.result || !canCommit) return;
    setIsCommitting(true);
    setErrorNotice(null);
    try {
      if (reviewMarkdown !== attempt.result.session_record_markdown) {
        await saveReview({ session_record_markdown: reviewMarkdown }, markdownVersionRef.current);
      }
      await reviewSaveQueueRef.current;
      const committed = await commitSession(session.id, attempt.id);
      applySession(committed);
      if (committed.status === 'needs_attention') {
        setErrorNotice('A Completed Session Folder with this name already exists. Update the Short Name, then commit again.');
      }
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The Session could not be committed. Source Media remains untouched.'));
    } finally {
      setIsCommitting(false);
    }
  };

  const scrollToIntake = () => intakeRef.current?.scrollIntoView({ behavior: 'smooth' });
  const scrollToOutput = () => outputRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="h-screen w-full overflow-y-scroll scroll-smooth bg-app-canvas text-main-canvas font-sans select-none relative transition-colors duration-200">
      <header className="fixed top-4 right-6 z-50 flex items-center space-x-2.5 bg-panel-canvas/80 backdrop-blur-md px-4 py-2.5 rounded-full border border-muted-canvas shadow-sm">
        <Workflow size={16} className="text-orange-500 mr-1.5" />
        <span className="text-xs font-mono text-muted-canvas uppercase tracking-wider font-bold mr-2">Signal Console</span>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-1 rounded-full hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer" title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} mode`}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button onClick={() => setShowGuide(true)} className="p-1 rounded-full hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer" title="Workspace Help Guide"><HelpCircle size={15} /></button>
      </header>

      {errorNotice && (
        <div role="alert" className="fixed z-[60] top-16 left-1/2 -translate-x-1/2 w-[min(92vw,700px)] p-3 rounded-xl border border-rose-500/30 bg-panel-canvas text-rose-500 text-sm flex justify-between items-center shadow-lg">
          <span className="flex items-center gap-2"><AlertCircle size={16} />{errorNotice}</span>
          <button aria-label="Dismiss error" onClick={() => setErrorNotice(null)} className="p-1 rounded-lg hover:bg-input-canvas"><X size={14} /></button>
        </div>
      )}

      <section ref={intakeRef} aria-label="Session Intake" className="min-h-screen h-screen shrink-0 flex flex-col justify-between overflow-y-auto relative py-12 px-6 sm:px-12 md:px-20 lg:px-32 bg-app-canvas border-b border-muted-canvas">
        <div className="flex-1 flex flex-col justify-center">
          <IntakePanel
            source={source}
            destination={destination}
            onSelectSource={selectSource}
            onClearSource={clearSource}
            onSelectDestination={selectDestination}
            pickerBusy={pickerBusy}
            context={context}
            setContext={setContext}
            attachments={attachments}
            onSelectAttachments={selectAttachments}
            speakers={speakers}
            setSpeakers={setSpeakers}
            extractionOptions={extractionOptions}
            setExtractionOptions={setExtractionOptions}
            onExecute={handleExecute}
            isProcessing={isProcessing}
            onAbort={handleAbort}
            stage={session?.stage || 'intake'}
            progress={session?.progress || 0}
          />
        </div>
        <div className="text-center pt-4 flex flex-col items-center justify-center space-y-1.5 select-none">
          <button onClick={scrollToOutput} className="group flex flex-col items-center text-muted-canvas hover:text-main-canvas transition-all cursor-pointer">
            <span className="text-xs font-mono uppercase tracking-widest font-semibold opacity-75 group-hover:opacity-100 transition-opacity">
              {hasOutput ? 'View Distilled Output' : 'Open Distillation Workspace'}
            </span>
            <ChevronDown size={24} className="animate-bounce mt-1 text-orange-500" />
          </button>
        </div>
      </section>

      <section
        ref={outputRef}
        role={review || analysisPreview ? 'region' : undefined}
        aria-label={review ? 'Final Review' : analysisPreview ? 'Analysis Preview' : undefined}
        className="min-h-screen h-screen shrink-0 flex flex-col overflow-hidden relative bg-panel-canvas/45"
      >
        <div className="flex-shrink-0 flex items-center justify-between px-8 md:px-14 lg:px-24 py-3.5 border-b border-muted-canvas bg-panel-canvas/80 backdrop-blur-md">
          <button onClick={scrollToIntake} className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-muted-canvas hover:text-main-canvas transition-colors font-bold cursor-pointer">
            <ChevronUp size={18} className="text-orange-500" />
            <span>← Back to Intake Configuration</span>
          </button>
          <div className="flex items-center space-x-3.5 text-xs font-mono text-muted-canvas">
            {source && <span className="hidden md:inline truncate max-w-xs font-semibold text-main-canvas">Feed: {source.name}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-[1600px] mx-auto px-6 md:px-12 lg:px-20 py-6">
          <section className="lg:col-span-7 flex flex-col h-full overflow-hidden">
            <DistillationPanel
              result={review}
              previewText={analysisPreview}
              isProcessing={isProcessing}
              processTime={processTime}
              stage={session?.stage || 'intake'}
              progress={session?.progress || 0}
              markdownText={reviewMarkdown}
              setMarkdownText={(text) => {
                markdownVersionRef.current += 1;
                setSaveStatus('idle');
                setReviewMarkdown(text);
              }}
              onSaveMarkdown={() => saveReview({ session_record_markdown: reviewMarkdown }, markdownVersionRef.current)}
              highlightPhrase={activeMentionPhrase}
              saveStatus={saveStatus}
              onSelectSource={selectSource}
              isReadOnly={isReviewReadOnly}
            />
          </section>
          <section className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <InsightsPanel
              result={review}
              onSaveIdentity={(short_name) => saveReview({ short_name })}
              onRenameSpeaker={(from, to) => saveReview({ speaker_renames: { [from]: to } })}
              onReviewEdit={() => setSaveStatus('idle')}
              onSnapshotKeep={(filename, kept) => saveReview({ snapshot_keeps: { [filename]: kept } })}
              onMentionCorrect={(ranges, replacement) => {
                saveReview({
                  phrase_corrections: ranges.map((range) => ({
                    source_word_start: range.sourceWordStart,
                    source_word_end: range.sourceWordEnd,
                    replacement,
                  })),
                });
              }}
              onMentionSelect={setActiveMentionPhrase}
              saveStatus={saveStatus}
              onCommit={commitReview}
              canCommit={canCommit}
              isCommitPending={isCommitting}
              isReadOnly={isReviewReadOnly}
            />
          </section>
        </div>
      </section>

      <GlassModal isOpen={showGuide} onClose={() => setShowGuide(false)} title="Workspace Intelligence Guide">
        <div className="space-y-3 text-sm text-muted-canvas"><p>Choose a local recording and destination through service-owned pickers, then execute the durable session.</p><p>Raw provider output appears as Analysis Preview. Final Review is created only after the backend validates the complete schema.</p><p>Issue 2 never commits, moves, or deletes your source.</p></div>
      </GlassModal>
    </div>
  );
}
