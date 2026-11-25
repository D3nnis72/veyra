import { Check, Pencil, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+P';

const SYMBOL_KEYS = new Set(['⌘', '⇧', '⌥', '⌃', '↵', '⌫', '⌦', '↑', '↓', '←', '→']);

const TOKEN_DISPLAY_MAP: Record<string, string> = {
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  command: '⌘',
  cmd: '⌘',
  meta: '⌘',
  super: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  altgr: '⌥',
  shift: '⇧',
  space: 'Space',
  enter: '↵',
  return: '↵',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  plus: '+',
  minus: '-',
};

const MODIFIER_ORDER: Record<string, number> = {
  '⌘': 0,
  '⌃': 1,
  '⌥': 2,
  '⇧': 3,
};

/**
 * Converts an Electron accelerator string (e.g. "CommandOrControl+Shift+P")
 * into an ordered array of individual macOS keycap labels (e.g. ["⌘", "⇧", "P"]).
 */
export function parseAcceleratorToKeys(accelerator: string): string[] {
  const trimmed = accelerator.trim();
  if (!trimmed) return ['⌘', '⇧', 'P'];

  const rawParts = trimmed
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawParts.length === 0) return ['⌘', '⇧', 'P'];

  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of rawParts) {
    const mapped = TOKEN_DISPLAY_MAP[part.toLowerCase()];
    if (mapped && mapped in MODIFIER_ORDER) {
      if (!modifiers.includes(mapped)) {
        modifiers.push(mapped);
      }
      continue;
    }
    if (mapped) {
      keys.push(mapped);
      continue;
    }
    if (part.length === 1) {
      keys.push(part.toUpperCase());
    } else if (/^f\d{1,2}$/i.test(part)) {
      keys.push(part.toUpperCase());
    } else {
      keys.push(part);
    }
  }

  modifiers.sort((a, b) => (MODIFIER_ORDER[a] ?? 99) - (MODIFIER_ORDER[b] ?? 99));
  return [...modifiers, ...keys];
}

const CODE_TO_ELECTRON_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

const PURE_MODIFIER_KEYS = new Set([
  'Meta',
  'Control',
  'Alt',
  'Shift',
  'CapsLock',
  'OS',
  'AltGraph',
]);

export function eventToAcceleratorKey(event: KeyboardEvent): string | null {
  return extractElectronKey(event);
}

function extractElectronKey(event: KeyboardEvent): string | null {
  if (PURE_MODIFIER_KEYS.has(event.key)) return null;

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3);
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(5);
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
    return event.code;
  }
  if (event.code in CODE_TO_ELECTRON_KEY) {
    return CODE_TO_ELECTRON_KEY[event.code];
  }

  if (event.key.length === 1 && !/\s/.test(event.key)) {
    return event.key.toUpperCase();
  }
  return null;
}

export type AcceleratorCaptureResult =
  | { kind: 'ignore' }
  | { kind: 'cancel' }
  | { kind: 'needs-modifier' }
  | { kind: 'captured'; accelerator: string };

/**
 * Converts a browser KeyboardEvent into an Electron globalShortcut accelerator.
 * Requires at least one of Command/Control/Option so bare typing keys cannot be bound globally,
 * unless `allowBare` is set (single-key shortcuts that only fire inside the Veyra window).
 */
export function keyboardEventToAccelerator(
  event: KeyboardEvent,
  options: { allowBare?: boolean } = {},
): AcceleratorCaptureResult {
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    return { kind: 'cancel' };
  }

  if (PURE_MODIFIER_KEYS.has(event.key)) {
    return { kind: 'ignore' };
  }

  const key = extractElectronKey(event);
  if (!key) {
    return { kind: 'ignore' };
  }

  const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey;
  if (!hasPrimaryModifier && !options.allowBare) {
    return { kind: 'needs-modifier' };
  }

  const parts: string[] = [];
  if (event.metaKey) parts.push('CommandOrControl');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);

  return { kind: 'captured', accelerator: parts.join('+') };
}

export function Keycap({
  label,
  active = false,
  size = 'md',
}: {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}) {
  const isSymbol = SYMBOL_KEYS.has(label);
  const isWord = label.length > 1;

  const sizeClass =
    size === 'sm'
      ? `h-[21px] ${isWord ? 'px-1.5 text-[10.5px]' : isSymbol ? 'min-w-[21px] px-1 text-[11.5px]' : 'min-w-[21px] px-1 text-[10.5px]'}`
      : `h-[24px] ${isWord ? 'px-2 text-[11px]' : isSymbol ? 'min-w-[24px] px-1.5 text-[12.5px]' : 'min-w-[24px] px-1.5 text-[11.5px]'}`;

  const toneClass = active
    ? 'bg-[#253070] border-[#6B7CFF] text-[#EEF1FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_0_#111428]'
    : 'bg-gradient-to-b from-[#2B2B2B] to-[#212121] border-[#3D3D3D] text-[#EDEDED] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_1px_0_#0E0E0E]';

  return (
    <kbd
      className={[
        'inline-flex items-center justify-center rounded-[5px] border font-sans font-medium leading-none select-none',
        sizeClass,
        toneClass,
      ].join(' ')}
    >
      {label}
    </kbd>
  );
}

