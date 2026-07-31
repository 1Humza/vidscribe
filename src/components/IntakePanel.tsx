import { Check, FileAudio, FileVideo, FolderOpen, Play, X } from 'lucide-react';
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

export default function IntakePanel(props: IntakePanelProps) {
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
  const canExecute = Boolean(props.source && props.destination);
  const status = props.stage.replaceAll('_', ' ');
  const progress = props.progress > 1 ? props.progress / 100 : props.progress;
  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-4 font-sans select-none">
      <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-main-canvas sm:text-4xl">Speech Distiller</h1>
        <p className="text-sm text-muted-canvas">Distill a real local recording into a durable review.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Source Media</h2>{props.source && <span className="text-[10px] font-mono text-orange-500">SELECTED</span>}</div>
            {props.source && (
              <div className="p-3.5 rounded-xl bg-input-canvas border border-muted-canvas flex items-center gap-3">
                {props.source.mediaKind === 'video' ? <FileVideo className="text-orange-500" /> : <FileAudio className="text-orange-500" />}
                <div className="min-w-0"><div className="font-mono text-sm font-bold truncate">{props.source.name}</div><div className="font-mono text-[11px] text-muted-canvas break-all">{props.source.path}</div></div>
              </div>
            )}
            <button type="button" onClick={props.onSelectSource} disabled={props.pickerBusy !== null || props.isProcessing} className="w-full px-4 py-3 rounded-xl border border-dashed border-orange-500/35 bg-orange-500/[0.03] text-orange-500 font-bold text-xs uppercase tracking-wider disabled:opacity-50">
              {props.pickerBusy === 'source' ? 'Opening Source Picker…' : 'Select Source'}
            </button>
          </div>

          <label className="block space-y-2">
            <span className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Context and Instructions</span>
            <textarea aria-label="Context and Instructions" value={props.context} onChange={(event) => props.setContext(event.target.value)} rows={4} placeholder="Goals, constraints, and analysis guidance…" className="w-full rounded-xl bg-input-canvas border border-muted-canvas p-3 text-sm text-main-canvas focus:outline-none focus:border-active-canvas resize-y" />
          </label>

          <label className="block space-y-2">
            <span className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Speaker Hints</span>
            <input aria-label="Speaker Hints" value={props.speakers} onChange={(event) => props.setSpeakers(event.target.value)} placeholder="Alex, Sam" className="w-full rounded-xl bg-input-canvas border border-muted-canvas p-3 text-sm text-main-canvas focus:outline-none focus:border-active-canvas" />
          </label>
        </div>

        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Extract</h2>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries({ action_summary: 'Action Summary', topics: 'Topics Matrix', chapters: 'Chapters', highlights: 'Highlights' }).map(([rawKey, label]) => {
                const key = rawKey as keyof ExtractionOptionsDto;
                return <button type="button" key={key} aria-pressed={props.extractionOptions[key]} onClick={() => toggleExtraction(key)} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs ${props.extractionOptions[key] ? 'bg-orange-500/10 text-main-canvas font-semibold' : 'bg-input-canvas/50 text-muted-canvas'}`}><span className="w-4 h-4 rounded border border-orange-500/30 flex items-center justify-center">{props.extractionOptions[key] && <Check size={11} />}</span>{label}</button>;
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider">Destination</h2>
            {props.destination && <div className="p-3 rounded-xl bg-input-canvas border border-muted-canvas font-mono text-xs break-all flex gap-2"><FolderOpen size={15} className="text-orange-500 shrink-0" />{props.destination.path}</div>}
            <button type="button" onClick={props.onSelectDestination} disabled={props.pickerBusy !== null || props.isProcessing} className="w-full px-4 py-3 rounded-xl border border-dashed border-orange-500/35 bg-orange-500/[0.03] text-orange-500 font-bold text-xs uppercase tracking-wider disabled:opacity-50">
              {props.pickerBusy === 'destination' ? 'Opening Destination Picker…' : 'Select Destination'}
            </button>
          </div>

          <div aria-live="polite" className="rounded-xl bg-input-canvas border border-muted-canvas p-3">
            <div className="flex justify-between text-xs font-mono uppercase"><span>Stage: <strong>{status}</strong></span><span>{Math.round(progress * 100)}%</span></div>
            <div className="mt-2 h-1.5 bg-panel-canvas rounded overflow-hidden"><div className="h-full bg-orange-500 transition-all" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /></div>
          </div>

          {props.isProcessing ? (
            <button type="button" onClick={props.onAbort} className="w-full py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-500 font-bold text-xs uppercase flex items-center justify-center gap-2"><X size={14} />Stop</button>
          ) : (
            <button type="button" onClick={props.onExecute} disabled={!canExecute} className="w-full py-3.5 rounded-xl accent-button font-bold text-xs tracking-widest uppercase disabled:opacity-40 flex items-center justify-center gap-2"><Play size={13} fill="currentColor" />Execute</button>
          )}
        </div>
      </div>
    </div>
  );
}
