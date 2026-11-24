import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../src/components/ContextMenu';
import { Pill } from '../src/components/Pill';
import {
  ShortcutBinding,
  ShortcutRecorder,
  keyboardEventToAccelerator,
  parseAcceleratorToKeys,
} from '../src/components/ShortcutKeys';
import { goalTint } from '../src/components/goalTint';

afterEach(() => cleanup());

describe('goal tint', () => {
  it('derives a dark background, ~38% border and bright text from the goal color', () => {
    const emerald = goalTint('#2E9E6F');
    expect(emerald.border).toBe('#2E9E6F61');
    expect(emerald.text).toBe('#7BE0B0');
    expect(emerald.bg).not.toBe('#152B47');

    const generic = goalTint('#FF0000');
    expect(generic.text).toBe('#FF8080');
    expect(generic.bg).toBe('#491616');

    // Invalid input falls back to the default goal blue instead of throwing.
    expect(goalTint('not-a-color').dot).toBe('#4DA3FF');
  });

  it('renders goal pills tinted from dotColor instead of hardcoded blue', () => {
    render(
      <>
        <Pill tone="goal" dot dotColor="#2E9E6F">
          Green goal
        </Pill>
        <Pill tone="goal" dot dotColor="#2A8FBD">
          Cyan goal
        </Pill>
      </>,
    );
    const green = screen.getByText('Green goal').parentElement!;
    const cyan = screen.getByText('Cyan goal').parentElement!;
    expect(green.style.backgroundColor).not.toBe(cyan.style.backgroundColor);
    expect(green.style.backgroundColor).not.toBe('rgb(21, 43, 71)');
    expect(green.style.color).toBe('rgb(123, 224, 176)');
    expect(green.className).toContain('border');
  });
});

describe('ContextMenu', () => {
  it('renders items, header and dividers, runs actions and dismisses on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const onDelete = vi.fn();

    render(
      <ContextMenu
        position={{ x: 40, y: 40 }}
        header="Wire metrics"
        onClose={onClose}
        items={[
          { type: 'divider', id: 'lead' },
          { id: 'open', label: 'Open Details', onSelect: onOpen },
          false,
          { type: 'divider', id: 'd1' },
          { type: 'divider', id: 'd2' },
          { id: 'delete', label: 'Delete Block', destructive: true, onSelect: onDelete },
        ]}
      />,
    );

    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Wire metrics');
    // Leading and doubled dividers collapse to a single separator.
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Delete Block' }).className).toContain(
      'text-[#FF9EC5]',
    );

    await user.click(screen.getByRole('menuitem', { name: 'Open Details' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('dismisses on outside click and renders nothing without a position', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <div>
        <button type="button">outside</button>
        <ContextMenu
          position={{ x: 10, y: 10 }}
          onClose={onClose}
          items={[{ id: 'a', label: 'Action', onSelect: () => {} }]}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onClose).toHaveBeenCalled();

    rerender(
      <div>
        <ContextMenu
          position={null}
          onClose={onClose}
          items={[{ id: 'a', label: 'Action', onSelect: () => {} }]}
        />
      </div>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('ShortcutKeys & ShortcutRecorder', () => {
  it('parses Electron accelerators into ordered individual macOS keycap labels', () => {
    expect(parseAcceleratorToKeys('CommandOrControl+Shift+P')).toEqual(['⌘', '⇧', 'P']);
    expect(parseAcceleratorToKeys('Shift+Alt+Space')).toEqual(['⌥', '⇧', 'Space']);
    expect(parseAcceleratorToKeys('Control+O')).toEqual(['⌃', 'O']);
    expect(parseAcceleratorToKeys('CommandOrControl+Return')).toEqual(['⌘', '↵']);
  });

  it('converts keyboard events to Electron accelerators using physical codes and requires a primary modifier', () => {
    const bareKey = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP' });
    expect(keyboardEventToAccelerator(bareKey)).toEqual({ kind: 'needs-modifier' });

    const optionCombo = new KeyboardEvent('keydown', {
      key: '˚',
      code: 'KeyK',
      altKey: true,
    });
    expect(keyboardEventToAccelerator(optionCombo)).toEqual({
      kind: 'captured',
      accelerator: 'Alt+K',
    });

    const cmdShiftSpace = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      metaKey: true,
      shiftKey: true,
    });
    expect(keyboardEventToAccelerator(cmdShiftSpace)).toEqual({
      kind: 'captured',
      accelerator: 'CommandOrControl+Shift+Space',
    });

    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
    expect(keyboardEventToAccelerator(esc)).toEqual({ kind: 'cancel' });
  });

  it('renders separate keycaps per chord with an "or" separator between alternatives', () => {
    render(<ShortcutBinding chords={[['⌘', '⇧', 'O'], ['⌃', 'O']]} separator="or" />);
    expect(screen.getByText('⌘')).toBeInTheDocument();
    expect(screen.getByText('⇧')).toBeInTheDocument();
    expect(screen.getByText('⌃')).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
    expect(screen.getAllByText('O')).toHaveLength(2);
  });

  it('records a new shortcut, rejects bare keys, cancels on Escape, and resets to default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(
      <ShortcutRecorder value="CommandOrControl+Shift+P" onChange={onChange} />,
    );

    // Displays parsed keycaps instead of raw accelerator string
    expect(screen.queryByText('CommandOrControl+Shift+P')).not.toBeInTheDocument();
    expect(screen.getByText('⌘')).toBeInTheDocument();
    expect(screen.getByText('⇧')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();

    // Enter recording mode
    await user.click(screen.getByRole('button', { name: /Record global capture shortcut/i }));
    expect(screen.getByText(/Press keys/i)).toBeInTheDocument();

    // Bare key shows hint and stays recording
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    expect(screen.getByText(/Include ⌘, ⌥, or ⌃/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    // Pressing a valid shortcut emits Electron accelerator and exits recording
    fireEvent.keyDown(window, { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Shift+Space');
    expect(screen.queryByText(/Press keys/i)).not.toBeInTheDocument();

    // Custom shortcut shows Reset button
    rerender(<ShortcutRecorder value="CommandOrControl+Shift+Space" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Reset shortcut to default/i }));
    expect(onChange).toHaveBeenLastCalledWith('CommandOrControl+Shift+P');
  });
});
