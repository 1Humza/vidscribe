export interface ExtractionOptionsDto {
  action_summary: boolean;
  topics: boolean;
  chapters: boolean;
  highlights: boolean;
}

export interface AnalysisResultDto {
  session_record_markdown: string;
  short_name: string;
  session_date: string;
  speaker_labels: string[];
  mentions?: MentionDto[];
  snapshots?: SnapshotDto[];
  source_media_has_video?: boolean;
}

export interface MentionDto {
  source_word_start: number;
  source_word_end: number;
  speaker_label?: string;
  replacement?: string | null;
}

export interface SnapshotDto {
  filename: string;
  cue_phrase: string;
  anchor_word: string;
  speaker_label?: string;
  kind?: 'overview' | 'detail';
  subject: string;
  source_word_index: number;
  timestamp_seconds: number;
  image_path: string;
  kept: boolean;
}

export type AnalysisAttemptStatus = 'streaming' | 'completed' | 'error';

export interface AnalysisAttemptDto {
  id: string;
  status: AnalysisAttemptStatus;
  model: string;
  effort: string;
  raw_stream: string;
  result: AnalysisResultDto | null;
  error: string | null;
}

export type SessionStatus = 'ready' | 'processing' | 'review' | 'error' | 'finalizing' | 'needs_attention' | 'completed';
export type SessionStage = 'intake' | 'preparing' | 'transcribing' | 'analyzing' | 'review' | 'completed';

export interface SessionViewDto {
  id: string;
  status: SessionStatus;
  stage: SessionStage;
  progress: number;
  source_path: string;
  destination_path: string;
  extra_instructions: string;
  speaker_hints: string[];
  extraction_options: ExtractionOptionsDto;
  model: AnalysisModelDto;
  effort: AnalysisEffortDto;
  analysis_audio_path: string | null;
  transcript: string | null;
  transcript_word_timings?: Array<{ word: string; start: number; end: number }>;
  session_date: string;
  attachment_paths: string[];
  completed_folder_path?: string | null;
  attempts: AnalysisAttemptDto[];
  created_at: string;
  updated_at: string;
}

export interface SourcePickerSelectionDto {
  selection_id: string;
  path: string;
  name: string;
  media_kind: 'audio' | 'video' | null;
}

export interface DestinationPickerSelectionDto {
  selection_id: string;
  path: string;
  name: string;
}

export interface AttachmentPickerSelectionDto {
  selection_id: string;
  path: string;
  name: string;
}

export interface SelectedAttachment {
  selectionId?: string;
  path: string;
  name: string;
}

export interface CreateSessionRequestDto {
  source_selection_id: string;
  destination_selection_id: string;
  extra_instructions?: string;
  speaker_hints?: string[];
  extraction_options: ExtractionOptionsDto;
  session_date?: string;
  attachment_selection_ids?: string[];
  model?: AnalysisModelDto;
  effort?: AnalysisEffortDto;
}

export type AnalysisModelDto = 'gemini-3-flash-preview' | 'gemini-2.5-flash';
export type AnalysisEffortDto = 'minimal' | 'low' | 'medium' | 'high';

export interface ReviewUpdateDto {
  session_record_markdown?: string;
  session_date?: string;
  short_name?: string;
  speaker_renames?: Record<string, string>;
  snapshot_keeps?: Record<string, boolean>;
  phrase_corrections?: Array<{
    source_word_start: number;
    source_word_end: number;
    replacement: string;
  }>;
}

export interface AnalysisDeltaDto {
  attempt_id: string;
  delta: string;
  raw_stream: string;
}

export interface AnalysisErrorDto {
  attempt_id: string;
  message: string;
  raw_stream: string;
}

export interface PipelineErrorDto {
  message: string;
}

export interface SelectedSource {
  selectionId?: string;
  path: string;
  name: string;
  mediaKind: 'audio' | 'video';
}

export interface SelectedDestination {
  selectionId?: string;
  path: string;
  name: string;
}

export interface Speaker {
  id: string;
  initials: string;
  name: string;
  color?: string;
}

export interface Mention {
  id: string;
  tag: string;
  time: string;
  context: string;
  speakerLabel: string;
  sourceRanges: Array<{ sourceWordStart: number; sourceWordEnd: number }>;
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
  sessionDate?: string;
  markdown: string;
  speakers: Speaker[];
  mentions: Mention[];
  agentNotes: AgentNote[];
  filesystem: FileTreeNode[];
  snapshots?: Array<{
    filename: string;
    time: string;
    subject: string;
    cuePhrase: string;
    anchorWord: string;
    speakerLabel: string;
    kind: 'overview' | 'detail';
    imageUrl?: string;
    kept: boolean;
  }>;
}
