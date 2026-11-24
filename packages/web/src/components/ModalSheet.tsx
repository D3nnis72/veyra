import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

export interface ModalSheetProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissible?: boolean;
  ariaLabel?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  headerRight,
  footer,
  width = 640,
  dismissible = true,
  ariaLabel = 'Dialog',
  bodyClassName = '',
  children,
}: ModalSheetProps) {
  useEffect(() => {
    if (!open || !dismissible || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] animate-veyra-fade"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        className="relative z-10 flex flex-col max-h-[88vh] bg-[#1C1C1C] border border-[#2A2A2A] rounded-[12px] shadow-[var(--shadow-float)] overflow-hidden animate-veyra-modal"
      >
        {(title || headerRight || (dismissible && onClose)) ? (
          <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#2A2A2A]">
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <h2 className="font-display text-[16px] font-semibold text-[#EDEDED] truncate">
                  {title}
                </h2>
              ) : (
                title
              )}
              {subtitle ? (
                <div className="mt-0.5 text-[12px] text-[#9A9A9A]">{subtitle}</div>
              ) : null}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {headerRight}
              {dismissible && onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close modal"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-[6px] text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626] transition-colors"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        <div className={`flex-1 overflow-y-auto px-5 py-4 ${bodyClassName}`}>{children}</div>

        {footer ? (
          <footer className="shrink-0 px-5 py-3.5 border-t border-[#2A2A2A] bg-[#1C1C1C]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
