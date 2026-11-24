import type { ExternalLink, NotionSearchResult } from '@veyra/core/types';
import {
  Check,
  Database,
  FileText,
  Link2,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotionSearchQuery, useSettingsQuery } from '../api/queries';
import { Button } from './Button';
import { inferLinkSource, inferLinkTitle } from './LinkChip';
import { formatShortDate } from './icons';

export interface LinkPickerPopoverProps {
  open: boolean;
  onClose: () => void;
  existingLinks: ExternalLink[];
  onAddLink: (link: ExternalLink) => void;
}

const COMMON_TLDS = new Set([
  'com',
  'org',
  'net',
  'io',
  'so',
  'site',
  'app',
  'dev',
  'ai',
  'co',
  'de',
  'eu',
  'gg',
  'me',
  'us',
  'uk',
  'ch',
  'at',
]);

/**
 * Distinguishes direct URL pastes from free-text Notion search queries.
 * Explicit `http(s)://` URLs always match; scheme-less strings only match
 * when they look like a real domain + path or a well-known web domain.
 */
export function looksLikeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) return true;

  const domainMatch = /^([a-z0-9-]+\.)+([a-z]{2,})(\/.*)?$/i.exec(trimmed);
  if (!domainMatch) return false;
  const tld = domainMatch[2].toLowerCase();
  const hasPath = Boolean(domainMatch[3]);
  return hasPath || COMMON_TLDS.has(tld);
}

export function normalizeUrlInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatEditedShort(iso: string): string {
  if (!iso || iso.length < 10) return '';
  return formatShortDate(iso.slice(0, 10));
}

