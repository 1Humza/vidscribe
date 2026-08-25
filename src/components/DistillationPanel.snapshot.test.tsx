import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DistillationPanel from './DistillationPanel';

it('uses the snapshot source word index when the cue phrase repeats', () => {
  const markdownText = [
    '## Snapshots',
    '',
    '- 00:20 — [03-door.jpg](03-door.jpg) — Door detail',
    '',
    '## Transcript',
    '',
    '[00:00] Speaker 1: Check the door.',
    '[00:10] Speaker 1: I will check the door.',
    '[00:20] Speaker 1: Check the door again.',
  ].join('\n');
  const view = render(
    <DistillationPanel
      result={{ title: 'Door demo', timestamp: 'Jun 25, 2026', markdown: markdownText, speakers: [], mentions: [], agentNotes: [], filesystem: [], snapshots: [] }}
      previewText=""
      isProcessing={false}
      processTime="00:00"
      stage="review"
      progress={100}
      markdownText={markdownText}
      setMarkdownText={vi.fn()}
      onSaveMarkdown={vi.fn()}
      highlightPhrase="check the door"
      highlightSourceWordIndex={10}
      saveStatus="idle"
      onSelectSource={vi.fn()}
      isReadOnly={false}
    />,
  );

  const editor = screen.getByLabelText('Session Record Markdown') as HTMLTextAreaElement;
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('[00:20] Speaker 1: Check the door again.');

  fireEvent.click(screen.getByRole('button', { name: 'RICH' }));
  const marks = [...view.container.querySelectorAll<HTMLElement>('[data-mention-highlight="true"]')];
  expect(marks).toHaveLength(1);
  expect(marks[0]).toHaveTextContent('Check the door again.');
});