export function KeyChord({
  keys,
  active = false,
  size = 'md',
}: {
  keys: string[];
  active?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, idx) => (
        <Keycap key={`${key}-${idx}`} label={key} active={active} size={size} />
      ))}
    </span>
  );
}

export interface ShortcutBindingSpec {
  chords: string[][];
  separator?: 'or' | 'to';
}

export function ShortcutBinding({
  chords,
  separator = 'or',
  size = 'md',
}: ShortcutBindingSpec & { size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
      {chords.map((chord, idx) => (
        <span key={`${chord.join('-')}-${idx}`} className="inline-flex items-center gap-1.5">
          {idx > 0 ? (
            <span className="text-[11px] text-[#6E6E6E] px-0.5 select-none">
              {separator === 'to' ? '–' : 'or'}
            </span>
          ) : null}
          <KeyChord keys={chord} size={size} />
        </span>
      ))}
    </div>
  );
}

export interface ShortcutRecorderProps {
  value: string;
  onChange: (nextAccelerator: string) => void;
  defaultValue?: string;
  disabled?: boolean;
  saved?: boolean;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  /** Accept keys without ⌘/⌥/⌃ (for in-window shortcuts like P or C). */
  allowBare?: boolean;
  /** Shown instead of the recorder hint when the last recorded keys were rejected. */
  error?: string | null;
}

export function ShortcutRecorder({
  value,
  onChange,
  defaultValue = DEFAULT_CAPTURE_SHORTCUT,
  disabled = false,
  saved = false,
  ariaLabel = 'Record global capture shortcut',
  size = 'md',
  allowBare = false,
  error = null,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setHeldModifiers([]);
    setHint(null);
  }, []);

  useEffect(() => {
    if (!recording) return;

    const readModifiers = (e: KeyboardEvent) => {
      const mods: string[] = [];
      if (e.metaKey) mods.push('⌘');
      if (e.ctrlKey) mods.push('⌃');
      if (e.altKey) mods.push('⌥');
      if (e.shiftKey) mods.push('⇧');
      return mods;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      setHeldModifiers(readModifiers(e));

      const result = keyboardEventToAccelerator(e, { allowBare });
      if (result.kind === 'cancel') {
        stopRecording();
        return;
      }
      if (result.kind === 'needs-modifier') {
        setHint('Include ⌘, ⌥, or ⌃');
        return;
      }
      if (result.kind === 'captured') {
        onChange(result.accelerator);
        stopRecording();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      setHeldModifiers(readModifiers(e));
    };

    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        stopRecording();
      }
    };

    const onWindowBlur = () => {
      stopRecording();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [recording, onChange, stopRecording, allowBare]);

  const keys = parseAcceleratorToKeys(value);
  const isCustom = value.trim() !== '' && value.trim() !== defaultValue;

  return (
    <div ref={containerRef} className="inline-flex flex-col items-end gap-1 shrink-0">
      <div className="inline-flex items-center gap-2">
        {saved && !recording ? (
          <span className="text-[11.5px] text-[#7BE0A0] inline-flex items-center gap-1 animate-veyra-fade">
            <Check size={12} />
            <span>Saved</span>
          </span>
        ) : null}

        {isCustom && !recording ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(defaultValue)}
            title={`Reset to default (${parseAcceleratorToKeys(defaultValue).join('')})`}
            aria-label="Reset shortcut to default"
            className="h-7 px-2 rounded-[6px] text-[11.5px] text-[#8E8E8E] hover:text-[#EDEDED] hover:bg-[#262626] inline-flex items-center gap-1 transition-colors disabled:opacity-45"
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        ) : null}

        {recording ? (
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              aria-label="Recording shortcut, press keys or Escape to cancel"
              onClick={stopRecording}
              className="h-[34px] px-2.5 rounded-[8px] bg-[#1F2759]/80 border border-[#5566F2] ring-2 ring-[#5566F2]/25 inline-flex items-center gap-2 text-[11.5px] text-[#D6DCFF] transition-all"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#7E90FF] animate-pulse shrink-0" />
              {heldModifiers.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <KeyChord keys={heldModifiers} active size="sm" />
                  <span className="text-[11px] text-[#AEB8FF] pl-0.5">+ key</span>
                </span>
              ) : (
                <span className="font-medium">Press keys…</span>
              )}
              <span className="text-[10.5px] text-[#AEB8FF]/75 pl-1.5 border-l border-[#5566F2]/40">
                Esc
              </span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            onClick={() => {
              setHint(null);
              setRecording(true);
            }}
            title="Click to record a new shortcut"
            className={[
              'group inline-flex items-center gap-2 rounded-[8px] border border-[#2F2F2F] bg-[#171717]/80 hover:border-[#5566F2]/65 hover:bg-[#1F2759]/35 px-2 py-1 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5566F2]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            <KeyChord keys={keys} size={size} />
            <span className="inline-flex items-center text-[#787878] group-hover:text-[#AEB8FF] transition-colors pl-1 border-l border-[#2D2D2D] group-hover:border-[#5566F2]/40">
              <Pencil size={11} />
            </span>
          </button>
        )}
      </div>

      {recording && hint ? (
        <span className="text-[11px] text-[#F5A66B]">{hint}</span>
      ) : !recording && error ? (
        <span role="alert" className="text-[11px] text-[#FF9EC5] max-w-[260px] text-right">
          {error}
        </span>
      ) : null}
    </div>
  );
}
