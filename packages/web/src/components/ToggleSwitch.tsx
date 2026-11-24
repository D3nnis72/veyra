export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  id,
}: ToggleSwitchProps) {
  const trackSize = size === 'sm' ? 'w-8 h-[18px]' : 'w-9 h-5';
  const thumbSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const thumbShift = size === 'sm'
    ? checked ? 'translate-x-[15px]' : 'translate-x-[2px]'
    : checked ? 'translate-x-[18px]' : 'translate-x-[2px]';

  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex items-center shrink-0 rounded-full transition-colors duration-150',
        'border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4BD8]',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        trackSize,
        checked
          ? 'bg-[#3B4BD8] border-[#5566F2]'
          : 'bg-[#262626] border-[#3C3C3C]',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block rounded-full bg-white shadow-xs transition-transform duration-150',
          thumbSize,
          thumbShift,
        ].join(' ')}
      />
    </button>
  );

  if (!label && !description) {
    return button;
  }

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-start gap-2.5 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <span className="pt-0.5">{button}</span>
      <span className="flex flex-col">
        {label ? <span className="text-[13px] font-medium text-[#EDEDED]">{label}</span> : null}
        {description ? <span className="text-[12px] text-[#9A9A9A]">{description}</span> : null}
      </span>
    </label>
  );
}
