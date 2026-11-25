import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GoalKind, GoalWithStats } from '@veyra/core/types';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateAllVeyraData, useGoalsQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { GoalKindIconBadge } from '../components/GoalChip';
import { Pill } from '../components/Pill';
import { useGoalContextMenu } from '../components/entityMenus';
import { formatDuration, formatShortDate } from '../components/icons';

function GoalCard({
  goal,
  onOpen,
  onEdit,
  onClose,
  onContextMenu,
}: {
  goal: GoalWithStats;
  onOpen: () => void;
  onEdit: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const focusSummary = `This week: ${formatDuration(goal.weeklyFocusMinutes)} focused · ${goal.weeklyBlockCount} ${goal.weeklyBlockCount === 1 ? 'block' : 'blocks'}${goal.measure ? ` · ${goal.measure}` : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="veyra-card w-full text-left space-y-2.5 transition-colors hover:border-[#3C3C3C] focus:outline-none focus-visible:border-[#5566F2] cursor-pointer"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <GoalKindIconBadge kind={goal.kind} color={goal.color} size="md" />
          <h3 className="font-display text-[16px] font-semibold text-[#EDEDED] truncate">
            {goal.name}
          </h3>
        </div>

        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[12px] text-[#9A9A9A] tabular-nums">
            {goal.linkedProjectCount} {goal.linkedProjectCount === 1 ? 'project' : 'projects'}
          </span>
          <button
            type="button"
            aria-label={`Edit goal ${goal.name}`}
            title="Edit goal"
            onClick={onEdit}
            className="h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626] transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            aria-label={`Close goal ${goal.name}`}
            title="Close goal"
            onClick={onClose}
            className="h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626] transition-colors"
          >
            <Archive size={13} />
          </button>
        </div>
      </div>

      {/* Done when */}
      {goal.doneWhen ? (
        <div className="text-[13px] text-[#EDEDED] leading-snug">
          <span className="text-[#6E6E6E] mr-1.5">Done when:</span>
          <span>{goal.doneWhen}</span>
        </div>
      ) : null}

      {/* Quiet check in date */}
      {goal.checkInDate ? (
        <div className="text-[12px] text-[#9A9A9A] tabular-nums">
          Check in · {formatShortDate(goal.checkInDate)}
        </div>
      ) : null}

      {/* Measured weekly focus line — strictly no progress bar or target */}
      <div className="text-[12.5px] text-[#C4C4C4] tabular-nums">{focusSummary}</div>

      {/* Why */}
      {goal.description ? (
        <div className="text-[12.5px] text-[#9A9A9A] leading-relaxed">
          <span className="text-[#6E6E6E] mr-1.5">Why:</span>
          <span>{goal.description}</span>
        </div>
      ) : null}
    </div>
  );
}

export function GoalsView() {
  const queryClient = useQueryClient();
  const { openGoalDrawer, openCreateGoal, openEditGoal, openCloseGoal } = useAppShell();
  const goalsQuery = useGoalsQuery({ includeArchived: true });
  const goalMenu = useGoalContextMenu();
  const [closedOpen, setClosedOpen] = useState(false);

  const reactivateMutation = useMutation({
    mutationFn: (goalId: string) => apiClient.updateGoal(goalId, { status: 'active' }),
    onSuccess: () => {
      void invalidateAllVeyraData(queryClient);
    },
  });

  const allGoals = (goalsQuery.data?.goals ?? []).filter((g) => !g.deletedAt);
  const personalGoals = allGoals.filter((g) => g.status === 'active' && g.kind === 'personal');
  const companyGoals = allGoals.filter((g) => g.status === 'active' && g.kind === 'company');
  const closedGoals = allGoals.filter((g) => g.status === 'achieved' || g.status === 'archived');

  const renderGroup = (
    title: string,
    ariaLabel: string,
    kind: GoalKind,
    items: GoalWithStats[],
  ) => (
    <section aria-label={ariaLabel} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-[18px] font-semibold text-[#EDEDED]">{title}</h2>
          <span className="text-[12px] text-[#6E6E6E] tabular-nums">{items.length}</span>
        </div>
        <button
          type="button"
          onClick={() => openCreateGoal(kind)}
          aria-label={`New ${title.toLowerCase()} goal`}
          className="h-7 px-2 rounded-[6px] inline-flex items-center gap-1 text-[12px] text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#242424] transition-colors"
        >
          <Plus size={12} />
          <span>Add</span>
        </button>
      </div>

      {items.length === 0 ? (
        <div className="veyra-card text-[13px] text-[#6E6E6E]">
          No active {title.toLowerCase()} goals yet.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onOpen={() => openGoalDrawer(goal.id)}
              onEdit={() => openEditGoal(goal.id)}
              onClose={() => openCloseGoal(goal.id)}
              onContextMenu={(e) => goalMenu.open(e, goal)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-[880px] mx-auto px-6 py-6 space-y-7">
      <header className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-[#2A2A2A]">
        <div className="space-y-1">
          <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">Goals</h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Personal and company outcomes that anchor your projects and weekly focus.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          leftIcon={<Plus size={14} />}
          onClick={() => openCreateGoal('personal')}
        >
          New Goal
        </Button>
      </header>

      {goalsQuery.isLoading ? (
        <div className="text-[13px] text-[#9A9A9A]">Loading goals…</div>
      ) : (
        <div className="space-y-8">
          {renderGroup('Personal', 'Personal goals', 'personal', personalGoals)}
          {renderGroup('Company', 'Company goals', 'company', companyGoals)}

          {closedGoals.length > 0 ? (
            <section className="pt-2 border-t border-[#2A2A2A] space-y-3">
              <button
                type="button"
                aria-expanded={closedOpen}
                onClick={() => setClosedOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] transition-colors"
              >
                {closedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Closed goals</span>
                <span className="text-[12px] text-[#6E6E6E] tabular-nums">
                  ({closedGoals.length})
                </span>
              </button>

              {closedOpen ? (
                <div className="space-y-3">
                  {closedGoals.map((goal) => (
                    <div
                      key={goal.id}
                      onClick={() => openGoalDrawer(goal.id)}
                      onContextMenu={(e) => goalMenu.open(e, goal)}
                      className="veyra-card bg-[#171717] space-y-2 cursor-pointer hover:border-[#3C3C3C] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <GoalKindIconBadge kind={goal.kind} color={goal.color} size="sm" />
                          <span className="text-[14.5px] font-medium text-[#C4C4C4] truncate">
                            {goal.name}
                          </span>
                          <Pill tone={goal.status === 'achieved' ? 'energy-up' : 'neutral'}>
                            {goal.status === 'achieved' ? 'Achieved' : 'Let Go'}
                          </Pill>
                        </div>

                        <div onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            leftIcon={<RotateCcw size={11} />}
                            disabled={reactivateMutation.isPending}
                            onClick={() => reactivateMutation.mutate(goal.id)}
                          >
                            Reactivate
                          </Button>
                        </div>
                      </div>

                      {goal.closingNote ? (
                        <p className="text-[12.5px] text-[#9A9A9A] leading-snug">
                          {goal.closingNote}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {goalMenu.menu}
    </div>
  );
}
