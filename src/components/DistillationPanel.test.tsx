import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DistillationPanel from './DistillationPanel';

it('keeps Raw review active and selects the complete matching transcript turn', () => {
  const scrollIntoView = vi.fn();
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  const view = render(
    <DistillationPanel
      result={{ title: 'Door demo', timestamp: 'Jun 25, 2026', markdown: '', speakers: [], mentions: [], agentNotes: [], filesystem: [], snapshots: [] }}
      previewText=""
      isProcessing={false}
      processTime="00:00"
      stage="review"
      progress={100}
      markdownText={'## Snapshots\n\n- 00:10 — [01-door.jpg](01-door.jpg) — Slab\n\n## Transcript\n\nSlab is ready. The slab is visible.'}
      setMarkdownText={vi.fn()}
      onSaveMarkdown={vi.fn()}
      highlightPhrase="Slab"
      saveStatus="idle"
      onSelectSource={vi.fn()}
      isReadOnly={false}
    />,
  );

  expect(screen.getByRole('button', { name: 'RAW' })).toHaveClass('bg-panel-canvas');
  const editor = screen.getByLabelText('Session Record Markdown') as HTMLTextAreaElement;
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('Slab is ready. The slab is visible.');
  expect(view.container.querySelectorAll('[data-mention-highlight="true"]')).toHaveLength(0);
  expect(scrollIntoView).not.toHaveBeenCalled();
  if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalDescriptor);
  else delete (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
});
