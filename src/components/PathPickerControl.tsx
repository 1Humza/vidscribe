import { FolderOpen, X } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';

interface PathPickerControlProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (path: string) => Promise<boolean>;
  onPick: () => void | Promise<void>;
  inputLabel: string;
  submitLabel: string;
  pickerLabel: string;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  showSubmit?: boolean;
  showCancel?: boolean;
  closeOnBlur?: boolean;
  className?: string;
}

/** Shared path affordance used wherever a path can be pasted or chosen in Finder. */
export default function PathPickerControl({
  value,
  onChange,
  onSubmit,
  onPick,
  inputLabel,
  submitLabel,
  pickerLabel,
  placeholder,
  disabled = false,
  required = true,
  autoFocus = false,
  onCancel,
  cancelLabel = 'Cancel path',
  showSubmit = true,
  showCancel = true,
  closeOnBlur = false,
  className = '',
}: PathPickerControlProps) {
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!closeOnBlur || !onCancel) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) onCancel();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [closeOnBlur, onCancel]);

  const submit = async () => {
    const path = value.trim();
    if (!path || !await onSubmit(path)) return;
    onChange('');
    onCancel?.();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  return (
    <div
      ref={controlRef}
      onBlur={(event) => {
        if (closeOnBlur && onCancel && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          window.setTimeout(() => {
            if (!controlRef.current?.contains(document.activeElement)) onCancel();
          }, 0);
        }
      }}
      className={`flex items-center gap-1.5 rounded-xl border p-1.5 ${className}`}
    >
      <form onSubmit={handleSubmit} className="contents">
        <input
          autoFocus={autoFocus}
          required={required}
          aria-label={inputLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs font-mono text-main-canvas placeholder-muted-canvas/60 focus:outline-none"
        />
        {showSubmit && (
          <button type="submit" aria-label={submitLabel} disabled={disabled || (required && !value.trim())} className="rounded-lg bg-orange-500 p-1.5 text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">
            <span className="sr-only">{submitLabel}</span>
          </button>
        )}
      </form>
      <button type="button" aria-label={pickerLabel} onClick={() => void onPick()} disabled={disabled} className="rounded-lg p-1.5 text-muted-canvas hover:bg-input-canvas hover:text-main-canvas disabled:cursor-not-allowed disabled:opacity-50" title={pickerLabel}>
        <FolderOpen size={13} />
      </button>
      {showCancel && onCancel && (
        <button type="button" aria-label={cancelLabel} onClick={onCancel} disabled={disabled} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50">
          <X size={13} />
        </button>
      )}
    </div>
  );
}
