import type { Block, ProjectWithStats } from '@veyra/core/types';
import { Check, Copy, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { formatShortDate, getTodayDateString } from './icons';

export interface TellSomeonePopoverProps {
  block: Block;
  project?: ProjectWithStats;
  onClose: () => void;
  todayDate?: string;
}

function getNextDayLabel(dateStr?: string | null): string {
  const effective = dateStr ?? getTodayDateString();
  const [y, m, d] = effective.split('-').map(Number);
  if (!y || !m || !d) return 'tomorrow';
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // Fri (5), Sat (6), Sun (0) -> Monday; Mon–Thu -> tomorrow
  if (day === 5 || day === 6 || day === 0) {
    return 'Monday';
  }
  return 'tomorrow';
}

function buildInitialDraft(block: Block, todayDate?: string): string {
  const nextDay = getNextDayLabel(todayDate ?? block.scheduledDate);
  return `I won't get to ${block.title} today, you'll have it ${nextDay} morning.`;
}

function buildContextLine(block: Block, project?: ProjectWithStats): string {
  const parts: string[] = [];
  if (block.dueDate) {
    parts.push(`Due ${formatShortDate(block.dueDate)}`);
  } else if (/^follow-up:/i.test(block.title.trim())) {
    parts.push('Meeting follow-up');
  } else {
    parts.push('Heads-up for someone waiting');
  }
  if (project && !project.isSystem) {
    parts.push(project.name);
  }
  return parts.join(' · ');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

export function TellSomeonePopover({
  block,
  project,
  onClose,
  todayDate,
}: TellSomeonePopoverProps) {
  const [draft, setDraft] = useState(() => buildInitialDraft(block, todayDate));
  const [feedback, setFeedback] = useState<'none' | 'copied' | 't3'>('none');
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(buildInitialDraft(block, todayDate));
    setFeedback('none');
  }, [block.id, block.title, block.scheduledDate, todayDate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (feedback === 'none') return;
    const timer = window.setTimeout(() => setFeedback('none'), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const contextLine = buildContextLine(block, project);

  const handleCopy = async () => {
    await copyText(draft.trim());
    setFeedback('copied');
  };

  const handleSendToT3 = async () => {
    const contextBits = [
      project && !project.isSystem ? `Project: ${project.name}` : null,
      block.dueDate ? `Due: ${formatShortDate(block.dueDate)}` : null,
    ].filter(Boolean);

    const prompt = [
      `Draft and help me send this quick update for "${block.title}"${contextBits.length > 0 ? ` (${contextBits.join(' · ')})` : ''}:`,
      '',
      draft.trim(),
      '',
      'Confirm recipient and channel with me before sending anything.',
    ].join('\n');

    await copyText(prompt);
    setFeedback('t3');
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Tell someone"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="z-30 w-[380px] max-w-[calc(100vw-32px)] rounded-[12px] bg-[#1C1C1C] border border-[#2A2A2A] p-[18px] shadow-[0_12px_32px_-4px_rgba(0,0,0,0.44)] space-y-3 animate-veyra-modal"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9A9A9A]">
            TELL SOMEONE
          </div>
          <p className="text-[12.5px] text-[#C4C4C4] truncate">{contextLine}</p>
        </div>
        <button
          type="button"
          aria-label="Close Tell someone"
          onClick={onClose}
          className="h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:bg-[#262626] hover:text-[#EDEDED] transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        aria-label="Draft message"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full p-3 rounded-[8px] bg-[#242424] border border-[#3C3C3C] text-[13px] leading-relaxed text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2] resize-none"
      />

      <p className="text-[11.5px] leading-snug text-[#6E6E6E]">
        Veyra copies the note or hands it to T3 Code. It never sends anything itself.
      </p>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[11.5px] text-[#7BE0A0] min-h-[16px]" aria-live="polite">
          {feedback === 'copied'
            ? 'Copied to clipboard'
            : feedback === 't3'
              ? 'Copied prompt for T3 Code'
              : ''}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={feedback === 'copied' ? <Check size={12} /> : <Copy size={12} />}
            onClick={() => void handleCopy()}
            disabled={!draft.trim()}
          >
            Copy
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={feedback === 't3' ? <Check size={12} /> : <Send size={12} />}
            onClick={() => void handleSendToT3()}
            disabled={!draft.trim()}
          >
            Send to T3 Code
          </Button>
        </div>
      </div>
    </div>
  );
}
