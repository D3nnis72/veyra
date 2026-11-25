import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExternalLink } from '@veyra/core/types';
import { Check, ChevronDown, CornerDownLeft, Flame, FolderKanban, Inbox, NotebookPen, Play, X } from 'lucide-react';
import { type FormEvent, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import {
  invalidateBlockRelated,
  invalidateNotesRelated,
  useProjectsQuery,
} from '../api/queries';
import { Button } from '../components/Button';
import { inferLinkSource, inferLinkTitle } from '../components/LinkChip';
import { ProjectBadge } from '../components/ProjectBadge';
import { getTodayDateString } from '../components/icons';
import { AppShellContext } from './AppShellContext';
import { matchesAnyAccelerator, useHotkeys } from './hotkeys';

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
  const [isOps, setIsOps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryInputRef = useRef<HTMLInputElement>(null);

  // Dedupe: keep non-system projects first, then system "Other" once at the end
  const orderedProjects = useMemo(() => {
    const regular = projects.filter((p) => !p.isSystem);
    const system = projects.filter((p) => p.isSystem);
    return [...regular, ...system];
  }, [projects]);

  const selectedProject = useMemo(
    () => orderedProjects.find((p) => p.id === projectId) ?? null,
    [orderedProjects, projectId],
  );

  const dismiss = () => {
    setError(null);
    setProjectPickerOpen(false);
    if (standalone) {
      void window.veyraDesktop?.closeCaptureWindow();
    }
    onClose?.();
  };

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
  // - Tab / Shift+Tab: cycle tabs (Daily Note -> Park into Inbox -> Focus Now)
  // - Ctrl+P: cycle project (rebindable)
  // - Alt+O: toggle Ops (rebindable)
  // - Cmd+Enter: create & start focus immediately (on Inbox or Focus tab)
  // - Esc: close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (projectPickerOpen) {
          setProjectPickerOpen(false);
          window.setTimeout(() => primaryInputRef.current?.focus(), 10);
          return;
        }
        dismiss();
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
        const ids = ['', ...orderedProjects.filter((p) => !p.isSystem).map((p) => p.id)];
        setProjectId((cur) => {
          const idx = ids.indexOf(cur);
          return ids[(idx + 1) % ids.length] ?? '';
        });
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, tab, orderedProjects, projectPickerOpen, noteContent, blockTitle, blockNoteOrUrl, projectId, isOps, isPending, hotkeys]);

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
            Daily Note
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

        <span className="text-[11px] text-[#6E6E6E] shrink-0">Tab switch · ⌃P project · Esc</span>
      </div>

      {/* Borderless Spotlight-style Inputs */}
      <div className="space-y-1.5 py-0.5">
        {tab === 'daily-note' ? (
          <input
            ref={primaryInputRef}
            type="text"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Capture a quick note, win, or blocker…"
            className="w-full bg-transparent border-0 px-0.5 py-1 font-display text-[17px] font-semibold text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
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
            onClick={() => setProjectPickerOpen((v) => !v)}
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

      {/* Sleek inline dark Project Picker overlay (never clipped inside 580×204 floating window!) */}
      {projectPickerOpen ? (
        <div className="absolute inset-0 z-20 bg-[#1C1C1C]/98 backdrop-blur-md px-5 py-4 flex flex-col gap-2.5 animate-veyra-fade">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A]">
              Choose Project
            </span>
            <button
              type="button"
              onClick={() => {
                setProjectPickerOpen(false);
                window.setTimeout(() => primaryInputRef.current?.focus(), 10);
              }}
              aria-label="Close project picker"
              className="h-6 w-6 rounded-[6px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED]"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-1.5 content-start">
            <button
              type="button"
              onClick={() => {
                setProjectId('');
                setProjectPickerOpen(false);
                window.setTimeout(() => primaryInputRef.current?.focus(), 10);
              }}
              className={[
                'h-9 px-2.5 rounded-[8px] border text-left text-[12.5px] font-medium flex items-center justify-between gap-2 transition-colors',
                projectId === ''
                  ? 'bg-[#1F2759] border-[#5566F2]/60 text-[#D6DCFF]'
                  : 'bg-[#242424] border-[#323232] text-[#C4C4C4] hover:border-[#4A4A4A] hover:text-[#EDEDED]',
              ].join(' ')}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FolderKanban size={13} className="text-[#9A9A9A] shrink-0" />
                <span className="truncate">{tab === 'daily-note' ? 'No project' : 'Other'}</span>
              </span>
              {projectId === '' ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
            </button>
            {orderedProjects
              .filter((p) => !p.isSystem)
              .map((p) => {
                const active = projectId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProjectId(p.id);
                      setProjectPickerOpen(false);
                      window.setTimeout(() => primaryInputRef.current?.focus(), 10);
                    }}
                    className={[
                      'h-9 px-2.5 rounded-[8px] border text-left text-[12.5px] font-medium flex items-center justify-between gap-2 transition-colors',
                      active
                        ? 'bg-[#1F2759] border-[#5566F2]/60 text-[#D6DCFF]'
                        : 'bg-[#242424] border-[#323232] text-[#EDEDED] hover:border-[#4A4A4A]',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <ProjectBadge name={p.name} color={p.color} icon={p.icon} size="xs" />
                      <span className="truncate">{p.name}</span>
                    </span>
                    {active ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
                  </button>
                );
              })}
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
