import { X } from 'lucide-react';
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { goalTint } from './goalTint';

export type PillTone =
  | 'goal'
  | 'ops'
  | 'due'
  | 'energy-up'
  | 'energy-down'
  | 'neutral'
  | 'cyan'
  | 'violet'
  | 'accent';

interface ToneTokens {
  bg: string;
  dot: string;
  text: string;
  border?: string;
}

const TONE_MAP: Record<PillTone, ToneTokens> = {
  goal: { bg: '#152B47', dot: '#4DA3FF', text: '#8FC7FF' },
  ops: { bg: '#3A3110', dot: '#E8B417', text: '#F2D06B' },
  due: { bg: '#3D2410', dot: '#F07C2A', text: '#F5A66B' },
  'energy-up': { bg: '#14331F', dot: '#2FB463', text: '#7BE0A0' },
  'energy-down': { bg: '#3D1A2B', dot: '#EC659B', text: '#FF9EC5' },
  neutral: { bg: '#2A2A2A', dot: '#A3A3A3', text: '#A3A3A3' },
  cyan: { bg: '#123840', dot: '#22B8CF', text: '#7EE3F0' },
  violet: { bg: '#291F45', dot: '#9D7FF7', text: '#C9B6FF' },
  accent: { bg: '#1F2759', dot: '#AEB8FF', text: '#AEB8FF', border: '#5566F258' },
};

export interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  dotColor?: string;
  bgColor?: string;
  textColor?: string;
  icon?: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
  onRemove?: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Pill({
  tone = 'neutral',
  dot = false,
  dotColor,
  bgColor,
  textColor,
  icon,
  onClick,
  onRemove,
  title,
  className = '',
  children,
}: PillProps) {
  const baseTokens = TONE_MAP[tone];
  const tint = tone === 'goal' && dotColor ? goalTint(dotColor) : null;
  const tokens: ToneTokens = tint
    ? { bg: tint.bg, dot: tint.dot, text: tint.text, border: tint.border }
    : baseTokens;
  const style: CSSProperties = {
    backgroundColor: bgColor ?? tokens.bg,
    color: textColor ?? tokens.text,
    ...(tokens.border ? { borderColor: tokens.border } : {}),
  };

  const baseClass = [
    'inline-flex items-center gap-2 min-h-[26px] px-3 py-1 rounded-[6px] text-[12px] font-medium leading-none max-w-full',
    tokens.border ? 'border' : '',
    onClick ? 'cursor-pointer hover:brightness-110 transition-[filter]' : '',
    className,
  ].join(' ');

  const content = (
    <>
      {dot ? (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor ?? tokens.dot }}
        />
      ) : null}
      {icon ? <span className="shrink-0 inline-flex items-center">{icon}</span> : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="ml-0.5 inline-flex items-center justify-center rounded hover:bg-white/10 p-0.5 cursor-pointer"
        >
          <X size={10} />
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} style={style} className={baseClass}>
        {content}
      </button>
    );
  }

  return (
    <span title={title} style={style} className={baseClass}>
      {content}
    </span>
  );
}
