/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Folder,
  File,
  ChevronDown,
  ChevronRight,
  Plus,
  AlertTriangle,
  Info,
  Lightbulb,
  Star,
  X
} from 'lucide-react';
import { DistillationResult, Speaker, Mention, AgentNote, FileTreeNode } from '../types';
import GlassModal from './GlassModal';

interface InsightsPanelProps {
  result: DistillationResult | null;
  setResult: React.Dispatch<React.SetStateAction<DistillationResult | null>>;
}

export default function InsightsPanel({
  result,
  setResult
}: InsightsPanelProps) {
  // Modal viewer states
  const [activeFileContent, setActiveFileContent] = useState<{ name: string; content: string } | null>(null);

  // Speaker creation states
  const [showAddSpeaker, setShowAddSpeaker] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');

  // Mention creation states
  const [showAddMention, setShowAddMention] = useState(false);
  const [newMentionTag, setNewMentionTag] = useState('');

  // Expand state for filesystem tree
  const [fsExpanded, setFsExpanded] = useState<Record<string, boolean>>({
    'root': true,
    'assets': true
  });

  const toggleFsExpanded = (key: string) => {
    setFsExpanded({
      ...fsExpanded,
      [key]: !fsExpanded[key]
    });
  };

  // Updaters for edited fields
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!result) return;
    setResult({ ...result, title: e.target.value });
  };

  const handleTimestampChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!result) return;
    setResult({ ...result, timestamp: e.target.value });
  };

  // Add/Remove Speakers
  const handleAddSpeaker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result || !newSpeakerName.trim()) return;

    const initials = newSpeakerName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    const newSpeaker: Speaker = {
      id: Date.now().toString(),
      initials: initials || 'SP',
      name: newSpeakerName.trim()
    };

    setResult({
      ...result,
      speakers: [...result.speakers, newSpeaker]
    });
    setNewSpeakerName('');
    setShowAddSpeaker(false);
  };

  const handleRemoveSpeaker = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      speakers: result.speakers.filter((s) => s.id !== id)
    });
  };

  // Add/Remove Mentions
  const handleAddMention = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result || !newMentionTag.trim()) return;

    const newMention: Mention = {
      id: Date.now().toString(),
      tag: newMentionTag.trim()
    };

    setResult({
      ...result,
      mentions: [...result.mentions, newMention]
    });
    setNewMentionTag('');
    setShowAddMention(false);
  };

  const handleRemoveMention = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      mentions: result.mentions.filter((m) => m.id !== id)
    });
  };

  // Dismiss Agent Note
  const handleDismissAgentNote = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      agentNotes: result.agentNotes.filter((n) => n.id !== id)
    });
  };

  // Renders the filesystem tree recursively
  const renderFileSystemTree = (nodes: FileTreeNode[], depth = 0, pathPrefix = 'root') => {
    return nodes.map((node, index) => {
      const uniqueKey = `${pathPrefix}-${node.name}-${index}`;
      const isDir = node.type === 'directory';
      const isExpanded = fsExpanded[uniqueKey] !== false;

      if (isDir) {
        return (
          <div key={uniqueKey} className="select-none">
            <div
              onClick={() => toggleFsExpanded(uniqueKey)}
              className="flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-input-canvas cursor-pointer text-main-canvas hover:text-main-canvas transition-colors"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
            >
              {isExpanded ? <ChevronDown size={12} className="text-muted-canvas" /> : <ChevronRight size={12} className="text-muted-canvas" />}
              <Folder size={13} className="text-muted-canvas/80 flex-shrink-0" />
              <span className="font-mono text-xs truncate">{node.name}</span>
            </div>
            {isExpanded && node.children && (
              <div className="border-l border-muted-canvas/60 ml-2">
                {renderFileSystemTree(node.children, depth + 1, uniqueKey)}
              </div>
            )}
          </div>
        );
      } else {
        return (
          <div
            key={uniqueKey}
            onClick={() => {
              if (node.content) {
                setActiveFileContent({ name: node.name, content: node.content });
              }
            }}
            className={`flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors ${
              node.content ? 'cursor-pointer' : ''
            }`}
            style={{ paddingLeft: `${depth * 12 + 16}px` }}
          >
            <File size={12} className="text-muted-canvas/60 flex-shrink-0" />
            <span className="font-mono text-xs truncate">{node.name}</span>
          </div>
        );
      }
    });
  };

  // Helper to render Note Type Icons
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-muted-canvas pb-2 mb-3 flex-shrink-0">
        <div className="flex items-center space-x-1.5">
          <h2 className="font-sans font-semibold text-xs tracking-wider text-muted-canvas uppercase">Insights & Assets</h2>
        </div>

        {result && <span className="text-[10px] font-mono text-muted-canvas uppercase">Review only · source untouched</span>}
      </div>

      {/* Main Column Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
        {result ? (
          /* Populated State with Flattened Layout & No protective cards */
          <div className="space-y-4">
            {/* 1. Title & Timestamp Editable Metadata - Proportional Grid Layout */}
            <div className="grid grid-cols-12 gap-3 border-b border-muted-canvas pb-3">
              <div className="col-span-8 md:col-span-9">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1">Title</div>
                <input
                  type="text"
                  value={result.title}
                  onChange={handleTitleChange}
                  className="w-full bg-input-canvas border border-muted-canvas hover:border-active-canvas focus:border-active-canvas text-xs text-main-canvas font-sans px-2.5 py-1.5 rounded focus:outline-none transition-colors"
                />
              </div>

              <div className="col-span-4 md:col-span-3">
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1">Timestamp</div>
                <input
                  type="text"
                  value={result.timestamp}
                  onChange={handleTimestampChange}
                  className="w-full bg-input-canvas border border-muted-canvas hover:border-active-canvas focus:border-active-canvas text-xs text-muted-canvas font-mono px-2.5 py-1.5 rounded focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* 2. Filesystem Preview */}
            <div className="border-b border-muted-canvas pb-3">
              <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                Filesystem Preview
              </div>
              <div className="border border-muted-canvas p-2 rounded bg-input-canvas/50 max-h-[160px] overflow-y-auto">
                {result.filesystem && renderFileSystemTree(result.filesystem)}
              </div>
            </div>

            {/* 3. Speakers Section - GRIDS for compact height */}
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
                      <span className="text-xs text-main-canvas truncate font-sans">{speaker.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveSpeaker(speaker.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-panel-canvas text-muted-canvas hover:text-rose-500 transition-all cursor-pointer"
                      title="Remove Speaker"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}

                {/* Inline form to create speaker */}
                {showAddSpeaker ? (
                  <form onSubmit={handleAddSpeaker} className="flex items-center space-x-1 col-span-2 mt-0.5">
                    <input
                      type="text"
                      autoFocus
                      required
                      placeholder="Full Name"
                      value={newSpeakerName}
                      onChange={(e) => setNewSpeakerName(e.target.value)}
                      className="flex-1 bg-input-canvas border border-active-canvas text-xs text-main-canvas font-sans px-2.5 py-1 rounded focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="p-1 bg-main-canvas text-app-canvas rounded hover:opacity-95"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddSpeaker(false)}
                      className="p-1 rounded border border-muted-canvas text-muted-canvas hover:text-main-canvas"
                    >
                      <X size={12} />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddSpeaker(true)}
                    className="flex items-center justify-center space-x-1 py-1 rounded border border-dashed border-muted-canvas hover:border-active-canvas text-[11px] text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
                  >
                    <Plus size={10} />
                    <span>Add Speaker</span>
                  </button>
                )}
              </div>
            </div>

            {/* 4. Mentions (formerly Index) - Moved right under Speakers */}
            <div className="border-b border-muted-canvas pb-3">
              <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                Mentions
              </div>

              <div className="flex flex-wrap gap-1">
                {result.mentions.map((men) => (
                  <span
                    key={men.id}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-input-canvas border border-muted-canvas text-xs text-main-canvas"
                  >
                    <span>{men.tag}</span>
                    <button
                      onClick={() => handleRemoveMention(men.id)}
                      className="text-muted-canvas hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}

                {showAddMention ? (
                  <form onSubmit={handleAddMention} className="inline-flex items-center">
                    <input
                      type="text"
                      autoFocus
                      required
                      placeholder="Tag"
                      value={newMentionTag}
                      onChange={(e) => setNewMentionTag(e.target.value)}
                      className="bg-input-canvas border border-active-canvas text-xs text-main-canvas px-1.5 py-0.5 rounded focus:outline-none w-16"
                    />
                    <button type="submit" className="text-main-canvas ml-1 hover:opacity-80">
                      <Plus size={10} />
                    </button>
                    <button type="button" onClick={() => setShowAddMention(false)} className="text-muted-canvas ml-1">
                      <X size={10} />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddMention(true)}
                    className="inline-flex items-center space-x-0.5 px-2 py-0.5 rounded border border-dashed border-muted-canvas hover:border-active-canvas text-[11px] text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
                  >
                    <Plus size={8} />
                    <span>Add</span>
                  </button>
                )}
              </div>
            </div>

            {/* Agent Notes - Released padding, borderless simple lists */}
            {result.agentNotes && result.agentNotes.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-muted-canvas uppercase tracking-wider mb-1.5">
                  Agent Notes
                </div>

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
                        onClick={() => handleDismissAgentNote(note.id)}
                        className="p-0.5 rounded hover:bg-input-canvas text-muted-canvas hover:text-rose-500 opacity-0 group-hover:opacity-100 cursor-pointer ml-1"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Empty/Idle State Placeholders - beautifully styled with no protective cards */
          <div className="space-y-4">
            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Filesystem Pending</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Durable asset logs generated upon run</p>
            </div>

            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Speaker Grid Mapping</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Diarization indexes parsed from stream</p>
            </div>

            <div className="p-4 rounded border border-dashed border-muted-canvas bg-input-canvas/10 text-center">
              <div className="text-xs font-sans text-muted-canvas font-semibold mb-1">Intel Indexing</div>
              <p className="text-xs font-mono text-muted-canvas/60 uppercase">Semantic concept entities traced in run</p>
            </div>
          </div>
        )}
      </div>

      {/* Reusable File content preview Modal */}
      <GlassModal
        isOpen={activeFileContent !== null}
        onClose={() => setActiveFileContent(null)}
        title={`File Content: ${activeFileContent?.name || ''}`}
      >
        <pre className="p-4 rounded-xl bg-input-canvas border border-muted-canvas text-xs font-mono text-main-canvas overflow-x-auto whitespace-pre-wrap max-h-[350px]">
          {activeFileContent?.content || ''}
        </pre>
      </GlassModal>

    </div>
  );
}
