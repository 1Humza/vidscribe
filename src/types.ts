/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SourceFile {
  name: string;
  sizeStr: string;
  durationStr: string;
  dateStr: string;
  type: 'audio' | 'video' | 'url';
  url?: string;
}

export interface PipelineOptions {
  actions: boolean; // Action Summary
  chapters: boolean; // Chapters
  topics: boolean; // Topics
  highlights: boolean; // Highlights
  snapshots: boolean; // Visual snapshots
}

export type EngineType = 'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite';
export type EffortType = 'Balanced' | 'High' | 'Max';

export interface Speaker {
  id: string;
  initials: string;
  name: string;
  color?: string;
}

export interface Snapshot {
  time: string;
  name: string;
  description?: string;
  imageUrl?: string;
  excluded?: boolean;
}

export interface Mention {
  id: string;
  tag: string;
}

export interface AgentNote {
  id: string;
  time?: string;
  text: string;
  type: 'warning' | 'info' | 'insight' | 'notable';
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  content?: string;
}

export interface DistillationResult {
  title: string;
  timestamp: string;
  markdown: string;
  speakers: Speaker[];
  snapshots: Snapshot[];
  mentions: Mention[];
  agentNotes: AgentNote[];
  filesystem: FileTreeNode[];
}

export interface SampleSession {
  id: string;
  name: string;
  description: string;
  source: SourceFile;
  context: string;
  pipeline: PipelineOptions;
  engine: EngineType;
  effort: EffortType;
  result: DistillationResult;
}
