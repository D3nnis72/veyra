import type { Block, CalendarEvent, EnergySignal, Goal, ProjectWithStats } from '@veyra/core/types';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Flame,
  Link2,
  Minus,
  NotebookPen,
  Play,
  Plus,
  Repeat,
  Video,
} from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { openExternalUrl } from '../api/client';
import { useCalendarQuery, useTodayQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { useBlockContextMenu, useMeetingContextMenu } from '../components/entityMenus';
import { ProjectBadge } from '../components/ProjectBadge';
import { activeCardStyle, goalTint } from '../components/goalTint';
import {
  formatDateHeading,
  formatDuration,
  formatElapsedTimer,
  formatLocalTime,
  formatShortDate,
  formatTimeRange,
  getSessionDurationMinutes,
  getTodayDateString,
} from '../components/icons';

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

function formatFullTodayHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return formatDateHeading(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function TodayView() {
  const {
    activeDrawer,
    focusStatus: shellFocusStatus,
    liveElapsedSeconds,
    projects: shellProjects,
    goals: shellGoals,
    navigate,
    openBlockDrawer,
    openDailyNotesDrawer,
    openMeetingDrawer,
    openCreateBlock,
    startFocusAndNavigate,
  } = useAppShell();

  const todayQuery = useTodayQuery();
  const data = todayQuery.data;
  const dateStr = data?.date ?? getTodayDateString();

  // Optional same-day calendar query to display measured durations on COMPLETED TODAY rows
  const dayCalendarQuery = useCalendarQuery(dateStr, dateStr, Boolean(data?.date));

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

  const measuredMinutesByBlock = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of dayCalendarQuery.data?.sessions ?? []) {
      const mins = getSessionDurationMinutes(session.startedAt, session.endedAt);
      map.set(session.blockId, (map.get(session.blockId) ?? 0) + mins);
    }
    return map;
  }, [dayCalendarQuery.data?.sessions]);

  const focusStatus = data?.focusStatus ?? shellFocusStatus;
  const activeBlockId = focusStatus?.activeBlock?.id ?? null;
  const focusedTodayMinutes = focusStatus?.focusedTodayMinutes ?? 0;

  const upNext = data?.upNext ?? [];
  const completedToday = data?.completedToday ?? [];
  const upcomingEvents = data?.upcomingEvents ?? [];
  // Only surface a meeting that is still ahead — never fall back to one that already ended.
  const nextEvent: CalendarEvent | undefined = upcomingEvents[0];
  const blockMenu = useBlockContextMenu();
  const meetingMenu = useMeetingContextMenu();

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (selectedIndex >= upNext.length) {
      setSelectedIndex(0);
    }
  }, [upNext.length, selectedIndex]);

  // Keyboard navigation on Today: ArrowUp/ArrowDown select, Enter starts Focus on focused/first item
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (activeDrawer !== null || upNext.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx + 1) % upNext.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx - 1 + upNext.length) % upNext.length);
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const chosen = upNext[selectedIndex] ?? upNext[0];
        if (chosen) {
          e.preventDefault();
          void startFocusAndNavigate(chosen.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDrawer, upNext, selectedIndex, startFocusAndNavigate]);

  const drawerSelectedBlockId = activeDrawer?.kind === 'block' ? activeDrawer.blockId : null;
  const drawerSelectedEventId = activeDrawer?.kind === 'meeting' ? activeDrawer.eventId : null;

  return (
    <div className="min-h-full flex flex-col">
      {/* Unified 52px Topbar matching Figma */}
      <div className="shrink-0 h-[52px] px-7 border-b border-[#222222] flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-display text-[15px] font-semibold text-[#EDEDED]">Today</span>
          <span className="text-[13px] text-[#6E6E6E] truncate">
            {formatFullTodayHeading(dateStr)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="md"
            leftIcon={<NotebookPen size={13} />}
            onClick={() => openDailyNotesDrawer(dateStr)}
          >
            <span>+ Note</span>
            <span className="text-[10.5px] text-[#9A9A9A] ml-0.5">⌘⇧P</span>
          </Button>
          <Button
            variant="primary"
            size="md"
            leftIcon={<Plus size={14} />}
            onClick={() =>
              openCreateBlock({
                bucket: 'scheduled',
                scheduledDate: dateStr,
              })
            }
          >
            New Block
          </Button>
        </div>
      </div>

      {/* Main Calm Single-Column Content */}
      <div className="w-full max-w-[780px] mx-auto px-8 py-8 space-y-7">
        {/* Header Row: Date + Weekly Rule on left; Focused pill on right */}
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="font-display text-[28px] font-semibold leading-tight text-[#EDEDED]">
              {formatFullTodayHeading(dateStr)}
            </h1>
            <Pill
              tone="accent"
              icon={<Clock size={12} />}
              className="tabular-nums h-8 px-3 text-[12.5px]"
            >
              {formatDuration(focusedTodayMinutes)} focused today
            </Pill>
          </div>
          {data?.weeklyRule ? (
            <button
              type="button"
              onClick={() => navigate('review')}
              className="group inline-flex items-center gap-1.5 text-left text-[13px] text-[#9A9A9A] hover:text-[#C4C4C4] transition-colors max-w-full"
              title="Weekly Rule — click to edit in Review"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6E6E6E] group-hover:text-[#9A9A9A] shrink-0">
                Weekly Rule:
              </span>
              <span className="truncate">{data.weeklyRule}</span>
            </button>
          ) : null}
        </header>

      {/* Active Focus Banner when a timer is running */}
      {focusStatus?.activeSession && focusStatus.activeBlock ? (() => {
        const activeColor = projectsById.get(focusStatus.activeBlock.projectId)?.color ?? '#3B4BD8';
        const tint = goalTint(activeColor);
        return (
          <div
            style={activeCardStyle(activeColor)}
            className="veyra-card flex items-center justify-between gap-4"
          >
            <div className="min-w-0 flex items-center gap-3">
              <span
                className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0"
                style={{ backgroundColor: activeColor }}
              />
              <div className="min-w-0">
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.07em]"
                  style={{ color: tint.text }}
                >
                  Focusing Now
                </div>
                <div className="text-[14px] font-medium text-[#EDEDED] truncate">
                  {focusStatus.activeBlock.title}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-display text-[17px] font-semibold text-[#EDEDED] tabular-nums">
                {formatElapsedTimer(liveElapsedSeconds)}
              </span>
              <Button variant="primary" size="sm" onClick={() => navigate('focus')}>
                Open Focus
              </Button>
            </div>
          </div>
        );
      })() : null}

      {/* Quiet Upcoming Meeting Bar */}
      {nextEvent ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => openMeetingDrawer(nextEvent.id)}
          onContextMenu={(e) => meetingMenu.open(e, nextEvent)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openMeetingDrawer(nextEvent.id);
            }
          }}
          style={
            drawerSelectedEventId === nextEvent.id
              ? activeCardStyle(
                  nextEvent.projectId ? projectsById.get(nextEvent.projectId)?.color : undefined,
                )
              : undefined
          }
          className={[
            'flex items-center justify-between gap-3 px-5 py-3.5 rounded-[10px] bg-[#181818] border transition-colors cursor-pointer focus:outline-none focus-visible:border-[#5566F2]',
            drawerSelectedEventId === nextEvent.id
              ? ''
              : 'border-[#2A2A2A] hover:border-[#3C3C3C]',
          ].join(' ')}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-7 h-7 rounded-[6px] bg-[#242424] border border-[#2A2A2A] inline-flex items-center justify-center text-[#9A9A9A] shrink-0">
              <Video size={13} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-[#9A9A9A] tabular-nums">
                  {formatTimeRange(nextEvent.startAt, nextEvent.endAt)}
                </span>
                {upcomingEvents.length > 1 ? (
                  <span className="text-[11px] text-[#6E6E6E] tabular-nums">
                    +{upcomingEvents.length - 1} more today
                  </span>
                ) : null}
              </div>
              <div className="text-[13.5px] font-medium text-[#EDEDED] truncate">
                {nextEvent.title}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {nextEvent.meetingUrl ? (
              <Button
                variant="secondary"
                size="xs"
                rightIcon={<ExternalLink size={11} />}
                onClick={(e) => {
                  e.stopPropagation();
                  openExternalUrl(nextEvent.meetingUrl!);
                }}
              >
                Join
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                navigate('calendar');
              }}
            >
              Calendar
            </Button>
          </div>
        </div>
      ) : null}

      {/* UP NEXT Section */}
      <section className="space-y-3" aria-label="Up Next">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Up Next
            </h2>
            <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">{upNext.length}</span>
          </div>
          {upNext.length > 0 ? (
            <span className="text-[11.5px] text-[#6E6E6E]">
              Press <kbd className="text-[#9A9A9A] font-medium">Enter</kbd> to start focus
            </span>
          ) : null}
        </div>

        {todayQuery.isLoading ? (
          <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading today’s blocks…</div>
        ) : upNext.length === 0 ? (
          <div className="veyra-card text-center py-8 space-y-3">
            <div className="text-[14px] font-medium text-[#C4C4C4]">
              Nothing queued for today yet
            </div>
            <p className="text-[12.5px] text-[#6E6E6E] max-w-[360px] mx-auto">
              Pull a block in from Plan or create a new focus block to get started.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus size={13} />}
                onClick={() => openCreateBlock({ bucket: 'scheduled', scheduledDate: dateStr })}
              >
                New Block
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Calendar size={13} />}
                onClick={() => navigate('plan')}
              >
                Open Plan
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {upNext.map((block, index) => {
              const project = projectsById.get(block.projectId);
              const goal = block.goalId ? goalsById.get(block.goalId) : undefined;
              const isRunning = activeBlockId === block.id;
              const isSelected =
                drawerSelectedBlockId === block.id ||
                (!drawerSelectedBlockId && selectedIndex === index);

              return (
                <TodayBlockCard
                  key={block.id}
                  block={block}
                  project={project}
                  goal={goal}
                  isRunning={isRunning}
                  isSelected={isSelected}
                  onSelect={() => {
                    setSelectedIndex(index);
                    openBlockDrawer(block.id);
                  }}
                  onPlay={() => void startFocusAndNavigate(block.id)}
                  onContextMenu={(e) => blockMenu.open(e, block)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* COMPLETED TODAY Section */}
      {completedToday.length > 0 ? (
        <section className="space-y-2.5 pt-2" aria-label="Completed Today">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Completed Today
            </h2>
            <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
              {completedToday.length}
            </span>
          </div>

          <div className="space-y-2.5">
            {completedToday.map((block) => {
              const project = projectsById.get(block.projectId);
              const measuredMins = measuredMinutesByBlock.get(block.id) ?? 0;
              const isDrawerOpen = drawerSelectedBlockId === block.id;

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
                  className={[
                    'px-5 py-3.5 rounded-[10px] bg-[#171717] border transition-colors cursor-pointer focus:outline-none focus-visible:border-[#5566F2]',
                    isDrawerOpen
                      ? 'border-[#5566F2]'
                      : 'border-[#2A2A2A] hover:border-[#3C3C3C]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-[#14331F] text-[#7BE0A0] inline-flex items-center justify-center shrink-0">
                        <Check size={11} strokeWidth={2.5} />
                      </span>
                      {project ? (
                        <ProjectBadge
                          name={project.name}
                          color={project.color}
                          icon={project.icon}
                          size="xs"
                        />
                      ) : null}
                      <span className="text-[13.5px] font-medium text-[#C4C4C4] truncate">
                        {block.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {block.isOps ? (
                        <Pill tone="ops" dot>
                          Ops
                        </Pill>
                      ) : null}
                      <EnergyPill signal={block.energySignal} />
                      {measuredMins > 0 ? (
                        <span className="text-[12px] font-medium text-[#9A9A9A] tabular-nums">
                          {formatDuration(measuredMins)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {block.outcomeNote ? (
                    <p className="mt-1.5 pl-7 text-[12.5px] text-[#9A9A9A] truncate">
                      {block.outcomeNote}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      </div>
      {blockMenu.menu}
      {meetingMenu.menu}
    </div>
  );
}

interface TodayBlockCardProps {
  block: Block;
  project?: ProjectWithStats;
  goal?: Goal;
  isRunning: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

function TodayBlockCard({
  block,
  project,
  goal,
  isRunning,
  isSelected,
  onSelect,
  onPlay,
  onContextMenu,
}: TodayBlockCardProps) {
  const highlighted = isSelected || isRunning;
  const projectColor = project?.color ?? '#3B4BD8';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={highlighted ? activeCardStyle(projectColor) : undefined}
      className={[
        'veyra-card group transition-colors cursor-pointer focus:outline-none focus-visible:border-[#5566F2]',
        highlighted ? '' : 'hover:border-[#3C3C3C] hover:bg-[#1F1F1F]',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={`Start focus on ${block.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          style={
            isRunning
              ? { backgroundColor: projectColor, borderColor: projectColor }
              : undefined
          }
          className={[
            'mt-0.5 w-8 h-8 rounded-[8px] inline-flex items-center justify-center shrink-0 transition-colors border',
            isRunning
              ? 'text-white'
              : 'bg-[#262626] border-[#3C3C3C] text-[#EDEDED] hover:bg-[#3B4BD8] hover:border-[#5566F2] hover:text-white',
          ].join(' ')}
        >
          <Play size={13} className="translate-x-[0.5px]" fill="currentColor" />
        </button>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[14.5px] font-medium leading-snug text-[#EDEDED]">
              {block.title}
            </span>
            {block.plannedStartAt ? (
              <span className="text-[11.5px] text-[#9A9A9A] tabular-nums shrink-0 mt-0.5">
                {formatLocalTime(block.plannedStartAt)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            {project ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[#C4C4C4] mr-1">
                <ProjectBadge
                  name={project.name}
                  color={project.color}
                  icon={project.icon}
                  size="xs"
                />
                <span className="truncate max-w-[140px]">{project.name}</span>
              </span>
            ) : null}

            {goal ? (
              <Pill tone="goal" dot dotColor={goal.color}>
                {goal.name}
              </Pill>
            ) : null}

            {block.isOps ? (
              <Pill tone="ops" icon={<Flame size={10} />}>
                Ops
              </Pill>
            ) : null}

            {block.dueDate ? (
              <Pill tone="due">Due {formatShortDate(block.dueDate)}</Pill>
            ) : null}

            {block.carryoverCount > 0 ? (
              <Pill tone="neutral">×{block.carryoverCount} carried</Pill>
            ) : null}

            {block.recurrenceRule ? (
              <span
                title={`Repeats: ${block.recurrenceRule}`}
                className="inline-flex items-center text-[#9A9A9A]"
              >
                <Repeat size={12} />
              </span>
            ) : null}

            {block.externalLinks.length > 0 ? (
              <span
                title={`${block.externalLinks.length} linked resource(s)`}
                className="inline-flex items-center gap-1 text-[11.5px] text-[#9A9A9A] tabular-nums"
              >
                <Link2 size={11} />
                {block.externalLinks.length}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Paused resume note sits cleanly beneath a single 1px hairline — zero card-in-card nesting */}
      {block.resumeNote ? (
        <div className="mt-3 pt-2.5 border-t border-[#2A2A2A] flex items-baseline gap-2 text-[12.5px]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#AEB8FF] shrink-0">
            Paused
          </span>
          <span className="text-[#C4C4C4] truncate">{block.resumeNote}</span>
        </div>
      ) : null}
    </div>
  );
}
