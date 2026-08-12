/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
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
  onSaveSessionDate: (sessionDate: string, sessionTime: string) => void;
  onRenameSpeaker: (from: string, to: string) => void;
  onReviewEdit: () => void;
  onSnapshotKeep: (filename: string, kept: boolean) => void;
  onMentionCorrect: (ranges: Array<{ sourceWordStart: number; sourceWordEnd: number }>, replacement: string) => void;
  onMentionSelect: (phrase: string | null) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'fading';
  onCommit: () => void;
  canCommit: boolean;
  isCommitPending: boolean;
  isReadOnly: boolean;
}

type ReviewSnapshot = NonNullable<DistillationResult['snapshots']>[number];

const pendingActionTitle = 'This control is visible for the planned workflow and is not active yet.';

function canonicalWord(value: string): string {
  return value
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLocaleLowerCase();
}

function SnapshotEvidence({ cuePhrase, anchorWord }: Pick<ReviewSnapshot, 'cuePhrase' | 'anchorWord'>) {
  if (!cuePhrase) return null;
  const anchor = canonicalWord(anchorWord);
  return (
    <span aria-label="Snapshot evidence" className="text-sm text-muted-canvas leading-relaxed">
      {cuePhrase.split(/(\s+)/).map((fragment, index) => (
        canonicalWord(fragment) === anchor && anchor
          ? <strong key={index} className="font-bold text-main-canvas">{fragment}</strong>
          : fragment
      ))}
    </span>
  );
}

function isoDate(sessionDate: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(sessionDate);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : sessionDate;
}

