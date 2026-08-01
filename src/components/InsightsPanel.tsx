/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Image,
  Info,
  Lightbulb,
  Plus,
  Star,
  X,
} from 'lucide-react';
import type { DistillationResult, FileTreeNode } from '../types';
import GlassModal from './GlassModal';

interface InsightsPanelProps {
  result: DistillationResult | null;
  onSaveIdentity: (shortName: string) => void;
  onRenameSpeaker: (from: string, to: string) => void;
  onReviewEdit: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'fading';
}

interface ReviewSnapshot {
  time: string;
  name: string;
  description?: string;
  imageUrl?: string;
  excluded?: boolean;
}

type ResultWithSnapshots = DistillationResult & { snapshots?: ReviewSnapshot[] };

const pendingActionTitle = 'This control is visible for the planned workflow and is not active yet.';

export default function InsightsPanel({ result, onSaveIdentity, onRenameSpeaker, onReviewEdit, saveStatus }: InsightsPanelProps) {
  const [activeFileContent, setActiveFileContent] = useState<{ name: string; content: string } | null>(null);
  const [showSnapshotsPreview, setShowSnapshotsPreview] = useState(false);
  const [fsExpanded, setFsExpanded] = useState<Record<string, boolean>>({
    root: true,
    assets: true,
  });

  const snapshots = (result as ResultWithSnapshots | null)?.snapshots ?? [];

  const toggleFsExpanded = (key: string) => {
    setFsExpanded((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const renderFileSystemTree = (nodes: FileTreeNode[], depth = 0, pathPrefix = 'root') => (
    nodes.map((node, index) => {
      const uniqueKey = `${pathPrefix}-${node.name}-${index}`;
      const isDir = node.type === 'directory';
      const isExpanded = fsExpanded[uniqueKey] !== false;

      if (isDir) {
        return (
          <div key={uniqueKey} className="select-none">
            <button
              type="button"
              onClick={() => toggleFsExpanded(uniqueKey)}
              className="w-full flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-input-canvas cursor-pointer text-main-canvas hover:text-main-canvas transition-colors"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
            >
              {isExpanded ? <ChevronDown size={12} className="text-muted-canvas" /> : <ChevronRight size={12} className="text-muted-canvas" />}
              <Folder size={13} className="text-muted-canvas/80 flex-shrink-0" />
              <span className="font-mono text-xs truncate">{node.name}</span>
            </button>
            {isExpanded && node.children && (
              <div className="border-l border-muted-canvas/60 ml-2">
                {renderFileSystemTree(node.children, depth + 1, uniqueKey)}
              </div>
            )}
          </div>
        );
      }

      return (
        <button
          key={uniqueKey}
          type="button"
          onClick={() => node.content && setActiveFileContent({ name: node.name, content: node.content })}
          disabled={!node.content}
          className={`w-full flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors ${
            node.content ? 'cursor-pointer' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 16}px` }}
        >
          <File size={12} className="text-muted-canvas/60 flex-shrink-0" />
          <span className="font-mono text-xs truncate">{node.name}</span>
        </button>
      );
    })
  );

  const renderNoteIcon = (type: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />;
      case 'insight':
        return <Lightbulb size={14} className="text-emerald-500 flex-shrink-0" />;
      case 'notable':
        return <Star size={14} className="text-violet-500 flex-shrink-0" />;
      default:
        return <Info size={14} className="text-blue-500 flex-shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-muted-canvas pb-2 mb-3 flex-shrink-0">
        <div className="flex items-center space-x-1.5">
          <h2 className="font-sans font-semibold text-xs tracking-wider text-muted-canvas uppercase">Insights & Assets</h2>
        </div>

        {result && (
          <div className="flex items-center space-x-3.5">
            <label className="flex items-center space-x-1.5 select-none opacity-50" title={pendingActionTitle}>
              <input
                type="checkbox"
                checked={false}
                disabled
                readOnly
                aria-label="Trash Source (pending)"
                className="rounded border-muted-canvas bg-input-canvas text-main-canvas focus:ring-0 w-3.5 h-3.5 cursor-not-allowed"
              />
              <span className="text-xs font-mono text-muted-canvas uppercase tracking-wider">Trash Source</span>
            </label>

            <button
              type="button"
              disabled
              title={pendingActionTitle}
              className="px-4 py-1.5 bg-main-canvas text-app-canvas accent-button font-sans font-bold text-xs tracking-wider uppercase rounded transition-all cursor-not-allowed shadow-sm opacity-50"
            >
              Commit
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-muted-canvas pb-3">
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1">Title</div>
                <input
                  type="text"
                  key={`title-${result.title}`}
                  defaultValue={result.title}
                  onChange={onReviewEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSaveIdentity(event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="Short Name"
                  className="w-full bg-input-canvas border border-muted-canvas hover:border-active-canvas focus:border-active-canvas text-xs text-main-canvas font-sans px-2.5 py-1.5 rounded focus:outline-none transition-colors"
                />
              </div>

              <div className="shrink-0">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1">Timestamp</div>
                <div aria-label="Timestamp" className="w-full whitespace-nowrap bg-input-canvas border border-muted-canvas text-xs text-muted-canvas font-mono px-2.5 py-1.5 rounded">
                  {result.timestamp}
                </div>
              </div>
            </div>

            <div className="border-b border-muted-canvas pb-3">
              <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                Filesystem Preview
              </div>
              <div className="border border-muted-canvas p-2 rounded bg-input-canvas/50 min-h-9 max-h-[160px] overflow-y-auto">
                {result.filesystem.length > 0 ? (
                  renderFileSystemTree(result.filesystem)
                ) : (
                  <span className="text-[10px] font-mono text-muted-canvas uppercase">Asset generation pending</span>
                )}
              </div>
            </div>

            <div className="border-b border-muted-canvas pb-3">
              <div className="flex justify-between items-center mb-1.5">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider">Speakers</div>
                <span className="text-[10px] font-mono text-muted-canvas">
                  {result.speakers.length} Identified
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {result.speakers.map((speaker) => (
                  <div
                    key={speaker.id}
                    className="flex items-center justify-between p-1.5 rounded bg-input-canvas border border-muted-canvas/70 hover:bg-input-canvas/90 transition-all group"
                  >
                    <div className="flex items-center space-x-1.5 overflow-hidden">
                      <div className="w-5 h-5 flex-shrink-0 rounded bg-main-canvas text-app-canvas flex items-center justify-center font-sans font-bold text-[10px] opacity-90">
                        {speaker.initials}
                      </div>
                      <input
                        key={`${speaker.id}-${speaker.name}`}
                        defaultValue={speaker.name}
                        onChange={onReviewEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onRenameSpeaker(speaker.name, event.currentTarget.value);
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label={`Speaker Label ${speaker.name}`}
                        className="w-full min-w-0 bg-transparent text-xs text-main-canvas truncate font-sans focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      disabled
                      title={pendingActionTitle}
                      aria-label={`Remove ${speaker.name} (pending)`}
                      className="opacity-30 group-hover:opacity-50 p-0.5 rounded text-muted-canvas transition-all cursor-not-allowed"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  disabled
                  title={pendingActionTitle}
                  className="flex items-center justify-center space-x-1 py-1 rounded border border-dashed border-muted-canvas text-[11px] text-muted-canvas opacity-50 cursor-not-allowed"
                >
                  <Plus size={10} />
                  <span>Add Speaker</span>
                </button>
              </div>
            </div>


            <div className="border-b border-muted-canvas pb-3">
              <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                Mentions
              </div>

              <div className="flex flex-wrap gap-1">
                {result.mentions.map((mention) => (
                  <span
                    key={mention.id}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-input-canvas border border-muted-canvas text-xs text-main-canvas"
                  >
                    <span>{mention.tag}</span>
                    <button
                      type="button"
                      disabled
                      title={pendingActionTitle}
                      aria-label={`Remove ${mention.tag} (pending)`}
                      className="text-muted-canvas opacity-50 cursor-not-allowed"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}

                <button
                  type="button"
                  disabled
                  title={pendingActionTitle}
                  className="inline-flex items-center space-x-0.5 px-2 py-0.5 rounded border border-dashed border-muted-canvas text-[11px] text-muted-canvas opacity-50 cursor-not-allowed"
                >
                  <Plus size={8} />
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div className="border-b border-muted-canvas pb-3">
              <div className="flex justify-between items-center mb-1.5">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider">Snapshots</div>
                <button
                  type="button"
                  onClick={() => setShowSnapshotsPreview(true)}
                  aria-label="Preview Snapshots (pending)"
                  title="Snapshot extraction and curation are pending implementation"
                  className="text-[10px] text-orange-500 hover:underline font-bold uppercase tracking-wider cursor-pointer"
                >
                  Preview · Pending ({snapshots.filter((snapshot) => !snapshot.excluded).length}/{snapshots.length})
                </button>
              </div>

              {snapshots.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {snapshots.map((snapshot, index) => (
                    <button
                      key={`${snapshot.time}-${snapshot.name}-${index}`}
                      type="button"
                      onClick={() => setShowSnapshotsPreview(true)}
                      className={`group relative rounded border transition-all duration-200 overflow-hidden cursor-pointer text-left ${
                        snapshot.excluded
                          ? 'border-rose-500/20 bg-rose-500/5 opacity-50'
                          : 'border-muted-canvas bg-input-canvas/30 hover:border-active-canvas'
                      }`}
                    >
                      {snapshot.imageUrl ? (
                        <div className="relative h-16 overflow-hidden bg-input-canvas flex items-center justify-center">
                          <img
                            src={snapshot.imageUrl}
                            alt={snapshot.name}
                            referrerPolicy="no-referrer"
                            className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-102 ${
                              snapshot.excluded ? 'grayscale blur-[1px]' : ''
                            }`}
                          />
                          <div className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/75 rounded font-mono text-[9px] text-white">
                            {snapshot.time}
                          </div>
                          {snapshot.excluded && (
                            <div className="absolute inset-0 bg-rose-500/15 flex items-center justify-center">
                              <span className="text-[8px] font-mono font-bold bg-rose-600 text-white px-1 py-0.5 rounded tracking-widest">DENIED</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-16 flex flex-col items-center justify-center text-muted-canvas">
                          <Image size={14} />
                          <span className="text-[9px] font-mono mt-0.5">{snapshot.time}</span>
                        </div>
                      )}
                      <div className="p-1 px-1.5">
                        <div className={`text-[11px] font-sans truncate ${snapshot.excluded ? 'line-through text-muted-canvas/60' : 'text-main-canvas font-medium'}`}>
                          {snapshot.name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
                  <div className="text-[11px] text-muted-canvas font-semibold">Visual Snapshot Timeline</div>
                  <p className="text-[9px] font-mono text-muted-canvas/60 uppercase mt-0.5">Capture generation pending</p>
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                Agent Notes
              </div>

              {result.agentNotes.length > 0 ? (
                <div className="divide-y divide-muted-canvas/30 space-y-1.5">
                  {result.agentNotes.map((note) => (
                    <div
                      key={note.id}
                      className="relative py-1.5 flex items-start space-x-2 text-xs transition-all group border-none"
                    >
                      <div className="mt-0.5 flex-shrink-0">{renderNoteIcon(note.type)}</div>
                      <p className="text-[11px] text-main-canvas leading-normal flex-1 pr-4">
                        <span className="font-mono text-[9px] uppercase text-muted-canvas font-bold mr-1.5">[{note.type}]:</span>
                        <span className="italic">{note.text}</span>
                        {note.time && (
                          <span className="text-[9px] font-mono text-muted-canvas/60 ml-1.5">({note.time})</span>
                        )}
                      </p>
                      <button
                        type="button"
                        disabled
                        title={pendingActionTitle}
                        aria-label="Dismiss agent note (pending)"
                        className="p-0.5 rounded text-muted-canvas opacity-30 group-hover:opacity-50 cursor-not-allowed ml-1"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] font-mono text-muted-canvas uppercase">Agent annotations pending</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Filesystem Pending</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Available after Session finalization is implemented</p>
            </div>

            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Speaker Grid Mapping</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Global speaker editing pending</p>
            </div>

            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Visual Snapshot Timelines</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Snapshot extraction pending</p>
            </div>

            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Intel Indexing</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Semantic indexing pending</p>
            </div>
          </div>
        )}
      </div>

      <GlassModal
        isOpen={activeFileContent !== null}
        onClose={() => setActiveFileContent(null)}
        title={`File Content: ${activeFileContent?.name || ''}`}
      >
        <pre className="p-4 rounded-xl bg-input-canvas border border-muted-canvas text-xs font-mono text-main-canvas overflow-x-auto whitespace-pre-wrap max-h-[350px]">
          {activeFileContent?.content || ''}
        </pre>
      </GlassModal>

      <GlassModal
        isOpen={showSnapshotsPreview}
        onClose={() => setShowSnapshotsPreview(false)}
        title="Snapshots Curation Feed"
        size="full"
      >
        <div className="space-y-4">
          <div className="p-3 bg-panel-canvas border border-muted-canvas rounded-xl flex items-center justify-between text-xs font-sans">
            <div>
              <span className="font-bold text-main-canvas">Curation Flow:</span> Snapshot decisions will be available when capture curation is connected.
            </div>
            <div className="font-mono bg-input-canvas px-2.5 py-1 rounded border border-muted-canvas/60 text-main-canvas text-[11px] whitespace-nowrap">
              {snapshots.filter((snapshot) => !snapshot.excluded).length} / {snapshots.length} Active
            </div>
          </div>

          {snapshots.length > 0 ? (
            <div className="grid grid-cols-1 gap-8 max-h-[78vh] overflow-y-auto pr-1">
              {snapshots.map((snapshot, index) => (
                <div
                  key={`${snapshot.time}-${snapshot.name}-${index}`}
                  className={`flex flex-col rounded-2xl border transition-all duration-300 shadow-lg bg-panel-canvas overflow-hidden ${
                    snapshot.excluded
                      ? 'border-rose-500/20'
                      : 'border-muted-canvas hover:border-active-canvas hover:shadow-xl'
                  }`}
                >
                  <div className="p-4 flex items-center justify-between gap-4 border-b border-muted-canvas/60">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-black/70 border border-muted-canvas/20 px-2 py-0.5 rounded font-mono text-[11px] font-semibold text-white">
                          {snapshot.time}
                        </span>
                        <h4 className={`font-sans font-bold text-main-canvas text-base leading-none truncate ${snapshot.excluded ? 'line-through text-muted-canvas/60' : ''}`} title={snapshot.name}>
                          {snapshot.name}
                        </h4>
                        {snapshot.excluded && (
                          <span className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider">
                            Excluded
                          </span>
                        )}
                      </div>
                      {snapshot.description && (
                        <p className={`font-sans text-xs text-muted-canvas leading-relaxed ${snapshot.excluded ? 'italic text-muted-canvas/50' : ''}`}>
                          {snapshot.description}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled
                      title={pendingActionTitle}
                      aria-label={`${snapshot.excluded ? 'Restore' : 'Exclude'} ${snapshot.name} (pending)`}
                      className={`p-2 rounded-full border transition-all duration-200 cursor-not-allowed flex-shrink-0 opacity-50 ${
                        snapshot.excluded
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                      }`}
                    >
                      {snapshot.excluded ? <Plus size={16} className="stroke-[2.5]" /> : <X size={16} className="stroke-[2.5]" />}
                    </button>
                  </div>

                  <div className={`relative w-full overflow-hidden bg-black/40 ${snapshot.excluded ? 'grayscale opacity-40 blur-[1px]' : ''}`}>
                    {snapshot.imageUrl ? (
                      <img
                        src={snapshot.imageUrl}
                        alt={snapshot.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-auto max-h-[85vh] object-contain mx-auto block"
                      />
                    ) : (
                      <div className="w-full h-64 flex flex-col items-center justify-center text-muted-canvas">
                        <Image size={48} />
                        <span className="text-sm font-mono mt-2">No Image Capture</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center rounded-2xl border border-dashed border-muted-canvas bg-input-canvas/20 text-muted-canvas">
              <Image size={48} />
              <span className="text-sm font-mono mt-2 uppercase">Snapshot capture pending</span>
            </div>
          )}
        </div>
      </GlassModal>
    </div>
  );
}
