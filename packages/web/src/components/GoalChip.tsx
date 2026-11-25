import type { GoalKind } from '@veyra/core/types';
import { Briefcase, User } from 'lucide-react';
import type { MouseEventHandler } from 'react';
import { goalTint } from './goalTint';

export type GoalKindIconSize = 'xs' | 'sm' | 'md' | 'lg';

const BADGE_SIZE_CLASSES: Record<GoalKindIconSize, { box: string; icon: number }> = {
  xs: { box: 'h-[18px] w-[18px] rounded-[6px]', icon: 11 },
  sm: { box: 'h-5 w-5 rounded-[6px]', icon: 12 },
  md: { box: 'h-6 w-6 rounded-[6px]', icon: 13 },
  lg: { box: 'h-11 w-11 rounded-[8px]', icon: 20 },
};

export interface GoalKindIconBadgeProps {
  kind: GoalKind;
  color: string;
  size?: GoalKindIconSize;
  className?: string;
}

export function GoalKindIconBadge({
  kind,
  color,
  size = 'sm',
  className = '',
}: GoalKindIconBadgeProps) {
  const tint = goalTint(color);
  const dims = BADGE_SIZE_CLASSES[size];
  const Icon = kind === 'company' ? Briefcase : User;

  return (
    <span
      data-goal-kind={kind}
      aria-hidden="true"
      style={{
        backgroundColor: tint.bg,
        borderColor: tint.border,
        color: tint.text,
      }}
      className={[
        'inline-flex items-center justify-center border shrink-0',
        dims.box,
        className,
      ].join(' ')}
    >
      <Icon size={dims.icon} strokeWidth={2} />
    </span>
  );
}

export interface GoalChipProps {
  name: string;
  kind: GoalKind;
  color: string;
  onClick?: MouseEventHandler<HTMLElement>;
  title?: string;
  className?: string;
}

export function GoalChip({
  name,
  kind,
  color,
  onClick,
  title,
  className = '',
}: GoalChipProps) {
  const tint = goalTint(color);
  const style = {
    backgroundColor: tint.bg,
    borderColor: tint.border,
    color: tint.text,
  };

  const baseClass = [
    'inline-flex items-center gap-2 min-h-[26px] pl-1 pr-2 py-1 rounded-[6px] border text-[12px] font-medium leading-none max-w-full',
    onClick ? 'cursor-pointer hover:brightness-110 transition-[filter]' : '',
    className,
  ].join(' ');

  const content = (
    <>
      <GoalKindIconBadge kind={kind} color={color} size="xs" />
      <span className="truncate">{name}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title ?? name} style={style} className={baseClass}>
        {content}
      </button>
    );
  }

  return (
    <span title={title ?? name} style={style} className={baseClass}>
      {content}
    </span>
  );
}