export default function InsightsPanel({ result, onSaveIdentity, onSaveSessionDate, onRenameSpeaker, onReviewEdit, onSnapshotKeep, onMentionCorrect, onMentionSelect, saveStatus, onCommit, canCommit, isCommitPending, isReadOnly }: InsightsPanelProps) {
  const [activeFileContent, setActiveFileContent] = useState<{ name: string; content: string } | null>(null);
  const [activeSnapshotFilename, setActiveSnapshotFilename] = useState<string | null>(null);
  const [hoveredSnapshot, setHoveredSnapshot] = useState<{ filename: string; left: number; top: number; width: number; height: number } | null>(null);
  const [editingMention, setEditingMention] = useState<string | null>(null);
  const [hoveredMention, setHoveredMention] = useState<string | null>(null);
  const [hoveredMentionPosition, setHoveredMentionPosition] = useState<{ left: number; top: number } | null>(null);
  const [fsExpanded, setFsExpanded] = useState<Record<string, boolean>>({
    root: true,
    assets: true,
  });

  const snapshots = result?.snapshots ?? [];
  const keptSnapshotCount = snapshots.filter((snapshot) => snapshot.kept).length;
  const activeSnapshot = snapshots.find((snapshot) => snapshot.filename === activeSnapshotFilename) ?? null;
  const activeSnapshotIndex = activeSnapshotFilename
    ? snapshots.findIndex((snapshot) => snapshot.filename === activeSnapshotFilename)
    : -1;
  const hoveredSnapshotData = snapshots.find((snapshot) => snapshot.filename === hoveredSnapshot?.filename) ?? null;

  const isWithinSnapshotHover = (target: EventTarget | null) => (
    target instanceof HTMLElement
    && Boolean(target.closest('[data-snapshot-card], [data-snapshot-hover-preview]'))
  );

  const showSnapshotHover = (snapshot: ReviewSnapshot, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    onMentionSelect(snapshot.cuePhrase || snapshot.anchorWord || null);
    setHoveredSnapshot({
      filename: snapshot.filename,
      left: rect.left - rect.width * 0.25,
      top: rect.top - rect.height * 0.25,
      width: rect.width * 1.5,
      height: rect.height * 1.5,
    });
  };

  const showMentionHover = (mentionId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setHoveredMention(mentionId);
    setHoveredMentionPosition({ left: rect.left, top: Math.max(8, rect.top - 6) });
  };

  useEffect(() => {
    if (!activeSnapshot) return;
    onMentionSelect(activeSnapshot.cuePhrase || activeSnapshot.anchorWord || null);
  }, [activeSnapshot, onMentionSelect]);

  useEffect(() => {
    if (activeSnapshotIndex === -1 || snapshots.length < 2) return;
    const cycleSnapshot = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (activeSnapshotIndex + direction + snapshots.length) % snapshots.length;
      setActiveSnapshotFilename(snapshots[nextIndex].filename);
    };
    window.addEventListener('keydown', cycleSnapshot);
    return () => window.removeEventListener('keydown', cycleSnapshot);
  }, [activeSnapshotIndex, snapshots]);

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
              onClick={onCommit}
              disabled={!canCommit || isCommitPending}
              title={isReadOnly ? 'Session commit is in progress.' : undefined}
              className={`px-4 py-1.5 bg-main-canvas text-app-canvas accent-button font-sans font-bold text-xs tracking-wider uppercase rounded transition-all shadow-sm ${canCommit && !isCommitPending ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
              {isCommitPending || isReadOnly ? 'Committing…' : 'Commit'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-muted-canvas pb-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-muted-canvas uppercase tracking-wider mb-1">Title</div>
                <input
                  type="text"
                  key={`title-${result.title}`}
                  defaultValue={result.title}
                  onChange={onReviewEdit}
                  disabled={isReadOnly}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSaveIdentity(event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="Short Name"
                  className="w-full bg-input-canvas border border-muted-canvas hover:border-active-canvas focus:border-active-canvas text-sm text-main-canvas font-sans px-2.5 py-1.5 rounded focus:outline-none transition-colors"
                />
              </div>

              <div className="shrink-0">
                <div className="text-xs font-bold text-muted-canvas uppercase tracking-wider mb-1">Session Date</div>
                <div className="flex items-center gap-2 bg-input-canvas border border-muted-canvas hover:border-active-canvas focus-within:border-active-canvas rounded px-2.5 py-1.5 transition-colors">
                  <input
                    key={`session-date-${result.sessionDate || result.timestamp}`}
                    type="datetime-local"
                    defaultValue={`${isoDate(result.sessionDate || '')}T${(result.sessionTime || '00:00').slice(0, 5)}`}
                    onChange={(event) => {
                      if (!event.currentTarget.value) return;
                      onReviewEdit();
                      const [sessionDate, sessionTime] = event.currentTarget.value.split('T');
                      onSaveSessionDate(sessionDate, sessionTime);
                    }}
                    disabled={isReadOnly}
                    aria-label="Session Date"
                    className="min-w-0 bg-transparent text-sm text-main-canvas font-mono outline-none"
                  />
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
                        disabled={isReadOnly}
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
                  editingMention === mention.id ? (
                    <input
                      key={mention.id}
                      autoFocus
                      aria-label={`Correct ${mention.tag}`}
                      defaultValue={mention.tag}
                      onBlur={() => {
                        setEditingMention(null);
                        onMentionSelect(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && event.currentTarget.value.trim()) {
                          onMentionCorrect(mention.sourceRanges, event.currentTarget.value.trim());
                          setEditingMention(null);
                          onMentionSelect(null);
                        }
                        if (event.key === 'Escape') {
                          setEditingMention(null);
                          onMentionSelect(null);
                        }
                      }}
                      className="w-36 px-2 py-0.5 rounded bg-input-canvas border border-orange-500 text-xs text-main-canvas focus:outline-none"
                    />
                  ) : (
                    <div
                      key={mention.id}
                      className="relative"
                      onMouseEnter={(event) => showMentionHover(mention.id, event.currentTarget)}
                      onMouseLeave={() => {
                        setHoveredMention(null);
                        setHoveredMentionPosition(null);
                      }}
                      onFocus={(event) => showMentionHover(mention.id, event.currentTarget)}
                      onBlur={() => {
                        setHoveredMention(null);
                        setHoveredMentionPosition(null);
                      }}
                    >
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => {
                          onMentionSelect(mention.tag);
                          setEditingMention(mention.id);
                        }}
                        className="inline-flex items-center px-2 py-0.5 rounded bg-input-canvas border border-muted-canvas text-xs text-main-canvas hover:border-orange-500 disabled:opacity-50"
                      >
                        {mention.tag}
                      </button>
                    </div>
                  )
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
                  onClick={() => setActiveSnapshotFilename(snapshots.find((snapshot) => snapshot.kept)?.filename || snapshots[0]?.filename || null)}
                  aria-label="Preview Snapshots"
                  title="Preview proposed Snapshots"
                  className="text-[10px] text-orange-500 hover:underline font-bold uppercase tracking-wider cursor-pointer"
                >
                  Preview ({keptSnapshotCount}/{snapshots.length})
                </button>
              </div>

              {snapshots.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {snapshots.map((snapshot, index) => (
                    <motion.div
                      key={`${snapshot.time}-${snapshot.filename}-${index}`}
                      layout
                      initial={false}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      data-snapshot-card="true"
                      onPointerEnter={(event) => showSnapshotHover(snapshot, event.currentTarget)}
                      onPointerLeave={(event) => {
                        if (!isWithinSnapshotHover(event.relatedTarget)) {
                          setHoveredSnapshot(null);
                          if (!activeSnapshot) onMentionSelect(null);
                        }
                      }}
                      className={`group relative aspect-[16/10] rounded border transition-[border-color,box-shadow] duration-200 overflow-hidden cursor-pointer text-left ${!snapshot.kept ? 'border-muted-canvas bg-input-canvas/30' : 'border-muted-canvas bg-input-canvas/30 hover:border-active-canvas'}`}
                    >
                      <button type="button" onClick={() => setActiveSnapshotFilename(snapshot.filename)} className="absolute inset-0 w-full text-left">
                      {snapshot.imageUrl ? (
                        <div className="absolute inset-0 overflow-hidden bg-input-canvas">
                          <img
                            src={snapshot.imageUrl}
                            alt={snapshot.filename}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-102"
                          />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-canvas">
                          <Image size={14} />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2.5 pb-2 pt-7 text-white">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-white/80">
                          <span>{snapshot.time}</span>
                          {snapshot.kind === 'overview' && <span className="rounded bg-white/15 px-1 uppercase">Overview</span>}
                        </div>
                        <div className={`truncate text-sm font-medium ${!snapshot.kept ? 'line-through text-white/60' : ''}`}>{snapshot.subject}</div>
                      </div>
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => onSnapshotKeep(snapshot.filename, !snapshot.kept)}
                        aria-label={`${snapshot.kept ? 'Remove' : 'Keep'} ${snapshot.filename}`}
                        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white/80 hover:bg-black/80 hover:text-white disabled:cursor-not-allowed"
                      >
                        {snapshot.kept ? <X size={13} /> : <Plus size={13} />}
                      </button>
                    </motion.div>
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
        isOpen={activeSnapshot !== null}
        onClose={() => setActiveSnapshotFilename(null)}
        title="Snapshots"
        size="full"
        minimal
      >
        {activeSnapshot && (
          <div className="flex max-h-[90vh] max-w-full flex-col items-center justify-center">
            <div className="inline-flex max-w-full flex-col overflow-hidden rounded-xl border border-muted-canvas bg-panel-canvas shadow-2xl">
              {activeSnapshot.imageUrl ? (
                <img
                  src={activeSnapshot.imageUrl}
                  alt={activeSnapshot.filename}
                  referrerPolicy="no-referrer"
                  className="block max-h-[78vh] max-w-[96vw] object-contain"
                />
              ) : (
                <div className="flex h-64 w-[min(70vw,48rem)] flex-col items-center justify-center bg-input-canvas text-muted-canvas">
                  <Image size={48} />
                  <span className="mt-2 text-sm font-mono">No Image Capture</span>
                </div>
              )}
              <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-t border-muted-canvas px-5 py-3.5 ${!activeSnapshot.kept ? 'bg-input-canvas/85' : 'bg-panel-canvas'}`}>
                <div className="flex min-w-0 items-center gap-2 justify-self-start">
                  <h4 className={`truncate font-sans text-base font-bold text-main-canvas ${!activeSnapshot.kept ? 'line-through text-muted-canvas/70' : ''}`}>{activeSnapshot.subject}</h4>
                  {!activeSnapshot.kept && <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-500">Denied</span>}
                </div>
                <div className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-center text-sm text-muted-canvas">
                  <span className="font-mono">{activeSnapshot.time}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeSnapshot.speakerLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>“<SnapshotEvidence cuePhrase={activeSnapshot.cuePhrase} anchorWord={activeSnapshot.anchorWord} />”</span>
                  {activeSnapshot.kind === 'overview' && <span className="rounded border border-muted-canvas px-1.5 py-0.5 text-xs font-mono uppercase">Overview</span>}
                </div>
                <div className="justify-self-end flex items-center gap-2">
                  <span aria-label={`Snapshot ${activeSnapshotIndex + 1} of ${snapshots.length}`} className="shrink-0 font-mono text-[11px] text-muted-canvas">{activeSnapshotIndex + 1} / {snapshots.length}</span>
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => onSnapshotKeep(activeSnapshot.filename, !activeSnapshot.kept)}
                    aria-label={`${activeSnapshot.kept ? 'Remove' : 'Keep'} ${activeSnapshot.filename}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-muted-canvas text-muted-canvas transition-all hover:bg-input-canvas hover:text-main-canvas disabled:cursor-not-allowed"
                  >
                    {!activeSnapshot.kept ? <Plus size={16} /> : <X size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </GlassModal>

      {hoveredSnapshot && hoveredSnapshotData && typeof document !== 'undefined' && createPortal(
        <div
          data-snapshot-hover-preview="true"
          style={{ left: hoveredSnapshot.left, top: hoveredSnapshot.top, width: hoveredSnapshot.width, height: hoveredSnapshot.height }}
          className="pointer-events-none fixed z-[55] overflow-hidden rounded border border-active-canvas bg-input-canvas shadow-2xl"
        >
          <button type="button" onClick={() => setActiveSnapshotFilename(hoveredSnapshotData.filename)} className="absolute inset-0 w-full text-left">
            {hoveredSnapshotData.imageUrl ? (
              <img
                src={hoveredSnapshotData.imageUrl}
                alt={hoveredSnapshotData.filename}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center text-muted-canvas">
                <Image size={21} />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 py-3 pt-9 text-white">
              <div className="flex items-center gap-1.5 text-xs font-mono text-white/80">
                <span>{hoveredSnapshotData.time}</span>
                {hoveredSnapshotData.kind === 'overview' && <span className="rounded bg-white/15 px-1 uppercase">Overview</span>}
              </div>
              <div className={`truncate text-base font-medium ${!hoveredSnapshotData.kept ? 'line-through text-white/60' : ''}`}>{hoveredSnapshotData.subject}</div>
            </div>
          </button>
          <button
            type="button"
            disabled={isReadOnly}
            onClick={(event) => {
              event.stopPropagation();
              onSnapshotKeep(hoveredSnapshotData.filename, !hoveredSnapshotData.kept);
            }}
            aria-label={`${hoveredSnapshotData.kept ? 'Remove' : 'Keep'} ${hoveredSnapshotData.filename}`}
            className="pointer-events-auto absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white/80 hover:bg-black/80 hover:text-white disabled:cursor-not-allowed"
          >
            {hoveredSnapshotData.kept ? <X size={16} /> : <Plus size={16} />}
          </button>
        </div>,
        document.body,
      )}

      {hoveredMention && hoveredMentionPosition && typeof document !== 'undefined' && (() => {
        const mention = result?.mentions.find((item) => item.id === hoveredMention);
        if (!mention) return null;
        return createPortal(
          <div
            role="tooltip"
            style={{ left: hoveredMentionPosition.left, top: hoveredMentionPosition.top }}
            className="pointer-events-none fixed z-[55] w-64 -translate-y-full rounded border border-muted-canvas bg-panel-canvas px-2.5 py-2 text-left shadow-lg"
          >
            <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-wider text-orange-500">{mention.time} — {mention.speakerLabel}</div>
            <p className="text-[11px] leading-relaxed text-main-canvas">{mention.context}</p>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
