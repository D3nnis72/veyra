import type { ExternalLink } from '@veyra/core/types';
import {
  BookOpen,
  Calendar,
  ExternalLink as ExternalLinkIcon,
  FileText,
  GitBranch,
  Globe,
  PenTool,
  X,
} from 'lucide-react';
import { openExternalUrl } from '../api/client';

export interface LinkChipProps {
  link: ExternalLink;
  onRemove?: () => void;
  className?: string;
}

function getSourceIcon(url: string, source: string) {
  const lower = `${source} ${url}`.toLowerCase();
  if (lower.includes('notion.so') || lower.includes('notion.site') || lower.includes('notion')) {
    return <FileText size={12} className="text-[#C4C4C4]" />;
  }
  if (lower.includes('github.com') || lower.includes('gitlab')) {
    return <GitBranch size={12} className="text-[#AEB8FF]" />;
  }
  if (lower.includes('figma.com')) {
    return <PenTool size={12} className="text-[#C9B6FF]" />;
  }
  if (lower.includes('linear.app') || lower.includes('docs')) {
    return <BookOpen size={12} className="text-[#8FC7FF]" />;
  }
  if (lower.includes('meet.google') || lower.includes('teams.microsoft') || lower.includes('zoom.us')) {
    return <Calendar size={12} className="text-[#7EE3F0]" />;
  }
  return <Globe size={12} className="text-[#9A9A9A]" />;
}

export function inferLinkSource(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('notion.so') || lower.includes('notion.site')) return 'notion';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('linear.app')) return 'linear';
  if (lower.includes('figma.com')) return 'figma';
  if (lower.includes('teams.microsoft') || lower.includes('meet.google') || lower.includes('zoom.us')) {
    return 'meeting';
  }
  return 'url';
}

export function inferLinkTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length > 0) {
      const last = decodeURIComponent(segs[segs.length - 1]).replace(/[-_]+/g, ' ').trim();
      if (last && last.length <= 42) {
        return last;
      }
    }
    return host;
  } catch {
    return url;
  }
}

export function LinkChip({ link, onRemove, className = '' }: LinkChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 h-8 max-w-full rounded-[7px]',
        'bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED]',
        'hover:border-[#525252] hover:bg-[#2C2C2C] transition-colors',
        className,
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => openExternalUrl(link.url)}
        title={link.url}
        className="inline-flex items-center gap-2 h-full px-3 min-w-0 max-w-[260px]"
      >
        <span className="shrink-0 inline-flex items-center">
          {getSourceIcon(link.url, link.source)}
        </span>
        <span className="truncate font-medium">{link.title}</span>
        <ExternalLinkIcon size={11} className="shrink-0 text-[#6E6E6E]" />
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove link ${link.title}`}
          className="h-full px-2 inline-flex items-center text-[#9A9A9A] hover:text-[#EDEDED] border-l border-[#3C3C3C]"
        >
          <X size={11} />
        </button>
      ) : null}
    </span>
  );
}
