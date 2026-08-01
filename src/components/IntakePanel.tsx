import { useState, type FormEvent } from 'react';
import {
  Check,
  Cpu,
  FileAudio,
  FileVideo,
  Inbox,
  LockKeyhole,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import type {
  ExtractionOptionsDto,
  SelectedDestination,
  SelectedSource,
  SessionStage,
} from '../types';

interface IntakePanelProps {
  source: SelectedSource | null;
  destination: SelectedDestination | null;
  onSelectSource: () => void;
  onClearSource: () => void;
  onSelectDestination: () => void;
  pickerBusy: 'source' | 'destination' | null;
  context: string;
  setContext: (value: string) => void;
  speakers: string;
  setSpeakers: (value: string) => void;
  extractionOptions: ExtractionOptionsDto;
  setExtractionOptions: (value: ExtractionOptionsDto) => void;
  onExecute: () => void;
  onAbort: () => void;
  isProcessing: boolean;
  stage: SessionStage;
  progress: number;
}

const extractionTiles: Array<
  | { key: keyof ExtractionOptionsDto; label: string; pending?: false }
  | { key: 'snapshots'; label: string; pending: true }
> = [
  { key: 'action_summary', label: 'Action Items' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'topics', label: 'Topics Matrix' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'snapshots', label: 'Snapshots', pending: true },
];

export default function IntakePanel(props: IntakePanelProps) {
  const [showAddSpeaker, setShowAddSpeaker] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const speakerList = props.speakers.split(',').map((name) => name.trim()).filter(Boolean);

  const toggleExtraction = (key: keyof ExtractionOptionsDto) => {
    if (key === 'action_summary') {
      props.setExtractionOptions({ ...props.extractionOptions, action_summary: true, topics: false });
      return;
    }
    if (key === 'topics') {
      props.setExtractionOptions({ ...props.extractionOptions, action_summary: false, topics: true });
      return;
    }
    props.setExtractionOptions({ ...props.extractionOptions, [key]: !props.extractionOptions[key] });
  };

  const addSpeaker = (event: FormEvent) => {
    event.preventDefault();
    const name = newSpeakerName.trim();
    if (!name) return;
    props.setSpeakers([...speakerList, name].join(', '));
    setNewSpeakerName('');
  };

  const removeSpeaker = (index: number) => {
    props.setSpeakers(speakerList.filter((_, speakerIndex) => speakerIndex !== index).join(', '));
  };

  const getInitials = (name: string) => name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const progress = props.progress > 1 ? props.progress / 100 : props.progress;
  const canExecute = Boolean(props.source && props.destination && props.stage !== 'review');

  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-4 font-sans select-none">
      <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-main-canvas font-sans sm:text-4xl">
          Speech Distiller
        </h1>
        <p className="text-sm text-muted-canvas max-w-md mx-auto leading-relaxed whitespace-nowrap">
          Consolidate and distill media sessions instantly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Source</h2>
              {props.source && (
                <span className="px-2.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400 font-mono text-[10px] uppercase tracking-wider font-bold">
                  Active
                </span>
              )}
            </div>

            {props.source ? (
              <div className="p-3.5 rounded-xl bg-input-canvas border border-muted-canvas flex items-center justify-between transition-all">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-panel-canvas border border-muted-canvas text-orange-500 flex-shrink-0">
                    {props.source.mediaKind === 'video' ? <FileVideo size={20} /> : <FileAudio size={20} />}
                  </div>
                  <div className="overflow-hidden">
                    <div className="font-mono text-sm font-bold text-main-canvas truncate max-w-[280px] sm:max-w-md" title={props.source.name}>
                      {props.source.name}
                    </div>
                    <div className="text-[10px] text-muted-canvas font-mono mt-0.5 truncate max-w-[260px] uppercase" title={props.source.path}>
                      {props.source.mediaKind} • size pending • duration pending • date pending
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  <button
                    type="button"
                    aria-label="Select Source"
                    onClick={props.onSelectSource}
                    disabled={props.pickerBusy !== null || props.isProcessing}
                    className="p-1.5 rounded-lg hover:bg-panel-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Replace source file"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove Source"
                    onClick={props.onClearSource}
                    disabled={props.isProcessing}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove source"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                aria-label="Select Source"
                onClick={props.onSelectSource}
                disabled={props.pickerBusy !== null || props.isProcessing}
                className="w-full flex flex-col items-center justify-center py-8 px-6 rounded-xl border border-dashed border-orange-500/25 hover:border-orange-500/50 bg-orange-500/[0.01] hover:bg-orange-500/[0.04] cursor-pointer transition-all text-center group space-y-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="p-3 rounded-full bg-panel-canvas border border-orange-500/20 text-orange-500 group-hover:scale-105 transition-transform shadow-xs">
                  <FileAudio size={24} />
                </div>
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-main-canvas block">
                    {props.pickerBusy === 'source' ? 'Opening source picker…' : 'Select media source feed'}
                  </span>
                  <span className="text-[10px] font-mono text-orange-500 dark:text-orange-400 font-semibold uppercase tracking-wider block">
                    Supports audio &amp; video files • Start here
                  </span>
                </div>
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">
                Context and Instructions
              </h2>
              <button
                type="button"
                aria-label="Attach reference files"
                disabled
                className="flex items-center space-x-1 text-xs text-muted-canvas font-semibold uppercase cursor-not-allowed opacity-60"
                title="Reference attachments are pending implementation"
              >
                <Paperclip size={12} />
                <span>Attach</span>
                <span className="rounded border border-muted-canvas/70 px-1 py-px font-mono text-[8px] tracking-wider">Pending</span>
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative rounded-xl bg-input-canvas border border-muted-canvas focus-within:border-active-canvas transition-colors p-3">
                <textarea
                  aria-label="Context and Instructions"
                  value={props.context}
                  onChange={(event) => props.setContext(event.target.value)}
                  placeholder="Provide guidelines, constraints, or custom distillation instructions..."
                  rows={4}
                  className="w-full bg-transparent resize-y text-sm text-main-canvas placeholder-muted-canvas/60 focus:outline-none min-h-[90px] leading-relaxed"
                />
              </div>

              <div className="text-xs font-mono text-muted-canvas flex flex-wrap items-center gap-1.5 pt-1" aria-label="Attachments pending">
                <span className="font-semibold">Attachments:</span>
                <span className="inline-flex items-center space-x-1.5 bg-input-canvas border border-muted-canvas/65 px-2 py-0.5 rounded opacity-60" aria-disabled="true">
                  <Paperclip size={10} />
                  <span>Reference files</span>
                  <LockKeyhole size={9} />
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Speakers</h2>
            <div
              onWheel={(event) => {
                event.currentTarget.scrollLeft += event.deltaY;
              }}
              className="flex flex-nowrap items-center space-x-2 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-muted-canvas/30 scrollbar-track-transparent w-full whitespace-nowrap"
            >
              {speakerList.map((name, index) => (
                <button
                  key={`${name}-${index}`}
                  type="button"
                  onClick={() => removeSpeaker(index)}
                  disabled={props.isProcessing}
                  className="flex items-center space-x-1.5 pl-1.5 pr-3 py-1 rounded-full bg-input-canvas border border-transparent text-main-canvas transition-all shrink-0 cursor-pointer hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-500 group disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Click to remove speaker"
                >
                  <span className="w-4 h-4 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-500 flex items-center justify-center font-bold text-[8px] group-hover:bg-rose-500/15 group-hover:border-rose-500/30 group-hover:text-rose-500 transition-colors">
                    {getInitials(name)}
                  </span>
                  <span className="text-xs font-medium">{name}</span>
                </button>
              ))}

              {showAddSpeaker ? (
                <form onSubmit={addSpeaker} className="flex items-center space-x-1.5 bg-input-canvas border border-orange-500/40 px-3 py-1 rounded-full shrink-0">
                  <input
                    autoFocus
                    required
                    aria-label="New Speaker"
                    placeholder="New Speaker..."
                    value={newSpeakerName}
                    onChange={(event) => setNewSpeakerName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setShowAddSpeaker(false);
                        setNewSpeakerName('');
                      }
                    }}
                    className="bg-transparent text-xs text-main-canvas focus:outline-none w-24"
                  />
                  <button type="submit" aria-label="Add Speaker" className="p-1 bg-orange-500 text-white rounded-full hover:bg-orange-600 cursor-pointer">
                    <Check size={10} className="stroke-[3]" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel adding speaker"
                    onClick={() => {
                      setShowAddSpeaker(false);
                      setNewSpeakerName('');
                    }}
                    className="p-1 rounded-full border border-muted-canvas text-muted-canvas hover:text-rose-500 cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddSpeaker(true)}
                  disabled={props.isProcessing}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full border border-dashed border-orange-500/30 text-xs text-orange-500 bg-orange-500/[0.01] hover:border-orange-500/60 hover:bg-orange-500/[0.04] transition-all cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={11} className="stroke-[2.5]" />
                  <span>Add Speaker</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Extract</h2>
            <div className="grid grid-cols-2 gap-2">
              {extractionTiles.map((tile) => {
                if (tile.key === 'snapshots') {
                  return (
                    <button
                      type="button"
                      key={tile.key}
                      aria-label={tile.label}
                      disabled
                      className="flex items-center space-x-3 px-3 py-2.5 rounded-xl border border-transparent text-left bg-input-canvas/30 text-muted-canvas/60 cursor-not-allowed"
                      title="Snapshot extraction is pending implementation"
                    >
                      <span className="w-4 h-4 rounded border border-muted-canvas/60 flex items-center justify-center flex-shrink-0">
                        <LockKeyhole size={9} />
                      </span>
                      <span className="text-xs tracking-tight truncate">{tile.label}</span>
                      <span className="ml-auto font-mono text-[8px] uppercase tracking-wider">Pending</span>
                    </button>
                  );
                }

                const selected = props.extractionOptions[tile.key];
                return (
                  <button
                    type="button"
                    key={tile.key}
                    aria-pressed={selected}
                    onClick={() => toggleExtraction(tile.key)}
                    disabled={props.isProcessing}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl border border-transparent text-left cursor-pointer transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-orange-500/10 text-main-canvas font-semibold shadow-xs'
                        : 'bg-input-canvas/50 text-muted-canvas hover:bg-input-canvas/80'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors duration-200 flex-shrink-0 ${
                      selected
                        ? 'bg-orange-500/15 border-orange-500/30 text-orange-500'
                        : 'border-muted-canvas text-transparent'
                    }`}>
                      {selected && <Check size={11} className="stroke-[3]" />}
                    </span>
                    <span className="text-xs tracking-tight truncate">{tile.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">
              Deliverable Target
            </h2>
            <button
              type="button"
              aria-label="Select Destination"
              onClick={props.onSelectDestination}
              disabled={props.pickerBusy !== null || props.isProcessing}
              className="w-full flex items-center bg-input-canvas border border-muted-canvas rounded-xl px-3 py-2.5 hover:border-active-canvas transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Inbox size={15} className="text-muted-canvas mr-2 flex-shrink-0" />
              <span
                className={`w-full text-xs font-mono truncate ${props.destination ? 'text-main-canvas' : 'text-muted-canvas'}`}
                title={props.destination?.path}
              >
                {props.pickerBusy === 'destination'
                  ? 'Opening destination picker…'
                  : props.destination?.path || 'Select destination folder'}
              </span>
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3" aria-label="Locked provider settings">
              <div className="relative">
                <select
                  aria-label="Engine"
                  defaultValue="gemini-3-flash"
                  disabled
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas pl-2.5 pr-8 py-2.5 rounded-xl appearance-none cursor-not-allowed disabled:opacity-70"
                  title="Engine selection is locked for this milestone"
                >
                  <option value="gemini-3-flash">Gemini 3 Flash</option>
                </select>
                <Cpu size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas" />
              </div>

              <div className="relative">
                <select
                  aria-label="Effort"
                  defaultValue="medium"
                  disabled
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas pl-2.5 pr-8 py-2.5 rounded-xl appearance-none cursor-not-allowed disabled:opacity-70"
                  title="Effort selection is locked for this milestone"
                >
                  <option value="medium">Medium</option>
                </select>
                <Server size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas" />
              </div>
            </div>

            <div className="flex items-center justify-center space-x-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-canvas">
              <LockKeyhole size={10} />
              <span>Provider controls locked for this milestone</span>
            </div>

            <div aria-live="polite" className="rounded-xl bg-input-canvas/50 border border-muted-canvas px-3 py-2.5">
              <div className="flex justify-between text-[10px] font-mono uppercase tracking-wider text-muted-canvas">
                <span>Stage: {props.stage.replaceAll('_', ' ')}</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="mt-2 h-1 bg-panel-canvas rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all"
                  style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
                />
              </div>
            </div>

            {props.isProcessing ? (
              <button
                type="button"
                disabled
                title="Durable cancellation is pending implementation"
                className="w-full py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-500 dark:text-rose-400 font-bold text-xs tracking-wider uppercase transition-all cursor-not-allowed opacity-60 shadow-xs flex items-center justify-center space-x-1.5"
              >
                <X size={14} />
                <span>Abort · Pending</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onExecute}
                disabled={!canExecute}
                className={`w-full py-3.5 rounded-xl font-bold text-xs tracking-widest uppercase transition-all duration-200 shadow-xs flex items-center justify-center space-x-2 ${
                  canExecute
                    ? 'accent-button hover:scale-[1.01] active:scale-99 cursor-pointer'
                    : 'bg-orange-500/20 border border-orange-500/15 text-orange-500/50 cursor-not-allowed'
                }`}
              >
                <Play size={13} fill="currentColor" />
                <span>{props.stage === 'review' ? 'Reviewed' : 'Execute'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
