import { Check, ChevronDown, Search } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

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
  triggerTitle?: string;
  menuWidthClass?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  onCloseFocus?: () => void;
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
  triggerTitle,
  menuWidthClass = 'w-60',
  open: controlledOpen,
  onOpenChange,
  searchable = false,
  searchPlaceholder = 'Search…',
  onCloseFocus,
}: SelectPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(open) : next;
    if (controlledOpen === undefined) {
      setUncontrolledOpen(resolved);
    }
    onOpenChange?.(resolved);
  };

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    const prefix: SelectPopoverOption[] = [];
    const substring: SelectPopoverOption[] = [];
    for (const opt of options) {
      const lower = opt.label.toLowerCase();
      if (lower.startsWith(needle)) {
        prefix.push(opt);
      } else if (lower.includes(needle)) {
        substring.push(opt);
      }
    }
    return [...prefix, ...substring];
  }, [options, searchable, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    if (searchable) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    if (query.trim()) {
      setActiveIndex(0);
    } else {
      const idx = filteredOptions.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [query, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setOpen(false);
        onCloseFocus?.();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) =>
          filteredOptions.length > 0 ? (i + 1) % filteredOptions.length : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          filteredOptions.length > 0
            ? (i - 1 + filteredOptions.length) % filteredOptions.length
            : 0,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const opt = filteredOptions[activeIndex];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
          onCloseFocus?.();
        }
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, filteredOptions, activeIndex, onChange, onCloseFocus]);

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
        title={triggerTitle}
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
          className={`absolute ${posClass} ${alignClass} z-40 ${menuWidthClass} p-1.5 rounded-[11px] bg-[#222222] border border-white/[0.15] shadow-[var(--shadow-float)] animate-veyra-fade flex flex-col gap-1`}
        >
          {menuTitle ? (
            <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
              {menuTitle}
            </div>
          ) : null}
          {searchable ? (
            <div className="px-1 pb-0.5">
              <div className="relative flex items-center">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2.5 text-[#6E6E6E]"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  aria-label={`Search ${ariaLabel}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full h-8 pl-7 pr-2.5 rounded-[6px] bg-[#171717] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
                />
              </div>
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-[12.5px] text-[#6E6E6E]">No matches</div>
            ) : (
              filteredOptions.map((opt, idx) => {
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
                      onCloseFocus?.();
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
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
