import { useState, type FormEvent } from 'react';
import {
  Check,
  Cpu,
  FileAudio,
  FileVideo,
  FolderOpen,
  Paperclip,
  Play,
  Plus,
  Server,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import PathPickerControl from './PathPickerControl';
import { displayPath } from '../pathDisplay';
import type {
  ExtractionOptionsDto,
  AnalysisEffortDto,
  AnalysisModelDto,
  SelectedAttachment,
  SelectedSource,
  SessionStage,
  PickerBusy,
} from '../types';

interface IntakePanelProps {
  source: SelectedSource | null;
  onSelectSource: () => void;
  onSelectSourcePath: (path: string) => Promise<boolean>;
  onClearSource: () => void;
  pickerBusy: PickerBusy;
  onSelectCopySettings: () => void;
  onSelectCopySettingsPath: (path: string) => Promise<boolean>;
  context: string;
  setContext: (value: string) => void;
  onEditSystemPrompt: () => void;
  attachments: SelectedAttachment[];
  onSelectAttachments: () => void;
  speakers: string;
  setSpeakers: (value: string) => void;
  extractionOptions: ExtractionOptionsDto;
  setExtractionOptions: (value: ExtractionOptionsDto) => void;
  model: AnalysisModelDto;
  setModel: (value: AnalysisModelDto) => void;
  effort: AnalysisEffortDto;
  setEffort: (value: AnalysisEffortDto) => void;
  onExecute: () => void;
  onAbort: () => void;
  isProcessing: boolean;
  stage: SessionStage;
  progress: number;
}

const extractionTiles: Array<{ key: keyof ExtractionOptionsDto; label: string }> = [
  { key: 'action_summary', label: 'Action Items' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'topics', label: 'Topics Matrix' },
  { key: 'highlights', label: 'Highlights' },
];

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return 'size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024 || nextUnit === units.at(-1)) break;
  }
  const precision = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return 'duration unavailable';
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

function formatSourceDate(sourceDate: string | null | undefined): string {
  return sourceDate || 'date unavailable';
}

