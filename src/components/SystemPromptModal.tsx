import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, LockKeyhole, Save, X } from 'lucide-react';
import GlassModal from './GlassModal';

interface SystemPromptModalProps {
  isOpen: boolean;
  value: string;
  lockedContract: Record<string, unknown> | null;
  isLoading: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (prompt: string) => Promise<void>;
}

export default function SystemPromptModal({ isOpen, value, lockedContract, isLoading, isSaving, onClose, onSave }: SystemPromptModalProps) {
  const [draft, setDraft] = useState(value);
  const [isContractOpen, setIsContractOpen] = useState(false);
  const contractRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setDraft(value);
    else setIsContractOpen(false);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isContractOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!contractRef.current?.contains(event.target as Node)) setIsContractOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [isContractOpen]);

  const save = async () => {
    if (!draft.trim() || isSaving) return;
    await onSave(draft);
  };

  return (
    <GlassModal isOpen={isOpen} onClose={onClose} title="System prompt" size="full" minimal>
      <div className="pointer-events-none relative mx-auto h-[82vh] w-full">
        <section className="pointer-events-auto mx-auto flex h-full w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-muted-canvas bg-panel-canvas shadow-2xl">
          <header className="flex items-center justify-between gap-5 px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-main-canvas">System prompt</h2>
              <p className="mt-0.5 text-xs text-muted-canvas">Focus workspace · edit every authoring instruction that shapes the output.</p>
            </div>
            <button
              type="button"
              aria-label="Close System Prompt"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-canvas transition-colors hover:bg-input-canvas hover:text-main-canvas"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-y border-muted-canvas px-6 py-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-canvas">Authoring instructions</span>
            <span className="text-[11px] text-muted-canvas">{draft.length.toLocaleString()} characters · ⌘/Ctrl + Enter to save</span>
          </div>

          <textarea
            aria-label="System Prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
            disabled={isLoading || isSaving}
            placeholder="Describe the system behavior you want Vidscribe to follow…"
            className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-mono text-[13px] leading-7 text-main-canvas outline-none placeholder:text-muted-canvas/60 disabled:opacity-60"
          />

          <footer className="flex items-center justify-between gap-4 border-t border-muted-canvas px-6 py-4">
            <p className="text-xs text-muted-canvas">Saved locally · applies to the next analysis</p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isLoading || isSaving || !draft.trim()}
              className="accent-button inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <span className="animate-pulse">Saving…</span> : <><Save size={15} />Save prompt</>}
            </button>
          </footer>
        </section>

        <aside className="pointer-events-auto absolute top-0 left-1/2 ml-[370px] hidden max-h-full w-[280px] overflow-y-auto rounded-2xl border border-muted-canvas bg-panel-canvas px-6 py-6 shadow-xl xl:block">
          <div className="space-y-2 border-b border-muted-canvas pb-6">
            <div className="flex items-center gap-2 text-main-canvas">
              <FileText size={15} className="text-orange-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider">Format formula</h3>
            </div>
            <p className="pt-2 text-xs leading-relaxed text-muted-canvas">Finder folder</p>
            <code className="block break-all font-mono text-xs text-orange-600 dark:text-orange-400">[YYYY-MM-DD] {'{short_name}'}</code>
            <p className="pt-3 text-xs leading-relaxed text-muted-canvas">Record header</p>
            <code className="block font-mono text-xs text-orange-600 dark:text-orange-400">📝 **{'{title}'}** · {'{MM-DD-YYYY}'}</code>
            <p className="pt-3 text-xs leading-relaxed text-muted-canvas">Use a concise human title. The server preserves it in Finder folder and asset names.</p>
          </div>

          <div ref={contractRef} className="pt-6">
            <button
              type="button"
              aria-expanded={isContractOpen}
              onClick={() => setIsContractOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-main-canvas"
            >
              <span className="flex items-center gap-2">
              <LockKeyhole size={14} className="text-orange-500" />
              JSON Contract
              </span>
              <ChevronDown size={14} className={`text-muted-canvas transition-transform ${isContractOpen ? 'rotate-180' : ''}`} />
            </button>
            {isContractOpen && <>
              <p className="mt-3 text-xs leading-relaxed text-muted-canvas">The JSON response schema, session inputs, and timed-word evidence remain server-enforced.</p>
              {lockedContract && (
                <pre className="mt-3 max-h-[56vh] overflow-x-auto overflow-y-auto whitespace-pre font-mono text-[11px] leading-5 text-muted-canvas">
                  {JSON.stringify(lockedContract, null, 2)}
                </pre>
              )}
            </>}
          </div>
        </aside>
      </div>
    </GlassModal>
  );
}
