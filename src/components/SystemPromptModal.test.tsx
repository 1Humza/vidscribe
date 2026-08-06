import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SystemPromptModal from './SystemPromptModal';

describe('SystemPromptModal', () => {
  it('closes when the empty modal area around the centered prompt is clicked', () => {
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
    fireEvent.click(modalContentArea!);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
