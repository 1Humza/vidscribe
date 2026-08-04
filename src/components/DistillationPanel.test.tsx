import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DistillationPanel from './DistillationPanel';

it('highlights every selected mention in rich review without a document navigation target', () => {
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

  expect(screen.getByRole('button', { name: 'RICH' })).toHaveClass('bg-panel-canvas');
  expect(view.container.querySelectorAll('[data-mention-highlight="true"]')).toHaveLength(3);
});
