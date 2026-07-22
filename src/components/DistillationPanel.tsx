/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Download,
  Activity,
  Volume2,
  Video,
  Globe,
  Layers,
  ArrowRight
} from 'lucide-react';
import { SourceFile, DistillationResult, SampleSession } from '../types';

interface DistillationPanelProps {
  source: SourceFile | null;
  result: DistillationResult | null;
  setResult: React.Dispatch<React.SetStateAction<DistillationResult | null>>;
  isProcessing: boolean;
  processTime: string;
  samples: SampleSession[];
  onLoadSample: (sampleId: string) => void;
  triggerFileSelect: () => void;
  markdownText: string;
  setMarkdownText: (text: string) => void;
}

export default function DistillationPanel({
  source,
  result,
  setResult,
  isProcessing,
  processTime,
  samples,
  onLoadSample,
  triggerFileSelect,
  markdownText,
  setMarkdownText
}: DistillationPanelProps) {
  const [viewMode, setViewMode] = useState<'rich' | 'raw'>('rich');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdownText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdownText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result?.title || 'distillation'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Renders markdown content to HTML with quiet room styles and interactive checkboxes
  const renderRichMarkdown = (md: string) => {
    if (!md) return null;

    // Filter out frontmatter block
    let cleanedMd = md;
    if (md.startsWith('---')) {
      const parts = md.split('---');
      if (parts.length >= 3) {
        cleanedMd = parts.slice(2).join('---').trim();
      }
    }

    const lines = cleanedMd.split('\n');
    let inQuote = false;
    let quoteLines: string[] = [];

    const renderedElements = lines.map((line, idx) => {
      const trimmed = line.trim();

      // Blockquote handler
      if (trimmed.startsWith('>')) {
        inQuote = true;
        quoteLines.push(trimmed.replace(/^>\s*/, ''));
        return null;
      } else if (inQuote && trimmed === '') {
        // flush quote
        inQuote = false;
        const quoteContent = quoteLines.join('\n');
        quoteLines = [];
        return (
          <blockquote key={`q-${idx}`} className="border-l-2 border-muted-canvas pl-4 py-1.5 my-4 bg-input-canvas/40 italic text-muted-canvas font-sans text-sm leading-relaxed">
            {quoteContent}
          </blockquote>
        );
      }

      if (inQuote) {
        quoteLines.push(trimmed);
        return null;
      }

      // Headers
      if (trimmed.startsWith('# ')) {
        return (
          <h1 key={idx} className="text-xl font-sans font-bold text-main-canvas tracking-tight mt-6 mb-4">
            {trimmed.substring(2)}
          </h1>
        );
      }
      if (trimmed.startsWith('## ')) {
        return (
          <h2 key={idx} className="text-sm font-sans font-bold tracking-wider text-muted-canvas uppercase mt-5 mb-2.5 border-b border-muted-canvas pb-1.5">
            {trimmed.substring(3)}
          </h2>
        );
      }
      if (trimmed.startsWith('### ')) {
        return (
          <h3 key={idx} className="text-xs font-sans font-semibold tracking-wide text-main-canvas uppercase mt-4 mb-2">
            {trimmed.substring(4)}
          </h3>
        );
      }

      // Checkboxes (- [ ] or - [x])
      if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [ ]') || trimmed.startsWith('- [X]')) {
        const isChecked = trimmed.toLowerCase().startsWith('- [x]');
        const text = trimmed.substring(5).trim();

        // Parse bold and metadata in checklist items
        const parts = text.split('**');
        let renderedText: React.ReactNode = text;
        if (parts.length >= 3) {
          renderedText = (
            <span>
              <strong>{parts[1]}</strong>
              {parts.slice(2).join('')}
            </span>
          );
        }

        // Action items checklist checkbox toggle
        const handleCheckboxToggle = () => {
          const linesCopy = [...lines];
          const absoluteIndex = cleanedMd.split('\n').indexOf(line);
          if (absoluteIndex !== -1) {
            const currentLine = linesCopy[absoluteIndex];
            if (currentLine.includes('- [ ]')) {
              linesCopy[absoluteIndex] = currentLine.replace('- [ ]', '- [x]');
            } else {
              linesCopy[absoluteIndex] = currentLine.replace('- [x]', '- [ ]');
            }
            const reassembled = md.startsWith('---') 
              ? md.split('---').slice(0, 2).join('---') + '---\n\n' + linesCopy.join('\n')
              : linesCopy.join('\n');
            setMarkdownText(reassembled);
          }
        };

        return (
          <div key={idx} className="flex items-start space-x-3 my-2.5 pl-0.5 group cursor-pointer select-none" onClick={handleCheckboxToggle}>
            <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
              isChecked 
                ? 'bg-main-canvas border-active-canvas text-app-canvas' 
                : 'border-muted-canvas group-hover:border-active-canvas text-transparent'
            }`}>
              <Check size={12} className={isChecked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'} />
            </div>
            <span className={`text-sm font-sans leading-relaxed transition-all ${
              isChecked ? 'text-muted-canvas line-through' : 'text-main-canvas'
            }`}>
              {renderedText}
            </span>
          </div>
        );
      }

      // Standard lists
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        const text = trimmed.substring(2);
        return (
          <li key={idx} className="list-none flex items-start space-x-2 my-2 text-sm text-muted-canvas pl-0.5">
            <span className="mt-2 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-muted-canvas" />
            <span>{text}</span>
          </li>
        );
      }

      // Paragraphs or numbers
      if (trimmed !== '') {
        // Is it numbered?
        const matchNumber = trimmed.match(/^(\d+)\.\s(.*)/);
        if (matchNumber) {
          return (
            <div key={idx} className="flex items-start space-x-2.5 my-2.5 text-sm text-muted-canvas font-sans pl-0.5">
              <span className="font-mono text-main-canvas text-xs font-semibold">{matchNumber[1]}.</span>
              <span>{matchNumber[2]}</span>
            </div>
          );
        }

        return (
          <p key={idx} className="text-sm text-muted-canvas font-sans leading-relaxed my-2.5">
            {trimmed}
          </p>
        );
      }

      return <div key={idx} className="h-1.5" />;
    });

    return <div className="space-y-0.5">{renderedElements}</div>;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-panel-canvas rounded-xl border border-muted-canvas shadow-sm">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-muted-canvas px-4 py-3 bg-input-canvas/30">
        <div className="flex items-center space-x-2">
          <Layers size={14} className="text-muted-canvas" />
          <h2 className="font-sans font-semibold text-xs tracking-wider text-muted-canvas uppercase">Document</h2>
        </div>

        {/* State Toggle & Buttons */}
        {result || isProcessing ? (
          <div className="flex items-center space-x-3.5">
            {/* Rich / Raw mode toggles */}
            <div className="flex bg-input-canvas p-0.5 rounded border border-muted-canvas text-xs font-mono">
              <button
                onClick={() => setViewMode('rich')}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                  viewMode === 'rich'
                    ? 'bg-panel-canvas text-main-canvas font-semibold shadow-sm'
                    : 'text-muted-canvas hover:text-main-canvas'
                }`}
              >
                RICH
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                  viewMode === 'raw'
                    ? 'bg-panel-canvas text-main-canvas font-semibold shadow-sm'
                    : 'text-muted-canvas hover:text-main-canvas'
                }`}
              >
                RAW
              </button>
            </div>

            {/* Live Streaming Indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-input-canvas border border-muted-canvas text-xs font-mono text-muted-canvas">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-main-canvas opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-main-canvas"></span>
              </span>
              <span>{isProcessing ? `DISTILLING • ${processTime}` : 'DISTILLED'}</span>
            </div>

            {/* Action Tools */}
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
              title="Copy markdown"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
            <button
              onClick={handleDownload}
              className="p-1 rounded hover:bg-input-canvas text-muted-canvas hover:text-main-canvas transition-colors cursor-pointer"
              title="Download markdown"
            >
              <Download size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-input-canvas/50 border border-muted-canvas text-xs font-mono text-muted-canvas uppercase">
            <span>IDLE</span>
          </div>
        )}
      </div>

      {/* Content Container */}
      <div className="flex-1 overflow-y-auto p-4 min-h-[300px]">
        {isProcessing && !result ? (
          /* Processing/Streaming Loader State - ultra clean, quiet styling */
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] py-12">
            <div className="relative flex items-center justify-center w-16 h-16 mb-5">
              <div className="absolute w-12 h-12 border border-dashed border-muted-canvas rounded-full animate-[spin_8s_linear_infinite]" />
              <div className="absolute w-16 h-16 border border-t-main-canvas border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
              <Activity size={20} className="text-muted-canvas animate-pulse" />
            </div>

            <div className="font-mono text-xs tracking-widest text-main-canvas font-bold mb-1">
              DISTILLING SOURCE...
            </div>
            <div className="text-xs font-mono text-muted-canvas">
              Time Elapsed: {processTime}
            </div>

            {/* Immersive transcription log scroll */}
            <div className="w-full max-w-md mt-6 p-3 rounded-xl bg-input-canvas border border-muted-canvas/60 text-xs font-mono text-muted-canvas/80 space-y-1 h-[100px] flex flex-col justify-end">
              <div>&gt; Syncing speech token buffers... [OK]</div>
              <div>&gt; Extracting semantic waveforms... [OK]</div>
              <div>&gt; Running custom prompt pipeline...</div>
              <div className="text-main-canvas animate-pulse">&gt; Distilling active chapters and compiling agent notes...</div>
            </div>
          </div>
        ) : result ? (
          /* Report Complete State */
          <div className="relative">
            {isProcessing && (
              <div className="mb-4 p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-mono uppercase tracking-wider flex items-center justify-between select-none animate-pulse">
                <span className="flex items-center space-x-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  <span>Streaming dynamic neural distillation...</span>
                </span>
                <span>{processTime}</span>
              </div>
            )}
            {viewMode === 'rich' ? (
              <div className="prose prose-sm max-w-none text-main-canvas select-text font-sans">
                {renderRichMarkdown(markdownText)}
              </div>
            ) : (
              <textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                className="w-full h-[65vh] lg:h-[calc(100vh-260px)] min-h-[450px] bg-input-canvas/50 text-sm font-mono text-main-canvas p-4 rounded border border-muted-canvas focus:outline-none focus:border-active-canvas leading-relaxed resize-none transition-colors"
              />
            )}
          </div>
        ) : (
          /* Empty / Initial Dropzone & Sample Syncs State - Quiet Linen style */
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            {/* Elegant Low Key Visual Icon stacking */}
            <div className="relative flex items-center justify-center w-32 h-32 mb-6 select-none">
              <div className="absolute w-20 h-20 rotate-[15deg] rounded bg-input-canvas border border-muted-canvas/60" />
              <div className="absolute w-20 h-20 rotate-[45deg] rounded bg-input-canvas/50 border border-muted-canvas/40" />
              <div className="absolute w-20 h-20 rotate-[75deg] rounded bg-input-canvas/20 border border-muted-canvas/20" />
              <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-input-canvas border border-muted-canvas text-muted-canvas">
                <Volume2 size={18} className="animate-pulse" />
              </div>
            </div>

            <h1 className="font-sans font-bold text-base text-main-canvas tracking-tight mb-2">
              Quiet Distillation Center
            </h1>
            <p className="font-sans text-sm text-muted-canvas max-w-md leading-relaxed mb-6">
              Consolidate spoken dialogs and media frames into structured layouts. Load a sample preset below or drop a source to begin.
            </p>

            <button
              onClick={triggerFileSelect}
              className="px-5 py-2 rounded border border-muted-canvas hover:border-active-canvas bg-input-canvas hover:bg-input-canvas/80 text-main-canvas font-sans font-semibold text-xs tracking-wider uppercase transition-all duration-200 mb-8 cursor-pointer"
            >
              Select File Source
            </button>

            {/* Quick pre-sets launcher */}
            <div className="w-full max-w-md border-t border-muted-canvas pt-6 mt-2">
              <div className="text-xs font-mono text-muted-canvas uppercase tracking-widest mb-3">
                Sample Preloaded Sessions
              </div>
              <div className="grid grid-cols-1 gap-2">
                {samples.map((sample) => (
                  <div
                    key={sample.id}
                    onClick={() => onLoadSample(sample.id)}
                    className="flex items-center justify-between p-3 rounded-xl border border-muted-canvas bg-input-canvas/30 hover:bg-input-canvas/70 cursor-pointer text-left transition-colors group"
                  >
                    <div className="overflow-hidden pr-2">
                      <div className="text-sm font-semibold text-main-canvas group-hover:underline transition-all truncate">
                        {sample.name}
                      </div>
                      <div className="text-xs text-muted-canvas truncate mt-0.5">
                        {sample.description}
                      </div>
                    </div>
                    <ArrowRight size={12} className="text-muted-canvas group-hover:text-main-canvas group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* Sub-icons footer */}
            <div className="flex items-center space-x-6 text-xs text-muted-canvas font-mono uppercase tracking-widest mt-10">
              <div className="flex items-center space-x-1.5">
                <Volume2 size={12} />
                <span>Audio</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Video size={12} />
                <span>Video</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Globe size={12} />
                <span>URL</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
