import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GoalKind, UpdateGoalInput } from '@veyra/core/types';
import {
  Archive,
  Briefcase,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  TrendingUp,
  User,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { invalidateAllVeyraData, useGoalDetailQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { ColorPicker } from '../components/ColorPicker';
import { DockedDrawer } from '../components/DockedDrawer';
import { GoalKindIconBadge } from '../components/GoalChip';
import { Pill } from '../components/Pill';
import { useGoalContextMenu } from '../components/entityMenus';
import { formatDuration, formatShortDate, getTodayDateString } from '../components/icons';

export interface GoalDetailDrawerProps {
  goalId: string | null;
  onClose: () => void;
  dismissOnEscape?: boolean;
}

function formatHistoryDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return formatShortDate(getTodayDateString(dt));
}

export function GoalDetailDrawer({
  goalId,
  onClose,
  dismissOnEscape = true,
}: GoalDetailDrawerProps) {
  const queryClient = useQueryClient();
  const { openEditGoal, openCloseGoal } = useAppShell();
  const detailQuery = useGoalDetailQuery(goalId);
  const goal = detailQuery.data?.goal ?? null;
  const goalMenu = useGoalContextMenu();

  const updateMutation = useMutation({
    mutationFn: (input: UpdateGoalInput) => apiClient.updateGoal(goalId!, input),
    onSuccess: () => {
      void invalidateAllVeyraData(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteGoal(goalId!),
    onSuccess: () => {
      void invalidateAllVeyraData(queryClient);
      onClose();
    },
  });

  const kindLabel = goal?.kind === 'company' ? 'Company' : 'Personal';
  const statusLabel =
    goal?.status === 'achieved'
      ? 'Achieved'
      : goal?.status === 'archived'
        ? 'Let Go'
        : 'Active';
  const statusTone =
    goal?.status === 'achieved'
      ? 'energy-up'
      : goal?.status === 'archived'
        ? 'neutral'
        : 'accent';

  return (
    <>
      <DockedDrawer
        open={Boolean(goalId)}
        onClose={onClose}
        dismissOnEscape={dismissOnEscape}
        width={520}
        ariaLabel="Goal detail"
        title={goal ? `Goal Detail · ${kindLabel}` : 'Goal Detail'}
        headerActions={
          goal ? (
            <>
              <button
                type="button"
                aria-label="Edit goal"
                title="Edit goal"
                onClick={() => openEditGoal(goal.id)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252] transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                aria-label="Delete goal"
                title="Delete goal"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="h-7 w-7 inline-flex items-center justify-center rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[#9A9A9A] hover:text-[#FF9EC5] hover:border-[#C94A6A]/60 transition-colors"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                aria-label="More goal actions"
                title="More actions"
                onClick={(e) => goalMenu.open(e, goal)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252] transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>
            </>
          ) : null
        }
        footer={
          goal ? (
            goal.status === 'active' ? (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leftIcon={<Archive size={13} />}
                  onClick={() => openCloseGoal(goal.id, 'archived')}
                >
                  Let Go
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  leftIcon={<CheckCircle2 size={13} />}
                  onClick={() => openCloseGoal(goal.id, 'achieved')}
                >
                  Mark Achieved
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leftIcon={<RotateCcw size={13} />}
                  loading={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ status: 'active' })}
                >
                  Reactivate Goal
                </Button>
              </div>
            )
          ) : undefined
        }
      >
        {detailQuery.isLoading || !goal ? (
          <div className="text-[13px] text-[#9A9A9A]">
            {detailQuery.isError ? 'Could not load goal details.' : 'Loading goal…'}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Identity + inline kind toggle + metadata chips */}
            <div className="space-y-3.5 pb-5 border-b border-[#2A2A2A]">
              <div className="flex items-center gap-3.5">
                <GoalKindIconBadge kind={goal.kind} color={goal.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[20px] font-semibold text-[#EDEDED] leading-tight">
                    {goal.name}
                  </h3>
                </div>
              </div>

              {/* Inline kind toggle */}
              <div
                role="group"
                aria-label="Goal kind"
                className="inline-flex p-0.5 rounded-[8px] bg-[#242424] border border-[#2A2A2A]"
              >
                {(
                  [
                    { id: 'personal', label: 'Personal', Icon: User },
                    { id: 'company', label: 'Company', Icon: Briefcase },
                  ] as Array<{ id: GoalKind; label: string; Icon: typeof User }>
                ).map(({ id, label, Icon }) => {
                  const active = goal.kind === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (!active) updateMutation.mutate({ kind: id });
                      }}
                      className={[
                        'h-7 px-3 rounded-[6px] inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors',
                        active
                          ? 'bg-[#3B4BD8] text-white'
                          : 'text-[#9A9A9A] hover:text-[#EDEDED]',
                      ].join(' ')}
                    >
                      <Icon size={12} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Status / linked projects / rank chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={statusTone}>{statusLabel}</Pill>
                <Pill tone="neutral" className="tabular-nums">
                  {goal.linkedProjectCount} {goal.linkedProjectCount === 1 ? 'project' : 'projects'}
                </Pill>
                {goal.status === 'active' && goal.rankInKind > 0 ? (
                  <Pill tone="neutral" className="tabular-nums">
                    #{goal.rankInKind} in {kindLabel}
                  </Pill>
                ) : null}
              </div>
            </div>

            {/* CLOSING NOTE (closed goals only) */}
            {goal.status !== 'active' ? (
              <div className="space-y-2 pb-5 border-b border-[#2A2A2A]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                    Closing note
                  </div>
                  {goal.closedAt && formatHistoryDate(goal.closedAt) ? (
                    <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                      Closed {formatHistoryDate(goal.closedAt)}
                    </span>
                  ) : null}
                </div>
                <p className="text-[13.5px] text-[#C4C4C4] leading-relaxed">
                  {goal.closingNote || (
                    <span className="text-[#6E6E6E]">No closing note recorded.</span>
                  )}
                </p>
              </div>
            ) : null}

            {/* WHY IT MATTERS */}
            <div className="space-y-1.5 pb-5 border-b border-[#2A2A2A]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Why it matters
              </div>
              <p className="text-[13.5px] text-[#C4C4C4] leading-relaxed">
                {goal.description || <span className="text-[#6E6E6E]">No motivation noted yet.</span>}
              </p>
            </div>

            {/* DONE WHEN */}
            <div className="space-y-1.5 pb-5 border-b border-[#2A2A2A]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Done when
              </div>
              <p className="text-[13.5px] text-[#EDEDED] leading-relaxed">
                {goal.doneWhen || <span className="text-[#6E6E6E]">Not defined yet.</span>}
              </p>
            </div>

            {/* CHECK IN & MEASURE row */}
            <div className="grid grid-cols-2 gap-4 pb-5 border-b border-[#2A2A2A]">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Check in
                </div>
                <div className="text-[13px] text-[#C4C4C4] tabular-nums">
                  {goal.checkInDate ? formatShortDate(goal.checkInDate) : (
                    <span className="text-[#6E6E6E]">Not set</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Measure
                </div>
                <div className="text-[13px] text-[#C4C4C4]">
                  {goal.measure || <span className="text-[#6E6E6E]">Not set</span>}
                </div>
              </div>
            </div>

            {/* THIS WEEK (measured focus only — zero weekly bar or target) */}
            <div className="space-y-1.5 pb-5 border-b border-[#2A2A2A]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                This week
              </div>
              <div className="text-[13.5px] text-[#EDEDED] tabular-nums">
                {formatDuration(goal.weeklyFocusMinutes)} focused · {goal.weeklyBlockCount}{' '}
                {goal.weeklyBlockCount === 1 ? 'block' : 'blocks'}
              </div>
            </div>

            {/* IF IT STALLS */}
            {goal.ifItStalls ? (
              <div className="space-y-1.5 pb-5 border-b border-[#2A2A2A]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  If it stalls
                </div>
                <p className="text-[13px] text-[#C4C4C4] leading-relaxed">{goal.ifItStalls}</p>
              </div>
            ) : null}

            {/* COLOR */}
            <div className="pb-5 border-b border-[#2A2A2A]">
              <ColorPicker
                value={goal.color}
                onChange={(hex) => updateMutation.mutate({ color: hex })}
                label="Color"
              />
            </div>

            {/* HISTORY · THIS QUARTER */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                History · This Quarter
              </div>

              {goal.history.length === 0 ? (
                <div className="text-[12.5px] text-[#6E6E6E]">
                  Completed block outcomes and measure updates will appear here.
                </div>
              ) : (
                <ul className="divide-y divide-[#262626]">
                  {goal.history.map((item) => {
                    if (item.kind === 'outcome') {
                      return (
                        <li key={item.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#EDEDED] min-w-0">
                              <CheckCircle2 size={13} className="text-[#7BE0A0] shrink-0" />
                              <span className="truncate">{item.blockTitle}</span>
                            </span>
                            <span className="text-[11.5px] text-[#6E6E6E] tabular-nums shrink-0">
                              {formatDuration(item.totalFocusMinutes)} · {formatHistoryDate(item.timestamp)}
                            </span>
                          </div>
                          <p className="text-[12.5px] text-[#9A9A9A] leading-snug">
                            {item.outcomeNote}
                          </p>
                        </li>
                      );
                    }
                    return (
                      <li key={item.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#EDEDED]">
                            <TrendingUp size={13} className="text-[#AEB8FF] shrink-0" />
                            <span>Measure updated</span>
                          </span>
                          <span className="text-[11.5px] text-[#6E6E6E] tabular-nums shrink-0">
                            {formatShortDate(item.weekStartDate)}
                          </span>
                        </div>
                        <div className="text-[12.5px] text-[#C4C4C4]">
                          {item.previousValue ? (
                            <>
                              <span className="text-[#6E6E6E]">{item.previousValue}</span>
                              <span className="mx-1.5 text-[#6E6E6E]">→</span>
                            </>
                          ) : null}
                          <span className="text-[#EDEDED]">{item.value}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </DockedDrawer>
      {goalMenu.menu}
    </>
  );
}
