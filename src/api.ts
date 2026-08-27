import type {
  AnalysisDeltaDto,
  AnalysisErrorDto,
  CreateSessionRequestDto,
  DestinationPickerSelectionDto,
  AttachmentPickerSelectionDto,
  AnalysisEffortDto,
  AnalysisModelDto,
  ExtractionOptionsDto,
  PipelineErrorDto,
  SessionViewDto,
  SourcePickerSelectionDto,
  ReviewUpdateDto,
  SystemPromptDto,
} from './types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const body = await response.json() as { detail?: string; message?: string };
      detail = body.detail || body.message || detail;
    } catch {
      // Retain the HTTP status when the service did not return JSON.
    }
    throw new Error(detail || 'The local service request failed.');
  }
  return response.json() as Promise<T>;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getSystemPrompt(): Promise<SystemPromptDto> {
  return requestJson('/api/system-prompt');
}

export function updateSystemPrompt(prompt: string): Promise<SystemPromptDto> {
  return requestJson('/api/system-prompt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export function pickSource(initialPath?: string): Promise<SourcePickerSelectionDto> {
  return postJson('/api/pickers/source', initialPath ? { initial_path: initialPath } : {});
}

export function selectSourcePath(path: string): Promise<SourcePickerSelectionDto> {
  return postJson('/api/pickers/source-path', { path });
}

export function pickCompletedSessionFolder(): Promise<SourcePickerSelectionDto> {
  return postJson('/api/pickers/completed-session', {});
}

export function openCompletedSession(sourceSelectionId: string): Promise<SessionViewDto> {
  return postJson('/api/sessions/open-completed', { source_selection_id: sourceSelectionId });
}

export async function openSourceSession(sourceSelectionId: string): Promise<SessionViewDto | null> {
  const response = await fetch(apiUrl('/api/sessions/open-source'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_selection_id: sourceSelectionId }),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.json() as Promise<SessionViewDto>;
}

export function pickDestination(initialPath?: string): Promise<DestinationPickerSelectionDto> {
  return postJson('/api/pickers/destination', initialPath ? { initial_path: initialPath } : {});
}

export function selectDestinationPath(path: string): Promise<DestinationPickerSelectionDto> {
  return postJson('/api/pickers/destination-path', { path });
}

export function pickAttachments(initialPath?: string): Promise<AttachmentPickerSelectionDto[]> {
  return postJson('/api/pickers/attachments', initialPath ? { initial_path: initialPath } : {});
}

export function createSession(input: {
  sourceSelectionId: string;
  destinationSelectionId?: string;
  extraInstructions: string;
  speakerHints?: string[];
  extractionOptions: ExtractionOptionsDto;
  sessionDate?: string;
  attachmentSelectionIds?: string[];
  model?: AnalysisModelDto;
  effort?: AnalysisEffortDto;
}): Promise<SessionViewDto> {
  const request: CreateSessionRequestDto = {
    source_selection_id: input.sourceSelectionId,
    destination_selection_id: input.destinationSelectionId,
    extra_instructions: input.extraInstructions || undefined,
    speaker_hints: input.speakerHints?.length ? input.speakerHints : undefined,
    extraction_options: input.extractionOptions,
    session_date: input.sessionDate || undefined,
    attachment_selection_ids: input.attachmentSelectionIds?.length ? input.attachmentSelectionIds : undefined,
    model: input.model,
    effort: input.effort,
  };
  return postJson('/api/sessions', request);
}

export function updateSessionDestination(sessionId: string, destinationSelectionId: string): Promise<SessionViewDto> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/destination`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination_selection_id: destinationSelectionId }),
  });
}

export function updateSessionIntake(sessionId: string, input: {
  extraInstructions: string;
  speakerHints: string[];
  extractionOptions: ExtractionOptionsDto;
  attachmentSelectionIds?: string[];
}): Promise<SessionViewDto> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/intake`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extra_instructions: input.extraInstructions,
      speaker_hints: input.speakerHints,
      extraction_options: input.extractionOptions,
      ...(input.attachmentSelectionIds ? { attachment_selection_ids: input.attachmentSelectionIds } : {}),
    }),
  });
}

export function updateReview(
  sessionId: string,
  attemptId: string,
  update: ReviewUpdateDto,
): Promise<SessionViewDto> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
}

export function commitSession(sessionId: string, attemptId: string): Promise<SessionViewDto> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/commit`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  );
}

export function snapshotUrl(sessionId: string, attemptId: string, filename: string): string {
  return apiUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/snapshots/${encodeURIComponent(filename)}`,
  );
}

export function getSession(id: string, signal?: AbortSignal): Promise<SessionViewDto> {
  return requestJson(`/api/sessions/${encodeURIComponent(id)}`, { signal });
}

export type SessionEvent =
  | { type: 'session' | 'complete'; data: SessionViewDto }
  | { type: 'analysis_delta'; data: AnalysisDeltaDto }
  | { type: 'analysis_error'; data: AnalysisErrorDto }
  | { type: 'pipeline_error'; data: PipelineErrorDto };

export type SessionEventHandler = (event: SessionEvent) => void;

function dispatchFrame(frame: string, onEvent: SessionEventHandler) {
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') type = value;
    if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return;
  const rawData = dataLines.join('\n');
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // Unknown diagnostic frames remain observable without terminating the stream.
  }
  switch (type) {
    case 'session':
    case 'complete':
      onEvent({ type, data: data as SessionViewDto });
      break;
    case 'analysis_delta':
      onEvent({ type, data: data as AnalysisDeltaDto });
      break;
    case 'analysis_error':
      onEvent({ type, data: data as AnalysisErrorDto });
      break;
    case 'pipeline_error':
      onEvent({ type, data: data as PipelineErrorDto });
      break;
  }
}

export async function executeSession(
  id: string,
  onEvent: SessionEventHandler,
  selection?: {
    model: AnalysisModelDto;
    effort: AnalysisEffortDto;
    extraInstructions?: string;
    speakerHints?: string[];
    extractionOptions?: ExtractionOptionsDto;
  },
  signal?: AbortSignal,
) {
  const body = selection
    ? JSON.stringify({
      model: selection.model,
      effort: selection.effort,
      ...(selection.extraInstructions !== undefined ? { extra_instructions: selection.extraInstructions } : {}),
      ...(selection.speakerHints !== undefined ? { speaker_hints: selection.speakerHints } : {}),
      ...(selection.extractionOptions !== undefined ? { extraction_options: selection.extractionOptions } : {}),
    })
    : undefined;
  const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/execute`), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`Execution failed (${response.status}).`);
  if (!response.body) throw new Error('The local service returned an empty event stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    frames.forEach((frame) => dispatchFrame(frame, onEvent));
    if (done) break;
  }
  if (buffer.trim()) dispatchFrame(buffer, onEvent);
}
