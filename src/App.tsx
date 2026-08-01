import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, HelpCircle, Moon, Sun, Workflow, X } from 'lucide-react';
import { createSession, executeSession, getSession, pickDestination, pickSource, type SessionEvent } from './api';
import IntakePanel from './components/IntakePanel';
import DistillationPanel from './components/DistillationPanel';
import InsightsPanel from './components/InsightsPanel';
import GlassModal from './components/GlassModal';
import type {
  AnalysisResultDto,
  DistillationResult,
  ExtractionOptionsDto,
  SelectedDestination,
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

function toReview(result: AnalysisResultDto, markdown: string): DistillationResult {
  return {
    title: result.short_name,
    timestamp: result.session_date,
    markdown,
    speakers: result.speaker_labels.map((name, index) => ({
      id: `speaker-${index + 1}`,
      name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    })),
    mentions: [],
    agentNotes: [],
    filesystem: [],
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
  const [showGuide, setShowGuide] = useState(false);
  const executeAbortRef = useRef<AbortController | null>(null);
  const intakeRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLElement>(null);

  const validatedResult = latestResult(session);
  const review = useMemo(
    () => validatedResult ? toReview(validatedResult, reviewMarkdown || validatedResult.session_record_markdown) : null,
    [validatedResult, reviewMarkdown],
  );
  const hasOutput = Boolean(analysisPreview || review);

  const applySession = (next: SessionViewDto) => {
    setSession(next);
    setSource((current) => ({
      selectionId: current?.path === next.source_path ? current.selectionId : undefined,
      path: next.source_path,
      name: fileName(next.source_path),
      mediaKind: current?.path === next.source_path ? current.mediaKind : mediaKindForPath(next.source_path),
    }));
    setDestination((current) => ({
      selectionId: current?.path === next.destination_path ? current.selectionId : undefined,
      path: next.destination_path,
      name: fileName(next.destination_path),
    }));
    setContext(next.extra_instructions || '');
    setExtractionOptions(next.extraction_options);
    const attempt = next.attempts.at(-1);
    if (attempt?.result) {
      setReviewMarkdown(attempt.result.session_record_markdown);
      setAnalysisPreview('');
    } else if (attempt?.raw_stream) {
      setAnalysisPreview(attempt.raw_stream);
    }
    window.localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const activeId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!activeId) return;
    const controller = new AbortController();
    getSession(activeId, controller.signal)
      .then(applySession)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
        setErrorNotice(errorMessage(error, 'The saved session could not be restored.'));
      });
    return () => controller.abort();
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

  const selectSource = async () => {
    setPickerBusy('source');
    setErrorNotice(null);
    try {
      const selected = await pickSource(source?.path);
      setSource({ selectionId: selected.selection_id, path: selected.path, name: selected.name, mediaKind: selected.media_kind });
      setSession(null);
      setAnalysisPreview('');
      setReviewMarkdown('');
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
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
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  };

  const handleEvent = (event: SessionEvent) => {
    if (event.type === 'session' || event.type === 'complete') {
      applySession(event.data);
      if (event.type === 'complete') setIsProcessing(false);
      return;
    }
    if (event.type === 'analysis_delta') {
      const delta = event.data;
      if (delta.raw_stream) setAnalysisPreview(delta.raw_stream);
      else setAnalysisPreview((current) => `${current}${delta.delta}`);
      requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: 'smooth' }));
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
    if (session?.status === 'review') {
      setErrorNotice('This Session already has a completed review.');
      return;
    }
    if (!session && (!source.selectionId || !destination.selectionId)) {
      setErrorNotice('Select Source and Destination again before creating a new session.');
      return;
    }
    setErrorNotice(null);
    setAnalysisPreview('');
    setReviewMarkdown('');
    setIsProcessing(true);
    setProcessTime('00:00');
    try {
      const active = session || await createSession({
        sourceSelectionId: source.selectionId!,
        destinationSelectionId: destination.selectionId!,
        extraInstructions: [context, speakers && `Speaker hints: ${speakers}`].filter(Boolean).join('\n'),
        extractionOptions,
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

  const handleAbort = () => {
    executeAbortRef.current?.abort();
    setIsProcessing(false);
    setErrorNotice('Execution was stopped. The source media remains untouched.');
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
              setMarkdownText={setReviewMarkdown}
              onSelectSource={selectSource}
            />
          </section>
          <section className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <InsightsPanel result={review} />
          </section>
        </div>
      </section>

      <GlassModal isOpen={showGuide} onClose={() => setShowGuide(false)} title="Workspace Intelligence Guide">
        <div className="space-y-3 text-sm text-muted-canvas"><p>Choose a local recording and destination through service-owned pickers, then execute the durable session.</p><p>Raw provider output appears as Analysis Preview. Final Review is created only after the backend validates the complete schema.</p><p>Issue 2 never commits, moves, or deletes your source.</p></div>
      </GlassModal>
    </div>
  );
}
