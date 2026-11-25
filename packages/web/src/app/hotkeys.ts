import {
  HOTKEY_DEFINITIONS,
  type HotkeyId,
  type HotkeyOverrides,
  type HotkeyScope,
  resolveHotkey,
} from '@veyra/core/types';
import { useMemo } from 'react';
import { useSettingsQuery } from '../api/queries';
import { eventToAcceleratorKey, parseAcceleratorToKeys } from '../components/ShortcutKeys';

export type { HotkeyId, HotkeyScope };

export interface HotkeyMeta {
  id: HotkeyId;
  scope: HotkeyScope;
  label: string;
  description: string;
}

/** Display metadata for every rebindable hotkey, in the order the settings page lists them. */
export const HOTKEY_META: Record<HotkeyId, HotkeyMeta> = {
  quickCapture: {
    id: 'quickCapture',
    scope: 'global',
    label: 'Quick Capture',
    description: 'Opens the floating capture bar for Daily Note or Inbox from any macOS app',
  },
  quickFocus: {
    id: 'quickFocus',
    scope: 'global',
    label: 'Quick Focus',
    description: 'Opens floating capture on Focus Now, or jumps to the active Focus view if a block is already running',
  },
  globalCommandPalette: {
    id: 'globalCommandPalette',
    scope: 'global',
    label: 'Global Command Palette',
    description: 'Search blocks, projects, and actions from anywhere on macOS',
  },
  commandPalette: {
    id: 'commandPalette',
    scope: 'app',
    label: 'Command Palette',
    description: 'Jump to views, projects, or start a block',
  },
  newBlock: {
    id: 'newBlock',
    scope: 'app',
    label: 'New Block Composer',
    description: 'Open full composer sheet inside Veyra',
  },
  saveDrawer: {
    id: 'saveDrawer',
    scope: 'app',
    label: 'Save Active Drawer',
    description: 'Flush notes and edits in Block, Meeting, or Session drawer',
  },
  openSettings: {
    id: 'openSettings',
    scope: 'app',
    label: 'Open Settings',
    description: 'Jump directly to full-page Settings',
  },
  cycleProject: {
    id: 'cycleProject',
    scope: 'capture',
    label: 'Select Project',
    description: 'Open the searchable project picker in Quick Capture and New Block composer',
  },
  toggleOps: {
    id: 'toggleOps',
    scope: 'capture',
    label: 'Toggle Ops Flag',
    description: 'Mark a note or block as Ops without touching the mouse',
  },
  pauseFocus: {
    id: 'pauseFocus',
    scope: 'focus',
    label: 'Pause Focus',
    description: 'Pause the active session with an optional resume note',
  },
  completeBlock: {
    id: 'completeBlock',
    scope: 'focus',
    label: 'Complete Block',
    description: 'Finish the current block and log outcome and energy',
  },
  toggleNotes: {
    id: 'toggleNotes',
    scope: 'focus',
    label: 'Toggle Notes Drawer',
    description: 'Open or close block notes without leaving Focus mode',
  },
};

export type ResolvedHotkeys = Record<HotkeyId, string[]>;

export const HOTKEY_DEFAULTS = Object.fromEntries(
  HOTKEY_DEFINITIONS.map((d) => [d.id, [...d.defaults]]),
) as Record<HotkeyId, string[]>;

/** Accelerators the desktop shell registers system-wide besides Quick Capture. */
export function globalHotkeyPayload(overrides: HotkeyOverrides | undefined): {
  quickFocus: string[];
  globalCommandPalette: string[];
} {
  return {
    quickFocus: resolveHotkey('quickFocus', overrides),
    globalCommandPalette: resolveHotkey('globalCommandPalette', overrides),
  };
}

export function resolveAllHotkeys(
  overrides: HotkeyOverrides | undefined,
  globalCaptureShortcut?: string,
): ResolvedHotkeys {
  const out = {} as ResolvedHotkeys;
  for (const def of HOTKEY_DEFINITIONS) {
    out[def.id] = resolveHotkey(def.id, overrides, globalCaptureShortcut);
  }
  return out;
}

/** Active accelerators for every hotkey, following the saved settings. */
export function useHotkeys(): ResolvedHotkeys {
  const settings = useSettingsQuery().data?.settings;
  const overrides = settings?.hotkeys;
  const capture = settings?.globalCaptureShortcut;
  return useMemo(() => resolveAllHotkeys(overrides, capture), [overrides, capture]);
}

interface ParsedAccelerator {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeKeyToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'enter') return 'RETURN';
  if (lower === 'esc') return 'ESCAPE';
  return token.toUpperCase();
}

export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  // "Command+," splits cleanly, but "Control++" would drop the plus key.
  if (accelerator.trim().endsWith('++')) parts.push('+');
  if (parts.length === 0) return null;
  const parsed: ParsedAccelerator = { cmd: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'commandorcontrol':
      case 'cmdorctrl':
      case 'command':
      case 'cmd':
      case 'meta':
      case 'super':
        parsed.cmd = true;
        break;
      case 'control':
      case 'ctrl':
        parsed.ctrl = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      default:
        parsed.key = normalizeKeyToken(part);
    }
  }
  return parsed.key ? parsed : null;
}

/** True when the keyboard event is exactly the given accelerator (⌘ also accepts Ctrl). */
export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  if (event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) return false;

  let modifiersOk: boolean;
  if (parsed.cmd && parsed.ctrl) modifiersOk = event.metaKey && event.ctrlKey;
  else if (parsed.cmd) modifiersOk = event.metaKey || event.ctrlKey;
  else if (parsed.ctrl) modifiersOk = event.ctrlKey && !event.metaKey;
  else modifiersOk = !event.metaKey && !event.ctrlKey;
  if (!modifiersOk) return false;

  const pressed = eventToAcceleratorKey(event);
  return pressed !== null && normalizeKeyToken(pressed) === parsed.key;
}

export function matchesAnyAccelerator(event: KeyboardEvent, accelerators: string[]): boolean {
  return accelerators.some((a) => matchesAccelerator(event, a));
}

/** Canonical form used to detect two actions bound to the same keys. */
export function normalizeAccelerator(accelerator: string): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator.trim().toLowerCase();
  return [
    parsed.cmd ? 'cmd' : '',
    parsed.ctrl ? 'ctrl' : '',
    parsed.alt ? 'alt' : '',
    parsed.shift ? 'shift' : '',
    parsed.key,
  ]
    .filter(Boolean)
    .join('+');
}

/**
 * Finds another hotkey that already uses this accelerator. Hotkeys in the same context
 * collide, and global hotkeys also collide with in-app ones because macOS delivers a
 * global hotkey to Veyra before the window sees it.
 */
export function findHotkeyConflict(
  id: HotkeyId,
  accelerator: string,
  resolved: ResolvedHotkeys,
): HotkeyMeta | null {
  const target = normalizeAccelerator(accelerator);
  const scope = HOTKEY_META[id].scope;
  for (const def of HOTKEY_DEFINITIONS) {
    if (def.id === id) continue;
    const otherScope = def.scope;
    const overlaps =
      otherScope === scope ||
      (scope === 'global' && otherScope === 'app') ||
      (scope === 'app' && otherScope === 'global');
    if (!overlaps) continue;
    if (resolved[def.id].some((a) => normalizeAccelerator(a) === target)) {
      return HOTKEY_META[def.id];
    }
  }
  return null;
}

/** Display label such as "⌘⇧P" for the first accelerator of a hotkey. */
export function formatHotkeyLabel(accelerators: string[]): string {
  return accelerators.length > 0 ? parseAcceleratorToKeys(accelerators[0]).join('') : '';
}
