import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './Button';

export interface AutoSummarySectionProps {
  summary: string | null | undefined;
  onSave: (next: string | null) => void;
  saving?: boolean;
}

/**
 * Quiet hairline AUTO SUMMARY section rendered inside BlockDetailDrawer and
 * SessionDetailDrawer whenever a block carries an autoSummary. Zero nested cards.
 */
export function AutoSummarySection({ summary, onSave, saving = false }: AutoSummarySectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? '');

  useEffect(() => {
    setDraft(summary ?? '');
    if (!summary) {
      setEditing(false);
    }
  }, [summary]);

  if (!summary && !editing) {
    return null;
  }

  const handleSave = () => {
    const trimmed = draft.trim();
    onSave(trimmed ? trimmed : null);
    setEditing(false);
  };

  return (
    <section
      aria-label="Auto Summary"
      className="space-y-2 pt-4 border-t border-[#2A2A2A]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#AEB8FF] inline-flex items-center gap-1.5">
          <Sparkles size={11} />
          <span>Auto Summary</span>
        </span>
        {!editing ? (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setDraft(summary ?? '');
                setEditing(true);
              }}
              aria-label="Edit auto summary"
              className="text-[11.5px] text-[#9A9A9A] hover:text-[#EDEDED] transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onSave(null)}
              disabled={saving}
              aria-label="Clear auto summary"
              className="text-[11.5px] text-[#6E6E6E] hover:text-[#FF9EC5] transition-colors disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            aria-label="Auto summary"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(summary ?? '');
                setEditing(false);
              }
            }}
            rows={3}
            placeholder="Post-block summary…"
            className="w-full bg-transparent border-0 p-0 text-[13.5px] leading-[1.6] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-y"
          />
          <div className="flex items-center gap-1.5">
            <Button variant="primary" size="xs" disabled={saving} onClick={handleSave}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setDraft(summary ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[13.5px] leading-[1.6] text-[#C4C4C4] whitespace-pre-wrap break-words">
          {summary}
        </p>
      )}
    </section>
  );
}
