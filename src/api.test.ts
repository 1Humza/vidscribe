import { describe, expect, it, vi } from 'vitest';
import { createSession, executeSession } from './api';

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