export function LinkPickerPopover({
  open,
  onClose,
  existingLinks,
  onAddLink,
}: LinkPickerPopoverProps) {
  const settingsQuery = useSettingsQuery();
  const [inputValue, setInputValue] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [urlError, setUrlError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isUrlInput = useMemo(() => looksLikeUrl(inputValue), [inputValue]);
  const settingsSaysUnconfigured = settingsQuery.data?.notionConfigured === false;

  // Reset state whenever popover opens
  useEffect(() => {
    if (!open) return;
    setInputValue('');
    setCustomTitle('');
    setDebouncedQuery('');
    setActiveIndex(0);
    setUrlError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Debounce typed search queries; clear immediately when empty
  useEffect(() => {
    if (!open || isUrlInput) return;
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, inputValue, isUrlInput]);

  const shouldSearchNotion = open && !isUrlInput && !settingsSaysUnconfigured;
  const searchQuery = useNotionSearchQuery(debouncedQuery, shouldSearchNotion);

  const notionConfigured =
    searchQuery.data?.configured ?? settingsQuery.data?.notionConfigured ?? false;
  const results = useMemo<NotionSearchResult[]>(
    () => (notionConfigured && !isUrlInput ? (searchQuery.data?.results ?? []) : []),
    [notionConfigured, isUrlInput, searchQuery.data?.results],
  );

  const existingUrlSet = useMemo(
    () => new Set(existingLinks.map((l) => l.url)),
    [existingLinks],
  );

  // Keep activeIndex in bounds whenever results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Dismiss on Escape (capture phase so parent drawer/modal stays open) and outside click
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);

  const attachUrl = useCallback(() => {
    const normalized = normalizeUrlInput(inputValue);
    if (!normalized) {
      setUrlError('Enter a valid URL (e.g. https://notion.so/...)');
      return;
    }
    setUrlError(null);
    if (!existingUrlSet.has(normalized)) {
      onAddLink({
        url: normalized,
        title: customTitle.trim() || inferLinkTitle(normalized),
        source: inferLinkSource(normalized),
      });
    }
    onClose();
  }, [inputValue, customTitle, existingUrlSet, onAddLink, onClose]);

  const attachNotionResult = useCallback(
    (item: NotionSearchResult) => {
      if (!existingUrlSet.has(item.url)) {
        onAddLink({
          url: item.url,
          title: item.title,
          source: 'notion',
        });
      }
      onClose();
    },
    [existingUrlSet, onAddLink, onClose],
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isUrlInput) {
        attachUrl();
        return;
      }
      if (results.length > 0 && results[activeIndex]) {
        attachNotionResult(results[activeIndex]);
        return;
      }
      if (inputValue.trim()) {
        attachUrl();
      }
    }
  };

  if (!open) return null;

  const showSearching =
    shouldSearchNotion &&
    (searchQuery.isLoading || (searchQuery.isFetching && results.length === 0));

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Add link picker"
      className="rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] p-2 space-y-2 animate-veyra-fade"
    >
      {/* Unified Search / URL Input */}
      <div className="flex items-center gap-2 h-9 px-2.5 rounded-[7px] bg-[#171717] border border-[#3C3C3C] focus-within:border-[#5566F2] transition-colors">
        {isUrlInput || !notionConfigured ? (
          <Link2 size={13} className="text-[#9A9A9A] shrink-0" />
        ) : (
          <Search size={13} className="text-[#9A9A9A] shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="veyra-notion-link-results"
          aria-activedescendant={
            results[activeIndex] ? `veyra-notion-option-${results[activeIndex].id}` : undefined
          }
          aria-label="Search Notion or paste URL"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (urlError) setUrlError(null);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={
            notionConfigured
              ? 'Search Notion pages or paste any URL…'
              : 'Paste any URL (https://notion.so/…)'
          }
          className="flex-1 min-w-0 bg-transparent text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
        />
        {showSearching ? (
          <Loader2 size={13} className="text-[#9A9A9A] animate-spin shrink-0" />
        ) : inputValue ? (
          <button
            type="button"
            aria-label="Clear input"
            onClick={() => {
              setInputValue('');
              setUrlError(null);
              inputRef.current?.focus();
            }}
            className="text-[#6E6E6E] hover:text-[#EDEDED] transition-colors shrink-0"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>

      {/* Direct URL Attach Controls */}
      {isUrlInput || !notionConfigured ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Link label"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  attachUrl();
                }
              }}
              placeholder="Label (optional)"
              className="flex-1 h-8 px-2.5 rounded-[6px] bg-[#171717] border border-[#3C3C3C] focus:border-[#5566F2] text-[12px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
            <Button
              type="button"
              variant="primary"
              size="xs"
              disabled={!inputValue.trim()}
              onClick={attachUrl}
            >
              Add link
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onClose}>
              Cancel
            </Button>
          </div>
          {urlError ? <div className="text-[11.5px] text-[#FF9EC5] px-0.5">{urlError}</div> : null}
          {!notionConfigured && !isUrlInput ? (
            <div className="text-[11.5px] text-[#6E6E6E] px-0.5">
              Add a Notion token in Settings → Integrations to search pages live.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Live Notion Search Results */}
      {!isUrlInput && notionConfigured ? (
        <div className="space-y-1">
          {searchQuery.isError ? (
            <div className="px-2 py-2 text-[12px] text-[#FF9EC5]">
              {searchQuery.error instanceof Error
                ? searchQuery.error.message
                : 'Notion search failed — paste any URL instead.'}
            </div>
          ) : showSearching ? (
            <div className="px-2 py-3 text-[12px] text-[#9A9A9A] flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              <span>Searching Notion…</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-[#6E6E6E]">
              {debouncedQuery
                ? `No Notion pages found for "${debouncedQuery}".`
                : 'No recent Notion pages shared with your integration.'}
            </div>
          ) : (
            <>
              <div className="px-2 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                {debouncedQuery ? 'Notion results' : 'Recent Notion pages'}
              </div>
              <div
                id="veyra-notion-link-results"
                role="listbox"
                aria-label="Notion search results"
                className="max-h-56 overflow-y-auto space-y-0.5"
              >
                {results.map((item, idx) => {
                  const isHighlighted = idx === activeIndex;
                  const alreadyLinked = existingUrlSet.has(item.url);
                  const editedLabel = formatEditedShort(item.lastEditedTime);
                  return (
                    <button
                      key={item.id}
                      id={`veyra-notion-option-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => attachNotionResult(item)}
                      className={[
                        'w-full px-2.5 py-2 rounded-[7px] text-left flex items-center justify-between gap-2.5 transition-colors',
                        isHighlighted ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {item.objectType === 'database' ? (
                          <Database size={13} className="text-[#8FC7FF] shrink-0" />
                        ) : (
                          <FileText size={13} className="text-[#C4C4C4] shrink-0" />
                        )}
                        <span className="text-[13px] text-[#EDEDED] truncate">{item.title}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-[11px] text-[#6E6E6E] tabular-nums">
                        {alreadyLinked ? (
                          <span className="inline-flex items-center gap-1 text-[#7BE0A0]">
                            <Check size={11} />
                            Linked
                          </span>
                        ) : (
                          <>
                            {item.objectType === 'database' ? (
                              <span className="text-[#8FC7FF]">Database</span>
                            ) : null}
                            {editedLabel ? <span>{editedLabel}</span> : null}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="pt-1.5 px-1 border-t border-[#2E2E2E] flex items-center justify-between text-[11px] text-[#6E6E6E]">
            <span>↑↓ navigate · ↵ attach · Esc close</span>
            <button
              type="button"
              onClick={onClose}
              className="text-[#9A9A9A] hover:text-[#EDEDED] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
