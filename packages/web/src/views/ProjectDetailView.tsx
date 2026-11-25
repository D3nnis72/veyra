import type { EnergySignal, Goal } from '@veyra/core/types';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Clock,
  Flame,
  Minus,
  Pencil,
  Play,
  Plus,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGoalsQuery, useProjectDetailQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { GoalChip } from '../components/GoalChip';
import { LinkChip } from '../components/LinkChip';
import { Pill } from '../components/Pill';
import { useBlockContextMenu } from '../components/entityMenus';
import { ProjectBadge } from '../components/ProjectBadge';
import { activeCardStyle } from '../components/goalTint';
import { formatDuration, formatShortDate } from '../components/icons';
import { ProjectModal } from './ProjectModal';

function EnergyPill({ signal }: { signal: EnergySignal | null }) {
  if (!signal) return null;
  if (signal === 'up') {
    return (
      <Pill tone="energy-up" icon={<ArrowUp size={10} />}>
        Energy +
      </Pill>
    );
  }
  if (signal === 'down') {
    return (
      <Pill tone="energy-down" icon={<ArrowDown size={10} />}>
        Energy −
      </Pill>
    );
  }
  return (
    <Pill tone="neutral" icon={<Minus size={10} />}>
      Neutral
    </Pill>
  );
}

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const {
    activeDrawer,
    navigate,
    openBlockDrawer,
    openCreateBlock,
    startFocusAndNavigate,
  } = useAppShell();
  const blockMenu = useBlockContextMenu();

  const detailQuery = useProjectDetailQuery(projectId);
  const goalsQuery = useGoalsQuery({ activeOnly: true });
  const [editOpen, setEditOpen] = useState(false);

  const goalsById = useMemo(() => {
    const map = new Map<string, Goal>();
    for (const g of goalsQuery.data?.goals ?? []) {
      map.set(g.id, g);
    }
    return map;
  }, [goalsQuery.data?.goals]);

  const data = detailQuery.data;
  const project = data?.project;
  const openBlocks = data?.openBlocks ?? [];
  const completedBlocks = data?.completedBlocks ?? [];
  const defaultGoal = project?.defaultGoalId ? goalsById.get(project.defaultGoalId) : undefined;
  const selectedBlockId = activeDrawer?.kind === 'block' ? activeDrawer.blockId : null;

  if (detailQuery.isLoading) {
    return (
      <div className="max-w-[820px] mx-auto px-7 py-7">
        <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading project…</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-[820px] mx-auto px-7 py-7 space-y-4">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => navigate('projects')}
        >
          Projects
        </Button>
        <div className="veyra-card text-[13.5px] text-[#9A9A9A]">Project not found.</div>
      </div>
    );
  }

  return (
    <div className="max-w-[820px] mx-auto px-7 py-7 space-y-6">
      {/* Top Breadcrumb + Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => navigate('projects')}
        >
          Projects
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Pencil size={12} />}
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={13} />}
            onClick={() =>
              openCreateBlock({
                projectId: project.id,
                goalId: project.defaultGoalId,
                bucket: 'inbox',
              })
            }
          >
            New Block
          </Button>
        </div>
      </div>

      {/* Project Header */}
      <header className="space-y-3 pb-4 border-b border-[#2A2A2A]">
        <div className="flex items-start gap-3.5">
          <ProjectBadge
            name={project.name}
            color={project.color}
            icon={project.icon}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-[24px] font-semibold leading-tight text-[#EDEDED]">
                {project.name}
              </h1>
              {project.status !== 'active' ? (
                <Pill tone="neutral">{project.status}</Pill>
              ) : null}
              {project.isQuiet ? <Pill tone="due">Quiet</Pill> : null}
            </div>
            {project.description ? (
              <p className="text-[13.5px] text-[#9A9A9A]">{project.description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Pill tone="neutral" icon={<Clock size={11} />} className="tabular-nums">
            {formatDuration(project.weeklyFocusMinutes)} focused this week
          </Pill>
          {defaultGoal ? (
            <GoalChip name={defaultGoal.name} kind={defaultGoal.kind} color={defaultGoal.color} />
          ) : null}
          {project.notionUrl ? (
            <LinkChip
              link={{
                url: project.notionUrl,
                title: 'Notion Hub',
                source: 'notion',
              }}
            />
          ) : null}
        </div>
      </header>

      {/* Open Blocks */}
      <section className="space-y-3" aria-label="Open blocks">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
            Open Blocks
          </h2>
          <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">{openBlocks.length}</span>
        </div>

        {openBlocks.length === 0 ? (
          <div className="veyra-card text-center py-6 space-y-2.5">
            <div className="text-[13.5px] text-[#9A9A9A]">No open blocks in {project.name} yet.</div>
            <div>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus size={12} />}
                onClick={() =>
                  openCreateBlock({
                    projectId: project.id,
                    goalId: project.defaultGoalId,
                    bucket: 'inbox',
                  })
                }
              >
                Add Block
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {openBlocks.map((block) => {
              const goal = block.goalId ? goalsById.get(block.goalId) : undefined;
              const selected = selectedBlockId === block.id;
              return (
                <div
                  key={block.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openBlockDrawer(block.id)}
                  onContextMenu={(e) => blockMenu.open(e, block)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openBlockDrawer(block.id);
                    }
                  }}
                  style={selected ? activeCardStyle(project.color) : undefined}
                  className={[
                    'veyra-card group transition-colors cursor-pointer flex items-start gap-3 focus:outline-none focus-visible:border-[#5566F2]',
                    selected ? '' : 'hover:border-[#3C3C3C] hover:bg-[#1F1F1F]',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    aria-label={`Start focus on ${block.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void startFocusAndNavigate(block.id);
                    }}
                    className="mt-0.5 w-7 h-7 rounded-[7px] bg-[#262626] border border-[#3C3C3C] hover:bg-[#3B4BD8] hover:border-[#5566F2] text-[#EDEDED] inline-flex items-center justify-center shrink-0 transition-colors"
                  >
                    <Play size={11} fill="currentColor" />
                  </button>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="text-[14px] font-medium text-[#EDEDED] leading-snug">
                      {block.title}
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5">
                      <Pill tone="neutral">
                        {block.bucket === 'scheduled' && block.scheduledDate
                          ? formatShortDate(block.scheduledDate)
                          : block.bucket === 'later'
                            ? block.revisitAt
                              ? `Later · ${formatShortDate(block.revisitAt)}`
                              : 'Later'
                            : 'Inbox'}
                      </Pill>
                      {goal ? (
                        <GoalChip name={goal.name} kind={goal.kind} color={goal.color} />
                      ) : null}
                      {block.isOps ? (
                        <Pill tone="ops" icon={<Flame size={10} />}>
                          Ops
                        </Pill>
                      ) : null}
                      {block.dueDate ? (
                        <Pill tone="due">Due {formatShortDate(block.dueDate)}</Pill>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed Blocks */}
      {completedBlocks.length > 0 ? (
        <section className="space-y-2.5 pt-2" aria-label="Completed blocks">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Completed
            </h2>
            <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
              {completedBlocks.length}
            </span>
          </div>

          <div className="space-y-2.5">
            {completedBlocks.map((block) => (
              <div
                key={block.id}
                role="button"
                tabIndex={0}
                onClick={() => openBlockDrawer(block.id)}
                onContextMenu={(e) => blockMenu.open(e, block)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openBlockDrawer(block.id);
                  }
                }}
                className={[
                  'px-5 py-3.5 rounded-[10px] bg-[#171717] border transition-colors cursor-pointer space-y-1.5 focus:outline-none focus-visible:border-[#5566F2]',
                  selectedBlockId === block.id
                    ? 'border-[#5566F2]'
                    : 'border-[#2A2A2A] hover:border-[#3C3C3C]',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-4 h-4 rounded-full bg-[#14331F] text-[#7BE0A0] inline-flex items-center justify-center shrink-0">
                      <Check size={10} strokeWidth={2.5} />
                    </span>
                    <span className="text-[13.5px] font-medium text-[#C4C4C4] truncate">
                      {block.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <EnergyPill signal={block.energySignal} />
                    {block.scheduledDate ? (
                      <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                        {formatShortDate(block.scheduledDate)}
                      </span>
                    ) : null}
                  </div>
                </div>
                {block.outcomeNote ? (
                  <p className="pl-6 text-[12.5px] text-[#9A9A9A] truncate">{block.outcomeNote}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ProjectModal
        open={editOpen}
        project={project}
        onClose={() => setEditOpen(false)}
        onDeleted={() => navigate('projects')}
      />
      {blockMenu.menu}
    </div>
  );
}
