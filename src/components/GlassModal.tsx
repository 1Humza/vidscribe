/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
  minimal?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  'full': 'max-w-[96vw]'
};

export default function GlassModal({ isOpen, onClose, title, children, size = 'lg', minimal = false }: GlassModalProps) {
  const backdropPointerId = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onPointerDownCapture={(event) => {
            backdropPointerId.current = (event.target as HTMLElement).dataset.modalBackdrop === 'true'
              ? event.pointerId
              : null;
          }}
          onPointerUpCapture={(event) => {
            const completedOnBackdrop = (event.target as HTMLElement).dataset.modalBackdrop === 'true';
            if (backdropPointerId.current === event.pointerId && completedOnBackdrop) onClose();
            backdropPointerId.current = null;
          }}
          onPointerCancelCapture={() => {
            backdropPointerId.current = null;
          }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-modal-backdrop="true"
            className="absolute inset-0 bg-black/45 dark:bg-black/75 backdrop-blur-sm"
          />

          {/* Modal Content Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className={`relative w-full ${sizeClasses[size]} z-10 ${minimal ? '' : 'overflow-hidden rounded-xl border border-muted-canvas bg-panel-canvas p-5 shadow-xl'}`}
          >
            {!minimal && (
              <div className="flex items-center justify-between border-b border-muted-canvas pb-3 mb-3">
                <h3 className="font-sans font-semibold text-sm text-main-canvas tracking-tight">{title}</h3>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {/* Body */}
            <div className={minimal ? '' : 'text-muted-canvas text-xs font-sans'}>
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
