import { describe, expect, it, vi } from 'vitest';
import { commitSession, createSession, executeSession, getSystemPrompt, openCompletedSession, openSourceSession, pickCompletedSessionFolder, selectAttachmentPath, updateSystemPrompt } from './api';

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('executeSession', () => {
  it('parses split SSE frames and joins multiline data before dispatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
      'event: analysis_del',
      'ta\ndata: {"attempt_id":"a-1",\n',
      'data: "delta":"hello","raw_stream":"hello"}\n\n',
      'event: complete\ndata: {"id":"s-1","status":"review","stage":"review","progress":100,"source_path":"/in/a.mp4","destination_path":"/out","extra_instructions":"","extraction_options":{"action_summary":true,"topics":false,"chapters":true,"highlights":false},"analysis_audio_path":"/work/analysis.24k.ogg","transcript":"[00:00] Speaker 1: Hello","attempts":[],"created_at":"2026-07-31T12:00:00Z","updated_at":"2026-07-31T12:01:00Z"}\n\n',
    ])));
    const events: Array<{ type: string; data: unknown }> = [];

    await executeSession('s-1', (event) => { events.push(event); });

    expect(events[0]).toEqual({ type: 'analysis_delta', data: { attempt_id: 'a-1', delta: 'hello', raw_stream: 'hello' } });
    expect(events[1].type).toBe('complete');
  });

  it('reports an incomplete final frame instead of silently discarding it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
      'event: analysis_error\ndata: {"attempt_id":"a-1","message":"quota exceeded","raw_stream":"partial"}',
    ])));
    const events: Array<{ type: string; data: unknown }> = [];

    await executeSession('s-1', (event) => { events.push(event); });

    expect(events).toEqual([{ type: 'analysis_error', data: { attempt_id: 'a-1', message: 'quota exceeded', raw_stream: 'partial' } }]);
  });
});

describe('createSession', () => {
  it('maps the visual extraction controls to the canonical service contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createSession({
      sourceSelectionId: 'source-token',
      destinationSelectionId: 'destination-token',
      extraInstructions: '',
      extractionOptions: { action_summary: true, topics: false, chapters: true, highlights: false },
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      source_selection_id: 'source-token',
      destination_selection_id: 'destination-token',
      extraction_options: {
        action_summary: true,
        topics: false,
        chapters: true,
        highlights: false,
      },
    });
  });
});

describe('system prompts', () => {
  it('loads and saves the locally persisted system prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'Current rules', locked_contract: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'New rules', locked_contract: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSystemPrompt()).resolves.toEqual({ prompt: 'Current rules', locked_contract: {} });
    await expect(updateSystemPrompt('New rules')).resolves.toEqual({ prompt: 'New rules', locked_contract: {} });

    expect(fetchMock.mock.calls).toEqual([
      ['/api/system-prompt', undefined],
      ['/api/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'New rules' }),
      }],
    ]);
  });
});

describe('commitSession', () => {
  it('commits the selected reviewed attempt through the local service', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await commitSession('session id', 'attempt id');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session%20id/attempts/attempt%20id/commit',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
  });
});

describe('openCompletedSession', () => {
  it('reissues an attachment capability from its retained path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await selectAttachmentPath('/recordings/context.md');

    expect(fetchMock).toHaveBeenCalledWith('/api/pickers/attachment-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/recordings/context.md' }),
    });
  });

  it('opens the native completed-session folder picker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await pickCompletedSessionFolder();

    expect(fetchMock).toHaveBeenCalledWith('/api/pickers/completed-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('returns no Session when a selected Source Media is new', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(openSourceSession('source selection')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/open-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_selection_id: 'source selection' }),
    });
  });

  it('resolves a selected Completed Session Folder through the local service', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await openCompletedSession('folder selection');

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/open-completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_selection_id: 'folder selection' }),
    });
  });
});
