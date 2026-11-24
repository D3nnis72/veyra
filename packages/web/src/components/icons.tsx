import type { ProjectIconKey } from '@veyra/core/types';
import {
  Briefcase,
  Code,
  Cpu,
  Globe,
  Layers,
  type LucideIcon,
  Rocket,
  Shield,
  Sparkles,
} from 'lucide-react';

export const PROJECT_ICON_MAP: Record<ProjectIconKey, LucideIcon> = {
  Rocket,
  Layers,
  Cpu,
  Briefcase,
  Globe,
  Shield,
  Code,
  Sparkles,
};

export function isProjectIconKey(value: string | null | undefined): value is ProjectIconKey {
  return Boolean(value && value in PROJECT_ICON_MAP);
}

export function ProjectIcon({
  icon,
  size = 13,
  className,
}: {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!isProjectIconKey(icon)) return null;
  const Icon = PROJECT_ICON_MAP[icon];
  return <Icon size={size} strokeWidth={2} className={className} />;
}

export interface ProjectAccentStyle {
  hex: string;
  wash: string;
  badgeBg: string;
  border: string;
  text: string;
}

const ACCENT_WASH_LOOKUP: Record<string, { wash: string; text: string }> = {
  '#3B4BD8': { wash: '#171A30', text: '#AEB8FF' },
  '#2E9E6F': { wash: '#13261E', text: '#7BE0A0' },
  '#D9772B': { wash: '#291C12', text: '#F5A66B' },
  '#C94A6A': { wash: '#29151C', text: '#FF9EC5' },
  '#2A8FBD': { wash: '#12232C', text: '#7EE3F0' },
  '#8B5CF6': { wash: '#1F1933', text: '#C9B6FF' },
  '#C49B2A': { wash: '#272112', text: '#F2D06B' },
  '#6E7280': { wash: '#1D1E22', text: '#C4C4C4' },
};

export function getProjectAccentStyle(hex: string | null | undefined): ProjectAccentStyle {
  const normalized = (hex ?? '#6E7280').trim().toUpperCase();
  const matched = ACCENT_WASH_LOOKUP[normalized];
  if (matched) {
    return {
      hex: normalized,
      wash: matched.wash,
      badgeBg: `${normalized}26`,
      border: `${normalized}4D`,
      text: matched.text,
    };
  }
  return {
    hex: normalized || '#6E7280',
    wash: '#1D1E22',
    badgeBg: `${normalized || '#6E7280'}26`,
    border: `${normalized || '#6E7280'}4D`,
    text: '#EDEDED',
  };
}

export function getProjectMonogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'PR';
  const words = trimmed.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }
  const caps = trimmed.match(/[A-Z]/g);
  if (caps && caps.length >= 2) {
    return `${caps[0]}${caps[1]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  if (safe < 60) {
    return `${safe}m`;
  }
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatElapsedTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

export function getTodayDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatLocalTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export function formatTimeRange(startIso: string, endIso: string | null): string {
  const start = formatLocalTime(startIso);
  if (!endIso) return `${start} – now`;
  return `${start} – ${formatLocalTime(endIso)}`;
}

export function getSessionDurationMinutes(startedAt: string, endedAt: string | null): number {
  const s = Date.parse(startedAt);
  const e = endedAt ? Date.parse(endedAt) : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 0;
  return Math.max(1, Math.round((e - s) / 60_000));
}

export function formatDateHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}
