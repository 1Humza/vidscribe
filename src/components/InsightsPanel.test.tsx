import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import InsightsPanel from './InsightsPanel';

it('allows Final Review to remove a proposed Snapshot', async () => {
  const onSnapshotKeep = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial',
        timestamp: 'Jun 25, 2026',
        markdown: '## Snapshots',
        speakers: [],
        mentions: [],
        agentNotes: [],
        filesystem: [],
        snapshots: [{
          filename: '01-door-status.jpg',
          time: '00:01',
          subject: 'door status',
          cuePhrase: 'see this door',
          anchorWord: 'this',
          speakerLabel: 'Developer',
          kind: 'detail',
          imageUrl: '/api/snapshot.jpg',
          kept: true,
        }],
      }}
      onSaveIdentity={vi.fn()}
      onSaveSessionDate={vi.fn()}
      onRenameSpeaker={vi.fn()}
      onReviewEdit={vi.fn()}
      onSnapshotKeep={onSnapshotKeep}
      onMentionCorrect={vi.fn()}
      onMentionAdd={vi.fn(() => true)}
      onMentionSelect={vi.fn()}
      saveStatus="idle"
      onCommit={vi.fn()}
      canCommit
      isCommitPending={false}
      isReadOnly={false}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Remove 01-door-status.jpg' }));

  expect(onSnapshotKeep).toHaveBeenCalledWith('01-door-status.jpg', false);
  await user.click(within(view.container).getByRole('button', { name: '01-door-status.jpg 00:01 door status' }));
  expect(screen.getByLabelText('Snapshot evidence')).toHaveTextContent('see this door');
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Snapshot 1 of 1').parentElement).toHaveTextContent('1 / 1');
});

it('edits a terminology Mention tag without dismissing it', async () => {
  const onMentionCorrect = vi.fn();
  const onMentionSelect = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: '2-3', tag: 'reclass plug in', time: '01:50', context: 'I use the reclass plug in here', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 3 }] }],
        agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={onMentionCorrect} onMentionAdd={vi.fn(() => true)} onMentionSelect={onMentionSelect} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'reclass plug in' }));
  expect(onMentionSelect).toHaveBeenCalledWith('reclass plug in', 2);
  const input = screen.getByRole('textbox', { name: 'Correct reclass plug in' });
  await user.clear(input);
  await user.type(input, 'Reclass plugin{Enter}');

  expect(onMentionCorrect).toHaveBeenCalledWith([{ sourceWordStart: 2, sourceWordEnd: 3 }], 'Reclass plugin');
  expect(onMentionSelect).toHaveBeenLastCalledWith(null);
});

it('selects a terminology Mention while hovered and clears it on leave', async () => {
  const onMentionSelect = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: '2-3', tag: 'reclass plug in', time: '01:50', context: 'I use the reclass plug in here', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 3 }] }],
        agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={onMentionSelect} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const mention = within(view.container).getByRole('button', { name: 'reclass plug in' });
  await user.hover(mention);
  expect(onMentionSelect).toHaveBeenLastCalledWith('reclass plug in', 2);
  await user.unhover(mention);
  expect(onMentionSelect).toHaveBeenLastCalledWith(null);
});

it('hides a Mention tooltip while its tag is being edited', async () => {
  const user = userEvent.setup();
  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: '2-3', tag: 'reclass plug in', time: '01:50', context: 'I use the reclass plug in here', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 3 }] }],
        agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  const mention = query.getByRole('button', { name: 'reclass plug in' });
  await user.hover(mention);
  expect(screen.getAllByRole('tooltip').at(-1)).toBeInTheDocument();
  await user.click(mention);

  expect(query.getByRole('textbox', { name: 'Correct reclass plug in' })).toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('saves a manually changed title when focus leaves the field', () => {
  const onSaveIdentity = vi.fn();
  const view = render(
    <InsightsPanel
      result={{ title: 'Original title', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [], snapshots: [] }}
      onSaveIdentity={onSaveIdentity} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const title = within(view.container).getByRole('textbox', { name: 'Short Name' });
  fireEvent.change(title, { target: { value: 'Updated title' } });
  fireEvent.blur(title);

  expect(onSaveIdentity).toHaveBeenCalledWith('Updated title');
});

it('commits a Mention edit when focus leaves the editor', async () => {
  const onMentionCorrect = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: '2-3', tag: 'reclass plug in', time: '01:50', context: 'I use the reclass plug in here', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 3 }] }],
        agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={onMentionCorrect} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  await user.click(query.getByRole('button', { name: 'reclass plug in' }));
  const input = query.getByRole('textbox', { name: 'Correct reclass plug in' });
  await user.clear(input);
  await user.type(input, 'Reclass plugin');
  fireEvent.blur(input);

  expect(onMentionCorrect).toHaveBeenCalledWith([{ sourceWordStart: 2, sourceWordEnd: 3 }], 'Reclass plugin');
});

