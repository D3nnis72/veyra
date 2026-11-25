import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Block,
  EnergySignal,
  Goal,
  OpsRadarItem,
  ProjectWithStats,
} from '@veyra/core/types';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Minus,
  NotebookPen,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateBlockRelated, useReviewQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { GoalChip } from '../components/GoalChip';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import {
  addDaysDateString,
  formatDuration,
  formatLocalTime,
  formatShortDate,
  getSessionDurationMinutes,
  getTodayDateString,
} from '../components/icons';

function getMondayOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysDateString(dateStr, diff);
}

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

export function ReviewView() {
  const queryClient = useQueryClient();
  const {
    projects: shellProjects,
    goals: shellGoals,
    openBlockDrawer,
    openMeetingDrawer,
    openDailyNotesDrawer,
  } = useAppShell();

  const currentMonday = useMemo(() => getMondayOfDate(getTodayDateString()), []);
  const [weekStart, setWeekStart] = useState<string>(currentMonday);

  const reviewQuery = useReviewQuery(weekStart);
  const data = reviewQuery.data;

  const [ruleDraft, setRuleDraft] = useState('');
  const [ruleSaved, setRuleSaved] = useState(false);

  useEffect(() => {
    setRuleDraft(data?.ruleForNextWeek ?? '');
    setRuleSaved(false);
  }, [data?.weekStartDate, data?.ruleForNextWeek]);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectWithStats>();
    for (const p of data?.projects ?? shellProjects) {
      map.set(p.id, p);
    }
    return map;
  }, [data?.projects, shellProjects]);

  const goalsById = useMemo(() => {
    const map = new Map<string, Goal>();
    for (const g of data?.goals ?? shellGoals) {
      map.set(g.id, g);
    }
    return map;
  }, [data?.goals, shellGoals]);

  const saveRuleMutation = useMutation({
    mutationFn: (ruleForNextWeek: string) =>
      apiClient.setWeeklyRule({
        weekStartDate: data?.weekStartDate ?? weekStart,
        ruleForNextWeek,
      }),
    onSuccess: () => {
      setRuleSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      window.setTimeout(() => setRuleSaved(false), 1800);
    },
  });

  const planNextWeekMutation = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.moveBlock(blockId, {
        bucket: 'scheduled',
        scheduledDate: addDaysDateString(data?.weekStartDate ?? weekStart, 7),
      }),
    onSuccess: (_res, blockId) => {
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const revisitLaterMutation = useMutation({
    mutationFn: (blockId: string) => apiClient.parkBlock(blockId, { revisitAt: '2w' }),
    onSuccess: (_res, blockId) => {
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const dropMutation = useMutation({
    mutationFn: (blockId: string) => apiClient.dropBlock(blockId),
    onSuccess: (_res, blockId) => {
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const handleRuleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveRuleMutation.mutate(ruleDraft.trim());
  };

  const isCurrentWeek = weekStart === currentMonday;
  const weekRangeLabel = `${formatShortDate(data?.weekStartDate ?? weekStart)} – ${formatShortDate(
    data?.weekEndDate ?? addDaysDateString(weekStart, 6),
  )}`;

  const energy = data?.energyCounts ?? { up: 0, neutral: 0, down: 0 };
  const energyDisplay = `${energy.up}+ · ${energy.neutral}· · ${energy.down}−`;

  const pureOpsItems = data?.opsRadar.pureOpsItems ?? [];
  const goalLinkedOpsItems = data?.opsRadar.goalLinkedOpsItems ?? [];
  const checkInBlocks: Array<{ block: Block; reason: 'carryover' | 'later' }> = useMemo(() => {
    const items: Array<{ block: Block; reason: 'carryover' | 'later' }> = [];
    for (const b of data?.chronicCarryovers ?? []) {
      items.push({ block: b, reason: 'carryover' });
    }
    for (const b of data?.pastRevisitLater ?? []) {
      items.push({ block: b, reason: 'later' });
    }
    return items;
  }, [data?.chronicCarryovers, data?.pastRevisitLater]);

  return (
    <div className="max-w-[1040px] mx-auto px-7 py-7 space-y-6">
      {/* Header + Week Switcher */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h1 className="font-display text-[26px] font-semibold leading-tight text-[#EDEDED]">
            Weekly Review
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Reflect on focus alignment, energy signals, recurring ops, and carryovers.
          </p>
        </div>

        <div className="inline-flex items-center rounded-[8px] bg-[#1C1C1C] border border-[#2A2A2A] p-0.5">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDaysDateString(w, -7))}
            className="h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626]"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(currentMonday)}
            className="h-7 px-2.5 rounded-[6px] text-[12.5px] font-medium text-[#EDEDED] hover:bg-[#262626] tabular-nums"
          >
            {isCurrentWeek ? `This Week · ${weekRangeLabel}` : weekRangeLabel}
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDaysDateString(w, 7))}
            className="h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626]"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </header>

      {/* Weekly Rule Banner: Active Rule This Week + Inline Editable Rule for Next Week */}
      <section className="veyra-card space-y-3" aria-label="Weekly Rule">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#AEB8FF]">
              <Sparkles size={11} />
              <span>Weekly Rule</span>
            </div>
            {data?.activeRuleText ? (
              <div className="text-[14px] text-[#EDEDED]">
                <span className="text-[#9A9A9A] mr-1.5">Active this week:</span>
                <span className="font-medium">{data.activeRuleText}</span>
              </div>
            ) : (
              <div className="text-[13px] text-[#9A9A9A]">
                No rule carried into this week — set one below for next week’s Today header.
              </div>
            )}
          </div>
          {ruleSaved ? (
            <Pill tone="energy-up" icon={<Check size={10} />}>
              Saved for next week
            </Pill>
          ) : null}
        </div>

        <form onSubmit={handleRuleSubmit} className="pt-3 border-t border-[#2A2A2A] flex items-center gap-2">
          <label htmlFor="review-next-week-rule" className="sr-only">
            Rule for next week
          </label>
          <input
            id="review-next-week-rule"
            type="text"
            value={ruleDraft}
            onChange={(e) => setRuleDraft(e.target.value)}
            placeholder="Rule for next week (e.g. Protect 09:00–12:00 for deep product build)…"
            className="flex-1 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={saveRuleMutation.isPending}
          >
            Save Rule
          </Button>
        </form>
      </section>

      {/* Four Flat KPI Tiles (16px equal padding, zero card-in-card) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Weekly metrics">
        <div className="veyra-card space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            Total Focus
          </div>
          <div className="font-display text-[26px] font-semibold text-[#EDEDED] tabular-nums leading-tight">
            {formatDuration(data?.totalFocusMinutes ?? 0)}
          </div>
          <div className="text-[12px] text-[#9A9A9A] tabular-nums">
            {data?.progressFeed.length ?? 0} logged milestone
            {(data?.progressFeed.length ?? 0) === 1 ? '' : 's'}
          </div>
        </div>

        <div className="veyra-card space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            Goal Alignment
          </div>
          <div className="font-display text-[26px] font-semibold text-[#EDEDED] tabular-nums leading-tight">
            {data?.goalAlignmentPct ?? 0}%
          </div>
          <div className="h-1.5 rounded-full bg-[#262626] overflow-hidden mt-1">
            <div
              className="h-full bg-[#3B4BD8] rounded-full transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, data?.goalAlignmentPct ?? 0))}%` }}
            />
          </div>
        </div>

        <div className="veyra-card space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            Build vs. Ops
          </div>
          <div className="font-display text-[22px] font-semibold text-[#EDEDED] tabular-nums leading-tight pt-0.5">
            {formatDuration(data?.buildMinutes ?? 0)}{' '}
            <span className="text-[#6E6E6E] font-normal">/</span>{' '}
            <span className="text-[#F2D06B]">{formatDuration(data?.opsMinutes ?? 0)}</span>
          </div>
          <div className="text-[12px] text-[#9A9A9A]">Build focus vs. Ops load</div>
        </div>

        {/* Energy Tile — strictly raw counts, NEVER a percentage score */}
        <div className="veyra-card space-y-1.5" data-testid="review-energy-tile">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            Energy
          </div>
          <div className="font-display text-[22px] font-semibold text-[#EDEDED] tabular-nums leading-tight pt-0.5">
            {energyDisplay}
          </div>
          <div className="text-[12px] text-[#9A9A9A]">Up · Neutral · Down blocks</div>
        </div>
      </section>

      {/* Two-Column Lower Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Progress Feed */}
        <section className="lg:col-span-7 space-y-3" aria-label="Progress Feed">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Progress Feed
            </h2>
            <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
              {data?.progressFeed.length ?? 0} items
            </span>
          </div>

          {reviewQuery.isLoading ? (
            <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading review…</div>
          ) : (data?.progressFeed.length ?? 0) === 0 ? (
            <div className="veyra-card text-center py-8 text-[13px] text-[#6E6E6E]">
              No completed blocks or goal-linked meetings recorded this week yet.
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.progressFeed ?? []).map((item) => {
                const project = item.projectId ? projectsById.get(item.projectId) : undefined;
                const goal = item.goalId ? goalsById.get(item.goalId) : undefined;

                if (item.kind === 'meeting') {
                  const mins = getSessionDurationMinutes(item.startAt, item.endAt);
                  return (
                    <div
                      key={`meeting-${item.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openMeetingDrawer(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openMeetingDrawer(item.id);
                        }
                      }}
                      className="veyra-card hover:border-[#3C3C3C] transition-colors cursor-pointer space-y-2 focus:outline-none focus-visible:border-[#5566F2]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-5 h-5 rounded-[5px] bg-[#242424] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] shrink-0">
                            <Video size={11} />
                          </span>
                          <span className="text-[13.5px] font-medium text-[#EDEDED] truncate">
                            {item.title}
                          </span>
                        </div>
                        <span className="text-[12px] text-[#9A9A9A] tabular-nums shrink-0">
                          {formatDuration(mins)}
                        </span>
                      </div>

                      <div className="flex items-center flex-wrap gap-1.5">
                        {project ? (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#9A9A9A] mr-0.5">
                            <ProjectBadge
                              name={project.name}
                              color={project.color}
                              icon={project.icon}
                              size="xs"
                            />
                            <span>{project.name}</span>
                          </span>
                        ) : null}
                        {goal ? (
                          <GoalChip name={goal.name} kind={goal.kind} color={goal.color} />
                        ) : null}
                        {item.isOps ? (
                          <Pill tone="ops" icon={<Flame size={10} />}>
                            Ops
                          </Pill>
                        ) : null}
                      </div>

                      {item.notes ? (
                        <p className="text-[12.5px] text-[#9A9A9A] line-clamp-2">{item.notes}</p>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <div
                    key={`block-${item.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openBlockDrawer(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openBlockDrawer(item.id);
                      }
                    }}
                    className="veyra-card hover:border-[#3C3C3C] transition-colors cursor-pointer space-y-2 focus:outline-none focus-visible:border-[#5566F2]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {project ? (
                          <ProjectBadge
                            name={project.name}
                            color={project.color}
                            icon={project.icon}
                            size="xs"
                          />
                        ) : null}
                        <span className="text-[14px] font-medium text-[#EDEDED] truncate">
                          {item.title}
                        </span>
                      </div>
                      <span className="text-[12px] font-medium text-[#9A9A9A] tabular-nums shrink-0 inline-flex items-center gap-1">
                        <Clock size={11} className="text-[#6E6E6E]" />
                        {formatDuration(item.totalFocusMinutes)}
                      </span>
                    </div>

                    <div className="flex items-center flex-wrap gap-1.5">
                      {goal ? (
                        <GoalChip name={goal.name} kind={goal.kind} color={goal.color} />
                      ) : null}
                      {item.isOps ? (
                        <Pill tone="ops" icon={<Flame size={10} />}>
                          Ops
                        </Pill>
                      ) : null}
                      <EnergyPill signal={item.energySignal} />
                    </div>

                    {item.outcomeNote ? (
                      <p className="text-[12.5px] text-[#C4C4C4]">{item.outcomeNote}</p>
                    ) : null}

                    {item.autoSummary ? (
                      <div className="pt-2 border-t border-[#262626] flex items-start gap-1.5 text-[12px] leading-relaxed text-[#9A9A9A]">
                        <Sparkles size={11} className="text-[#AEB8FF] mt-0.5 shrink-0" />
                        <p className="min-w-0 break-words">{item.autoSummary}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Column: Daily Notes + Ops Radar + Backlog/Carryovers/Later Check-In */}
        <div className="lg:col-span-5 space-y-5">
          {/* Daily Notes This Week */}
          <section className="veyra-card space-y-3" aria-label="Daily Notes This Week">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E] flex items-center gap-1.5">
                <NotebookPen size={12} />
                <span>Daily Notes This Week</span>
              </h2>
              <button
                type="button"
                onClick={() => openDailyNotesDrawer()}
                className="text-[12px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF]"
              >
                + Add note
              </button>
            </div>

            {(data?.dailyNotes.length ?? 0) === 0 ? (
              <div className="text-[12.5px] text-[#6E6E6E]">
                No daily notes captured this week. Press ⌘⇧P anytime to jot a quick bullet.
              </div>
            ) : (
              <ul className="divide-y divide-[#2A2A2A]">
                {(data?.dailyNotes ?? []).map((note) => {
                  const proj = note.projectId ? projectsById.get(note.projectId) : undefined;
                  return (
                    <li key={note.id} className="py-2 first:pt-0 last:pb-0 space-y-1">
                      <div className="text-[13px] text-[#EDEDED] leading-snug">{note.content}</div>
                      <div className="flex items-center gap-2 text-[11px] text-[#6E6E6E] tabular-nums">
                        <span>{formatShortDate(note.date)}</span>
                        <span>·</span>
                        <span>{formatLocalTime(note.createdAt)}</span>
                        {proj ? <span className="text-[#9A9A9A]">· {proj.name}</span> : null}
                        {note.isOps ? <Pill tone="ops">Ops</Pill> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Ops & Automation Radar */}
          <section className="veyra-card space-y-3" aria-label="Ops and Automation Radar">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#F2D06B] flex items-center gap-1.5">
                <Flame size={12} />
                <span>Ops &amp; Automation Radar</span>
              </h2>
              <span className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                {formatDuration(data?.opsRadar.totalOpsMinutes ?? 0)} total
              </span>
            </div>

            {pureOpsItems.length === 0 && goalLinkedOpsItems.length === 0 ? (
              <div className="text-[12.5px] text-[#6E6E6E]">
                Zero Ops blocks logged this week.
              </div>
            ) : (
              <div className="space-y-3">
                {pureOpsItems.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-[#9A9A9A]">
                      <span className="font-semibold uppercase tracking-[0.06em]">
                        Pure Ops (Automate / Delegate)
                      </span>
                      <span className="tabular-nums">
                        {formatDuration(data?.opsRadar.pureOpsMinutes ?? 0)}
                      </span>
                    </div>
                    <OpsRadarList
                      items={pureOpsItems}
                      projectsById={projectsById}
                      onOpenBlock={openBlockDrawer}
                    />
                  </div>
                ) : null}

                {goalLinkedOpsItems.length > 0 ? (
                  <div className="space-y-1.5 pt-2 border-t border-[#2A2A2A]">
                    <div className="flex items-center justify-between text-[11px] text-[#9A9A9A]">
                      <span className="font-semibold uppercase tracking-[0.06em]">
                        Goal-Linked Ops
                      </span>
                      <span className="tabular-nums">
                        {formatDuration(data?.opsRadar.goalLinkedOpsMinutes ?? 0)}
                      </span>
                    </div>
                    <OpsRadarList
                      items={goalLinkedOpsItems}
                      projectsById={projectsById}
                      onOpenBlock={openBlockDrawer}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* Backlog, Carryovers & Later Check-In */}
          <section className="veyra-card space-y-3" aria-label="Backlog, Carryovers and Later Check-In">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E] flex items-center gap-1.5">
                <AlertCircle size={12} />
                <span>Backlog, Carryovers &amp; Later Check-In</span>
              </h2>
              <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                {checkInBlocks.length}
              </span>
            </div>

            {checkInBlocks.length === 0 ? (
              <div className="text-[12.5px] text-[#6E6E6E]">
                No chronic carryovers (3+) or past-revisit Later items right now.
              </div>
            ) : (
              <ul className="divide-y divide-[#2A2A2A]">
                {checkInBlocks.map(({ block, reason }) => {
                  const proj = projectsById.get(block.projectId);
                  return (
                    <li key={block.id} className="py-2.5 first:pt-0 last:pb-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openBlockDrawer(block.id)}
                          className="text-left text-[13px] font-medium text-[#EDEDED] hover:text-[#AEB8FF] transition-colors flex items-center gap-2 min-w-0"
                        >
                          {proj ? (
                            <ProjectBadge
                              name={proj.name}
                              color={proj.color}
                              icon={proj.icon}
                              size="xs"
                            />
                          ) : null}
                          <span className="truncate">{block.title}</span>
                        </button>
                        <Pill tone="due" className="shrink-0">
                          {reason === 'carryover'
                            ? `×${block.carryoverCount} carried`
                            : block.revisitAt
                              ? `Past ${formatShortDate(block.revisitAt)}`
                              : 'Revisit due'}
                        </Pill>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                          variant="secondary"
                          size="xs"
                          leftIcon={<CalendarPlus size={11} />}
                          onClick={() => planNextWeekMutation.mutate(block.id)}
                          disabled={planNextWeekMutation.isPending}
                        >
                          Plan next week
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => revisitLaterMutation.mutate(block.id)}
                          disabled={revisitLaterMutation.isPending}
                        >
                          Revisit (+2w)
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          leftIcon={<Trash2 size={11} />}
                          onClick={() => dropMutation.mutate(block.id)}
                          disabled={dropMutation.isPending}
                          className="text-[#9A9A9A] hover:text-[#FF9EC5] hover:bg-[#3D1A2B]/60"
                        >
                          Drop
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function OpsRadarList({
  items,
  projectsById,
  onOpenBlock,
}: {
  items: OpsRadarItem[];
  projectsById: Map<string, ProjectWithStats>;
  onOpenBlock: (blockId: string) => void;
}) {
  return (
    <ul className="divide-y divide-[#262626]">
      {items.map((item) => {
        const proj = projectsById.get(item.projectId);
        const latestBlockId = item.blockIds[item.blockIds.length - 1];
        const summaries = item.autoSummaries ?? [];
        const visibleSummaries = summaries.slice(0, 2);
        const hiddenCount = summaries.length - visibleSummaries.length;
        return (
          <li key={item.key} className="py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => latestBlockId && onOpenBlock(latestBlockId)}
                className="flex items-center gap-2 min-w-0 text-left hover:text-[#AEB8FF] transition-colors"
              >
                {proj ? (
                  <ProjectBadge
                    name={proj.name}
                    color={proj.color}
                    icon={proj.icon}
                    size="xs"
                  />
                ) : null}
                <span className="text-[12.5px] text-[#EDEDED] truncate">{item.title}</span>
              </button>
              <span className="text-[11.5px] text-[#9A9A9A] tabular-nums shrink-0">
                {item.occurrenceCount > 1 ? `×${item.occurrenceCount} · ` : ''}
                {formatDuration(item.totalMinutes)}
              </span>
            </div>
            {visibleSummaries.length > 0 ? (
              <div className="pl-7 space-y-1">
                {visibleSummaries.map((summary, idx) => (
                  <div
                    key={`${item.key}-sum-${idx}`}
                    className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[#9A9A9A]"
                  >
                    <Sparkles size={10} className="text-[#F2D06B]/75 mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words">{summary}</span>
                  </div>
                ))}
                {hiddenCount > 0 ? (
                  <div className="text-[11px] text-[#6E6E6E]">
                    +{hiddenCount} more pattern {hiddenCount === 1 ? 'summary' : 'summaries'}
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
