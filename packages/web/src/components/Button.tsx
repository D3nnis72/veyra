import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent-soft';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#3B4BD8] text-white border border-transparent hover:bg-[#4758E6] active:bg-[#3240C2] shadow-xs',
  secondary:
    'bg-[#262626] text-[#EDEDED] border border-[#3C3C3C] hover:bg-[#2F2F2F] hover:border-[#4A4A4A]',
  ghost:
    'bg-transparent text-[#C4C4C4] border border-transparent hover:bg-[#262626] hover:text-[#EDEDED]',
  danger:
    'bg-[#3D1A2B]/80 text-[#FF9EC5] border border-[#C94A6A]/40 hover:bg-[#3D1A2B] hover:border-[#C94A6A]/70',
  'accent-soft':
    'bg-[#1F2759] text-[#AEB8FF] border border-[#5566F2]/35 hover:bg-[#27316E] hover:text-[#D6DCFF]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-[6px]',
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-[6px]',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-[8px]',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-[8px]',
  icon: 'h-7 w-7 p-0 justify-center rounded-[6px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center font-medium transition-colors duration-150 select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3B4BD8]',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {leftIcon ? <span className="shrink-0 inline-flex items-center">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span className="shrink-0 inline-flex items-center">{rightIcon}</span> : null}
    </button>
  );
}
