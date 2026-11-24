import type { Goal, ProjectWithStats } from '@veyra/core/types';
import { ExternalLink, Pencil, Pin, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { openExternalUrl } from '../api/client';
import { useGoalsQuery, useProjectsQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { useProjectContextMenu } from '../components/entityMenus';
import { ProjectBadge } from '../components/ProjectBadge';
import { formatDuration } from '../components/icons';
import { ProjectModal } from './ProjectModal';

type ProjectFilter = 'all' | 'active' | 'quiet' | 'paused' | 'archived';

function formatRelativeLastTouched(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const diffDays = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  return `${diffDays}d ago`;
}

export function ProjectsView() {
  const { openProject } = useAppShell();
  const projectMenu = useProjectContextMenu();
  const projectsQuery = useProjectsQuery({ includeArchived: true });
  const goalsQuery = useGoalsQuery({ includeArchived: false });

  const allProjects = projectsQuery.data?.projects ?? [];
  const goalsById = useMemo(() => {
    const map = new Map<string, Goal>();
    for (const g of goalsQuery.data?.goals ?? []) {
      map.set(g.id, g);
    }
    return map;
  }, [goalsQuery.data?.goals]);

  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [search, setSearch] = useState('');
  const [modalState, setModalState] = useState<{
    open: boolean;
    project: ProjectWithStats | null;
  }>({ open: false, project: null });

  const counts = useMemo(() => {
    const nonArchived = allProjects.filter((p) => p.status !== 'archived');
    return {
      all: nonArchived.length,
      active: allProjects.filter((p) => p.status === 'active').length,
      quiet: allProjects.filter((p) => p.status === 'active' && p.isQuiet).length,
      paused: allProjects.filter((p) => p.status === 'paused').length,
      archived: allProjects.filter((p) => p.status === 'archived').length,
    };
  }, [allProjects]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allProjects.filter((p) => {
      if (filter === 'all' && p.status === 'archived') return false;
      if (filter === 'active' && p.status !== 'active') return false;
      if (filter === 'quiet' && !(p.status === 'active' && p.isQuiet)) return false;
      if (filter === 'paused' && p.status !== 'paused') return false;
      if (filter === 'archived' && p.status !== 'archived') return false;

      if (!q) return true;
      const goalName = p.defaultGoalId ? (goalsById.get(p.defaultGoalId)?.name ?? '') : '';
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.nextBlockTitle ?? '').toLowerCase().includes(q) ||
        goalName.toLowerCase().includes(q)
      );
    });
  }, [allProjects, filter, search, goalsById]);

  const filterTabs: Array<{ id: ProjectFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'quiet', label: 'Quiet', count: counts.quiet },
    { id: 'paused', label: 'Paused', count: counts.paused },
    { id: 'archived', label: 'Archived', count: counts.archived },
  ];

  return (
    <div className="max-w-[960px] mx-auto px-7 py-7 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold leading-tight text-[#EDEDED]">
            Projects
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Track weekly momentum, linked goals, and quiet workstreams.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          leftIcon={<Plus size={14} />}
          onClick={() => setModalState({ open: true, project: null })}
        >
          New Project
        </Button>
      </header>

      {/* Filter Pills + Search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Project filters">
          {filterTabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(tab.id)}
                className={[
                  'h-8 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors',
                  active
                    ? 'bg-[#1F2759] border-[#5566F2]/55 text-[#D6DCFF]'
                    : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#3C3C3C]',
                ].join(' ')}
              >
                <span>{tab.label}</span>
                <span className="text-[11px] opacity-75 tabular-nums">{tab.count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative w-64 max-w-full">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E6E6E] pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter projects…"
            aria-label="Search projects"
            className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-[#1C1C1C] border border-[#2A2A2A] focus:border-[#5566F2] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
        </div>
      </div>

      {/* Flat Project Rows directly on #131313 */}
      {projectsQuery.isLoading ? (
        <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading projects…</div>
      ) : filteredProjects.length === 0 ? (
        <div className="veyra-card text-center py-8 space-y-2">
          <div className="text-[14px] font-medium text-[#C4C4C4]">No matching projects</div>
          <p className="text-[12.5px] text-[#6E6E6E]">
            Try another filter or create a new project to organize your blocks.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProjects.map((project) => {
            const goal = project.defaultGoalId ? goalsById.get(project.defaultGoalId) : undefined;
            const lastTouchedLabel = formatRelativeLastTouched(project.lastTouchedAt);

            return (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => openProject(project.id)}
                onContextMenu={(e) => projectMenu.open(e, project)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openProject(project.id);
                  }
                }}
                className="veyra-card py-4 px-5 group hover:border-[#3C3C3C] hover:bg-[#1F1F1F] transition-colors cursor-pointer flex items-center justify-between gap-4 focus:outline-none focus-visible:border-[#5566F2]"
              >
                {/* Left: Badge + Name + Next block preview */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <ProjectBadge
                    name={project.name}
                    color={project.color}
                    icon={project.icon}
                    size="md"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[14.5px] font-medium text-[#EDEDED] truncate">
                        {project.name}
                      </span>
                      {project.isPinned ? (
                        <Pin size={11} className="text-[#6E6E6E] shrink-0" aria-label="Pinned" />
                      ) : null}
                      {project.status === 'paused' ? (
                        <Pill tone="neutral">Paused</Pill>
                      ) : project.status === 'archived' ? (
                        <Pill tone="neutral">Archived</Pill>
                      ) : null}
                    </div>
                    <div className="text-[12.5px] text-[#9A9A9A] truncate">
                      {project.nextBlockTitle ? (
                        <>
                          <span className="text-[#6E6E6E]">Next: </span>
                          {project.nextBlockTitle}
                        </>
                      ) : (
                        <span className="text-[#6E6E6E]">No open blocks</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Goal pill, Notion link, Weekly focus, Open count, Last touched, Edit */}
                <div className="flex items-center gap-3 shrink-0">
                  {goal ? (
                    <Pill tone="goal" dot dotColor={goal.color} className="hidden sm:inline-flex">
                      {goal.name}
                    </Pill>
                  ) : null}

                  {project.notionUrl ? (
                    <button
                      type="button"
                      title="Open Notion hub"
                      aria-label={`Open ${project.name} in Notion`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openExternalUrl(project.notionUrl!);
                      }}
                      className="h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626] transition-colors"
                    >
                      <ExternalLink size={13} />
                    </button>
                  ) : null}

                  <div className="text-right tabular-nums w-16">
                    <div className="text-[13px] font-medium text-[#EDEDED]">
                      {project.weeklyFocusMinutes > 0
                        ? formatDuration(project.weeklyFocusMinutes)
                        : '0m'}
                    </div>
                    <div className="text-[10.5px] text-[#6E6E6E]">this wk</div>
                  </div>

                  <div className="text-right tabular-nums w-14">
                    <div className="text-[13px] font-medium text-[#C4C4C4]">
                      {project.openBlockCount}
                    </div>
                    <div className="text-[10.5px] text-[#6E6E6E]">open</div>
                  </div>

                  <div className="text-right tabular-nums w-16">
                    <div
                      className={`text-[12.5px] font-medium ${
                        project.isQuiet ? 'text-[#F5A66B]' : 'text-[#9A9A9A]'
                      }`}
                    >
                      {lastTouchedLabel}
                    </div>
                    <div className="text-[10.5px] text-[#6E6E6E]">
                      {project.isQuiet ? 'quiet' : 'touched'}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Edit ${project.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModalState({ open: true, project });
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626] transition-all"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProjectModal
        open={modalState.open}
        project={modalState.project}
        onClose={() => setModalState({ open: false, project: null })}
      />
      {projectMenu.menu}
    </div>
  );
}
