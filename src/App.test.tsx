import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { matchingMentionRanges } from './sessionReview';

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
  session_time: '12:00:00',
  attachment_paths: [],
  model: 'gemini-3-flash-preview',
  effort: 'medium',
  attempts: [],
  created_at: '2026-07-31T12:00:00Z',
  updated_at: '2026-07-31T12:00:00Z',
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
}

function noSourceSession() {
  return json({ detail: 'Session not found for Source Media' }, 404);
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

it('finds every case- and punctuation-insensitive mention occurrence in canonical words', () => {
  expect(matchingMentionRanges([
    { word: 'Slab.', start: 0, end: 0.1 },
    { word: 'slab', start: 0.1, end: 0.2 },
    { word: 'SLAB!', start: 0.2, end: 0.3 },
  ], 'Slab')).toEqual([
    { sourceWordStart: 0, sourceWordEnd: 0 },
    { sourceWordStart: 1, sourceWordEnd: 1 },
    { sourceWordStart: 2, sourceWordEnd: 2 },
  ]);
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
    expect(screen.getByRole('combobox', { name: 'Engine' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Engineering Sync: Database Migration sample preset (pending)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Product Design: Mobile App Redesign sample preset (pending)' })).toBeDisabled();
  });

  it('selects a source from a pasted absolute path', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-path-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video', size_bytes: 2048, duration_seconds: 125, source_date: '2026-07-31' }))
      .mockImplementationOnce(noSourceSession);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByRole('textbox', { name: 'Source path' }), session.source_path);
    await user.click(screen.getByRole('button', { name: 'Use source path' }));

    expect(await screen.findAllByText('team-sync.mp4')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled();
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ path: session.source_path }));
  });

  it('uses opaque picker selections, previews raw streaming, then promotes a validated result', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video', size_bytes: 2048, duration_seconds: 125, source_date: '2026-07-31' }))
      .mockImplementationOnce(noSourceSession)
      .mockImplementationOnce(() => json({ ...session, destination_path: null }, 201))
      .mockImplementationOnce(() => sse([
        `event: session\ndata: ${JSON.stringify({ ...session, destination_path: null, status: 'processing', stage: 'preparing', progress: 10 })}\n\n`,
        `event: session\ndata: ${JSON.stringify({ ...session, destination_path: null, status: 'processing', stage: 'transcribing', progress: 40 })}\n\n`,
        'event: analysis_delta\ndata: {"attempt_id":"attempt-1","delta":"{\\\"session_record_markdown\\\":\\\"# Team","raw_stream":"{\\\"session_record_markdown\\\":\\\"# Team"}\n\n',
        `event: complete\ndata: ${JSON.stringify({ ...session, destination_path: null, status: 'review', stage: 'review', progress: 100, transcript: '[00:00] Speaker 1: Hello', transcript_word_timings: [{ word: 'Use', start: 0, end: 0.1 }, { word: 'Slab.', start: 0.1, end: 0.2 }, { word: 'slab', start: 0.2, end: 0.3 }], attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-3-flash-preview', effort: 'medium', raw_stream: '{}', result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Team Sync', session_date: '07-31-2026', speaker_labels: ['Speaker 1'], mentions: [{ source_word_start: 1, source_word_end: 1 }, { source_word_start: 2, source_word_end: 2 }] }, error: null }] })}\n\n`,
      ]))
      .mockImplementationOnce(() => json({ selection_id: 'destination-token', path: session.destination_path, name: 'syncs' }))
      .mockImplementationOnce(() => json({ ...session, destination_path: session.destination_path }))
      .mockImplementationOnce(() => json({
        ...session,
        status: 'review',
        stage: 'review',
        progress: 100,
        session_date: '2026-08-01', session_time: '14:30:00',
        attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-2.5-flash', effort: 'low', raw_stream: '{}', error: null, result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Team Sync', session_date: '08-01-2026', speaker_labels: ['Speaker 1'] } }],
      }))
      .mockImplementationOnce(() => json({
        ...session,
        status: 'review',
        stage: 'review',
        progress: 100,
        session_date: '2026-08-01',
        model: 'gemini-2.5-flash',
        effort: 'low',
        attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-2.5-flash', effort: 'low', raw_stream: '{}', error: null, result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Renamed meeting', session_date: '08-01-2026', speaker_labels: ['Speaker 1'] } }],
      }))
      .mockImplementationOnce(() => json({
        ...session,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        session_date: '2026-08-01',
        model: 'gemini-2.5-flash',
        effort: 'low',
        source_path: '/archive/syncs/2026-08-01-renamed-meeting.mp4',
        analysis_audio_path: '/archive/syncs/2026-08-01-renamed-meeting.24k.ogg',
        completed_folder_path: '/archive/syncs/2026-08-01-renamed-meeting',
        attempts: [{ id: 'attempt-1', status: 'completed', model: 'gemini-2.5-flash', effort: 'low', raw_stream: '{}', error: null, result: { session_record_markdown: '# Team Sync\n\n(Silence 00:16)', short_name: 'Renamed meeting', session_date: '08-01-2026', speaker_labels: ['Speaker 1'] } }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Engine' })).toBeEnabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Effort' }), 'minimal');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Engine' }), 'gemini-2.5-flash');
    expect(screen.getByRole('combobox', { name: 'Effort' })).toHaveValue('low');
    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    expect(await screen.findAllByText('team-sync.mp4')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit source path' })).toHaveTextContent(session.source_path);
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    const review = await screen.findByRole('region', { name: 'Final Review' });
    expect(review).toHaveTextContent('(Silence 00:16)');
    expect(screen.getAllByRole('button', { name: 'Slab' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'RAW' }));
    await user.click(screen.getByRole('button', { name: 'Slab' }));
    expect(screen.getByRole('textbox', { name: 'Correct Slab' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByText('[2026-07-31] Team Sync')).toBeInTheDocument();
    expect(screen.getByText('[2026-07-31] Team Sync.md')).toBeInTheDocument();
    expect(screen.getByText('[2026-07-31] Team Sync.24k.ogg')).toBeInTheDocument();
    expect(screen.getByText('[2026-07-31] Team Sync.mp4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select Destination' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: 'Trash Source (pending)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Snapshots' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Session Record Markdown' })).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Session Date')).toHaveValue('2026-07-31T12:00');
    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vidscribe.activeSessionId')).toBe('session-1');
    const createRequest = fetchMock.mock.calls[2][1] as RequestInit;
    expect(JSON.parse(createRequest.body as string)).toMatchObject({
      source_selection_id: 'source-token',
      model: 'gemini-2.5-flash',
      effort: 'low',
    });
    const executeRequest = fetchMock.mock.calls[3][1] as RequestInit;
    expect(JSON.parse(executeRequest.body as string)).toMatchObject({
      model: 'gemini-2.5-flash',
      effort: 'low',
      extra_instructions: '',
      speaker_hints: [],
    });

    fireEvent.change(screen.getByLabelText('Session Date'), { target: { value: '2026-08-01T14:30' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(JSON.parse((fetchMock.mock.calls[6][1] as RequestInit).body as string)).toEqual({ session_date: '2026-08-01', session_time: '14:30' });
    expect(screen.getByLabelText('Session Date')).toHaveValue('2026-08-01T14:30');
    expect(screen.getByText('[2026-08-01] Team Sync')).toBeInTheDocument();

    const title = screen.getByLabelText('Short Name');
    await user.clear(title);
    await user.type(title, 'Renamed meeting{Enter}');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect((fetchMock.mock.calls[7][1] as RequestInit).method).toBe('PATCH');
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(9));
    const commitRequest = fetchMock.mock.calls[8][1] as RequestInit;
    expect(commitRequest.method).toBe('POST');
    expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Session Record Markdown' })).not.toHaveAttribute('readonly');
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
      .mockImplementationOnce(noSourceSession)
      .mockImplementationOnce(() => json({ ...session, destination_path: null }, 201))
      .mockImplementationOnce(() => Promise.resolve(openStream));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByRole('button', { name: 'Abort · Pending' })).toBeDisabled();
    finishStream?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled());
  });

  it('restores the active Session after a browser refresh', async () => {
    window.localStorage.setItem('vidscribe.activeSessionId', 'session-1');
    const hydrated = {
      ...session,
      source_size_bytes: 2048,
      source_duration_seconds: 125,
      source_date: '2026-07-31',
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
      .mockImplementationOnce(() => json(hydrated));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole('region', { name: 'Final Review' })).toHaveTextContent('Restored review');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByLabelText('Context and Instructions')).toHaveValue('Keep the executive summary concise.');
    expect(screen.getByRole('button', { name: 'Edit source path' })).toHaveTextContent(session.source_path);
    expect(screen.queryByRole('region', { name: 'Analysis Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-execute' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Remove Source' }));
    expect(screen.queryByRole('region', { name: 'Final Review' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });

  it('keeps unvalidated preview visible on generation failure without creating Final Review', async () => {
    const streamedPreview = '{"partial":"first\\nsecond"}';
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(noSourceSession)
      .mockImplementationOnce(() => json({ ...session, destination_path: null }, 201))
      .mockImplementationOnce(() => sse([
        `event: analysis_delta\ndata: ${JSON.stringify({ attempt_id: 'attempt-1', delta: streamedPreview, raw_stream: streamedPreview })}\n\n`,
        `event: analysis_error\ndata: ${JSON.stringify({ attempt_id: 'attempt-1', message: 'Provider connection failed', raw_stream: streamedPreview })}\n\n`,
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Select Source' }));
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

  it('restores a saved execution error after a browser refresh', async () => {
    window.localStorage.setItem('vidscribe.activeSessionId', 'session-1');
    const failure = 'Analysis generation stopped: Output folder was not selected.';
    const failedSession = {
      ...session,
      destination_path: null,
      status: 'error' as const,
      stage: 'analyzing' as const,
      progress: 65,
      transcript: '[00:00] Speaker 1: Restored transcript',
      attempts: [{
        id: 'attempt-1', status: 'error' as const, model: 'gemini-3-flash-preview', effort: 'high',
        raw_stream: '', result: null, error: failure,
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => json(failedSession)));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(failure);
  });

  it('copies the complete persistent execution error', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('vidscribe.activeSessionId', 'session-1');
    const failure = 'Analysis generation stopped: Gemini audio upload failed (RuntimeError: upload rejected). No analysis output was received.';
    const failedSession = {
      ...session,
      status: 'error' as const,
      attempts: [{ id: 'attempt-1', status: 'error' as const, model: 'gemini-3-flash-preview', effort: 'medium', raw_stream: '', result: null, error: failure }],
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => json(failedSession)));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(failure);
    await user.click(screen.getByRole('button', { name: 'Copy error' }));

    expect(writeText).toHaveBeenCalledWith(failure);
    expect(screen.getByRole('button', { name: 'Error copied' })).toBeInTheDocument();
  });

  it('clears a failed attempt preview as soon as a re-execution starts', async () => {
    const failedSession = {
      ...session,
      status: 'error' as const,
      stage: 'analyzing' as const,
      progress: 70,
      extra_instructions: 'Original instructions',
      transcript: '[00:00] Speaker 1: Retry this recording',
      attempts: [{
        id: 'attempt-1', status: 'error' as const, model: 'gemini-3-flash-preview', effort: 'medium',
        raw_stream: '{"partial":"stale preview"}', result: null, error: 'Analysis generation stopped.',
      }],
    };
    let closeStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const retryStream = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `event: session\ndata: ${JSON.stringify({ ...failedSession, status: 'processing', stage: 'preparing', progress: 10 })}\n\n`,
        ));
        closeStream = () => controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ selection_id: 'source-token', path: session.source_path, name: 'team-sync.mp4', media_kind: 'video' }))
      .mockImplementationOnce(() => json(failedSession))
      .mockImplementationOnce(() => Promise.resolve(retryStream));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Select Source' }));
    expect(await screen.findByRole('region', { name: 'Analysis Preview' })).toHaveTextContent('stale preview');
    const context = screen.getByRole('textbox', { name: 'Context and Instructions' });
    await user.clear(context);
    await user.type(context, 'Updated instructions');
    await user.click(screen.getByRole('button', { name: 'Execute' }));
    await waitFor(() => expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toMatchObject({
      extra_instructions: 'Updated instructions',
      speaker_hints: [],
    }));
    expect(context).toHaveValue('Updated instructions');
    await waitFor(() => {
      const preview = screen.queryByRole('region', { name: 'Analysis Preview' });
      expect(preview?.textContent || '').not.toContain('stale preview');
    });
    closeStream?.();
  });
});