it('adds a Mention from a phrase in the transcript', async () => {
  const onMentionAdd = vi.fn(() => true);
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [], agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={onMentionAdd} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  await user.click(query.getByRole('button', { name: 'Add Mention' }));
  await user.type(query.getByRole('textbox', { name: 'Words as transcribed' }), 'reclass plug in');
  await user.type(query.getByRole('textbox', { name: 'Corrected mention' }), 'Reclass Plugin');
  await user.click(query.getByRole('button', { name: 'Save new Mention' }));

  expect(onMentionAdd).toHaveBeenCalledWith('reclass plug in', 'Reclass Plugin');
  expect(query.queryByRole('textbox', { name: 'Words as transcribed' })).not.toBeInTheDocument();
});

it('accepts an output folder from a pasted path', async () => {
  const onSelectDestinationPath = vi.fn(() => Promise.resolve(true));
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{ title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [], snapshots: [] }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} onSelectDestinationPath={onSelectDestinationPath} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  const outputPath = query.getByRole('textbox', { name: 'Output path' });
  await user.type(outputPath, '/Users/example/records');
  await user.keyboard('{Enter}');

  expect(onSelectDestinationPath).toHaveBeenCalledWith('/Users/example/records');
});

it('shows mention context immediately and marks the Snapshot anchor', async () => {
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: '2-3', tag: 'Slab', time: '02:10', context: 'I am going to rename it Slab now', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 3 }] }],
        agentNotes: [], filesystem: [], snapshots: [{ filename: '02-slab.jpg', time: '02:10', subject: 'Slab creation', cuePhrase: 'I am going to rename it Slab now', anchorWord: 'Slab', speakerLabel: 'Developer', kind: 'detail', kept: true }],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  await user.hover(query.getByRole('button', { name: 'Slab' }));
  const tooltip = screen.getAllByRole('tooltip').at(-1)!;
  expect(tooltip).toHaveClass('fixed');
  expect(tooltip).toHaveTextContent('02:10 — Developer');
  expect(tooltip).toHaveTextContent('I am going to rename it Slab now');
  await user.click(query.getByRole('button', { name: 'Preview Snapshots' }));
  expect(query.getByLabelText('Snapshot evidence').querySelector('strong')).toHaveTextContent('Slab');
});

it('cycles the bare snapshot viewer with arrow keys', async () => {
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [],
        snapshots: [
          { filename: '01-overview.jpg', time: '00:10', subject: 'Door overview', cuePhrase: 'look at the door overview', anchorWord: 'overview', speakerLabel: 'Developer', kind: 'overview', kept: true },
          { filename: '02-detail.jpg', time: '00:20', subject: 'Door detail', cuePhrase: 'here is the lock detail', anchorWord: 'detail', speakerLabel: 'Developer', kind: 'detail', kept: true },
        ],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  await user.click(query.getByRole('button', { name: 'Preview Snapshots' }));
  expect(query.getByLabelText('Snapshot evidence')).toHaveTextContent('look at the door overview');
  expect(query.getByText('1 / 2')).toBeInTheDocument();
  await user.keyboard('{ArrowRight}');
  expect(query.getByLabelText('Snapshot evidence')).toHaveTextContent('here is the lock detail');
  expect(query.getByText('2 / 2')).toBeInTheDocument();
});

