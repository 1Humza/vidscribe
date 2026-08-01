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

export type SessionStatus = 'ready' | 'processing' | 'review' | 'error';
export type SessionStage = 'intake' | 'preparing' | 'transcribing' | 'analyzing' | 'review';

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
  analysis_audio_path: string | null;
  transcript: string | null;
  session_date: string;
  attachment_paths: string[];
  attempts: AnalysisAttemptDto[];
  created_at: string;
  updated_at: string;
}

export interface SourcePickerSelectionDto {
  selection_id: string;
  path: string;
  name: string;
  media_kind: 'audio' | 'video';
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
}

export interface ReviewUpdateDto {
  session_record_markdown?: string;
  session_date?: string;
  short_name?: string;
  speaker_renames?: Record<string, string>;
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
  mentions: Mention[];
  agentNotes: AgentNote[];
  filesystem: FileTreeNode[];
}
