import {
  BLOCK_SIZE_MAX_MINUTES,
  BLOCK_SIZE_MIN_MINUTES,
  BLOCK_SIZE_OPTIONS,
  type BlockSizeMinutes,
  parseBlockSizeInput,
} from '@veyra/core/types';
import { type FocusEvent, type KeyboardEvent, useRef, useState } from 'react';
import { formatDuration } from './icons';

interface BlockSizePickerProps {
  value: BlockSizeMinutes | null;
  onChange: (next: BlockSizeMinutes | null) => void;
}

const SEGMENT_CLASS =
  'h-full px-2 rounded-[6px] text-[12px] font-medium tabular-nums transition-colors';
const ACTIVE_CLASS = 'bg-[#262626] text-[#EDEDED]';
const IDLE_CLASS = 'text-[#9A9A9A] hover:text-[#EDEDED]';

function isPresetSize(value: BlockSizeMinutes | null): boolean {
  return value === null || (BLOCK_SIZE_OPTIONS as readonly number[]).includes(value);
}

/**
 * Segmented block size control: Auto / 30m / 1h / 2h presets plus a Custom segment
 * that opens an inline text input (e.g. "45", "90m", "1h 30m", "1.5h").
 * Input is rounded to 5 minutes and clamped to 5m–10h. Enter saves, Esc cancels.
 */
export function BlockSizePicker({ value, onChange }: BlockSizePickerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  // Set once Enter/Esc has resolved the edit, so the following blur does not commit again.
  const resolvedRef = useRef(false);

  const isCustom = !isPresetSize(value);

  const startEditing = () => {
    resolvedRef.current = false;
    setDraft(isCustom && value !== null ? formatDuration(value) : '');
    setInvalid(false);
    setEditing(true);
  };

  const stopEditing = () => {
    resolvedRef.current = true;
    setEditing(false);
    setInvalid(false);
  };

  const commit = (): boolean => {
    const parsed = parseBlockSizeInput(draft);
    if (parsed === null) {
      return false;
    }
    stopEditing();
    if (parsed !== value) {
      onChange(parsed);
    }
    return true;
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!draft.trim()) {
        stopEditing();
        return;
      }
      if (!commit()) {
        setInvalid(true);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopEditing();
    }
  };

  const onInputBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (resolvedRef.current) return;
    // Clicking another segment in this control picks that one instead.
    if (e.relatedTarget && groupRef.current?.contains(e.relatedTarget as Node)) {
      stopEditing();
      return;
    }
    if (!commit()) {
      stopEditing();
    }
  };

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Block size"
      className="inline-flex items-center h-9 p-0.5 rounded-[8px] bg-[#171717] border border-[#3C3C3C]"
    >
      <span className="px-2 text-[11.5px] font-medium text-[#6E6E6E] select-none">Size</span>
      {([null, ...BLOCK_SIZE_OPTIONS] as const).map((opt) => {
        const active = !editing && value === opt;
        const label = opt === null ? 'Auto' : formatDuration(opt);
        return (
          <button
            key={opt ?? 'auto'}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (editing) stopEditing();
              if (opt !== value) onChange(opt);
            }}
            className={[SEGMENT_CLASS, active ? ACTIVE_CLASS : IDLE_CLASS].join(' ')}
          >
            {label}
          </button>
        );
      })}
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={onInputKeyDown}
          onBlur={onInputBlur}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="45m"
          aria-label="Custom block size"
          aria-invalid={invalid}
          title={`Minutes or e.g. 1h 30m (${formatDuration(BLOCK_SIZE_MIN_MINUTES)}–${formatDuration(BLOCK_SIZE_MAX_MINUTES)}). Enter saves, Esc cancels.`}
          className={[
            'h-full w-[68px] px-2 rounded-[6px] bg-[#262626] border text-[12px] font-medium tabular-nums text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none',
            invalid ? 'border-[#C94A6A]/70' : 'border-[#525252]',
          ].join(' ')}
        />
      ) : (
        <button
          type="button"
          aria-pressed={isCustom}
          aria-label={isCustom && value !== null ? `Custom size ${formatDuration(value)}` : 'Custom size'}
          onClick={startEditing}
          className={[SEGMENT_CLASS, isCustom ? ACTIVE_CLASS : IDLE_CLASS].join(' ')}
        >
          {isCustom && value !== null ? formatDuration(value) : 'Custom'}
        </button>
      )}
    </div>
  );
}
