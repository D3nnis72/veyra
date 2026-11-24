import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuEntry =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
      hint?: string;
    }
  | { type: 'divider'; id: string }
  | { type: 'header'; id: string; label: string };

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  position: ContextMenuPosition | null;
  header?: string;
  items: Array<ContextMenuEntry | null | false | undefined>;
  onClose: () => void;
  width?: number;
  label?: string;
}

const VIEWPORT_GUTTER = 8;

/** Drops leading/trailing/double dividers that result from conditional items. */
function normalizeEntries(items: ContextMenuProps['items']): ContextMenuEntry[] {
  const filtered = items.filter(Boolean) as ContextMenuEntry[];
  const result: ContextMenuEntry[] = [];
  for (const entry of filtered) {
    if (entry.type === 'divider') {
      const prev = result[result.length - 1];
      if (!prev || prev.type === 'divider') continue;
    }
    result.push(entry);
  }
  while (result.length && result[result.length - 1].type === 'divider') result.pop();
  return result;
}

/**
 * Floating dark glass context menu. Rendered in a portal at fixed coordinates, clamped to the
 * viewport, dismissed on Escape, outside click, scroll, resize or window blur.
 */
export function ContextMenu({
  position,
  header,
  items,
  onClose,
  width = 224,
  label = 'Context menu',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<ContextMenuPosition | null>(null);
  const entries = normalizeEntries(items);

  useLayoutEffect(() => {
    if (!position) {
      setCoords(null);
      return;
    }
    const el = menuRef.current;
    const h = el?.offsetHeight ?? 0;
    const w = el?.offsetWidth ?? width;
    const maxX = window.innerWidth - w - VIEWPORT_GUTTER;
    const maxY = window.innerHeight - h - VIEWPORT_GUTTER;
    setCoords({
      x: Math.max(VIEWPORT_GUTTER, Math.min(position.x, maxX)),
      y: Math.max(VIEWPORT_GUTTER, Math.min(position.y, maxY)),
    });
  }, [position, width]);

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        // Let the focused menu button activate, but keep view-level shortcuts from firing.
        e.stopPropagation();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.stopPropagation();
        const buttons = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ??
            [],
        );
        if (buttons.length === 0) return;
        e.preventDefault();
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'ArrowDown'
            ? buttons[(idx + 1) % buttons.length]
            : buttons[(idx - 1 + buttons.length) % buttons.length];
        next?.focus();
      }
    };
    const dismiss = () => onClose();
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [position, onClose]);

  if (!position || typeof document === 'undefined') return null;

  const pos = coords ?? position;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y, width, visibility: coords ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[80] p-1.5 rounded-[11px] bg-[#222222] border border-white/[0.15] shadow-[var(--shadow-float)] animate-veyra-fade select-none"
    >
      {header ? (
        <div className="px-3 pt-1.5 pb-2 mb-1 text-[11px] font-medium text-[#6E6E6E] truncate border-b border-white/[0.08]">
          {header}
        </div>
      ) : null}
      {entries.map((entry) => {
        if (entry.type === 'divider') {
          return <div key={entry.id} role="separator" className="my-1.5 mx-1 border-t border-white/[0.08]" />;
        }
        if (entry.type === 'header') {
          return (
            <div
              key={entry.id}
              className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
            >
              {entry.label}
            </div>
          );
        }
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={[
              'w-full px-3 py-2 rounded-[7px] text-left text-[13px] flex items-center gap-2.5 transition-colors',
              'focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed',
              entry.destructive
                ? 'text-[#FF9EC5] hover:bg-[#3D1A2B]/70 focus-visible:bg-[#3D1A2B]/70'
                : 'text-[#EDEDED] hover:bg-white/[0.08] focus-visible:bg-white/[0.08]',
            ].join(' ')}
          >
            {entry.icon ? (
              <span
                className={[
                  'shrink-0 inline-flex items-center justify-center w-4',
                  entry.destructive ? '' : 'text-[#9A9A9A]',
                ].join(' ')}
              >
                {entry.icon}
              </span>
            ) : null}
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.hint ? <span className="text-[11px] text-[#6E6E6E] shrink-0">{entry.hint}</span> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Small state helper: `open(e, payload)` from an onContextMenu handler, `close()` to dismiss. */
export function useContextMenuState<T>() {
  const [state, setState] = useState<{ payload: T; position: ContextMenuPosition } | null>(null);
  const open = useCallback((e: ReactMouseEvent, payload: T) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ payload, position: { x: e.clientX, y: e.clientY } });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { payload: state?.payload ?? null, position: state?.position ?? null, open, close };
}
