import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  CalendarRange,
  CheckCircle2,
  CornerDownLeft,
  FolderKanban,
  NotebookPen,
  Play,
  Plus,
  Search,
  Settings,
  Sun,
  Target,
  Zap,
} from 'lucide-react';
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, type DesktopCommandAction, queryKeys } from '../api/client';
import { invalidateBlockRelated, useGoalsQuery, useProjectsQuery } from '../api/queries';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import { formatShortDate } from '../components/icons';
import { type AppRoute, AppShellContext, type SettingsSection } from './AppShellContext';

export interface CommandPaletteProps {
  open: boolean;
  /** Renders as the full-window content of the frameless desktop command window (⌥K). */
  standalone?: boolean;
  onClose?: () => void;
}

interface PaletteItem {
  id: string;
  group: 'Actions' | 'Projects' | 'Blocks' | 'Goals';
  title: string;
  subtitle?: string;
  keywords: string;
  shortcut?: string;
  leading: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
}

export function CommandPalette({ open, standalone = false, onClose }: CommandPaletteProps) {
  const shell = useContext(AppShellContext);
  const queryClient = useQueryClient();

  // The standalone window has no app shell, so it loads its own lists. React Query
  // dedupes these with the shell's identical queries in the main window.
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const goalsQuery = useGoalsQuery({ includeArchived: false });
  const projects = shell?.projects ?? projectsQuery.data?.projects ?? [];
  const goals = shell?.goals ?? goalsQuery.data?.goals ?? [];

  const close = useCallback(() => {
    if (standalone) {
      void window.veyraDesktop?.closeCommandWindow?.();
    }
    onClose?.();
  }, [standalone, onClose]);

  // Runs an action in the main app: directly through the shell in-app, or via the
  // desktop bridge from the floating ⌥K window (which hides it and focuses Veyra).
  const run = useCallback(
    (action: DesktopCommandAction) => {
      if (standalone || !shell) {
        const bridge = window.veyraDesktop;
        if (bridge?.focusAndDispatchAction) {
          void bridge.focusAndDispatchAction(action);
        } else if (action.type === 'start-focus') {
          void apiClient
            .startFocus(action.blockId)
            .then(() => invalidateBlockRelated(queryClient, action.blockId));
        }
        onClose?.();
        return;
      }

      onClose?.();
      switch (action.type) {
        case 'navigate':
          if (action.route === 'project-detail' && action.projectId) {
            shell.openProject(action.projectId);
          } else {
            shell.navigate(action.route as AppRoute, {
              settingsSection: action.settingsSection as SettingsSection | undefined,
            });
          }
          return;
        case 'start-focus':
          void shell.startFocusAndNavigate(action.blockId);
          return;
        case 'open-block':
          shell.openBlockDrawer(action.blockId);
          return;
        case 'open-create-block':
          shell.openCreateBlock(action.title ? { title: action.title } : undefined);
          return;
        case 'open-daily-notes':
          shell.openDailyNotesDrawer();
          return;
        case 'open-quick-capture':
          shell.openQuickCapture();
          return;
      }
    },
    [standalone, shell, onClose, queryClient],
  );

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const blocksQuery = useQuery({
    queryKey: queryKeys.blocks({ includeDone: false, includeDropped: false }),
    queryFn: () => apiClient.listBlocks({ includeDone: false, includeDropped: false }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // The desktop window is reused between ⌥K presses: start fresh each time it shows.
  useEffect(() => {
    if (!standalone) return;
    const reset = () => {
      setQuery('');
      setSelectedIndex(0);
      void queryClient.invalidateQueries({ queryKey: queryKeys.blocks({ includeDone: false, includeDropped: false }) });
      window.setTimeout(() => inputRef.current?.focus(), 20);
    };
    window.addEventListener('veyra:floating-show', reset);
    return () => window.removeEventListener('veyra:floating-show', reset);
  }, [standalone, queryClient]);

  const projectsById = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p]));
    return map;
  }, [projects]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: 'act-new-block',
        group: 'Actions',
        title: 'Create New Block',
        subtitle: 'Schedule work or add to inbox',
        keywords: 'new block create task add',
        shortcut: '⌘N',
        leading: <Plus size={14} className="text-[#AEB8FF]" />,
        onSelect: () => run({ type: 'open-create-block' }),
      },
      {
        id: 'act-quick-capture',
        group: 'Actions',
        title: 'Quick Capture',
        subtitle: 'Daily Note or Park into Inbox',
        keywords: 'quick capture note inbox jot',
        shortcut: '⌘⇧P',
        leading: <Zap size={14} className="text-[#F2D06B]" />,
        onSelect: () => run({ type: 'open-quick-capture' }),
      },
      {
        id: 'act-daily-notes',
        group: 'Actions',
        title: 'Open Daily Notes Drawer',
        subtitle: "View & add today's timestamped bullets",
        keywords: 'daily notes drawer journal bullets',
        leading: <NotebookPen size={14} className="text-[#7EE3F0]" />,
        onSelect: () => run({ type: 'open-daily-notes' }),
      },
      {
        id: 'nav-today',
        group: 'Actions',
        title: 'Go to Today',
        keywords: 'today dashboard home',
        leading: <Sun size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'today' }),
      },
      {
        id: 'nav-plan',
        group: 'Actions',
        title: 'Go to Plan',
        keywords: 'plan week inbox later backlog',
        leading: <CalendarRange size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'plan' }),
      },
      {
        id: 'nav-calendar',
        group: 'Actions',
        title: 'Go to Calendar',
        keywords: 'calendar time timeline schedule meetings',
        leading: <Calendar size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'calendar' }),
      },
      {
        id: 'nav-projects',
        group: 'Actions',
        title: 'Go to Projects',
        keywords: 'projects workspace list',
        leading: <FolderKanban size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'projects' }),
      },
      {
        id: 'nav-review',
        group: 'Actions',
        title: 'Go to Weekly Review',
        keywords: 'review weekly ops radar rule',
        leading: <CheckCircle2 size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'review' }),
      },
      {
        id: 'nav-settings',
        group: 'Actions',
        title: 'Open Settings & Goals',
        keywords: 'settings goals integrations server cli appearance',
        shortcut: '⌘,',
        leading: <Settings size={14} className="text-[#9A9A9A]" />,
        onSelect: () => run({ type: 'navigate', route: 'settings', settingsSection: 'goals' }),
      },
    ];

    for (const project of projects) {
      items.push({
        id: `proj-${project.id}`,
        group: 'Projects',
        title: project.name,
        subtitle: project.description || `${project.openBlockCount} open blocks`,
        keywords: `project ${project.name} ${project.description}`,
        leading: (
          <ProjectBadge
            name={project.name}
            color={project.color}
            icon={project.icon}
            size="xs"
          />
        ),
        trailing:
          project.openBlockCount > 0 ? (
            <span className="text-[11px] text-[#6E6E6E] tabular-nums">
              {project.openBlockCount} open
            </span>
          ) : undefined,
        onSelect: () => run({ type: 'navigate', route: 'project-detail', projectId: project.id }),
      });
    }

    for (const block of blocksQuery.data?.blocks ?? []) {
      const proj = projectsById.get(block.projectId);
      const bucketLabel =
        block.bucket === 'scheduled' && block.scheduledDate
          ? formatShortDate(block.scheduledDate)
          : block.bucket === 'later'
            ? 'Later'
            : 'Inbox';

      items.push({
        id: `blk-${block.id}`,
        group: 'Blocks',
        title: block.title,
        subtitle: proj ? `${proj.name} · ${bucketLabel}` : bucketLabel,
        keywords: `block ${block.title} ${proj?.name ?? ''} ${block.notes}`,
        leading: proj ? (
          <ProjectBadge name={proj.name} color={proj.color} icon={proj.icon} size="xs" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-[#6E6E6E]" />
        ),
        trailing: (
          <div className="flex items-center gap-1.5">
            {block.isOps ? <Pill tone="ops">Ops</Pill> : null}
            <button
              type="button"
              title="Start Focus"
              onClick={(e) => {
                e.stopPropagation();
                run({ type: 'start-focus', blockId: block.id });
              }}
              className="h-6 px-1.5 rounded-[5px] bg-[#262626] border border-[#3C3C3C] hover:bg-[#3B4BD8] hover:border-transparent text-[11px] text-[#C4C4C4] hover:text-white inline-flex items-center gap-1"
            >
              <Play size={10} />
              Focus
            </button>
          </div>
        ),
        onSelect: () => run({ type: 'open-block', blockId: block.id }),
      });
    }

    for (const goal of goals) {
      items.push({
        id: `goal-${goal.id}`,
        group: 'Goals',
        title: goal.name,
        subtitle: goal.description || 'Goal',
        keywords: `goal ${goal.name} ${goal.description}`,
        leading: <Target size={14} style={{ color: goal.color || '#4DA3FF' }} />,
        onSelect: () => run({ type: 'navigate', route: 'settings', settingsSection: 'goals' }),
      });
    }

    return items;
  }, [projects, goals, blocksQuery.data, projectsById, run]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 18);
    const terms = q.split(/\s+/).filter(Boolean);
    return allItems
      .filter((item) => {
        const hay = `${item.title} ${item.subtitle ?? ''} ${item.keywords}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 24);
  }, [allItems, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].onSelect();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, selectedIndex, close]);

  // Keep the keyboard selection visible while arrowing through a long list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  let lastGroup: string | null = null;

  const searchRow = (
    <div
      className={`flex items-center gap-3 px-5 h-[56px] shrink-0 ${
        standalone ? 'veyra-drag-region' : ''
      }`}
    >
      <Search size={17} className="text-[#8A8A8A] shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search blocks, projects, goals, or run a command…"
        aria-label="Search"
        className="veyra-no-drag flex-1 min-w-0 bg-transparent border-0 px-0 font-display text-[16px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
      />
      <span className="text-[11px] text-[#6E6E6E] shrink-0">{standalone ? '⌥K' : '⌘K'}</span>
    </div>
  );

  const results = (
    <div
      ref={listRef}
      className={`overflow-y-auto p-1.5 ${standalone ? 'flex-1 min-h-0' : 'max-h-[440px]'}`}
    >
      {filtered.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <div className="text-[13px] text-[#9A9A9A]">No matching items for "{query}"</div>
          <button
            type="button"
            onClick={() => run({ type: 'open-create-block', title: query.trim() })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-white/[0.045] border border-white/[0.12] text-[12.5px] text-[#EDEDED] hover:bg-white/[0.08]"
          >
            <Plus size={13} />
            Create block "{query.trim()}"
          </button>
        </div>
      ) : (
        filtered.map((item, idx) => {
          const showGroupHeader = item.group !== lastGroup;
          lastGroup = item.group;
          const selected = idx === selectedIndex;

          return (
            <div key={item.id}>
              {showGroupHeader ? (
                <div className="px-3 pt-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  {item.group}
                </div>
              ) : null}
              <div
                role="button"
                tabIndex={-1}
                data-palette-index={idx}
                aria-selected={selected}
                onMouseMove={() => setSelectedIndex(idx)}
                onClick={() => item.onSelect()}
                className={[
                  'w-full px-3 py-2 rounded-[7px] flex items-center justify-between gap-2.5 cursor-pointer transition-colors',
                  selected
                    ? 'bg-[#1C1F33] text-[#EDEDED] shadow-[inset_0_0_0_1px_rgba(85,102,242,0.28)]'
                    : 'text-[#C4C4C4]',
                ].join(' ')}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-5 h-5 inline-flex items-center justify-center shrink-0">
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

                <div className="shrink-0 flex items-center gap-2">
                  {item.trailing}
                  {item.shortcut ? (
                    <kbd className="text-[11px] text-[#8A8A8A] bg-white/[0.05] border border-white/[0.08] px-1.5 py-0.5 rounded-[5px]">
                      {item.shortcut}
                    </kbd>
                  ) : selected ? (
                    <CornerDownLeft size={12} className="text-[#AEB8FF]" />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-3 px-5 h-9 shrink-0 border-t border-white/[0.08] text-[11px] text-[#6E6E6E]">
      <span>↑↓ Navigate · ↵ Open · Esc</span>
      <span>{standalone ? 'Opens in Veyra' : `${filtered.length} results`}</span>
    </div>
  );

  const card = (
    <>
      {searchRow}
      <div className="h-px shrink-0 bg-white/[0.08]" />
      {results}
      {footer}
    </>
  );

  if (standalone) {
    return (
      <div
        role="dialog"
        aria-label="Command palette"
        className="h-screen w-screen overflow-hidden flex flex-col bg-[#1C1C1C] border border-white/[0.15] text-[#EDEDED]"
      >
        {card}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px] animate-veyra-fade"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-[600px] flex flex-col bg-[#1C1C1C] border border-white/[0.15] rounded-[14px] shadow-[var(--shadow-float)] overflow-hidden animate-veyra-modal"
      >
        {card}
      </div>
    </div>
  );
}
