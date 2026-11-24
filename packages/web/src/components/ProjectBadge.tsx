import {
  getProjectAccentStyle,
  getProjectMonogram,
  isProjectIconKey,
  ProjectIcon,
} from './icons';

export type ProjectBadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ProjectBadgeProps {
  name: string;
  color: string;
  icon?: string | null;
  size?: ProjectBadgeSize;
  className?: string;
}

const SIZE_STYLES: Record<
  ProjectBadgeSize,
  { box: string; icon: number; text: string }
> = {
  xs: { box: 'w-5 h-5 rounded-[5px]', icon: 12, text: 'text-[9.5px]' },
  sm: { box: 'w-6 h-6 rounded-[6px]', icon: 13, text: 'text-[10.5px]' },
  md: { box: 'w-7 h-7 rounded-[7px]', icon: 15, text: 'text-[11.5px]' },
  lg: { box: 'w-11 h-11 rounded-[10px]', icon: 20, text: 'text-[14px]' },
};

export function ProjectBadge({
  name,
  color,
  icon,
  size = 'sm',
  className = '',
}: ProjectBadgeProps) {
  const accent = getProjectAccentStyle(color);
  const spec = SIZE_STYLES[size];
  const hasVectorIcon = isProjectIconKey(icon);

  return (
    <span
      title={name}
      style={{
        backgroundColor: accent.badgeBg,
        borderColor: accent.border,
        color: accent.text,
      }}
      className={[
        'inline-flex items-center justify-center shrink-0 border font-semibold tracking-tight select-none',
        spec.box,
        className,
      ].join(' ')}
    >
      {hasVectorIcon ? (
        <ProjectIcon icon={icon} size={spec.icon} />
      ) : (
        <span className={`leading-none ${spec.text}`}>{getProjectMonogram(name)}</span>
      )}
    </span>
  );
}
