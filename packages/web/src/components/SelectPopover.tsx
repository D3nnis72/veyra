import { Check, ChevronDown } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

export interface SelectPopoverOption {
  value: string;
  label: string;
  leading?: ReactNode;
  muted?: boolean;
}

export interface SelectPopoverProps {
  ariaLabel: string;
  value: string;
  options: SelectPopoverOption[];
  onChange: (value: string) => void;
  leading?: ReactNode;
  placeholder?: string;
  menuTitle?: string;
  size?: 'sm' | 'md';
  placement?: 'bottom' | 'top';
  align?: 'left' | 'right';
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  menuWidthClass?: string;
}

export function SelectPopover({
  ariaLabel,
  value,
  options,
  onChange,
  leading,
  placeholder = 'Select…',
  menuTitle,
  size = 'md',
  placement = 'bottom',
  align = 'left',
  triggerClassName = '',
  triggerStyle,
  menuWidthClass = 'w-60',
}: SelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);

    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, options.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + Math.max(1, options.length)) % Math.max(1, options.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, options, value, activeIndex, onChange]);

  const sizeClass =
    size === 'sm'
      ? 'h-8 px-2.5 gap-1.5 rounded-[7px] text-[12px]'
      : 'h-9 px-3.5 gap-2 rounded-[8px] text-[13px]';

  const posClass = placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  const alignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
        className={[
          'inline-flex items-center font-medium border transition-colors cursor-pointer min-w-0',
          sizeClass,
          triggerStyle
            ? ''
            : 'bg-[#262626] border-[#3C3C3C] hover:border-[#525252] text-[#EDEDED]',
          triggerClassName,
        ].join(' ')}
      >
        {leading ?? selected?.leading ?? null}
        <span className="truncate max-w-[150px]">{selected?.label ?? placeholder}</span>
        <ChevronDown size={12} className="opacity-60 shrink-0" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute ${posClass} ${alignClass} z-40 ${menuWidthClass} max-h-72 overflow-y-auto p-1.5 rounded-[11px] bg-[#222222] border border-white/[0.15] shadow-[var(--shadow-float)] animate-veyra-fade`}
        >
          {menuTitle ? (
            <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
              {menuTitle}
            </div>
          ) : null}
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === activeIndex;
            return (
              <button
                key={opt.value || '__empty'}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={[
                  'w-full px-3 py-2 rounded-[7px] text-left text-[13px] flex items-center justify-between gap-2.5 transition-colors',
                  isHighlighted ? 'bg-white/[0.08]' : 'hover:bg-white/[0.06]',
                  opt.muted ? 'text-[#9A9A9A]' : 'text-[#EDEDED]',
                ].join(' ')}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {opt.leading}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSelected ? <Check size={13} className="text-[#AEB8FF] shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
