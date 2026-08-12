import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import GlassModal from './GlassModal';

it('closes only when a pointer starts and finishes on the modal backdrop', () => {
  const onClose = vi.fn();
  render(
    <GlassModal isOpen onClose={onClose} title="Preview">
      <button type="button">Widget control</button>
    </GlassModal>,
  );

  const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop="true"]');
  expect(backdrop).not.toBeNull();
  const widget = screen.getByRole('button', { name: 'Widget control' });

  fireEvent.pointerDown(widget, { pointerId: 1 });
  fireEvent.pointerUp(backdrop!, { pointerId: 1 });
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.pointerDown(backdrop!, { pointerId: 2 });
  fireEvent.pointerUp(backdrop!, { pointerId: 2 });
  expect(onClose).toHaveBeenCalledOnce();
});

it('closes when Escape is pressed', () => {
  const onClose = vi.fn();
  render(<GlassModal isOpen onClose={onClose} title="Preview">Content</GlassModal>);

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(onClose).toHaveBeenCalledOnce();
});
