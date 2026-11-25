import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

export interface DockedDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissOnEscape?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}

export function DockedDrawer({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  footer,
  width = 520,
  dismissOnEscape = true,
  ariaLabel = 'Detail drawer',
  children,
}: DockedDrawerProps) {
  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissOnEscape, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      {/* Subtle click-outside scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 bg-black/35 pointer-events-auto animate-veyra-fade"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width: `min(${width}px, 100vw)` }}
        className="relative z-10 h-full flex flex-col bg-[#1C1C1C] border-l border-[#2A2A2A] shadow-[var(--shadow-float)] pointer-events-auto animate-veyra-drawer"
      >
        {(title || headerActions) ? (
          <header className="shrink-0 h-[54px] flex items-center justify-between gap-3 px-6 border-b border-[#2A2A2A]">
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <h2 className="font-display text-[16px] font-semibold text-[#EDEDED] truncate">
                  {title}
                </h2>
              ) : (
                title
              )}
              {subtitle ? (
                <div className="mt-0.5 text-[12px] text-[#9A9A9A] truncate">{subtitle}</div>
              ) : null}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="h-7 w-7 inline-flex items-center justify-center rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252] transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          </header>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {footer ? (
          <footer className="shrink-0 px-6 py-4 border-t border-[#2A2A2A] bg-[#171717]">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
