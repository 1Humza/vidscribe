import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SystemPromptModal from './SystemPromptModal';

describe('SystemPromptModal', () => {
  it('closes from the actual backdrop without competing with the close control', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        isOpen
        value="Prompt"
        lockedContract={{}}
        isLoading={false}
        isSaving={false}
        onClose={onClose}
        onSave={async () => {}}
      />,
    );

    const promptPanel = screen.getByRole('heading', { name: 'System prompt' }).closest('section');
    expect(promptPanel?.parentElement).toHaveClass('pointer-events-none');
    expect(promptPanel).toHaveClass('pointer-events-auto');
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(promptPanel!, { pointerId: 1 });
    fireEvent.pointerUp(backdrop!, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop!, { pointerId: 2 });
    fireEvent.pointerUp(backdrop!, { pointerId: 2 });

    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Close System Prompt' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
