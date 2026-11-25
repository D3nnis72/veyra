import { COLOR_PICKER_PRESETS } from '@veyra/core/types';
import { Check, Pipette, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  className?: string;
}

/** Normalizes a 3- or 6-digit hex string (with or without leading `#`) to uppercase `#RRGGBB`. */
export function normalizeHexColor(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

function isLightHex(hex: string): boolean {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return false;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  // Relative luminance heuristic for choosing dark vs white check icon
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.66;
}

export function ColorPicker({ value, onChange, label, className = '' }: ColorPickerProps) {
  const normalizedValue = normalizeHexColor(value) ?? '#5E6AD2';
  const matchedPreset = COLOR_PICKER_PRESETS.find(
    (p) => p.hex.toUpperCase() === normalizedValue,
  );
  const isCustomActive = !matchedPreset;

  const [customOpen, setCustomOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(normalizedValue);
  const [hexError, setHexError] = useState<string | null>(null);
  const nativePickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexDraft(normalizedValue);
    setHexError(null);
  }, [normalizedValue]);

  const draftPreview = normalizeHexColor(hexDraft) ?? normalizedValue;

  const applyCustomHex = () => {
    const parsed = normalizeHexColor(hexDraft);
    if (!parsed) {
      setHexError('Enter a valid hex like #4DA3FF');
      return;
    }
    setHexError(null);
    onChange(parsed);
    setCustomOpen(false);
  };

  return (
    <div className={className}>
      {label ? (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
          {label}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {COLOR_PICKER_PRESETS.map((preset) => {
          const isSelected = preset.hex.toUpperCase() === normalizedValue;
          const checkColor = isLightHex(preset.hex) ? '#131313' : '#FFFFFF';
          return (
            <button
              key={preset.hex}
              type="button"
              aria-label={preset.name}
              aria-pressed={isSelected}
              title={preset.name}
              onClick={() => {
                setHexError(null);
                onChange(preset.hex.toUpperCase());
              }}
              style={{ backgroundColor: preset.hex }}
              className={[
                'h-[26px] w-[26px] rounded-full inline-flex items-center justify-center shrink-0 transition-transform box-border',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4BD8]',
                isSelected
                  ? 'border-2 border-[#EDEDED]'
                  : 'border border-white/10 hover:scale-105',
              ].join(' ')}
            >
              {isSelected ? (
                <Check size={12} strokeWidth={2.75} style={{ color: checkColor }} />
              ) : null}
            </button>
          );
        })}

        {/* 13th custom hex slot */}
        <button
          type="button"
          aria-label="Custom hex"
          aria-expanded={customOpen}
          aria-pressed={isCustomActive}
          title={isCustomActive ? `Custom hex (${normalizedValue})` : 'Custom hex'}
          onClick={() => {
            setCustomOpen((prev) => !prev);
            setHexError(null);
          }}
          style={isCustomActive ? { backgroundColor: normalizedValue } : undefined}
          className={[
            'h-[26px] w-[26px] rounded-full inline-flex items-center justify-center shrink-0 transition-colors box-border',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4BD8]',
            isCustomActive
              ? 'border-2 border-[#EDEDED]'
              : 'border border-dashed border-[#3C3C3C] bg-[#242424] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#6E6E6E]',
          ].join(' ')}
        >
          {isCustomActive ? (
            <Check
              size={12}
              strokeWidth={2.75}
              style={{ color: isLightHex(normalizedValue) ? '#131313' : '#FFFFFF' }}
            />
          ) : (
            <Plus size={13} strokeWidth={2.2} />
          )}
        </button>
      </div>

      {customOpen ? (
        <div className="mt-2.5 space-y-1.5">
          <div className="h-9 px-2 rounded-[8px] bg-[#242424] border border-[#2A2A2A] flex items-center gap-2">
            <span
              aria-hidden="true"
              data-testid="color-picker-draft-preview"
              className="h-[18px] w-[18px] rounded-[4px] border border-white/15 shrink-0"
              style={{ backgroundColor: draftPreview }}
            />
            <input
              type="text"
              aria-label="Hex color"
              value={hexDraft}
              onChange={(e) => {
                setHexDraft(e.target.value);
                if (hexError) setHexError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyCustomHex();
                }
              }}
              placeholder="#4DA3FF"
              className="flex-1 min-w-0 bg-transparent text-[13px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
            <label
              className="relative h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#2F2F2F] transition-colors cursor-pointer shrink-0"
              title="Custom color"
            >
              <Pipette size={13} />
              <input
                ref={nativePickerRef}
                type="color"
                aria-label="Custom color"
                value={draftPreview}
                onChange={(e) => {
                  const parsed = normalizeHexColor(e.target.value);
                  if (parsed) {
                    setHexDraft(parsed);
                    setHexError(null);
                  }
                }}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={applyCustomHex}
              className="h-6 px-2.5 rounded-[6px] bg-[#3B4BD8] hover:bg-[#4758E6] text-white text-[12px] font-medium transition-colors shrink-0"
            >
              Apply
            </button>
          </div>
          {hexError ? <p className="text-[11px] text-[#9A9A9A]">{hexError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
