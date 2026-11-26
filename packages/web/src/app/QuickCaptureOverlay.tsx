import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExternalLink } from '@veyra/core/types';
import { Check, ChevronDown, CornerDownLeft, Flame, FolderKanban, Inbox, NotebookPen, Play, Search, X } from 'lucide-react';
import { type FormEvent, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import {
  invalidateBlockRelated,
  invalidateNotesRelated,
  useNoteTagsQuery,
  useProjectsQuery,
} from '../api/queries';
import { Button } from '../components/Button';
import { inferLinkSource, inferLinkTitle } from '../components/LinkChip';
import { NoteTagSuggestions, useNoteTagAutocomplete } from '../components/NoteTags';
import { ProjectBadge } from '../components/ProjectBadge';
import { getTodayDateString } from '../components/icons';
import { AppShellContext } from './AppShellContext';
import { formatHotkeyLabel, matchesAnyAccelerator, useHotkeys } from './hotkeys';

export type QuickCaptureTab = 'daily-note' | 'inbox' | 'focus';

const CAPTURE_TABS: QuickCaptureTab[] = ['daily-note', 'inbox', 'focus'];

export interface QuickCaptureOverlayProps {
  open: boolean;
  standalone?: boolean;
  initialTab?: QuickCaptureTab;
  onClose?: () => void;
}

function extractOptionalUrl(raw: string): { notes: string; links: ExternalLink[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { notes: '', links: [] };

  const singleUrlMatch = /^(https?:\/\/\S+)$/i.exec(trimmed);
  if (singleUrlMatch) {
    const url = singleUrlMatch[1];
    try {
      new URL(url);
      return {
        notes: '',
        links: [
          {
            url,
            title: inferLinkTitle(url),
            source: inferLinkSource(url),
          },
        ],
      };
    } catch {
      return { notes: trimmed, links: [] };
    }
  }

  return { notes: trimmed, links: [] };
}

export function QuickCaptureOverlay({
  open,
  standalone = false,
  initialTab = 'daily-note',
  onClose,
}: QuickCaptureOverlayProps) {
  const shell = useContext(AppShellContext);
  const queryClient = useQueryClient();
  const hotkeys = useHotkeys();
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const projects = useMemo(
    () => (projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived'),
    [projectsQuery.data],
  );

  const [tab, setTab] = useState<QuickCaptureTab>(initialTab);
  const [noteContent, setNoteContent] = useState('');
  const [blockTitle, setBlockTitle] = useState('');
  const [blockNoteOrUrl, setBlockNoteOrUrl] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectActiveIndex, setProjectActiveIndex] = useState(0);
  const [isOps, setIsOps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryInputRef = useRef<HTMLInputElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const noteTagsQuery = useNoteTagsQuery(open && tab === 'daily-note');
  const tagAutocomplete = useNoteTagAutocomplete(
    noteContent,
    setNoteContent,
    primaryInputRef,
    noteTagsQuery.data?.tags,
  );

  // Dedupe: keep non-system projects first, then system "Other" once at the end
  const orderedProjects = useMemo(() => {
    const regular = projects.filter((p) => !p.isSystem);
    const system = projects.filter((p) => p.isSystem);
    return [...regular, ...system];
  }, [projects]);

  const projectPickerOptions = useMemo(() => {
    const base = [
      {
        id: '',
        name: tab === 'daily-note' ? 'No project' : 'Other',
        project: null as (typeof orderedProjects)[number] | null,
      },
      ...orderedProjects
        .filter((p) => !p.isSystem)
        .map((p) => ({ id: p.id, name: p.name, project: p })),
    ];
    const needle = projectQuery.trim().toLowerCase();
    if (!needle) return base;
    const prefix: typeof base = [];
    const substring: typeof base = [];
    for (const item of base) {
      const lower = item.name.toLowerCase();
      if (lower.startsWith(needle)) {
        prefix.push(item);
      } else if (lower.includes(needle)) {
        substring.push(item);
      }
    }
    return [...prefix, ...substring];
  }, [orderedProjects, tab, projectQuery]);

  const selectedProject = useMemo(
    () => orderedProjects.find((p) => p.id === projectId) ?? null,
    [orderedProjects, projectId],
  );

  const closeProjectPicker = () => {
    setProjectPickerOpen(false);
    setProjectQuery('');
    window.setTimeout(() => primaryInputRef.current?.focus(), 10);
  };

  const openProjectPicker = () => {
    setProjectQuery('');
    setProjectPickerOpen(true);
    const currentIdx = [
      '',
      ...orderedProjects.filter((p) => !p.isSystem).map((p) => p.id),
    ].indexOf(projectId);
    setProjectActiveIndex(currentIdx >= 0 ? currentIdx : 0);
    window.setTimeout(() => projectSearchRef.current?.focus(), 10);
  };

  const dismiss = () => {
    setError(null);
    setProjectPickerOpen(false);
    setProjectQuery('');
    if (standalone) {
      void window.veyraDesktop?.closeCaptureWindow();
    }
    onClose?.();
  };

  useEffect(() => {
    if (!projectPickerOpen) return;
    if (projectQuery.trim()) {
      setProjectActiveIndex(0);
    } else {
      const idx = projectPickerOptions.findIndex((o) => o.id === projectId);
      setProjectActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [projectQuery, projectPickerOpen]);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setError(null);
      window.setTimeout(() => primaryInputRef.current?.focus(), 20);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => primaryInputRef.current?.focus(), 20);
  }, [tab, open]);

  // Listen for Electron global shortcut tab selection (⌘⇧P -> daily-note, ⌃O -> focus)
  useEffect(() => {
    const onCaptureTab = (e: Event) => {
      const next = (e as CustomEvent<{ tab?: QuickCaptureTab }>).detail?.tab;
      if (next && CAPTURE_TABS.includes(next)) {
        setTab(next);
        setError(null);
        window.setTimeout(() => primaryInputRef.current?.focus(), 20);
      }
    };
    window.addEventListener('veyra:capture-tab', onCaptureTab);
    return () => window.removeEventListener('veyra:capture-tab', onCaptureTab);
  }, []);

  const addNoteMutation = useMutation({
    mutationFn: () =>
      apiClient.addNote({
        content: noteContent.trim(),
        projectId: projectId || null,
        isOps,
      }),
    onSuccess: () => {
      setNoteContent('');
      setIsOps(false);
      invalidateNotesRelated(queryClient);
      dismiss();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    },
  });

  const createBlockMutation = useMutation({
    mutationFn: async (opts: { startFocus: boolean }) => {
      const { notes, links } = extractOptionalUrl(blockNoteOrUrl);
      const todayStr = getTodayDateString();
      const created = await apiClient.createBlock({
        title: blockTitle.trim(),
        projectId: projectId || undefined,
        goalId: selectedProject?.defaultGoalId ?? null,
        bucket: opts.startFocus ? 'scheduled' : 'inbox',
        scheduledDate: opts.startFocus ? todayStr : null,
        isOps,
        notes,
        externalLinks: links,
      });
      return { block: created.block, startFocus: opts.startFocus };
    },
    onSuccess: async ({ block, startFocus }) => {
      setBlockTitle('');
      setBlockNoteOrUrl('');
      setIsOps(false);
      invalidateBlockRelated(queryClient, block.id);

      if (startFocus) {
        if (standalone || !shell) {
          if (window.veyraDesktop?.focusAndDispatchAction) {
            await window.veyraDesktop.focusAndDispatchAction({
              type: 'start-focus',
              blockId: block.id,
            });
          } else {
            await apiClient.startFocus(block.id);
            invalidateBlockRelated(queryClient, block.id);
            dismiss();
          }
          onClose?.();
          return;
        }
        dismiss();
        await shell.startFocusAndNavigate(block.id);
        return;
      }

      dismiss();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create block');
    },
  });

  const isPending = addNoteMutation.isPending || createBlockMutation.isPending;

  const submit = (forceFocus = false) => {
    if (isPending) return;
    setError(null);

    if (tab === 'daily-note') {
      if (!noteContent.trim()) return;
      addNoteMutation.mutate();
      return;
    }

    if (!blockTitle.trim()) return;
    createBlockMutation.mutate({ startFocus: forceFocus || tab === 'focus' });
  };

  // Full keyboard navigation inside Quick Capture:
  // - Tab / Shift+Tab: cycle tabs (Note -> Park into Inbox -> Focus Now)
  // - Ctrl+P: open searchable project picker (rebindable); when open, arrows/Ctrl+P navigate and Enter picks
  // - Alt+O: toggle Ops (rebindable)
  // - Cmd+Enter: create & start focus immediately (on Inbox or Focus tab)
  // - Esc: close project picker first, then overlay
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // `#` tag suggestions take Tab/Enter/arrows/Esc first while the note input shows them.
      if (
        tab === 'daily-note' &&
        !projectPickerOpen &&
        e.target === primaryInputRef.current &&
        tagAutocomplete.handleKey(e)
      ) {
        e.stopImmediatePropagation();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (projectPickerOpen) {
          closeProjectPicker();
          return;
        }
        dismiss();
        return;
      }

      if (projectPickerOpen) {
        if (matchesAnyAccelerator(e, hotkeys.cycleProject) || e.key === 'ArrowDown') {
          e.preventDefault();
          setProjectActiveIndex((idx) =>
            projectPickerOptions.length > 0 ? (idx + 1) % projectPickerOptions.length : 0,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setProjectActiveIndex((idx) =>
            projectPickerOptions.length > 0
              ? (idx - 1 + projectPickerOptions.length) % projectPickerOptions.length
              : 0,
          );
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const chosen = projectPickerOptions[projectActiveIndex];
          if (chosen) {
            setProjectId(chosen.id);
            closeProjectPicker();
          }
          return;
        }
        return;
      }

      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setProjectPickerOpen(false);
        setTab((current) => {
          const idx = CAPTURE_TABS.indexOf(current);
          const nextIdx = e.shiftKey
            ? (idx - 1 + CAPTURE_TABS.length) % CAPTURE_TABS.length
            : (idx + 1) % CAPTURE_TABS.length;
          return CAPTURE_TABS[nextIdx];
        });
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.cycleProject)) {
        e.preventDefault();
        openProjectPicker();
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.toggleOps)) {
        e.preventDefault();
        setIsOps((v) => !v);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit(tab !== 'daily-note');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    open,
    tab,
    orderedProjects,
    projectPickerOpen,
    projectPickerOptions,
    projectActiveIndex,
    noteContent,
    blockTitle,
    blockNoteOrUrl,
    projectId,
    isOps,
    isPending,
    hotkeys,
    tagAutocomplete,
  ]);

  const projectHotkeyLabel = formatHotkeyLabel(hotkeys.cycleProject) || '⌃P';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };

  const formContent = (
    <form
      onSubmit={handleSubmit}
      className={standalone ? 'flex-1 flex flex-col justify-between gap-3' : 'flex flex-col gap-4'}
    >
      {/* Mode Switcher Tabs (Tab cycles; draggable in standalone window) */}
      <div
        className={`flex items-center justify-between gap-2 ${
          standalone ? 'veyra-drag-region' : ''
        }`}
      >
        <div className="veyra-no-drag inline-flex items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setTab('daily-note')}
            className={[
              'h-7 px-2.5 rounded-[7px] text-[12px] font-medium inline-flex items-center gap-1.5 border transition-colors',
              tab === 'daily-note'
                ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#D6DCFF]'
                : 'bg-[#171717] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED]',
            ].join(' ')}
          >
            <NotebookPen size={12} />
            Note
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setTab('inbox')}
            className={[
              'h-7 px-2.5 rounded-[7px] text-[12px] font-medium inline-flex items-center gap-1.5 border transition-colors',
              tab === 'inbox'
                ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#D6DCFF]'
                : 'bg-[#171717] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED]',
            ].join(' ')}
          >
            <Inbox size={12} />
            Inbox
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setTab('focus')}
            className={[
              'h-7 px-2.5 rounded-[7px] text-[12px] font-medium inline-flex items-center gap-1.5 border transition-colors',
              tab === 'focus'
                ? 'bg-[#3B4BD8]/30 border-[#5566F2]/60 text-[#D6DCFF]'
                : 'bg-[#171717] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED]',
            ].join(' ')}
          >
            <Play size={11} fill="currentColor" />
            Focus Now
          </button>
        </div>

        <span className="text-[11px] text-[#6E6E6E] shrink-0">
          Tab switch · {projectHotkeyLabel} project · Esc
        </span>
      </div>

      {/* Borderless Spotlight-style Inputs */}
      <div className="space-y-1.5 py-0.5">
        {tab === 'daily-note' ? (
          <div className="relative">
            <input
              ref={primaryInputRef}
              type="text"
              aria-label="Note"
              value={noteContent}
              onChange={(e) => {
                setNoteContent(e.target.value);
                tagAutocomplete.syncCaret(e.target);
              }}
              onSelect={(e) => tagAutocomplete.syncCaret(e.currentTarget)}
              placeholder="Capture a quick note, win, or blocker… #tag to file it"
              className="w-full bg-transparent border-0 px-0.5 py-1 font-display text-[17px] font-semibold text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
            {/* Overlays the footer instead of growing the fixed 580×204 capture window */}
            <NoteTagSuggestions
              autocomplete={tagAutocomplete}
              className="absolute left-0 right-0 top-full z-10 mt-1 py-1 bg-[#1C1C1C]"
            />
          </div>
        ) : (
          <>
            <input
              ref={primaryInputRef}
              type="text"
              value={blockTitle}
              onChange={(e) => setBlockTitle(e.target.value)}
              placeholder={
                tab === 'focus'
                  ? 'What are you focusing on right now?…'
                  : 'Block title to park in Inbox…'
              }
              className="w-full bg-transparent border-0 px-0.5 py-0.5 font-display text-[17px] font-semibold text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
            <input
              type="text"
              value={blockNoteOrUrl}
              onChange={(e) => setBlockNoteOrUrl(e.target.value)}
              placeholder="Optional note or Notion URL…"
              className="w-full bg-transparent border-0 px-0.5 py-0.5 text-[13px] text-[#C4C4C4] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </>
        )}
        {error ? <div className="text-[12px] text-[#FF9EC5] pt-0.5">{error}</div> : null}
      </div>

      {/* Footer: Property Pills + Submit */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#2A2A2A]">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            tabIndex={-1}
            title={`Select project (${projectHotkeyLabel})`}
            onClick={() => (projectPickerOpen ? closeProjectPicker() : openProjectPicker())}
            className="inline-flex items-center gap-2 h-8 pl-2 pr-2.5 rounded-[7px] bg-[#262626] border border-[#3C3C3C] hover:border-[#525252] text-[12.5px] font-medium text-[#EDEDED] cursor-pointer transition-colors"
          >
            {selectedProject ? (
              <ProjectBadge
                name={selectedProject.name}
                color={selectedProject.color}
                icon={selectedProject.icon}
                size="xs"
              />
            ) : (
              <FolderKanban size={13} className="text-[#9A9A9A]" />
            )}
            <span className="truncate max-w-[140px]">
              {selectedProject ? selectedProject.name : tab === 'daily-note' ? 'No project' : 'Other'}
            </span>
            <ChevronDown size={12} className="text-[#6E6E6E]" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            title="Toggle Ops (⌥O)"
            onClick={() => setIsOps((v) => !v)}
            className={[
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-[7px] border text-[12.5px] font-medium transition-colors',
              isOps
                ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
            ].join(' ')}
          >
            <Flame size={12} />
            <span>{isOps ? 'Ops' : '+ Ops'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {tab === 'inbox' ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={isPending || !blockTitle.trim()}
              onClick={() => submit(true)}
              className="h-8 px-2.5 rounded-[7px] border border-[#3C3C3C] bg-[#262626] hover:border-[#525252] text-[12px] font-medium text-[#C4C4C4] hover:text-[#EDEDED] disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors"
            >
              <Play size={11} fill="currentColor" />
              <span>Focus ⌘↵</span>
            </button>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={
              isPending || (tab === 'daily-note' ? !noteContent.trim() : !blockTitle.trim())
            }
            leftIcon={tab === 'focus' ? <Play size={12} fill="currentColor" /> : undefined}
            rightIcon={tab !== 'focus' ? <CornerDownLeft size={13} /> : undefined}
          >
            {tab === 'daily-note'
              ? 'Save Note'
              : tab === 'focus'
                ? 'Start Focus ↵'
                : 'Park in Inbox'}
          </Button>
        </div>
      </div>

      {/* Sleek inline searchable dark Project Picker overlay (never clipped inside 580×204 floating window!) */}
      {projectPickerOpen ? (
        <div className="absolute inset-0 z-20 bg-[#1C1C1C]/98 backdrop-blur-md px-5 py-3.5 flex flex-col gap-2.5 animate-veyra-fade">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 flex items-center">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 text-[#6E6E6E]"
              />
              <input
                ref={projectSearchRef}
                type="text"
                aria-label="Filter projects"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                  }
                }}
                placeholder="Filter projects… (↑↓ / ↵)"
                className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-[#242424] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={closeProjectPicker}
              aria-label="Close project picker"
              className="h-8 w-8 rounded-[8px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] shrink-0"
            >
              <X size={13} />
            </button>
          </div>
          <div
            role="listbox"
            aria-label="Projects"
            className="flex-1 overflow-y-auto grid grid-cols-3 gap-1.5 content-start"
          >
            {projectPickerOptions.length === 0 ? (
              <div className="col-span-3 py-4 text-center text-[12.5px] text-[#6E6E6E]">
                No matching projects
              </div>
            ) : (
              projectPickerOptions.map((item, idx) => {
                const active = projectId === item.id;
                const highlighted = idx === projectActiveIndex;
                return (
                  <button
                    key={item.id || '__default'}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setProjectActiveIndex(idx)}
                    onClick={() => {
                      setProjectId(item.id);
                      closeProjectPicker();
                    }}
                    className={[
                      'h-9 px-2.5 rounded-[8px] border text-left text-[12.5px] font-medium flex items-center justify-between gap-2 transition-colors',
                      active
                        ? 'bg-[#1F2759] border-[#5566F2]/60 text-[#D6DCFF]'
                        : highlighted
                          ? 'bg-[#2A2A2A] border-[#5566F2]/60 text-[#EDEDED]'
                          : 'bg-[#242424] border-[#323232] text-[#EDEDED] hover:border-[#4A4A4A]',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {item.project ? (
                        <ProjectBadge
                          name={item.project.name}
                          color={item.project.color}
                          icon={item.project.icon}
                          size="xs"
                        />
                      ) : (
                        <FolderKanban size={13} className="text-[#9A9A9A] shrink-0" />
                      )}
                      <span className="truncate">{item.name}</span>
                    </span>
                    {active ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </form>
  );

  if (standalone) {
    return (
      <div className="relative h-screen w-screen bg-[#1C1C1C] border border-white/[0.15] px-5 py-4 flex flex-col">
        {formContent}
      </div>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh] px-4">
      <div
        aria-hidden="true"
        onClick={dismiss}
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px] animate-veyra-fade"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick Capture"
        className="relative z-10 w-full max-w-[580px] rounded-[14px] bg-[#1C1C1C] border border-white/[0.15] shadow-[var(--shadow-float)] px-5 py-4 overflow-hidden animate-veyra-modal"
      >
        {formContent}
      </div>
    </div>
  );
}
