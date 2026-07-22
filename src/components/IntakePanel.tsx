/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  FileVideo,
  FileAudio,
  Paperclip,
  Check,
  RefreshCw,
  FolderOpen,
  CheckSquare,
  Bookmark,
  Sparkles,
  Camera,
  Server,
  Cpu,
  Inbox,
  X,
  Play,
  Settings,
  HelpCircle,
  Plus
} from 'lucide-react';
import { SourceFile, PipelineOptions, EngineType, EffortType } from '../types';

interface IntakePanelProps {
  source: SourceFile | null;
  setSource: (file: SourceFile | null) => void;
  context: string;
  setContext: (text: string) => void;
  speakers: string;
  setSpeakers: (text: string) => void;
  pipeline: PipelineOptions;
  setPipeline: (options: PipelineOptions) => void;
  deliverTo: string;
  setDeliverTo: (text: string) => void;
  engine: EngineType;
  setEngine: (engine: EngineType) => void;
  effort: EffortType;
  setEffort: (effort: EffortType) => void;
  onExecute: () => void;
  isProcessing: boolean;
  onAbort: () => void;
}

export default function IntakePanel({
  source,
  setSource,
  context,
  setContext,
  speakers,
  setSpeakers,
  pipeline,
  setPipeline,
  deliverTo,
  setDeliverTo,
  engine,
  setEngine,
  effort,
  setEffort,
  onExecute,
  isProcessing,
  onAbort
}: IntakePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<{ name: string; size: string }[]>([]);

  const [showAddSpeaker, setShowAddSpeaker] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');

  const speakerList = speakers ? speakers.split(',').map(s => s.trim()).filter(Boolean) : [];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  };

  const handleAddSpeakerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSpeakerName.trim()) {
      const updated = [...speakerList, newSpeakerName.trim()].join(', ');
      setSpeakers(updated);
      setNewSpeakerName('');
      // Keep showAddSpeaker true to allow continuous entry
    }
  };

  const handleRemoveSpeaker = (indexToRemove: number) => {
    const updated = speakerList.filter((_, idx) => idx !== indexToRemove).join(', ');
    setSpeakers(updated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isVideo = file.type.startsWith('video');
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const now = new Date();
      const dateString = `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      setSource({
        name: file.name,
        sizeStr: `${sizeMB}MB`,
        durationStr: isVideo ? '15:30' : '05:42',
        dateStr: dateString.toUpperCase(),
        type: isVideo ? 'video' : 'audio'
      });
    }
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const sizeKB = (file.size / 1024).toFixed(0);
      setAttachments([...attachments, { name: file.name, size: `${sizeKB}KB` }]);
    }
  };

  const togglePipeline = (key: keyof PipelineOptions) => {
    setPipeline({
      ...pipeline,
      [key]: !pipeline[key]
    });
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const triggerAttachmentSelect = () => {
    attachmentInputRef.current?.click();
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-4 font-sans select-none">
      {/* Hidden Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*,video/*"
        className="hidden"
      />
      <input
        type="file"
        ref={attachmentInputRef}
        onChange={handleAttachmentChange}
        accept=".txt,.md,.pdf,.json"
        className="hidden"
      />

      {/* Simplified Header */}
      <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-main-canvas font-sans sm:text-4xl">
          Speech Distiller
        </h1>
        <p className="text-sm text-muted-canvas max-w-md mx-auto leading-relaxed truncate-none whitespace-nowrap">
          Consolidate and distill media sessions instantly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        
        {/* Container 1: Ingestion & Instructions */}
        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          
          {/* Section: Source */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider font-sans">
                Source
              </h3>
              {source && (
                <span className="px-2.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400 font-mono text-[10px] uppercase tracking-wider font-bold">
                  ACTIVE
                </span>
              )}
            </div>

            {source ? (
              <div className="p-3.5 rounded-xl bg-input-canvas border border-muted-canvas flex items-center justify-between transition-all">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-panel-canvas border border-muted-canvas text-orange-500 flex-shrink-0">
                    {source.type === 'video' ? <FileVideo size={20} /> : <FileAudio size={20} />}
                  </div>
                  <div className="overflow-hidden">
                    <div className="font-mono text-sm font-bold text-main-canvas truncate max-w-[280px] sm:max-w-md" title={source.name}>
                      {source.name}
                    </div>
                    <div className="text-xs text-muted-canvas font-mono mt-0.5">
                      {source.dateStr} • {source.sizeStr} • {source.durationStr}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={triggerFileSelect}
                    className="p-1.5 rounded-lg hover:bg-panel-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
                    title="Replace source file"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource(null)}
                    className="p-1.5 rounded-lg hover:bg-panel-canvas text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Remove source"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={triggerFileSelect}
                className="flex flex-col items-center justify-center py-8 px-6 rounded-xl border border-dashed border-orange-500/25 hover:border-orange-500/50 bg-orange-500/[0.01] hover:bg-orange-500/[0.04] cursor-pointer transition-all text-center group space-y-2.5"
              >
                <div className="p-3 rounded-full bg-panel-canvas border border-orange-500/20 text-orange-500 group-hover:scale-105 transition-transform shadow-xs">
                  <FileAudio size={24} />
                </div>
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-main-canvas block">
                    Select media source feed
                  </span>
                  <span className="text-[10px] font-mono text-orange-500 dark:text-orange-400 font-semibold uppercase tracking-wider block">
                    Supports Audio & Video files • Start Here
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section: Context and Instructions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider font-sans">
                Context and Instructions
              </h3>
              
              <button
                type="button"
                onClick={triggerAttachmentSelect}
                className="flex items-center space-x-1 text-xs text-orange-500 font-semibold uppercase hover:underline cursor-pointer"
              >
                <Paperclip size={12} />
                <span>Attach</span>
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative rounded-xl bg-input-canvas border border-muted-canvas focus-within:border-active-canvas transition-colors p-3">
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Provide guidelines, constraints, or custom distillation instructions..."
                  rows={4}
                  className="w-full bg-transparent resize-y text-sm text-main-canvas placeholder-muted-canvas/60 font-sans focus:outline-none min-h-[90px] leading-relaxed"
                />
              </div>

              {/* Attachments - Inline display */}
              {attachments.length > 0 && (
                <div className="text-xs font-mono text-muted-canvas flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="font-semibold">Attachments:</span>
                  {attachments.map((file, i) => (
                    <span key={i} className="inline-flex items-center space-x-1 bg-input-canvas border border-muted-canvas/65 px-2 py-0.5 rounded text-main-canvas">
                      <span className="truncate max-w-[140px]" title={file.name}>{file.name}</span>
                      <button 
                        type="button" 
                        onClick={() => removeAttachment(i)} 
                        className="text-muted-canvas hover:text-rose-500 cursor-pointer flex items-center justify-center"
                      >
                        <X size={10} />
                      </button>
                      {i < attachments.length - 1 && <span className="text-muted-canvas/40">,</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section: Speakers */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider font-sans">
              Speakers
            </h3>
            
            <div 
              onWheel={(e) => {
                const container = e.currentTarget;
                container.scrollLeft += e.deltaY;
              }}
              className="flex flex-nowrap items-center space-x-2 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-muted-canvas/30 scrollbar-track-transparent w-full whitespace-nowrap"
            >
              {/* Speaker List of Chips */}
              {speakerList.map((name, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleRemoveSpeaker(idx)}
                  className="flex items-center space-x-1.5 pl-1.5 pr-3 py-1 rounded-full bg-input-canvas border border-transparent text-main-canvas transition-all shrink-0 cursor-pointer hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-500 group"
                  title="Click to remove speaker"
                >
                  <div className="w-4 h-4 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-500 flex items-center justify-center font-sans font-bold text-[8px] shrink-0 group-hover:bg-rose-500/15 group-hover:border-rose-500/30 group-hover:text-rose-500 transition-colors">
                    {getInitials(name)}
                  </div>
                  <span className="text-xs font-medium transition-colors">{name}</span>
                </button>
              ))}

              {/* Add Speaker form or dotted button (rendered at the end) */}
              {showAddSpeaker ? (
                <form 
                  onSubmit={handleAddSpeakerSubmit} 
                  className="flex items-center space-x-1.5 bg-input-canvas border border-orange-500/40 px-3 py-1 rounded-full shrink-0"
                >
                  <input
                    type="text"
                    autoFocus
                    required
                    placeholder="New Speaker..."
                    value={newSpeakerName}
                    onChange={(e) => setNewSpeakerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowAddSpeaker(false);
                        setNewSpeakerName('');
                      }
                    }}
                    className="bg-transparent text-xs text-main-canvas font-sans focus:outline-none w-24"
                  />
                  <button
                    type="submit"
                    className="p-1 bg-orange-500 text-white rounded-full hover:bg-orange-600 cursor-pointer flex items-center justify-center"
                  >
                    <Check size={10} className="stroke-[3]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSpeaker(false);
                      setNewSpeakerName('');
                    }}
                    className="p-1 rounded-full border border-muted-canvas text-muted-canvas hover:text-rose-500 cursor-pointer flex items-center justify-center"
                  >
                    <X size={10} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddSpeaker(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full border border-dashed border-orange-500/30 text-xs text-orange-500 bg-orange-500/[0.01] hover:border-orange-500/60 hover:bg-orange-500/[0.04] transition-all cursor-pointer shrink-0"
                >
                  <Plus size={11} className="stroke-[2.5]" />
                  <span>Add Speaker</span>
                </button>
              )}
            </div>
          </div>

          {/* Section: Extract - Placed under Context in first widget as a 2-column list */}

        </div>

        {/* Container 2: Target, Engine & Execution */}
        <div className="p-6 rounded-2xl bg-panel-canvas border border-muted-canvas shadow-xs space-y-6">
          
          <div className="flex flex-col space-y-6">
            {/* Section: Extract - Placed at the top of second widget as a 2-column list */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider font-sans">
                Extract
              </h3>
              
              <div className="grid grid-cols-2 gap-2">
                {Object.entries({
                  actions: "Action Items",
                  chapters: "Chapters",
                  topics: "Topics Matrix",
                  highlights: "Highlights",
                  snapshots: "Snapshots"
                }).map(([key, label]) => {
                  const isChecked = pipeline[key as keyof PipelineOptions];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePipeline(key as keyof PipelineOptions)}
                      className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl border border-transparent text-left cursor-pointer transition-colors duration-200 ${
                        isChecked
                          ? 'bg-orange-500/10 text-main-canvas font-semibold shadow-xs'
                          : 'bg-input-canvas/50 text-muted-canvas hover:bg-input-canvas/80'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors duration-200 flex-shrink-0 ${
                        isChecked 
                          ? 'bg-orange-500/15 border-orange-500/30 text-orange-500' 
                          : 'border-muted-canvas text-transparent'
                      }`}>
                        {isChecked && <Check size={11} className="stroke-[3]" />}
                      </div>
                      <span className="text-xs font-sans tracking-tight truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section: Deliverable Target */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-muted-canvas uppercase tracking-wider font-sans">
                Deliverable Target
              </h3>
              <div className="flex items-center bg-input-canvas border border-muted-canvas rounded-xl px-3 py-2.5 focus-within:border-active-canvas transition-colors">
                <Inbox size={15} className="text-muted-canvas mr-2 flex-shrink-0" />
                <input
                  type="text"
                  value={deliverTo}
                  onChange={(e) => setDeliverTo(e.target.value)}
                  className="w-full bg-transparent text-xs text-main-canvas font-mono focus:outline-none"
                  placeholder="/hazagames/archive"
                />
              </div>
            </div>
          </div>

          {/* Combined Engine Settings (no header) & Execute Button with tight spacing */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {/* Engine Select */}
              <div className="relative">
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as EngineType)}
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas font-sans pl-2.5 pr-8 py-2.5 rounded-xl focus:outline-none focus:border-active-canvas appearance-none cursor-pointer"
                >
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas">
                  <Cpu size={14} />
                </div>
              </div>

              {/* Effort Select */}
              <div className="relative">
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value as EffortType)}
                  className="w-full bg-input-canvas border border-muted-canvas text-xs text-main-canvas font-sans pl-2.5 pr-8 py-2.5 rounded-xl focus:outline-none focus:border-active-canvas appearance-none cursor-pointer"
                >
                  <option value="Balanced">Balanced</option>
                  <option value="High">High</option>
                  <option value="Max">Max</option>
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-canvas">
                  <Server size={14} />
                </div>
              </div>
            </div>

            {isProcessing ? (
              <button
                type="button"
                onClick={onAbort}
                className="w-full py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 font-sans font-bold text-xs tracking-wider uppercase transition-all cursor-pointer shadow-xs flex items-center justify-center space-x-1.5"
              >
                <X size={14} />
                <span>Abort</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onExecute}
                disabled={!source}
                className={`w-full py-3.5 rounded-xl font-sans font-bold text-xs tracking-widest uppercase transition-all duration-200 shadow-xs flex items-center justify-center space-x-2 cursor-pointer ${
                  source
                    ? 'accent-button hover:scale-[1.01] active:scale-99'
                    : 'bg-orange-500/20 border border-orange-500/15 text-orange-500/50 dark:bg-orange-500/10 dark:border-orange-500/10 dark:text-orange-400/30 cursor-not-allowed'
                }`}
              >
                <Play size={13} fill="currentColor" />
                <span>Execute</span>
              </button>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
