import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SystemPromptModal from './SystemPromptModal';

describe('SystemPromptModal', () => {
  it('closes only when a pointer starts and finishes on the backdrop', () => {
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
    const modalContentArea = promptPanel?.parentElement;
    expect(modalContentArea).not.toBeNull();
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop="true"]');
    expect(backdrop).not.toBeNull();

    fireEvent.pointerDown(promptPanel!, { pointerId: 1 });
    fireEvent.pointerUp(backdrop!, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(modalContentArea!, { pointerId: 2 });
    fireEvent.pointerUp(modalContentArea!, { pointerId: 2 });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
