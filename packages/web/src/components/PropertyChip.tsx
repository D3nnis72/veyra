import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface PropertyChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label?: string;
  active?: boolean;
  tone?: 'default' | 'goal' | 'ops' | 'due' | 'accent';
}

const TONE_CLASSES: Record<NonNullable<PropertyChipProps['tone']>, string> = {
  default: 'bg-[#262626] border-[#3C3C3C] text-[#EDEDED] hover:bg-[#2E2E2E] hover:border-[#4E4E4E]',
  goal: 'bg-[#152B47] border-[#4DA3FF]/40 text-[#8FC7FF] hover:brightness-110',
  ops: 'bg-[#3A3110] border-[#E8B417]/40 text-[#F2D06B] hover:brightness-110',
  due: 'bg-[#3D2410] border-[#F07C2A]/40 text-[#F5A66B] hover:brightness-110',
  accent: 'bg-[#1F2759] border-[#5566F2]/50 text-[#AEB8FF] hover:brightness-110',
};

export function PropertyChip({
  icon,
  label,
  active = false,
  tone = 'default',
  className = '',
  children,
  type = 'button',
  ...rest
}: PropertyChipProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3B4BD8]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        active && tone === 'default'
          ? 'bg-[#1F2759] border-[#5566F2]/55 text-[#D6DCFF]'
          : TONE_CLASSES[tone],
        className,
      ].join(' ')}
      {...rest}
    >
      {icon ? <span className="shrink-0 inline-flex items-center">{icon}</span> : null}
      {label ? <span className="text-[#9A9A9A] font-normal">{label}</span> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}
