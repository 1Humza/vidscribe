import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Copy, X } from 'lucide-react';
import { commitSession, createSession, executeSession, getSession, getSystemPrompt, openCompletedSession, openSourceSession, pickAttachments, pickDestination, pickSource, selectDestinationPath as resolveDestinationPath, selectSourcePath as resolveSourcePath, updateReview, updateSessionDestination, updateSystemPrompt, type SessionEvent } from './api';
import IntakePanel from './components/IntakePanel';
import DistillationPanel from './components/DistillationPanel';
import InsightsPanel from './components/InsightsPanel';
import SystemPromptModal from './components/SystemPromptModal';
import type {
  AnalysisEffortDto,
  AnalysisModelDto,
  ExtractionOptionsDto,
  SelectedDestination,
  SelectedAttachment,
  SelectedSource,
  SessionViewDto,
} from './types';
import { fileName, matchingMentionRanges, toReview } from './sessionReview';


const ACTIVE_SESSION_KEY = 'vidscribe.activeSessionId';
const AUDIO_EXTENSIONS = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);

const mediaKindForPath = (path: string): 'audio' | 'video' => {
  const extension = path.split('.').at(-1)?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'video';
};

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

const latestResult = (session: SessionViewDto | null) => session?.attempts.at(-1)?.result || null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  ));
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
  const [model, setModel] = useState<AnalysisModelDto>('gemini-3-flash-preview');
  const [effort, setEffort] = useState<AnalysisEffortDto>('medium');
  const [session, setSession] = useState<SessionViewDto | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState('');
  const [reviewMarkdown, setReviewMarkdown] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processTime, setProcessTime] = useState('00:00');
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [pickerBusy, setPickerBusy] = useState<'source' | 'destination' | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'fading'>('idle');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [activeMentionPhrase, setActiveMentionPhrase] = useState<string | null>(null);
  const [activeMentionSourceWordIndex, setActiveMentionSourceWordIndex] = useState<number | null>(null);
  const [activeMentionAnchorWord, setActiveMentionAnchorWord] = useState<string | null>(null);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptContract, setSystemPromptContract] = useState<Record<string, unknown> | null>(null);
  const [isSystemPromptLoading, setIsSystemPromptLoading] = useState(false);
  const [isSystemPromptSaving, setIsSystemPromptSaving] = useState(false);
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
    session && validatedResult && destination && ['review', 'needs_attention', 'completed'].includes(session.status),
  );

  const applySession = (
    next: SessionViewDto,
    selectedSource?: SelectedSource,
    preserveMarkdownDraft = false,
    clearAnalysisPreview = false,
    preserveIntakeDraft = false,
  ) => {
    setSession(next);
    setSource((current) => ({
      selectionId: selectedSource?.path === next.source_path ? selectedSource.selectionId : current?.path === next.source_path ? current.selectionId : undefined,
      path: next.source_path,
      name: fileName(next.source_path),
      mediaKind: selectedSource?.path === next.source_path ? selectedSource.mediaKind : current?.path === next.source_path ? current.mediaKind : mediaKindForPath(next.source_path),
      sizeBytes: selectedSource?.path === next.source_path ? selectedSource.sizeBytes : current?.path === next.source_path ? current.sizeBytes ?? next.source_size_bytes : next.source_size_bytes,
      durationSeconds: selectedSource?.path === next.source_path ? selectedSource.durationSeconds : current?.path === next.source_path ? current.durationSeconds ?? next.source_duration_seconds : next.source_duration_seconds,
      sourceDate: selectedSource?.path === next.source_path ? selectedSource.sourceDate : current?.path === next.source_path ? current.sourceDate ?? next.source_date : next.source_date,
    }));
    if (next.destination_path) {
      setDestination((current) => ({
        selectionId: current?.path === next.destination_path ? current.selectionId : undefined,
        path: next.destination_path,
        name: fileName(next.destination_path),
      }));
    } else {
      setDestination(null);
    }
    if (!preserveIntakeDraft) {
      const intake = intakeFromSession(next.extra_instructions || '', next.speaker_hints);
      setContext(intake.context);
      setSpeakers(intake.speakers);
      setAttachments((next.attachment_paths || []).map((path) => ({ path, name: fileName(path) })));
      setExtractionOptions(next.extraction_options);
      setModel(next.model);
      setEffort(next.effort);
    }
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
    const sessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!sessionId) return;
    const controller = new AbortController();
    getSession(sessionId, controller.signal)
      .then((restored) => {
        applySession(restored);
        const failure = restored.status === 'error' ? restored.attempts.at(-1)?.error : null;
        if (failure) setErrorNotice(failure);
      })
      .catch(() => {
        if (!controller.signal.aborted) window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setTheme(preference.matches ? 'dark' : 'light');
    syncTheme();
    preference.addEventListener('change', syncTheme);
    return () => preference.removeEventListener('change', syncTheme);
  }, []);

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

  const selectSource = async () => {
    setPickerBusy('source');
    setErrorNotice(null);
    try {
      const selected = await pickSource(source?.path);
      await applySourceSelection(selected);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The source picker failed.'));
    } finally {
      setPickerBusy(null);
    }
  };

  const applySourceSelection = async (selected: Awaited<ReturnType<typeof pickSource>>) => {
      if (selected.media_kind === null) {
        applySession(await openCompletedSession(selected.selection_id));
        return true;
      }
      const selectedSource = {
        selectionId: selected.selection_id,
        path: selected.path,
        name: selected.name,
        mediaKind: selected.media_kind,
        sizeBytes: selected.size_bytes,
        durationSeconds: selected.duration_seconds,
        sourceDate: selected.source_date,
      };
      setSource(selectedSource);
      setSession(null);
      setAnalysisPreview('');
      setReviewMarkdown('');
      setContext('');
      setSpeakers('');
      setAttachments([]);
      setSaveStatus('idle');
      const restored = await openSourceSession(selected.selection_id);
      if (restored) applySession(restored, selectedSource);
      return true;
  };

  const selectSourcePath = async (path: string) => {
    setPickerBusy('source');
    setErrorNotice(null);
    try {
      await applySourceSelection(await resolveSourcePath(path));
      return true;
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The source path could not be selected.'));
      return false;
    } finally {
      setPickerBusy(null);
    }
  };

  const applyDestinationSelection = async (selected: Awaited<ReturnType<typeof pickDestination>>, preserveSession: boolean) => {
    const selectedDestination = { selectionId: selected.selection_id, path: selected.path, name: selected.name };
    if (preserveSession && session) {
      const updated = await updateSessionDestination(session.id, selected.selection_id);
      setSession((current) => current ? { ...current, destination_path: updated.destination_path } : updated);
      setDestination(selectedDestination);
    } else {
      setDestination(selectedDestination);
      setSession(null);
      setAnalysisPreview('');
      setReviewMarkdown('');
      setAttachments([]);
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  };

  const selectDestination = async (preserveSession = false) => {
    setPickerBusy('destination');
    setErrorNotice(null);
    try {
      const selected = await pickDestination(destination?.path);
      await applyDestinationSelection(selected, preserveSession);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The destination picker failed.'));
    } finally {
      setPickerBusy(null);
    }
  };

  const selectDestinationPath = async (path: string) => {
    setPickerBusy('destination');
    setErrorNotice(null);
    try {
      await applyDestinationSelection(await resolveDestinationPath(path), true);
      return true;
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The output path could not be selected.'));
      return false;
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
      applySession(event.data, undefined, false, event.type === 'session' && event.data.status === 'processing', true);
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
    if (!source || isProcessing) return;
    if (!session && !source.selectionId) {
      setErrorNotice('Select Source again before creating a new session.');
      return;
    }
    if (session && !source.selectionId) {
      setErrorNotice('Select Source again before executing this session.');
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
      const speakerHints = speakers.split(',').map((speaker) => speaker.trim()).filter(Boolean);
      const attachmentSelectionIds = attachments.map((attachment) => attachment.selectionId).filter((id): id is string => Boolean(id));
      const active = session || await createSession({
          sourceSelectionId: source.selectionId!,
          destinationSelectionId: destination?.selectionId,
          extraInstructions: context,
          speakerHints,
          extractionOptions,
          model,
          effort,
          attachmentSelectionIds,
        });
      if (!session) applySession(active);
      const controller = new AbortController();
      executeAbortRef.current = controller;
      await executeSession(active.id, handleEvent, {
        model,
        effort,
        extraInstructions: context,
        speakerHints,
        extractionOptions,
      }, controller.signal);
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

  const openSystemPrompt = async () => {
    setIsSystemPromptOpen(true);
    setIsSystemPromptLoading(true);
    try {
      const savedPrompt = await getSystemPrompt();
      setSystemPrompt(savedPrompt.prompt);
      setSystemPromptContract(savedPrompt.locked_contract);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The saved system prompt could not be loaded.'));
    } finally {
      setIsSystemPromptLoading(false);
    }
  };

  const saveSystemPrompt = async (prompt: string) => {
    setIsSystemPromptSaving(true);
    try {
      const savedPrompt = await updateSystemPrompt(prompt);
      setSystemPrompt(savedPrompt.prompt);
      setSystemPromptContract(savedPrompt.locked_contract);
      setIsSystemPromptOpen(false);
    } catch (error) {
      setErrorNotice(errorMessage(error, 'The system prompt could not be saved.'));
    } finally {
      setIsSystemPromptSaving(false);
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

  const copyError = async () => {
    if (!errorNotice || !window.navigator.clipboard?.writeText) return;
    try {
      await window.navigator.clipboard.writeText(errorNotice);
      setErrorCopied(true);
    } catch {
      setErrorCopied(false);
    }
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
      {errorNotice && (
        <div role="alert" className="fixed z-[60] top-16 left-1/2 -translate-x-1/2 w-[min(92vw,700px)] p-3 rounded-xl border border-rose-500/30 bg-panel-canvas text-rose-500 text-sm flex items-start justify-between gap-3 shadow-lg">
          <div className="flex min-w-0 items-start gap-2 select-text cursor-text">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{errorNotice}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button aria-label={errorCopied ? 'Error copied' : 'Copy error'} title={errorCopied ? 'Error copied' : 'Copy error'} onClick={() => void copyError()} className="p-1 rounded-lg hover:bg-input-canvas">
              {errorCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button aria-label="Dismiss error" onClick={() => { setErrorCopied(false); setErrorNotice(null); }} className="p-1 rounded-lg hover:bg-input-canvas"><X size={14} /></button>
          </div>
        </div>
      )}

      <section ref={intakeRef} aria-label="Session Intake" className="min-h-screen h-screen shrink-0 flex flex-col justify-between overflow-y-auto relative py-12 px-6 sm:px-12 md:px-20 lg:px-32 bg-app-canvas border-b border-muted-canvas">
        <div className="flex-1 flex flex-col justify-center">
          <IntakePanel
            source={source}
            onSelectSource={selectSource}
            onSelectSourcePath={selectSourcePath}
            onClearSource={clearSource}
            pickerBusy={pickerBusy}
            context={context}
            setContext={setContext}
            onEditSystemPrompt={() => void openSystemPrompt()}
            attachments={attachments}
            onSelectAttachments={selectAttachments}
            speakers={speakers}
            setSpeakers={setSpeakers}
            extractionOptions={extractionOptions}
            setExtractionOptions={setExtractionOptions}
            model={model}
            setModel={(nextModel) => {
              setModel(nextModel);
              if (nextModel === 'gemini-2.5-flash' && effort === 'minimal') setEffort('low');
            }}
            effort={effort}
            setEffort={setEffort}
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
        <div className="flex-shrink-0 flex items-center justify-center gap-4 px-6 py-2 border-b border-muted-canvas bg-panel-canvas/80 backdrop-blur-md">
          <span className="max-w-[58vw] truncate text-sm font-medium text-main-canvas">
            {source?.name || 'Distillation Workspace'}
          </span>
          <button onClick={scrollToIntake} className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-canvas hover:text-main-canvas transition-colors font-bold cursor-pointer">
            <ChevronUp size={15} className="text-orange-500" />
            <span>Back to intake</span>
          </button>
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
              highlightSourceWordIndex={activeMentionSourceWordIndex}
              highlightAnchorWord={activeMentionAnchorWord}
              saveStatus={saveStatus}
              onSelectSource={selectSource}
              isReadOnly={isReviewReadOnly}
            />
          </section>
          <section className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <InsightsPanel
              result={review}
              onSaveIdentity={(short_name) => saveReview({ short_name })}
              onSaveSessionDate={(session_date, session_time) => saveReview({ session_date, session_time })}
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
              onMentionAdd={(sourcePhrase, replacement) => {
                const ranges = matchingMentionRanges(session?.transcript_word_timings || [], sourcePhrase);
                if (!ranges.length) {
                  setErrorNotice('That phrase was not found in the transcript.');
                  return false;
                }
                void saveReview({
                  phrase_corrections: ranges.map((range) => ({
                    source_word_start: range.sourceWordStart,
                    source_word_end: range.sourceWordEnd,
                    replacement,
                  })),
                });
                return true;
              }}
              onMentionSelect={(phrase, sourceWordIndex, anchorWord) => {
                setActiveMentionPhrase(phrase);
                setActiveMentionSourceWordIndex(sourceWordIndex ?? null);
                setActiveMentionAnchorWord(anchorWord ?? null);
              }}
              saveStatus={saveStatus}
              onCommit={commitReview}
              canCommit={canCommit}
              destination={destination}
              onSelectDestination={() => void selectDestination(true)}
              onSelectDestinationPath={selectDestinationPath}
              pickerBusy={pickerBusy}
              isCommitPending={isCommitting}
              isReadOnly={isReviewReadOnly}
            />
          </section>
        </div>
      </section>
      <SystemPromptModal
        isOpen={isSystemPromptOpen}
        value={systemPrompt}
        lockedContract={systemPromptContract}
        isLoading={isSystemPromptLoading}
        isSaving={isSystemPromptSaving}
        onClose={() => setIsSystemPromptOpen(false)}
        onSave={saveSystemPrompt}
      />
    </div>
  );
}
