import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findHotkeyConflict,
  matchesAccelerator,
  resolveAllHotkeys,
} from '../src/app/hotkeys';
import { SettingsView } from '../src/views/SettingsView';

const updateSettings = vi.fn().mockResolvedValue({});
let settingsData: unknown;

vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, updateSettings: (...args: unknown[]) => updateSettings(...args) },
  };
});

vi.mock('../src/api/queries', () => ({
  useGoalsQuery: () => ({ data: { goals: [] } }),
  useActivityQuery: () => ({ data: { activity: [] } }),
  useProjectsQuery: () => ({ data: { projects: [] } }),
  useSettingsQuery: () => ({ data: settingsData }),
  invalidateAllVeyraData: vi.fn(),
}));

function key(init: KeyboardEventInit & { key: string; code: string }) {
  return new KeyboardEvent('keydown', init);
}

afterEach(() => {
  cleanup();
  updateSettings.mockClear();
});

describe('hotkey matching', () => {
  it('matches ⌘ or Ctrl for CommandOrControl and the physical key for Option combos', () => {
    expect(matchesAccelerator(key({ key: 'k', code: 'KeyK', metaKey: true }), 'CommandOrControl+K')).toBe(true);
    expect(matchesAccelerator(key({ key: 'k', code: 'KeyK', ctrlKey: true }), 'CommandOrControl+K')).toBe(true);
    expect(matchesAccelerator(key({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }), 'CommandOrControl+K')).toBe(false);
    // On macOS Option+K types "˚", the physical code still matches
    expect(matchesAccelerator(key({ key: '˚', code: 'KeyK', altKey: true }), 'Alt+K')).toBe(true);
    expect(matchesAccelerator(key({ key: ',', code: 'Comma', metaKey: true }), 'CommandOrControl+,')).toBe(true);
  });

  it('keeps Control+O separate from ⌘O and matches bare keys only without modifiers', () => {
    expect(matchesAccelerator(key({ key: 'o', code: 'KeyO', ctrlKey: true }), 'Control+O')).toBe(true);
    expect(matchesAccelerator(key({ key: 'o', code: 'KeyO', metaKey: true }), 'Control+O')).toBe(false);
    expect(matchesAccelerator(key({ key: 'p', code: 'KeyP' }), 'P')).toBe(true);
    expect(matchesAccelerator(key({ key: 'p', code: 'KeyP', metaKey: true }), 'P')).toBe(false);
  });

  it('uses defaults, honors overrides, and reads Quick Capture from globalCaptureShortcut', () => {
    const resolved = resolveAllHotkeys({ quickFocus: 'Alt+Shift+F' }, 'CommandOrControl+Shift+Space');
    expect(resolved.quickFocus).toEqual(['Alt+Shift+F']);
    expect(resolved.quickCapture).toEqual(['CommandOrControl+Shift+Space']);
    expect(resolved.globalCommandPalette).toEqual(['Alt+K']);
    expect(resolveAllHotkeys({}, undefined).quickFocus).toEqual(['CommandOrControl+Shift+O', 'Control+O']);
  });

  it('flags a key already used in the same context or by a global hotkey, but not across unrelated contexts', () => {
    const resolved = resolveAllHotkeys({}, undefined);
    expect(findHotkeyConflict('newBlock', 'CommandOrControl+K', resolved)?.id).toBe('commandPalette');
    // Global ⌥K is delivered to Veyra before the window, so an in-app binding would never fire
    expect(findHotkeyConflict('newBlock', 'Alt+K', resolved)?.id).toBe('globalCommandPalette');
    // Focus-mode "N" and the in-app ⌘N live in different contexts
    expect(findHotkeyConflict('toggleNotes', 'CommandOrControl+N', resolved)).toBeNull();
    expect(findHotkeyConflict('pauseFocus', 'C', resolved)?.id).toBe('completeBlock');
  });
});

describe('Shortcuts settings', () => {
  function renderShortcuts() {
    settingsData = {
      settings: {
        globalCaptureShortcut: 'CommandOrControl+Shift+P',
        runInMenuBar: true,
        hotkeys: {},
        updatedAt: 'x',
      },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SettingsView section="server" />
      </QueryClientProvider>,
    );
  }

  it('rebinds Quick Focus and saves only that override', async () => {
    renderShortcuts();
    expect(screen.getAllByRole('button', { name: /^Customize .* shortcut$/ })).toHaveLength(12);

    fireEvent.click(screen.getByRole('button', { name: 'Customize Quick Focus shortcut' }));
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', altKey: true, shiftKey: true });

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings).toHaveBeenCalledWith({
      globalCaptureShortcut: 'CommandOrControl+Shift+P',
      hotkeys: { quickFocus: 'Alt+Shift+F' },
    });
  });

  it('refuses a key that another action already uses and saves nothing', async () => {
    renderShortcuts();
    fireEvent.click(screen.getByRole('button', { name: 'Customize New Block Composer shortcut' }));
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true });

    expect(await screen.findByText('Already used by Command Palette')).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('accepts bare single keys for Focus mode only', async () => {
    renderShortcuts();
    fireEvent.click(screen.getByRole('button', { name: 'Customize Pause Focus shortcut' }));
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' });
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        globalCaptureShortcut: 'CommandOrControl+Shift+P',
        hotkeys: { pauseFocus: 'X' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize Toggle Ops Flag shortcut' }));
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' });
    expect(screen.getByText('Include ⌘, ⌥, or ⌃')).toBeInTheDocument();
  });
});
