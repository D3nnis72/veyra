import { type NoteTagCount, findNoteTagQueryAtCaret } from '@veyra/core/types';
import { Hash } from 'lucide-react';
import { type RefObject, useMemo, useState } from 'react';
import { Pill } from './Pill';

const MAX_SUGGESTIONS = 6;

export interface NoteTagChipProps {
  tag: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  title?: string;
}

/** `#tag` pill for notes; violet so it never reads as a goal, project or Ops flag. */
export function NoteTagChip({ tag, count, active = false, onClick, onRemove, title }: NoteTagChipProps) {
  return (
    <Pill
      tone={active ? 'accent' : 'violet'}
      onClick={onClick}
      onRemove={onRemove}
      title={title}
      className={active ? '' : 'border border-transparent'}
    >
      <span>#{tag}</span>
      {count !== undefined ? (
        <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
      ) : null}
    </Pill>
  );
}

export interface NoteTagAutocomplete {
  /** Suggestions for the `#partial` at the caret; empty when nothing to offer. */
  suggestions: string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Call from the input's change/select/keyup handlers so the caret position stays current. */
  syncCaret: (input: HTMLInputElement) => void;
  /** Replaces the `#partial` at the caret with `#tag ` and moves the caret behind it. */
  accept: (tag: string) => void;
  dismiss: () => void;
  /**
   * Handles Tab/Enter (accept), ↑/↓ (cycle) and Esc (dismiss) while suggestions show.
   * Returns true when the key was consumed; the caller then stops further handling.
   */
  handleKey: (e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault' | 'stopPropagation'>) => boolean;
}

/**
 * `#` autocomplete for a single-line note input. Typing `#` offers known tags (most used first),
 * `#ve` narrows by prefix, then substring. New tags need no confirmation: they are just text.
 */
export function useNoteTagAutocomplete(
  value: string,
  setValue: (next: string) => void,
  inputRef: RefObject<HTMLInputElement | null>,
  knownTags: readonly NoteTagCount[] | undefined,
): NoteTagAutocomplete {
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const tagQuery = useMemo(() => {
    if (caret === null) return null;
    return findNoteTagQueryAtCaret(value, Math.min(caret, value.length));
  }, [value, caret]);

  const suggestions = useMemo(() => {
    if (!tagQuery || !knownTags || knownTags.length === 0) return [];
    if (dismissedAt === `${tagQuery.start}:${tagQuery.query}`) return [];
    const needle = tagQuery.query;
    const prefix: string[] = [];
    const substring: string[] = [];
    for (const { tag } of knownTags) {
      if (tag.startsWith(needle)) prefix.push(tag);
      else if (needle && tag.includes(needle)) substring.push(tag);
    }
    const combined = [...prefix, ...substring].slice(0, MAX_SUGGESTIONS);
    // If the user already typed the exact and only matching tag, hide the bar so Enter submits.
    if (combined.length === 1 && combined[0] === needle) return [];
    return combined;
  }, [tagQuery, knownTags, dismissedAt]);

  const clampedIndex = suggestions.length > 0 ? Math.min(activeIndex, suggestions.length - 1) : 0;

  const syncCaret = (input: HTMLInputElement) => {
    const next = input.selectionStart ?? input.value.length;
    if (next !== caret) {
      setCaret(next);
      setActiveIndex(0);
    }
  };

  const accept = (tag: string) => {
    if (!tagQuery) return;
    const end = tagQuery.start + 1 + tagQuery.query.length;
    const rest = value.slice(end);
    const insert = `#${tag}${rest.startsWith(' ') ? '' : ' '}`;
    const next = value.slice(0, tagQuery.start) + insert + rest;
    const nextCaret = tagQuery.start + insert.length + (rest.startsWith(' ') ? 1 : 0);
    setValue(next);
    setCaret(nextCaret);
    setActiveIndex(0);
    window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  const dismiss = () => {
    if (tagQuery) setDismissedAt(`${tagQuery.start}:${tagQuery.query}`);
  };

  const handleKey: NoteTagAutocomplete['handleKey'] = (e) => {
    if (suggestions.length === 0) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      accept(suggestions[clampedIndex]);
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((clampedIndex + delta + suggestions.length) % suggestions.length);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return true;
    }
    return false;
  };

  return {
    suggestions,
    activeIndex: clampedIndex,
    setActiveIndex,
    syncCaret,
    accept,
    dismiss,
    handleKey,
  };
}

/** One row of tag suggestions under a note input. Mouse down picks without blurring the input. */
export function NoteTagSuggestions({
  autocomplete,
  className = '',
}: {
  autocomplete: NoteTagAutocomplete;
  className?: string;
}) {
  const { suggestions, activeIndex, setActiveIndex, accept } = autocomplete;
  if (suggestions.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Tag suggestions"
      className={`flex items-center gap-1.5 overflow-hidden ${className}`}
    >
      <Hash size={12} className="text-[#6E6E6E] shrink-0" />
      {suggestions.map((tag, idx) => (
        <button
          key={tag}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={idx === activeIndex}
          onMouseEnter={() => setActiveIndex(idx)}
          onMouseDown={(e) => {
            e.preventDefault();
            accept(tag);
          }}
          className={[
            'h-6 px-2 rounded-[6px] border text-[12px] font-medium shrink-0 transition-colors',
            idx === activeIndex
              ? 'bg-[#291F45] border-[#9D7FF7]/60 text-[#C9B6FF]'
              : 'bg-[#242424] border-[#323232] text-[#9A9A9A] hover:text-[#EDEDED]',
          ].join(' ')}
        >
          #{tag}
        </button>
      ))}
      <span className="ml-auto text-[11px] text-[#6E6E6E] shrink-0">Tab accept</span>
    </div>
  );
}
