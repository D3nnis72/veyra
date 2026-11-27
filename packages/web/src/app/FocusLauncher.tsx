import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  CornerDownLeft,
  Flame,
  FolderKanban,
  Play,
  Plus,
  Search,
  Video,
} from 'lucide-react';
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, queryKeys } from '../api/client';
import {
  invalidateBlockRelated,
  useProjectsQuery,
  useTodayQuery,
} from '../api/queries';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import {
  formatDuration,
  formatShortDate,
  formatTimeRange,
  getTodayDateString,
} from '../components/icons';
import { AppShellContext } from './AppShellContext';
import { formatHotkeyLabel, matchesAnyAccelerator, useHotkeys } from './hotkeys';

export interface FocusLauncherProps {
  open: boolean;
  /** Renders as the full-window content of the frameless desktop focus launcher window (⌘⇧O). */
  standalone?: boolean;
  onClose?: () => void;
}

interface LauncherItem {
  id: string;
  group: 'New' | 'Up Next' | 'Open Blocks';
  title: string;
  subtitle?: string;
  leading: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
}

export function FocusLauncher({ open, standalone = false, onClose }: FocusLauncherProps) {
  const shell = useContext(AppShellContext);
  const queryClient = useQueryClient();
  const hotkeys = useHotkeys();

  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const todayQuery = useTodayQuery();
  const blocksQuery = useQuery({
    queryKey: queryKeys.blocks({ status: 'todo' }),
    queryFn: () => apiClient.listBlocks({ status: 'todo' }),
    enabled: open,
  });

  const projects = useMemo(
    () => (shell?.projects ?? projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived'),
    [shell?.projects, projectsQuery.data?.projects],
  );
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const orderedProjects = useMemo(() => {
    const regular = projects.filter((p) => !p.isSystem);
    const system = projects.filter((p) => p.isSystem);
    return [...regular, ...system];
  }, [projects]);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectActiveIndex, setProjectActiveIndex] = useState(0);
  const [isOps, setIsOps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => orderedProjects.find((p) => p.id === projectId) ?? null,
    [orderedProjects, projectId],
  );

  const projectPickerOptions = useMemo(() => {
    const base = [
      { id: '', name: 'Other', project: null as (typeof orderedProjects)[number] | null },
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
      if (lower.startsWith(needle)) prefix.push(item);
      else if (lower.includes(needle)) substring.push(item);
    }
    return [...prefix, ...substring];
  }, [orderedProjects, projectQuery]);

  const close = useCallback(() => {
    setError(null);
    setProjectPickerOpen(false);
    setProjectQuery('');
    if (standalone) {
      void window.veyraDesktop?.closeFocusLauncherWindow?.();
    }
    onClose?.();
  }, [standalone, onClose]);

  const closeProjectPicker = useCallback(() => {
    setProjectPickerOpen(false);
    setProjectQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  const openProjectPicker = useCallback(() => {
    setProjectQuery('');
    setProjectPickerOpen(true);
    const currentIdx = [
      '',
      ...orderedProjects.filter((p) => !p.isSystem).map((p) => p.id),
    ].indexOf(projectId);
    setProjectActiveIndex(currentIdx >= 0 ? currentIdx : 0);
    window.setTimeout(() => projectSearchRef.current?.focus(), 10);
  }, [orderedProjects, projectId]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setProjectPickerOpen(false);
      setProjectQuery('');
      setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!standalone) return;
    const reset = () => {
      setQuery('');
      setSelectedIndex(0);
      setProjectPickerOpen(false);
      setProjectQuery('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.today });
      void queryClient.invalidateQueries({ queryKey: queryKeys.blocks({ status: 'todo' }) });
      window.setTimeout(() => inputRef.current?.focus(), 20);
    };
    window.addEventListener('veyra:floating-show', reset);
    return () => window.removeEventListener('veyra:floating-show', reset);
  }, [standalone, queryClient]);

  const startExistingBlock = useCallback(
    (blockId: string) => {
      setError(null);
      if (standalone || !shell) {
        const bridge = window.veyraDesktop;
        if (bridge?.focusAndDispatchAction) {
          void bridge.focusAndDispatchAction({ type: 'start-focus', blockId });
        } else {
          void apiClient
            .startFocus(blockId)
            .then(() => invalidateBlockRelated(queryClient, blockId));
        }
        onClose?.();
        return;
      }
      onClose?.();
      void shell.startFocusAndNavigate(blockId);
    },
    [standalone, shell, onClose, queryClient],
  );

  const createAndFocusMutation = useMutation({
    mutationFn: async (title: string) => {
      const todayStr = todayQuery.data?.date ?? getTodayDateString();
      const targetProject = projectId ? projectsById.get(projectId) : undefined;
      const { block } = await apiClient.createBlock({
        title: title.trim(),
        projectId: projectId || undefined,
        goalId: targetProject?.defaultGoalId ?? null,
        isOps,
        bucket: 'scheduled',
        scheduledDate: todayStr,
      });
      await apiClient.startFocus(block.id);
      return block;
    },
    onSuccess: (block) => {
      invalidateBlockRelated(queryClient, block.id);
      setQuery('');
      setIsOps(false);
      setError(null);
      if (standalone || !shell) {
        if (window.veyraDesktop?.focusAndDispatchAction) {
          void window.veyraDesktop.focusAndDispatchAction({ type: 'navigate', route: 'focus' });
        } else {
          void window.veyraDesktop?.closeFocusLauncherWindow?.();
        }
        onClose?.();
        return;
      }
      onClose?.();
      shell.navigate('focus');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to start focus block');
    },
  });

  const startNewFromQuery = useCallback(() => {
    if (createAndFocusMutation.isPending) return;
    const trimmed = query.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    createAndFocusMutation.mutate(trimmed);
  }, [query, createAndFocusMutation]);

  const items = useMemo<LauncherItem[]>(() => {
    const trimmed = query.trim();
    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    const matchesQuery = (hay: string) =>
      terms.length === 0 || terms.every((t) => hay.toLowerCase().includes(t));

    const upNextBlocks = todayQuery.data?.upNext ?? [];
    const upNextIds = new Set(upNextBlocks.map((b) => b.id));
    const upcomingMeetings = (todayQuery.data?.upcomingEvents ?? []).filter(
      (ev) => ev.status !== 'done' && ev.status !== 'dropped',
    );
    const otherOpenBlocks = (blocksQuery.data?.blocks ?? []).filter(
      (b) => !upNextIds.has(b.id) && b.status === 'todo',
    );

    const upNextItems: LauncherItem[] = [];
    for (const block of upNextBlocks) {
      const proj = projectsById.get(block.projectId);
      const hay = `${block.title} ${proj?.name ?? ''} ${block.notes}`;
      if (!matchesQuery(hay)) continue;
      const sizeLabel = block.sizeMinutes ? formatDuration(block.sizeMinutes) : null;
      upNextItems.push({
        id: `up-${block.id}`,
        group: 'Up Next',
        title: block.title,
        subtitle: [proj?.name, sizeLabel].filter(Boolean).join(' · ') || 'Today',
        leading: proj ? (
          <ProjectBadge name={proj.name} color={proj.color} icon={proj.icon} size="xs" />
        ) : (
          <Play size={12} className="text-[#AEB8FF]" />
        ),
        trailing: block.isOps ? <Pill tone="ops">Ops</Pill> : undefined,
        onSelect: () => startExistingBlock(block.id),
      });
    }

    for (const ev of upcomingMeetings) {
      const proj = ev.projectId ? projectsById.get(ev.projectId) : undefined;
      const hay = `${ev.title} ${proj?.name ?? ''} meeting`;
      if (!matchesQuery(hay)) continue;
      upNextItems.push({
        id: `mtg-${ev.id}`,
        group: 'Up Next',
        title: ev.title,
        subtitle: [proj?.name, formatTimeRange(ev.startAt, ev.endAt)].filter(Boolean).join(' · '),
        leading: (
          <span className="w-5 h-5 rounded-[5px] bg-[#242424] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] shrink-0">
            <Video size={11} />
          </span>
        ),
        trailing: ev.isOps ? <Pill tone="ops">Ops</Pill> : undefined,
        onSelect: () => startExistingBlock(ev.id),
      });
    }

    const otherItems: LauncherItem[] = [];
    for (const block of otherOpenBlocks) {
      const proj = projectsById.get(block.projectId);
      const bucketLabel =
        block.bucket === 'scheduled' && block.scheduledDate
          ? formatShortDate(block.scheduledDate)
          : block.bucket === 'later'
            ? 'Later'
            : 'Inbox';
      const hay = `${block.title} ${proj?.name ?? ''} ${bucketLabel} ${block.notes}`;
      if (!matchesQuery(hay)) continue;
      otherItems.push({
        id: `open-${block.id}`,
        group: 'Open Blocks',
        title: block.title,
        subtitle: [proj?.name, bucketLabel].filter(Boolean).join(' · '),
        leading: proj ? (
          <ProjectBadge name={proj.name} color={proj.color} icon={proj.icon} size="xs" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-[#6E6E6E]" />
        ),
        trailing: block.isOps ? <Pill tone="ops">Ops</Pill> : undefined,
        onSelect: () => startExistingBlock(block.id),
      });
    }

    const newItem: LauncherItem = {
      id: 'new-focus-block',
      group: 'New',
      title: trimmed ? `Create & focus "${trimmed}"` : 'New focus block',
      subtitle: trimmed
        ? `Today · ${selectedProject?.name ?? 'Other'}${isOps ? ' · Ops' : ''}`
        : 'Type a title above and press Enter to start immediately',
      leading: <Plus size={14} className="text-[#AEB8FF]" />,
      onSelect: startNewFromQuery,
    };

    // Empty search: Up Next first so Enter starts it right away (a New row without a title
    // cannot be confirmed), then Other Open (capped), with New at the end as a typing hint.
    // Active search: matching existing blocks first to avoid accidental duplicates, New right below.
    if (!trimmed) {
      return [...upNextItems.slice(0, 8), ...otherItems.slice(0, 8), newItem];
    }
    return [...upNextItems.slice(0, 10), ...otherItems.slice(0, 10), newItem];
  }, [
    query,
    todayQuery.data?.upNext,
    todayQuery.data?.upcomingEvents,
    blocksQuery.data?.blocks,
    projectsById,
    selectedProject?.name,
    isOps,
    startExistingBlock,
    startNewFromQuery,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= items.length && items.length > 0) {
      setSelectedIndex(items.length - 1);
    }
  }, [items.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (projectPickerOpen) {
          closeProjectPicker();
          return;
        }
        close();
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
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          items.length > 0 ? (prev - 1 + items.length) % items.length : 0,
        );
      } else if (e.key === 'Enter') {
        if ((e.metaKey || e.ctrlKey) && query.trim()) {
          e.preventDefault();
          startNewFromQuery();
          return;
        }
        const chosen = items[selectedIndex];
        if (chosen) {
          e.preventDefault();
          chosen.onSelect();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    open,
    projectPickerOpen,
    projectPickerOptions,
    projectActiveIndex,
    items,
    selectedIndex,
    query,
    hotkeys,
    close,
    closeProjectPicker,
    openProjectPicker,
    startNewFromQuery,
  ]);

  if (!open) return null;

  const grouped: Array<{ group: LauncherItem['group']; rows: Array<{ item: LauncherItem; idx: number }> }> = [];
  items.forEach((item, idx) => {
    const existing = grouped.find((g) => g.group === item.group);
    if (existing) existing.rows.push({ item, idx });
    else grouped.push({ group: item.group, rows: [{ item, idx }] });
  });

  const quickFocusLabel = formatHotkeyLabel(hotkeys.quickFocus) || '⌘⇧O';
  const projectHotkeyLabel = formatHotkeyLabel(hotkeys.cycleProject) || '⌃P';

  const card = (
    <div
      className={
        standalone
          ? 'w-full h-full bg-[#1C1C1C] flex flex-col overflow-hidden relative'
          : 'w-full max-w-[600px] rounded-[12px] bg-[#1C1C1C] border border-[#3C3C3C] shadow-[var(--shadow-float)] overflow-hidden animate-veyra-fade relative'
      }
    >
      {/* Search Bar */}
      <div
        className={`flex items-center gap-2.5 px-4 h-12 border-b border-[#2A2A2A] shrink-0 ${
          standalone ? 'veyra-drag-region' : ''
        }`}
      >
        <Search size={15} className="text-[#9A9A9A] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          aria-label="Focus launcher search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search blocks or type a new one to focus…"
          className="veyra-no-drag flex-1 bg-transparent text-[14.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
        />
        <span className="text-[11px] text-[#6E6E6E] font-medium shrink-0">{quickFocusLabel}</span>
      </div>

      {error ? (
        <div className="px-4 py-1.5 text-[12px] text-[#FF9EC5] border-b border-[#2A2A2A]">
          {error}
        </div>
      ) : null}

      {/* Grouped Results */}
      <div className={standalone ? 'flex-1 overflow-y-auto py-2 px-2' : 'max-h-[340px] overflow-y-auto py-2 px-2'}>
        {grouped.map((section) => (
          <div key={section.group} className="mb-2 last:mb-0">
            <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
              {section.group}
            </div>
            {section.rows.map(({ item, idx }) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.onSelect}
                  disabled={createAndFocusMutation.isPending}
                  className={[
                    'w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-[8px] text-left transition-colors',
                    active
                      ? 'bg-[#1F2759] border border-[#5566F2]/50 text-[#EDEDED]'
                      : 'border border-transparent text-[#C4C4C4] hover:bg-[#262626]',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0 inline-flex items-center justify-center w-5">
                      {item.leading}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-[#EDEDED] truncate">
                        {item.title}
                      </div>
                      {item.subtitle ? (
                        <div className="text-[11.5px] text-[#9A9A9A] truncate">{item.subtitle}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.trailing}
                    {active ? <CornerDownLeft size={12} className="text-[#AEB8FF]" /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: New-block Project / Ops defaults + keyboard hint */}
      <div className="px-3.5 py-2 border-t border-[#2A2A2A] bg-[#171717] flex items-center justify-between gap-2 text-[11px] text-[#6E6E6E] shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            title={`Project for new block (${projectHotkeyLabel})`}
            onClick={() => (projectPickerOpen ? closeProjectPicker() : openProjectPicker())}
            className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2 rounded-[6px] bg-[#242424] border border-[#323232] hover:border-[#4E4E4E] text-[12px] font-medium text-[#EDEDED] transition-colors"
          >
            {selectedProject ? (
              <ProjectBadge
                name={selectedProject.name}
                color={selectedProject.color}
                icon={selectedProject.icon}
                size="xs"
              />
            ) : (
              <FolderKanban size={12} className="text-[#9A9A9A]" />
            )}
            <span className="truncate max-w-[120px]">{selectedProject?.name ?? 'Other'}</span>
            <ChevronDown size={11} className="text-[#6E6E6E]" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            title="Toggle Ops for new block (⌥O)"
            onClick={() => setIsOps((v) => !v)}
            className={[
              'inline-flex items-center gap-1 h-7 px-2.5 rounded-[6px] border text-[12px] font-medium transition-colors',
              isOps
                ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                : 'bg-[#1C1C1C] border-[#323232] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#4E4E4E]',
            ].join(' ')}
          >
            <Flame size={11} />
            <span>{isOps ? 'Ops' : '+ Ops'}</span>
          </button>
        </div>

        <span className="tabular-nums">↑↓ Navigate · ↵ Focus · {projectHotkeyLabel} Project · Esc</span>
      </div>

      {/* Searchable Project Picker Popover */}
      {projectPickerOpen ? (
        <div
          role="dialog"
          aria-label="Choose project for new focus block"
          className="absolute left-3.5 bottom-12 z-40 w-[260px] rounded-[10px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-2.5 h-9 border-b border-[#2E2E2E]">
            <Search size={12} className="text-[#6E6E6E] shrink-0" />
            <input
              ref={projectSearchRef}
              type="text"
              aria-label="Search project"
              value={projectQuery}
              onChange={(e) => {
                setProjectQuery(e.target.value);
                setProjectActiveIndex(0);
              }}
              placeholder="Filter project…"
              className="flex-1 bg-transparent text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {projectPickerOptions.length === 0 ? (
              <div className="px-2.5 py-3 text-[12px] text-[#6E6E6E] text-center">
                No matching projects
              </div>
            ) : (
              projectPickerOptions.map((opt, idx) => {
                const isSelected = opt.id === projectId;
                const isHighlighted = idx === projectActiveIndex;
                return (
                  <button
                    key={opt.id || 'other'}
                    type="button"
                    onMouseEnter={() => setProjectActiveIndex(idx)}
                    onClick={() => {
                      setProjectId(opt.id);
                      closeProjectPicker();
                    }}
                    className={[
                      'w-full px-2.5 py-1.5 rounded-[6px] text-left text-[12.5px] flex items-center justify-between gap-2 transition-colors',
                      isHighlighted
                        ? 'bg-[#1F2759] text-[#EDEDED]'
                        : 'text-[#C4C4C4] hover:bg-white/[0.06]',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {opt.project ? (
                        <ProjectBadge
                          name={opt.project.name}
                          color={opt.project.color}
                          icon={opt.project.icon}
                          size="xs"
                        />
                      ) : (
                        <FolderKanban size={12} className="text-[#9A9A9A] shrink-0" />
                      )}
                      <span className="truncate">{opt.name}</span>
                    </span>
                    {isSelected ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (standalone) {
    return (
      <div className="h-screen w-screen bg-[#1C1C1C] flex flex-col border border-[#3C3C3C] rounded-[12px] overflow-hidden">
        {card}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus launcher"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/55 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {card}
    </div>
  );
}