export default function IntakePanel(props: IntakePanelProps) {
  const [showAddSpeaker, setShowAddSpeaker] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [showSourcePath, setShowSourcePath] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [showCopySettingsPath, setShowCopySettingsPath] = useState(false);
  const [copySettingsPath, setCopySettingsPath] = useState('');
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

  const openSourcePathEditor = () => {
    setSourcePath(props.source?.path || '');
    setShowSourcePath(true);
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
  const canExecute = Boolean(props.source);

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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Source</h2>
            </div>

            {props.source ? (
              <div className="overflow-hidden rounded-xl border border-muted-canvas bg-input-canvas transition-all">
                <div className="px-3 py-2">
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <div className="flex-shrink-0 rounded-lg border border-muted-canvas bg-panel-canvas p-2 text-orange-500">
                      {props.source.mediaKind === 'video' ? <FileVideo size={20} /> : <FileAudio size={20} />}
                    </div>
                    <div className="overflow-hidden">
                      <div className="max-w-[280px] truncate font-mono text-sm font-bold text-main-canvas sm:max-w-md" title={props.source.name}>
                        {props.source.name}
                      </div>
                      <div className="mt-0.5 max-w-[260px] truncate font-mono text-[10px] uppercase text-muted-canvas">
                        {props.source.mediaKind} • {formatFileSize(props.source.sizeBytes)} • {formatDuration(props.source.durationSeconds)} • {formatSourceDate(props.source.sourceDate)}
                      </div>
                    </div>
                  </div>
                </div>
                {showSourcePath ? (
                  <div className="p-1">
                    <PathPickerControl
                      value={sourcePath}
                      onChange={setSourcePath}
                      onSubmit={props.onSelectSourcePath}
                      onPick={props.onSelectSource}
                      inputLabel="Source path"
                      submitLabel="Use source path"
                      pickerLabel="Select Source"
                      placeholder="/path/to/source-media.mp4"
                      autoFocus
                      showSubmit={false}
                      showCancel={false}
                      closeOnBlur
                      disabled={props.pickerBusy !== null || props.isProcessing}
                      onCancel={() => {
                        setShowSourcePath(false);
                        setSourcePath('');
                      }}
                      className="border-0 bg-transparent p-0"
                    />
                  </div>
                ) : (
                  <div className="flex w-full items-center gap-1 px-1 py-0.5">
                    <button
                      type="button"
                      aria-label="Edit source path"
                      onClick={openSourcePathEditor}
                      disabled={props.isProcessing}
                      title={props.source.path}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left font-mono text-[10px] text-muted-canvas/80 hover:bg-panel-canvas hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {displayPath(props.source.path)}
                    </button>
                    <button
                      type="button"
                      aria-label="Select Source"
                      onClick={props.onSelectSource}
                      disabled={props.pickerBusy !== null || props.isProcessing}
                      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-muted-canvas p-1 text-muted-canvas hover:text-main-canvas disabled:cursor-not-allowed disabled:opacity-50"
                      title="Choose a different source file or folder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove Source"
                      onClick={props.onClearSource}
                      disabled={props.isProcessing}
                      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-muted-canvas p-1 text-muted-canvas hover:border-rose-500/40 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Remove source"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <PathPickerControl
                value={sourcePath}
                onChange={setSourcePath}
                onSubmit={props.onSelectSourcePath}
                onPick={props.onSelectSource}
                inputLabel="Source path"
                submitLabel="Use source path"
                pickerLabel="Select Source"
                placeholder="Paste a source path to begin"
                autoFocus
                showSubmit={false}
                disabled={props.pickerBusy !== null || props.isProcessing}
                onCancel={() => {
                  setShowSourcePath(false);
                  setSourcePath('');
                }}
                className="bg-orange-500/[0.02] border-dashed border-orange-500/35 hover:border-orange-500/60"
              />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">
                Context
              </h2>
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="Copy settings"
                  onClick={() => setShowCopySettingsPath((current) => !current)}
                  disabled={props.isProcessing}
                  className="flex items-center space-x-1 text-xs text-muted-canvas font-semibold uppercase cursor-pointer disabled:opacity-60"
                  title="Copy settings from another meeting"
                >
                  <Settings2 size={12} />
                  <span>Copy settings</span>
                </button>
                <button
                  type="button"
                  aria-label="Attach reference files"
                  onClick={props.onSelectAttachments}
                  disabled={props.isProcessing}
                  className="flex items-center space-x-1 text-xs text-muted-canvas font-semibold uppercase cursor-pointer disabled:opacity-60"
                  title="Attach context files"
                >
                  <Paperclip size={12} />
                  <span>Attach</span>
                </button>
              </div>
            </div>

            {showCopySettingsPath && (
              <PathPickerControl
                value={copySettingsPath}
                onChange={setCopySettingsPath}
                onSubmit={props.onSelectCopySettingsPath}
                onPick={props.onSelectCopySettings}
                inputLabel="Copy settings path"
                submitLabel="Use copy settings path"
                pickerLabel="Select copy settings path"
                placeholder="Paste meeting or completed-session path"
                showSubmit={false}
                showCancel={false}
                closeOnBlur
                disabled={props.pickerBusy !== null || props.isProcessing}
                onCancel={() => {
                  setShowCopySettingsPath(false);
                  setCopySettingsPath('');
                }}
                className="border-dashed border-muted-canvas"
              />
            )}

            <div className="space-y-3">
              <div className="relative rounded-xl bg-input-canvas border border-muted-canvas focus-within:border-active-canvas transition-colors p-3">
                <textarea
                  aria-label="Context"
                  value={props.context}
                  onChange={(event) => props.setContext(event.target.value)}
                  placeholder="Provide guidelines, constraints, or custom distillation instructions..."
                  rows={4}
                  className="w-full bg-transparent resize-y text-sm text-main-canvas placeholder-muted-canvas/60 focus:outline-none min-h-[90px] leading-relaxed"
                />
              </div>

              {props.attachments.length > 0 && (
                <div className="text-xs font-mono text-muted-canvas flex flex-wrap items-center gap-1.5 pt-1" aria-label="Attached Context">
                  <span className="font-semibold">Attachments:</span>
                  {props.attachments.map((attachment) => <span key={attachment.path} className="inline-flex items-center space-x-1.5 bg-input-canvas border border-muted-canvas/65 px-2 py-0.5 rounded"><Paperclip size={10} /><span>{attachment.name}</span></span>)}
                </div>
              )}
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
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Extract</h2>
              <button
                type="button"
                aria-label="Edit System Prompt"
                onClick={props.onEditSystemPrompt}
                disabled={props.isProcessing}
                className="flex items-center space-x-1 text-xs text-muted-canvas font-semibold uppercase cursor-pointer disabled:opacity-60"
                title="Edit the saved system prompt"
              >
                <SlidersHorizontal size={12} />
                <span>System Prompt</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {extractionTiles.map((tile) => {
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

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3" aria-label="Analysis settings">
              <div className="relative">
                <select
                  aria-label="Engine"
                  value={props.model}
                  onChange={(event) => props.setModel(event.target.value as AnalysisModelDto)}
                  disabled={props.isProcessing}
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas pl-2.5 pr-8 py-2.5 rounded-xl appearance-none cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
                <Cpu size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas" />
              </div>

              <div className="relative">
                <select
                  aria-label="Effort"
                  value={props.effort}
                  onChange={(event) => props.setEffort(event.target.value as AnalysisEffortDto)}
                  disabled={props.isProcessing}
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas pl-2.5 pr-8 py-2.5 rounded-xl appearance-none cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {props.model === 'gemini-3-flash-preview' && <option value="minimal">Minimal</option>}
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <Server size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas" />
              </div>
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
                <span>{['review', 'completed'].includes(props.stage) ? 'Re-execute' : 'Execute'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