it('renders an unclipped 1.5× snapshot hover layer and selects its transcript cue', async () => {
  const onMentionSelect = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [],
        snapshots: [{ filename: '01-door.jpg', time: '00:10', subject: 'Door detail', cuePhrase: 'look at this door', anchorWord: 'door', speakerLabel: 'Developer', kind: 'detail', kept: true }],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={onMentionSelect} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const snapshotButton = within(view.container).getByRole('button', { name: '00:10 Door detail' });
  const snapshotCard = snapshotButton.closest<HTMLElement>('[data-snapshot-card]');
  expect(snapshotCard).not.toBeNull();
  Object.defineProperty(snapshotCard!, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 100, top: 200, width: 80, height: 50 }),
  });
  fireEvent.pointerEnter(snapshotCard!);
  const hoverPreview = Array.from(document.querySelectorAll<HTMLElement>('[data-snapshot-hover-preview="true"]')).at(-1);
  expect(hoverPreview).not.toBeNull();
  expect(hoverPreview).toHaveStyle({ left: '80px', top: '187.5px', width: '120px', height: '75px' });
  expect(hoverPreview).toHaveClass('fixed');
  expect(hoverPreview).not.toHaveClass('pointer-events-none');
  expect(onMentionSelect).toHaveBeenLastCalledWith('look at this door');

  await user.click(snapshotButton);
  expect(document.querySelector('[data-snapshot-hover-preview="true"]')).not.toBeInTheDocument();
  expect(onMentionSelect).toHaveBeenCalledWith('look at this door');
});

it('mutes a rejected Snapshot thumbnail but restores it in the hover preview', () => {
  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [],
        snapshots: [{ filename: '01-rejected.jpg', time: '00:10', subject: 'Rejected frame', cuePhrase: 'look at the rejected frame', anchorWord: 'rejected', speakerLabel: 'Developer', kind: 'detail', kept: false, imageUrl: '/api/rejected.jpg' }],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const thumbnail = view.getByAltText('01-rejected.jpg');
  expect(thumbnail).toHaveClass('opacity-35');
  fireEvent.pointerEnter(thumbnail.closest<HTMLElement>('[data-snapshot-card]')!);
  const hoverPreview = Array.from(document.querySelectorAll<HTMLElement>('[data-snapshot-hover-preview="true"]')).at(-1);
  expect(hoverPreview?.querySelector('img')).not.toHaveClass('opacity-35');
});

it('denies a Snapshot from the full viewer without closing it', async () => {
  const onSnapshotKeep = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [], mentions: [], agentNotes: [], filesystem: [],
        snapshots: [{ filename: '01-door.jpg', time: '00:10', subject: 'Door detail', cuePhrase: 'look at this door', anchorWord: 'door', speakerLabel: 'Developer', kind: 'detail', kept: true, imageUrl: '/api/door.jpg' }],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={onSnapshotKeep}
      onMentionCorrect={vi.fn()} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  await user.click(view.getByRole('button', { name: '00:10 Door detail' }));
  const denyButtons = screen.getAllByRole('button', { name: 'Remove 01-door.jpg' });
  await user.click(denyButtons.at(-1)!);

  expect(onSnapshotKeep).toHaveBeenCalledWith('01-door.jpg', false);
  expect(screen.getAllByAltText('01-door.jpg')).toHaveLength(2);
});

it('applies one mention correction to every grouped source range', async () => {
  const onMentionCorrect = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <InsightsPanel
      result={{
        title: 'Door System Tutorial', timestamp: 'Jun 25, 2026', markdown: '## Transcript', speakers: [],
        mentions: [{ id: 'slab', tag: 'Slab', time: '02:10', context: 'I am going to rename it Slab now', speakerLabel: 'Developer', sourceRanges: [{ sourceWordStart: 2, sourceWordEnd: 2 }, { sourceWordStart: 9, sourceWordEnd: 9 }] }],
        agentNotes: [], filesystem: [], snapshots: [],
      }}
      onSaveIdentity={vi.fn()} onSaveSessionDate={vi.fn()} onRenameSpeaker={vi.fn()} onReviewEdit={vi.fn()} onSnapshotKeep={vi.fn()}
      onMentionCorrect={onMentionCorrect} onMentionAdd={vi.fn(() => true)} onMentionSelect={vi.fn()} saveStatus="idle" onCommit={vi.fn()} canCommit isCommitPending={false} isReadOnly={false}
    />,
  );

  const query = within(view.container);
  await user.click(query.getByRole('button', { name: 'Slab' }));
  await user.type(query.getByRole('textbox', { name: 'Correct Slab' }), '{End} surface{Enter}');

  expect(onMentionCorrect).toHaveBeenCalledWith(
    [{ sourceWordStart: 2, sourceWordEnd: 2 }, { sourceWordStart: 9, sourceWordEnd: 9 }],
    'Slab surface',
  );
});
