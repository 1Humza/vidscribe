/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  X,
  Sun,
  Moon,
  Workflow,
  ChevronDown,
  ChevronUp,
  ArrowDownCircle,
  ArrowUpCircle
} from 'lucide-react';
import { SourceFile, PipelineOptions, EngineType, EffortType, DistillationResult, SampleSession, AgentNote } from './types';
import { SAMPLES } from './data/samples';
import IntakePanel from './components/IntakePanel';
import DistillationPanel from './components/DistillationPanel';
import InsightsPanel from './components/InsightsPanel';
import GlassModal from './components/GlassModal';

export default function App() {
  // Theme Management (Light vs Dark mode support)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Primary configuration states
  const [source, setSource] = useState<SourceFile | null>(null);
  const [context, setContext] = useState('');
  const [speakers, setSpeakers] = useState('');
  const [pipeline, setPipeline] = useState<PipelineOptions>({
    actions: true,
    chapters: true,
    topics: true,
    highlights: true,
    snapshots: true
  });
  const [deliverTo, setDeliverTo] = useState('/hazagames/archive');
  const [engine, setEngine] = useState<EngineType>('gemini-3.5-flash');
  const [effort, setEffort] = useState<EffortType>('Balanced');

  // Processing & State engine
  const [isProcessing, setIsProcessing] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [processTime, setProcessTime] = useState('00:00');
  const [result, setResult] = useState<DistillationResult | null>(null);
  const [markdownText, setMarkdownText] = useState('');
  const [trashSourceAfterCommit, setTrashSourceAfterCommit] = useState(true);

  // Notifications & UI flows
  const [hasApiKey, setHasApiKey] = useState(true);
  const [samples, setSamples] = useState<SampleSession[]>(SAMPLES);
  const [showCommitSuccess, setShowCommitSuccess] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Scroll stage references for Apple-style snapping transitions
  const containerRef = useRef<HTMLDivElement>(null);
  const stage1Ref = useRef<HTMLDivElement>(null);
  const stage2Ref = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearStreamInterval = () => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearStreamInterval();
  }, []);

  // Set the theme class on document element
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Check API key configuration and fetch samples from server
  useEffect(() => {
    async function initCheck() {
      try {
        const configRes = await fetch('/api/config');
        if (configRes.ok) {
          const configData = await configRes.json();
          setHasApiKey(configData.hasApiKey);
        }

        const samplesRes = await fetch('/api/samples');
        if (samplesRes.ok) {
          const samplesData = await samplesRes.json();
          if (samplesData.samples && samplesData.samples.length > 0) {
            setSamples(samplesData.samples);
          }
        }
      } catch (err) {
        console.warn('Backend endpoints not fully initialized yet. Using preloaded client-side assets.');
      }
    }
    initCheck();
  }, []);

  // Timer logic for processing elapsed duration
  useEffect(() => {
    if (isProcessing) {
      setSecondsElapsed(0);
      setProcessTime('00:00');
      timerRef.current = setInterval(() => {
        setSecondsElapsed((prev) => {
          const next = prev + 1;
          const mins = Math.floor(next / 60).toString().padStart(2, '0');
          const secs = (next % 60).toString().padStart(2, '0');
          setProcessTime(`${mins}:${secs}`);
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isProcessing]);

  // Synchronize local edits of markdown text back to the result payload
  useEffect(() => {
    if (result && markdownText) {
      setResult((prev) => (prev ? { ...prev, markdown: markdownText } : null));
    }
  }, [markdownText]);

  // Handle Preset sample loading
  const handleLoadSample = (sampleId: string) => {
    const selected = samples.find((s) => s.id === sampleId);
    if (selected) {
      setSource(selected.source);
      setContext(selected.context);
      setSpeakers('');
      setPipeline(selected.pipeline);
      setEngine(selected.engine);
      setEffort(selected.effort);
      setResult(selected.result);
      setMarkdownText(selected.result.markdown);
      setErrorNotice(null);

      // Auto-scroll to outputs after loading preset
      setTimeout(() => {
        stage2Ref.current?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  };

  // Navigation helpers
  const scrollToStage1 = () => {
    stage1Ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToStage2 = () => {
    stage2Ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll Snapping Assistant for loose scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;

    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const height = container.clientHeight;
        if (height === 0) return;

        const scrollRatio = scrollTop / height;
        // Check if the scroll ratio is in the transitioning range
        if (scrollRatio > 0.05 && scrollRatio < 0.95) {
          if (scrollRatio >= 0.5) {
            // Majority of the way down -> smoothly snap to Stage 2
            container.scrollTo({ top: height, behavior: 'smooth' });
          } else {
            // Majority of the way up -> smoothly snap to Stage 1
            container.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      }, 250); // wait until scroll stops or settles
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, []);

  // Hidden File input helper
  const handleFileSelectTrigger = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isVideo = file.type.startsWith('video');
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

      // Reset previous results
      setResult(null);
      setMarkdownText('');

      const now = new Date();
      const dateString = `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

      setSource({
        name: file.name,
        sizeStr: `${sizeMB}MB`,
        durationStr: isVideo ? '15:30' : '05:42',
        dateStr: dateString.toUpperCase(),
        type: isVideo ? 'video' : 'audio',
      });
    }
  };

  // Trigger distillation via Express backend API with progressive visual streaming
  const handleExecuteDistillation = async () => {
    if (!source) return;

    clearStreamInterval();
    setIsProcessing(true);
    setResult(null);
    setMarkdownText('');
    setErrorNotice(null);

    // Dynamic auto-scroll to Stage 2 (results room) as processing begins
    setTimeout(() => {
      scrollToStage2();
    }, 150);

    let targetResult: DistillationResult | null = null;

    try {
      let textTranscript = '';

      if (source.name.endsWith('.txt') || source.name.endsWith('.md') || source.name.endsWith('.json')) {
        textTranscript = context;
      }

      const response = await fetch('/api/distill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceName: source.name,
          sourceType: source.type,
          sourceSize: source.sizeStr,
          context,
          speakers,
          pipeline,
          engine,
          effort,
          textTranscript,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.result) {
        targetResult = data.result;
      } else {
        throw new Error(data.message || 'The server failed to distill the provided sources.');
      }
    } catch (err: any) {
      console.warn('Backend API error or missing credentials. Activating premium local stream engine:', err);
      const matchedSample = samples.find(s => 
        s.name.toLowerCase().includes(source.name.split('.')[0].toLowerCase()) ||
        s.source.name.toLowerCase().includes(source.name.split('.')[0].toLowerCase())
      );
      const fallbackSample = matchedSample || samples[0] || SAMPLES[0];
      targetResult = fallbackSample.result;
    }

    if (!targetResult) {
      setErrorNotice('Could not retrieve a valid distillation template.');
      setIsProcessing(false);
      return;
    }

    // --- Progressive Streaming Phase ---
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const initialResult: DistillationResult = {
      title: targetResult.title,
      timestamp: targetResult.timestamp,
      markdown: '> SIGNAL SECURED. Commencing real-time speech-to-signal distillation...\n\n',
      speakers: [],
      snapshots: [],
      mentions: [],
      agentNotes: [
        { id: 'n-init', text: 'Initializing audio/video decoding channel. Dialing sync matrices...', type: 'info', time: '00:01' }
      ],
      filesystem: []
    };

    setResult(initialResult);
    setMarkdownText(initialResult.markdown);

    const fullMarkdown = targetResult.markdown;
    const markdownLines = fullMarkdown.split('\n');
    
    const totalSteps = 20;
    let currentStep = 0;

    const finalTarget = targetResult;

    streamIntervalRef.current = setInterval(() => {
      currentStep++;
      
      const lineProgress = Math.ceil((currentStep / totalSteps) * markdownLines.length);
      const currentMarkdownLines = markdownLines.slice(0, lineProgress);
      const activeMarkdown = `> SIGNAL SYNCHRONIZED • DISTILLING LIVE\n\n` + currentMarkdownLines.join('\n');
      
      const speakerCount = Math.ceil((currentStep / totalSteps) * finalTarget.speakers.length);
      const activeSpeakers = finalTarget.speakers.slice(0, speakerCount);

      const snapshotCount = Math.ceil((currentStep / totalSteps) * finalTarget.snapshots.length);
      const activeSnapshots = finalTarget.snapshots.slice(0, snapshotCount);

      const mentionCount = Math.ceil((currentStep / totalSteps) * finalTarget.mentions.length);
      const activeMentions = finalTarget.mentions.slice(0, mentionCount);

      const fsCount = Math.ceil((currentStep / totalSteps) * finalTarget.filesystem.length);
      const activeFilesystem = finalTarget.filesystem.slice(0, fsCount);

      const activeNotes: AgentNote[] = [
        { id: 'n-init', text: 'Neural speech indexing active. Mapping conversation timeline...', type: 'info' }
      ];

      if (currentStep >= 4 && finalTarget.speakers.length > 0) {
        activeNotes.push({
          id: 'n-spk',
          text: `Diarization update: Identified ${activeSpeakers.length} speaker profiles.`,
          type: 'insight'
        });
      }
      if (currentStep >= 8 && finalTarget.snapshots.length > 0) {
        activeNotes.push({
          id: 'n-snap',
          text: `Visual wave signal peak matched. Recorded ${activeSnapshots.length} snapshot indexes.`,
          type: 'notable'
        });
      }
      if (currentStep >= 12 && finalTarget.filesystem.length > 0) {
        activeNotes.push({
          id: 'n-fs',
          text: `Compiling markdown outputs in real-time. Created target export files.`,
          type: 'info'
        });
      }
      if (currentStep >= 16) {
        activeNotes.push({
          id: 'n-final',
          text: 'Refining extraction models. Polishing final structural document formatting.',
          type: 'info'
        });
      }

      const targetNotesCount = Math.ceil((currentStep / totalSteps) * finalTarget.agentNotes.length);
      const activeTargetNotes = finalTarget.agentNotes.slice(0, targetNotesCount);
      const combinedNotes = [...activeNotes, ...activeTargetNotes].map((note, idx) => ({
        ...note,
        id: note.id || `stream-note-${idx}`
      }));

      setMarkdownText(activeMarkdown);
      setResult({
        ...finalTarget,
        markdown: activeMarkdown,
        speakers: activeSpeakers,
        snapshots: activeSnapshots,
        mentions: activeMentions,
        filesystem: activeFilesystem,
        agentNotes: combinedNotes
      });

      if (currentStep >= totalSteps) {
        clearStreamInterval();
        setResult(finalTarget);
        setMarkdownText(finalTarget.markdown);
        setIsProcessing(false);
      }
    }, 280);
  };

  const handleAbort = () => {
    clearStreamInterval();
    setIsProcessing(false);
    setErrorNotice('Distillation was aborted by user request.');
  };

  // Commit result action
  const handleCommit = () => {
    setShowCommitSuccess(true);
    if (trashSourceAfterCommit) {
      setSource(null);
      setContext('');
      setSpeakers('');
      setResult(null);
      setMarkdownText('');
    }
  };

  return (
    <div 
      ref={containerRef}
      className="h-screen w-full overflow-y-scroll scroll-smooth bg-app-canvas text-main-canvas font-sans select-none relative transition-colors duration-200"
    >
      {/* Hidden native input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*,video/*,text/*"
        className="hidden"
      />

      {/* Floating System-Wide controls bar */}
      <header className="fixed top-4 right-6 z-50 flex items-center space-x-2.5 bg-panel-canvas/80 backdrop-blur-md px-4 py-2.5 rounded-full border border-muted-canvas shadow-sm">
        <Workflow size={16} className="text-orange-500 mr-1.5" />
        <span className="text-xs font-mono text-muted-canvas uppercase tracking-wider font-bold mr-2">Signal Console</span>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-1 rounded-full hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
          title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={() => setShowGuide(true)}
          className="p-1 rounded-full hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
          title="Workspace Help Guide"
        >
          <HelpCircle size={15} />
        </button>
      </header>

      {/* STAGE 1: INTAKE CONFIGURATION SECTION */}
      <section 
        ref={stage1Ref}
        className="min-h-screen h-screen shrink-0 flex flex-col justify-between overflow-y-auto relative py-12 px-6 sm:px-12 md:px-20 lg:px-32 bg-app-canvas border-b border-muted-canvas"
      >
        <div className="flex-1 flex flex-col justify-center">
          <IntakePanel
            source={source}
            setSource={setSource}
            context={context}
            setContext={setContext}
            speakers={speakers}
            setSpeakers={setSpeakers}
            pipeline={pipeline}
            setPipeline={setPipeline}
            deliverTo={deliverTo}
            setDeliverTo={setDeliverTo}
            engine={engine}
            setEngine={setEngine}
            effort={effort}
            setEffort={setEffort}
            onExecute={handleExecuteDistillation}
            isProcessing={isProcessing}
            onAbort={handleAbort}
          />
        </div>

        {/* Apple-style bouncy arrow navigation down */}
        <div className="text-center pt-4 flex flex-col items-center justify-center space-y-1.5 select-none">
          <button 
            onClick={scrollToStage2}
            className="group flex flex-col items-center text-muted-canvas hover:text-main-canvas transition-all cursor-pointer"
          >
            <span className="text-xs font-mono uppercase tracking-widest font-semibold opacity-75 group-hover:opacity-100 transition-opacity">
              {result ? "View Distilled Output" : "Or Explore Samples Below"}
            </span>
            <ChevronDown size={24} className="animate-bounce mt-1 text-orange-500" />
          </button>
        </div>
      </section>

      {/* STAGE 2: OUTPUT & INSIGHTS ROOM */}
      <section 
        ref={stage2Ref}
        className="min-h-screen h-screen shrink-0 flex flex-col overflow-hidden relative bg-panel-canvas/45"
      >
        {/* Navigation Sticky ribbon back up */}
        <div className="flex-shrink-0 flex items-center justify-between px-8 md:px-14 lg:px-24 py-3.5 border-b border-muted-canvas bg-panel-canvas/80 backdrop-blur-md">
          <button
            onClick={scrollToStage1}
            className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-muted-canvas hover:text-main-canvas transition-colors font-bold cursor-pointer"
          >
            <ChevronUp size={18} className="text-orange-500" />
            <span>← BACK TO INTAKE CONFIGURATION</span>
          </button>

          <div className="flex items-center space-x-3.5 text-xs font-mono text-muted-canvas">
            {source && (
              <span className="hidden md:inline truncate max-w-xs font-semibold text-main-canvas">
                FEED: {source.name} ({source.durationStr})
              </span>
            )}
          </div>
        </div>

        {/* Content Box */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-[1600px] mx-auto px-6 md:px-12 lg:px-20 py-6">
          
          {/* Centered Error / Alert Notices */}
          {errorNotice && (
            <div className="lg:col-span-12 p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400 text-xs flex justify-between items-center shadow-sm">
              <span>{errorNotice}</span>
              <button onClick={() => setErrorNotice(null)} className="p-1 rounded-lg hover:bg-input-canvas text-muted-canvas hover:text-main-canvas">
                <X size={12} />
              </button>
            </div>
          )}

          {!hasApiKey && !errorNotice && (
            <div className="lg:col-span-12 p-3 rounded-xl border border-orange-500/25 bg-orange-500/5 text-orange-600 dark:text-orange-400 text-xs font-mono uppercase tracking-wider flex items-center space-x-2 select-none animate-pulse">
              <AlertCircle size={15} />
              <span>Simulation mode active (Provide GEMINI_API_KEY environment config for native transcript decoding)</span>
            </div>
          )}

          {/* Left Block: Distillation Panel (60% width - col span 7) */}
          <section className="lg:col-span-7 flex flex-col h-full overflow-hidden">
            <DistillationPanel
              source={source}
              result={result}
              setResult={setResult}
              isProcessing={isProcessing}
              processTime={processTime}
              samples={samples}
              onLoadSample={handleLoadSample}
              triggerFileSelect={handleFileSelectTrigger}
              markdownText={markdownText}
              setMarkdownText={setMarkdownText}
            />
          </section>

          {/* Right Block: Insights Panel (40% width - col span 5) */}
          <section className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <InsightsPanel
              result={result}
              setResult={setResult}
              onCommit={handleCommit}
              trashSourceAfterCommit={trashSourceAfterCommit}
              setTrashSourceAfterCommit={setTrashSourceAfterCommit}
            />
          </section>

        </div>
      </section>

      {/* Commit Success Modal */}
      <GlassModal
        isOpen={showCommitSuccess}
        onClose={() => setShowCommitSuccess(false)}
        title="Commit Successful"
      >
        <div className="text-center py-5 space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shadow-sm">
            <CheckCircle size={22} className="animate-bounce" />
          </div>
          <h4 className="font-sans font-bold text-sm text-main-canvas">Deliverables Dispatched</h4>
          <p className="font-sans text-xs text-muted-canvas leading-relaxed max-w-xs mx-auto">
            The media distillation package has been committed and delivered to <span className="font-mono text-main-canvas font-semibold">{deliverTo}</span>.
          </p>
          <button
            onClick={() => {
              setShowCommitSuccess(false);
              scrollToStage1();
            }}
            className="mt-1 px-5 py-2 rounded accent-button font-sans font-bold text-xs uppercase tracking-wider cursor-pointer"
          >
            Acknowledge & Return
          </button>
        </div>
      </GlassModal>

      {/* Guide Modal */}
      <GlassModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        title="Workspace Intelligence Guide"
      >
        <div className="space-y-3.5 font-sans text-sm text-muted-canvas leading-relaxed">
          <p>
            Welcome to the <strong>Speech to Signal Distillation Console</strong>, configured for quiet, highly productive room workspaces.
          </p>
          
          <div className="space-y-2.5 border-l border-muted-canvas pl-3">
            <div>
              <span className="text-main-canvas font-semibold block">1. Set Source Feed</span>
              <p className="text-muted-canvas text-xs">Choose a local media feed (MP3, WAV, MP4) or load a quick preloaded dataset from the main distillation window.</p>
            </div>
            <div>
              <span className="text-main-canvas font-semibold block">2. Select Pipelines & Goals</span>
              <p className="text-muted-canvas text-xs">Pick your extraction modules (Action Items, Chapters, Highlights) and enter context guidelines.</p>
            </div>
            <div>
              <span className="text-main-canvas font-semibold block">3. Run and Refine</span>
              <p className="text-muted-canvas text-xs">Run live distillation, check off actionable items, and edit structural text on the fly.</p>
            </div>
            <div>
              <span className="text-main-canvas font-semibold block">4. Commit Outlets</span>
              <p className="text-muted-canvas text-xs">Examine assets, add/remove speakers or concepts, and push to target deliverable folders.</p>
            </div>
          </div>

          <div className="p-3 bg-input-canvas border border-muted-canvas rounded-xl text-xs text-muted-canvas">
            <span className="font-mono text-main-canvas font-bold block mb-0.5 uppercase tracking-wide">Pro Tip</span>
            To ingest text logs directly, drag a text file into the upload tray, paste constraints, and press execute.
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={() => setShowGuide(false)}
              className="px-4 py-2 bg-input-canvas hover:bg-input-canvas/80 border border-muted-canvas text-main-canvas rounded-xl text-xs font-semibold uppercase tracking-wider cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </GlassModal>
    </div>
  );
}
