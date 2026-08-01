import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const session = {
  id: 'session-1',
  status: 'ready' as const,
  stage: 'intake' as const,
  progress: 0,
  source_path: '/recordings/team-sync.mp4',
  destination_path: '/archive/syncs',
  extra_instructions: '',
  speaker_hints: [],
  extraction_options: { action_summary: true, topics: false, chapters: true, highlights: false },
  analysis_audio_path: null,
  transcript: null,
  session_date: '2026-07-31',
  attachment_paths: [],
  attempts: [],
  created_at: '2026-07-31T12:00:00Z',
  updated_at: '2026-07-31T12:00:00Z',
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
}

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('issue 2 session UI', () => {
  it('preserves the original two-stage intake and distillation workspace', () => {
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Speech Distiller' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Distillation Workspace' })).toBeInTheDocument();
    expect(screen.getByText('Quiet Distillation Center')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Insights & Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach reference files' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Engine' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Engineering Sync: Database Migration sample preset (pending)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Product Design: Mobile App Redesign sample preset (pending)' })).toBeDisabled();
  });

  it('uses opaque picker selections, previews raw streaming, then promotes a validated result', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(() => json({ selection_id: 'destination-token', path: session.destination_path, name: 'syncs', media_kind: null }))
      .mockImplementationOnce(() => json(session, 201))
      .mockImplementationOnce(() => sse([
        `event: session\ndata: ${JSON.stringify({ ...session, status: 'processing', stage: 'preparing', progress: 10 })}\n\n`,
        `event: session\ndata: ${JSON.stringify({ ...session, status: 'processing', stage: 'transcribing', progress: 40 })}\n\n`,
        'event: analysis_delta\ndata: {"attempt_id":"attempt-1","delta":"{\\\"session_record_markdown\\\":\\\"# Team","raw_stream":"{\\\"session_record_markdown\\\":\\\"# Team"}\n\n',
        `event: complete\ndata: ${JSON.stringify({ ...session, status: 'review', stage: 'review', progress: 100, transcript: '[00:00] Speaker 1: Hello', attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-3-flash-preview', effort: 'medium', raw_stream: '{}', result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Team Sync', session_date: '07-31-2026', speaker_labels: ['Speaker 1'] }, error: null }] })}\n\n`,
      ]))
      .mockImplementationOnce(() => json({
        ...session,
        status: 'review',
        stage: 'review',
        progress: 100,
        attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-3-flash-preview', effort: 'medium', raw_stream: '{}', error: null, result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Renamed meeting', session_date: '07-31-2026', speaker_labels: ['Speaker 1'] } }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Engine' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    await screen.findByText('team-sync.mp4');
    await user.click(screen.getByRole('button', { name: 'Select Destination' }));
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    const review = await screen.findByRole('region', { name: 'Final Review' });
    expect(review).toHaveTextContent('(Silence 00:16)');
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Trash Source (pending)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Snapshots (pending)' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Session Record Markdown' })).not.toHaveAttribute('readonly');
    expect(screen.queryByLabelText('Session Date')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Timestamp')).toHaveTextContent('Jul 31, 2026');
    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vidscribe.activeSessionId')).toBe('session-1');
    const createRequest = fetchMock.mock.calls[2][1] as RequestInit;
    expect(JSON.parse(createRequest.body as string)).toMatchObject({
      source_selection_id: 'source-token',
      destination_selection_id: 'destination-token',
    });

    const title = screen.getByLabelText('Short Name');
    await user.clear(title);
    await user.type(title, 'Renamed meeting{Enter}');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect((fetchMock.mock.calls[4][1] as RequestInit).method).toBe('PATCH');
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
  });

  it('keeps cancellation visible but pending until durable cancellation exists', async () => {
    let finishStream: (() => void) | undefined;
    const openStream = new Response(new ReadableStream({
      start(controller) {
        finishStream = () => controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(() => json({ selection_id: 'destination-token', path: session.destination_path, name: 'syncs', media_kind: null }))
      .mockImplementationOnce(() => json(session, 201))
      .mockImplementationOnce(() => Promise.resolve(openStream));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    await user.click(screen.getByRole('button', { name: 'Select Destination' }));
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByRole('button', { name: 'Abort · Pending' })).toBeDisabled();
    finishStream?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled());
  });

  it('keeps a saved session cleared until the same source is selected again', async () => {
    window.localStorage.setItem('vidscribe.activeSessionId', 'session-1');
    const hydrated = {
      ...session,
      extra_instructions: 'Keep the executive summary concise.\nSpeaker hints: Alex, Sam',
      speaker_hints: [],
      status: 'review' as const,
      stage: 'review' as const,
      progress: 100,
      transcript: '[00:00] Speaker 1: Restored',
      attempts: [{
        id: 'attempt-1', status: 'completed' as const, model: 'gemini-3-flash-preview', effort: 'medium', raw_stream: '{}', error: null,
        result: { session_record_markdown: '# Restored review', short_name: 'Restored review', session_date: '07-31-2026', speaker_labels: ['Speaker 1'] },
      }],
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(() => json(hydrated));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    expect(await screen.findByRole('region', { name: 'Final Review' })).toHaveTextContent('Restored review');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByLabelText('Context and Instructions')).toHaveValue('Keep the executive summary concise.');
    expect(screen.getByText(/video • size pending • duration pending • date pending/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Source' }));
    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });

  it('keeps unvalidated preview visible on generation failure without creating Final Review', async () => {
    const streamedPreview = '{"partial":"first\\nsecond"}';
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(() => json({ selection_id: 'destination-token', path: session.destination_path, name: 'syncs', media_kind: null }))
      .mockImplementationOnce(() => json(session, 201))
      .mockImplementationOnce(() => sse([
        `event: analysis_delta\ndata: ${JSON.stringify({ attempt_id: 'attempt-1', delta: streamedPreview, raw_stream: streamedPreview })}\n\n`,
        `event: analysis_error\ndata: ${JSON.stringify({ attempt_id: 'attempt-1', message: 'Provider connection failed', raw_stream: streamedPreview })}\n\n`,
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    await user.click(screen.getByRole('button', { name: 'Select Destination' }));
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    const preview = await screen.findByRole('region', { name: 'Analysis Preview' });
    expect(preview).toHaveTextContent('partial');
    expect(preview.querySelector('pre')?.textContent).toContain('first\nsecond');
    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Provider connection failed');
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Analysis Preview' })).toHaveTextContent('partial');
  });
});
