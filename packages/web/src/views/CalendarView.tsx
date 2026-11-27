import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Block, CalendarEvent, ProjectWithStats } from '@veyra/core/types';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  Video,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { type CalendarSessionItem, apiClient } from '../api/client';
import {
  invalidateBlockRelated,
  useBlocksQuery,
  useCalendarQuery,
} from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { ModalSheet } from '../components/ModalSheet';
import { ProjectBadge } from '../components/ProjectBadge';
import {
  useBlockContextMenu,
  useMeetingContextMenu,
  useSessionContextMenu,
} from '../components/entityMenus';
import {
  addDaysDateString,
  formatDuration,
  formatLocalTime,
  formatShortDate,
  getProjectAccentStyle,
  getTodayDateString,
} from '../components/icons';

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 60;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

function getMondayOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysDateString(dateStr, diff);
}

function formatDayColumnLabel(dateStr: string): { weekday: string; dayNum: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    dt,
  );
  return { weekday, dayNum: String(d) };
}

function toLocalDateStr(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return getTodayDateString(dt);
}

function getMinutesFromStartHour(iso: string): number {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 0;
  return dt.getHours() * 60 + dt.getMinutes() - START_HOUR * 60;
}

function buildLocalIso(dateStr: string, hour: number, minute = 0): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).toISOString();
}

type PositionedItem =
  | {
      kind: 'session';
      id: string;
      startMin: number;
      endMin: number;
      session: CalendarSessionItem;
    }
  | {
      kind: 'planned';
      id: string;
      startMin: number;
      endMin: number;
      block: Block;
    }
  | {
      kind: 'meeting';
      id: string;
      startMin: number;
      endMin: number;
      event: CalendarEvent;
    };

interface LayoutItem {
  item: PositionedItem;
  col: number;
  colCount: number;
}

function computeOverlapLayout(items: PositionedItem[]): LayoutItem[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: LayoutItem[] = [];

  let cluster: PositionedItem[] = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const placed: Array<{ item: PositionedItem; col: number }> = [];

    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      placed.push({ item, col });
    }

    const colCount = Math.max(1, colEnds.length);
    for (const p of placed) {
      result.push({ item: p.item, col: p.col, colCount });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) {
      flushCluster();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flushCluster();
  return result;
}

export function CalendarView() {
  const queryClient = useQueryClient();
  const {
    activeDrawer,
    projects: shellProjects,
    openBlockDrawer,
    openMeetingDrawer,
    openSessionDrawer,
    openCreateBlock,
  } = useAppShell();
  const blockMenu = useBlockContextMenu();
  const meetingMenu = useMeetingContextMenu();
  const sessionMenu = useSessionContextMenu();

  const todayStr = getTodayDateString();
  const currentMonday = useMemo(() => getMondayOfDate(todayStr), [todayStr]);
  const [weekStart, setWeekStart] = useState<string>(currentMonday);
  const [showWeekend, setShowWeekend] = useState(false);

  const dayCount = showWeekend ? 7 : 5;
  const weekEnd = useMemo(
    () => addDaysDateString(weekStart, dayCount - 1),
    [weekStart, dayCount],
  );
  const dayDates = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDaysDateString(weekStart, i)),
    [weekStart, dayCount],
  );

  const calendarQuery = useCalendarQuery(weekStart, weekEnd);
  const data = calendarQuery.data;

  // Slot assignment popover/modal state
  const [slotTarget, setSlotTarget] = useState<{ date: string; hour: number } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [slotDurationMins, setSlotDurationMins] = useState(60);

  const openBlocksQuery = useBlocksQuery({ status: 'todo' }, Boolean(slotTarget));
  const openBlocks = openBlocksQuery.data?.blocks ?? [];

  useEffect(() => {
    if (slotTarget && !selectedBlockId && openBlocks.length > 0) {
      setSelectedBlockId(openBlocks[0].id);
    }
  }, [slotTarget, selectedBlockId, openBlocks]);

  const assignSlotMutation = useMutation({
    mutationFn: (args: {
      blockId: string;
      scheduledDate: string;
      plannedStartAt: string;
      plannedEndAt: string;
    }) =>
      apiClient.moveBlock(args.blockId, {
        bucket: 'scheduled',
        scheduledDate: args.scheduledDate,
        plannedStartAt: args.plannedStartAt,
        plannedEndAt: args.plannedEndAt,
      }),
    onSuccess: (_res, vars) => {
      invalidateBlockRelated(queryClient, vars.blockId);
      setSlotTarget(null);
      setSelectedBlockId('');
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => apiClient.syncEvents(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });

  // Live "Now" line minute offset
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() - START_HOUR * 60;
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes() - START_HOUR * 60);
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectWithStats>();
    for (const p of data?.projects ?? shellProjects) {
      map.set(p.id, p);
    }
    return map;
  }, [data?.projects, shellProjects]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, PositionedItem[]>();
    for (const d of dayDates) map.set(d, []);

    for (const session of data?.sessions ?? []) {
      const day = toLocalDateStr(session.startedAt);
      const list = map.get(day);
      if (!list) continue;
      const startMin = getMinutesFromStartHour(session.startedAt);
      const endMin = session.endedAt
        ? getMinutesFromStartHour(session.endedAt)
        : Math.max(startMin + 20, nowMinutes);
      list.push({
        kind: 'session',
        id: session.id,
        startMin: Math.max(0, startMin),
        endMin: Math.min(TOTAL_MINUTES, Math.max(startMin + 18, endMin)),
        session,
      });
    }

    for (const block of data?.plannedBlocks ?? []) {
      if (!block.plannedStartAt || !block.plannedEndAt) continue;
      const day = toLocalDateStr(block.plannedStartAt);
      const list = map.get(day);
      if (!list) continue;
      const startMin = getMinutesFromStartHour(block.plannedStartAt);
      const endMin = getMinutesFromStartHour(block.plannedEndAt);
      list.push({
        kind: 'planned',
        id: block.id,
        startMin: Math.max(0, startMin),
        endMin: Math.min(TOTAL_MINUTES, Math.max(startMin + 22, endMin)),
        block,
      });
    }

    for (const ev of data?.events ?? []) {
      const day = toLocalDateStr(ev.startAt);
      const list = map.get(day);
      if (!list) continue;
      const startMin = getMinutesFromStartHour(ev.startAt);
      const endMin = getMinutesFromStartHour(ev.endAt);
      list.push({
        kind: 'meeting',
        id: ev.id,
        startMin: Math.max(0, startMin),
        endMin: Math.min(TOTAL_MINUTES, Math.max(startMin + 20, endMin)),
        event: ev,
      });
    }

    return map;
  }, [data, dayDates, nowMinutes]);

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i),
    [],
  );

  const isCurrentWeek = weekStart === currentMonday;
  const rangeLabel = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`;
  const showNowLine = nowMinutes >= 0 && nowMinutes <= TOTAL_MINUTES;
  const nowTopPx = (nowMinutes / 60) * HOUR_HEIGHT;

  const handleAssignSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!slotTarget || !selectedBlockId) return;
    const startIso = buildLocalIso(slotTarget.date, slotTarget.hour, 0);
    const endIso = new Date(Date.parse(startIso) + slotDurationMins * 60_000).toISOString();
    assignSlotMutation.mutate({
      blockId: selectedBlockId,
      scheduledDate: slotTarget.date,
      plannedStartAt: startIso,
      plannedEndAt: endIso,
    });
  };

  return (
    <div className="h-full flex flex-col bg-[#131313]">
      {/* Top Toolbar + Quiet Legend */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-3.5 border-b border-[#2A2A2A]/80 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-[22px] font-semibold text-[#EDEDED]">Calendar</h1>

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
              {isCurrentWeek ? `This Week · ${rangeLabel}` : rangeLabel}
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

          {/* Quiet Legend: Done (logged) vs Planned vs Meeting */}
          <div
            aria-label="Calendar legend"
            className="flex items-center gap-3.5 pl-1 text-[11.5px] text-[#9A9A9A]"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-[#1F2759] border border-[#3B4BD8] inline-flex items-center justify-center text-[#AEB8FF]">
                <Check size={9} strokeWidth={2.75} />
              </span>
              <span>Done (logged)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-[#171A30] border border-dashed border-[#3B4BD8]" />
              <span>Planned</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-[#181818] border border-[#2A2A2A] inline-flex items-center justify-center text-[#9A9A9A]">
                <Video size={8} />
              </span>
              <span>Meeting</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={
              <RefreshCw size={12} className={syncMutation.isPending ? 'animate-spin' : ''} />
            }
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            Sync
          </Button>
          <Button
            variant={showWeekend ? 'accent-soft' : 'secondary'}
            size="sm"
            onClick={() => setShowWeekend((v) => !v)}
          >
            {showWeekend ? 'Mon–Sun' : 'Mon–Fri'}
          </Button>
        </div>
      </header>

      {/* Day Header Row */}
      <div className="shrink-0 flex border-b border-[#2A2A2A] bg-[#131313] pr-2">
        <div className="w-16 shrink-0" />
        <div
          className="flex-1 grid"
          style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(130px, 1fr))` }}
        >
          {dayDates.map((dateStr) => {
            const { weekday, dayNum } = formatDayColumnLabel(dateStr);
            const isToday = dateStr === todayStr;
            return (
              <div
                key={dateStr}
                className="px-3 py-2.5 border-l border-[#2A2A2A]/70 flex items-center gap-2"
              >
                <span
                  className={`text-[12px] font-medium ${
                    isToday ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'
                  }`}
                >
                  {weekday}
                </span>
                <span
                  className={[
                    'text-[12.5px] font-semibold tabular-nums inline-flex items-center justify-center',
                    isToday
                      ? 'w-6 h-6 rounded-full bg-[#3B4BD8] text-white'
                      : 'text-[#EDEDED]',
                  ].join(' ')}
                >
                  {dayNum}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable Weekly Time Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto pt-3 pb-6">
        <div className="flex relative" style={{ height: `${GRID_HEIGHT}px` }}>
          {/* Hour Ruler */}
          <div className="w-16 shrink-0 relative select-none bg-[#131313]">
            {hours.map((hour, idx) => (
              <div
                key={hour}
                style={{ top: `${idx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                className="absolute inset-x-0 pr-2.5 flex items-start justify-end"
              >
                <span className="-mt-2 text-[11px] text-[#6E6E6E] tabular-nums">
                  {String(hour).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Day Columns */}
          <div
            className="flex-1 grid relative"
            style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(130px, 1fr))` }}
          >
            {dayDates.map((dateStr) => {
              const isToday = dateStr === todayStr;
              const layoutItems = computeOverlapLayout(itemsByDay.get(dateStr) ?? []);

              return (
                <div
                  key={dateStr}
                  className={`relative border-l border-[#2A2A2A]/70 ${
                    isToday ? 'bg-[#171717]/35' : ''
                  }`}
                >
                  {/* Clickable empty hour slots */}
                  {hours.map((hour, idx) => (
                    <button
                      key={hour}
                      type="button"
                      aria-label={`Plan slot ${dateStr} ${String(hour).padStart(2, '0')}:00`}
                      onClick={() => {
                        setSlotTarget({ date: dateStr, hour });
                        setSlotDurationMins(60);
                      }}
                      style={{ top: `${idx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                      className="absolute inset-x-0 border-b border-[#2A2A2A]/45 hover:bg-white/[0.025] transition-colors text-left group"
                    >
                      <span className="opacity-0 group-hover:opacity-100 absolute right-1.5 top-1 text-[10px] text-[#6E6E6E] transition-opacity">
                        + Plan
                      </span>
                    </button>
                  ))}

                  {/* Crisp #3B4BD8 Now Line */}
                  {isToday && showNowLine ? (
                    <div
                      aria-label="Current time"
                      style={{ top: `${nowTopPx}px` }}
                      className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                    >
                      <span className="-ml-1 w-2 h-2 rounded-full bg-[#3B4BD8] shrink-0" />
                      <div className="flex-1 h-[1.5px] bg-[#3B4BD8]" />
                    </div>
                  ) : null}

                  {/* Calendar Items */}
                  {layoutItems.map(({ item, col, colCount }) => {
                    const topPx = (item.startMin / 60) * HOUR_HEIGHT;
                    const heightPx = Math.max(
                      24,
                      ((item.endMin - item.startMin) / 60) * HOUR_HEIGHT - 2,
                    );
                    const widthPct = 100 / colCount;
                    const leftPct = col * widthPct;
                    // Figma time-grid proportions: compact padding, never card-sized.
                    const isTall = heightPx >= 48;
                    const padY = isTall ? 'py-2' : heightPx < 30 ? 'py-1' : 'py-1.5';
                    const padX = isTall ? 'px-3' : 'px-2.5';
                    const showMeta = heightPx >= 40;

                    if (item.kind === 'session') {
                      const session = item.session;
                      const project = projectsById.get(session.projectId);
                      const accent = getProjectAccentStyle(project?.color);
                      const isSelected =
                        activeDrawer?.kind === 'session' && activeDrawer.sessionId === session.id;
                      const mins = Math.max(1, Math.round(item.endMin - item.startMin));

                      return (
                        <button
                          key={`session-${session.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSessionDrawer(session.id);
                          }}
                          onContextMenu={(e) =>
                            sessionMenu.open(e, {
                              sessionId: session.id,
                              blockId: session.blockId,
                              title: session.blockTitle,
                            })
                          }
                          style={{
                            top: `${topPx + 1}px`,
                            height: `${heightPx}px`,
                            left: `calc(${leftPct}% + 3px)`,
                            width: `calc(${widthPct}% - 6px)`,
                            backgroundColor: accent.badgeBg,
                            borderColor: isSelected ? accent.hex : accent.border,
                            boxShadow: isSelected ? `0 0 0 2px ${accent.hex}` : undefined,
                          }}
                          className={`absolute z-10 rounded-[7px] border ${padX} ${padY} text-left overflow-hidden transition-[box-shadow,filter] hover:brightness-110 flex flex-col justify-start gap-0.5 focus:outline-none focus-visible:brightness-125`}
                        >
                          <div className="flex items-start justify-between gap-1 min-w-0">
                            <span className="text-[11.5px] font-medium text-[#EDEDED] leading-tight truncate">
                              {session.blockTitle}
                            </span>
                            {session.blockStatus === 'done' ? (
                              <span
                                style={{ color: accent.text }}
                                className="shrink-0 mt-0.5 inline-flex items-center"
                                title="Done (logged)"
                              >
                                <Check size={11} strokeWidth={2.75} />
                              </span>
                            ) : null}
                          </div>
                          {showMeta ? (
                            <div className="flex items-center justify-between gap-1 text-[10.5px] text-[#C4C4C4] tabular-nums">
                              <span className="truncate">{project?.name ?? 'Focus'}</span>
                              <span className="shrink-0 opacity-85">{formatDuration(mins)}</span>
                            </div>
                          ) : null}
                        </button>
                      );
                    }

                    if (item.kind === 'planned') {
                      const block = item.block;
                      const project = projectsById.get(block.projectId);
                      const accent = getProjectAccentStyle(project?.color);
                      const isSelected =
                        activeDrawer?.kind === 'block' && activeDrawer.blockId === block.id;

                      return (
                        <button
                          key={`planned-${block.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBlockDrawer(block.id);
                          }}
                          onContextMenu={(e) => blockMenu.open(e, block)}
                          style={{
                            top: `${topPx + 1}px`,
                            height: `${heightPx}px`,
                            left: `calc(${leftPct}% + 3px)`,
                            width: `calc(${widthPct}% - 6px)`,
                            backgroundColor: accent.wash,
                            borderColor: accent.hex,
                            boxShadow: isSelected ? `0 0 0 2px ${accent.hex}` : undefined,
                          }}
                          className={`absolute z-10 rounded-[7px] border border-dashed ${padX} ${padY} text-left overflow-hidden transition-[box-shadow,filter] hover:brightness-115 flex flex-col justify-start gap-0.5 focus:outline-none focus-visible:brightness-125`}
                        >
                          <div className="flex items-start justify-between gap-1 min-w-0">
                            <span className="text-[11.5px] font-medium text-[#EDEDED] leading-tight truncate">
                              {block.title}
                            </span>
                            <span
                              style={{ color: accent.text }}
                              className="text-[9.5px] font-semibold uppercase tracking-[0.04em] shrink-0"
                            >
                              Planned
                            </span>
                          </div>
                          {showMeta && block.plannedStartAt ? (
                            <div className="text-[10.5px] text-[#9A9A9A] tabular-nums truncate">
                              {formatLocalTime(block.plannedStartAt)}
                              {project ? ` · ${project.name}` : ''}
                            </div>
                          ) : null}
                        </button>
                      );
                    }

                    // Meeting item (unified calendar-synced block)
                    const ev = item.event;
                    const project = ev.projectId ? projectsById.get(ev.projectId) : undefined;
                    const accent = project ? getProjectAccentStyle(project.color) : null;
                    const isSelected =
                      activeDrawer?.kind === 'block' && activeDrawer.blockId === ev.id;
                    const ringColor = accent?.hex ?? '#5566F2';

                    return (
                      <button
                        key={`meeting-${ev.id}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMeetingDrawer(ev.id);
                        }}
                        onContextMenu={(e) => meetingMenu.open(e, ev)}
                        style={{
                          top: `${topPx + 1}px`,
                          height: `${heightPx}px`,
                          left: `calc(${leftPct}% + 3px)`,
                          width: `calc(${widthPct}% - 6px)`,
                          borderColor: isSelected ? ringColor : '#2A2A2A',
                          boxShadow: isSelected ? `0 0 0 2px ${ringColor}` : undefined,
                        }}
                        className={`absolute z-10 rounded-[7px] bg-[#181818] border ${
                          project ? (isTall ? 'pl-3.5' : 'pl-3') : isTall ? 'pl-3' : 'pl-2.5'
                        } ${isTall ? 'pr-3' : 'pr-2.5'} ${padY} text-left overflow-hidden transition-[box-shadow,border-color] hover:border-[#3C3C3C] flex flex-col justify-start gap-0.5 focus:outline-none focus-visible:border-[#5566F2]`}
                      >
                        {project ? (
                          <span
                            aria-hidden
                            className="absolute left-0 top-0 bottom-0 w-[3px]"
                            style={{ backgroundColor: project.color }}
                          />
                        ) : null}
                        <div className="flex items-start justify-between gap-1.5 min-w-0">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <Video size={11} className="text-[#9A9A9A] shrink-0 mt-0.5" />
                            <span className="text-[11.5px] font-medium text-[#EDEDED] leading-tight truncate">
                              {ev.title}
                            </span>
                          </div>
                          {ev.status === 'done' ? (
                            <span
                              className="shrink-0 mt-0.5 inline-flex items-center text-[#7BE0A0]"
                              title="Completed"
                            >
                              <Check size={11} strokeWidth={2.75} />
                            </span>
                          ) : null}
                        </div>
                        {showMeta ? (
                          <div className="flex items-center gap-1.5 min-w-0 text-[10.5px] text-[#9A9A9A] tabular-nums pl-4">
                            <span className="shrink-0">
                              {formatLocalTime(ev.startAt)} – {formatLocalTime(ev.endAt)}
                            </span>
                            {project && heightPx < 56 ? (
                              <span className="truncate text-[#6E6E6E]">· {project.name}</span>
                            ) : null}
                          </div>
                        ) : null}
                        {project && heightPx >= 56 ? (
                          <div className="flex items-center gap-1.5 min-w-0 pl-4 text-[10.5px] text-[#9A9A9A]">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="truncate">{project.name}</span>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Assign Planned Slot Chooser Modal */}
      <ModalSheet
        open={Boolean(slotTarget)}
        onClose={() => setSlotTarget(null)}
        width={460}
        ariaLabel="Assign planned slot"
        title="Schedule Planned Slot"
        subtitle={
          slotTarget
            ? `${formatShortDate(slotTarget.date)} · ${String(slotTarget.hour).padStart(2, '0')}:00`
            : undefined
        }
      >
        {slotTarget ? (
          <form onSubmit={handleAssignSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11.5px] font-medium text-[#9A9A9A] block">
                Pick an open block
              </label>
              {openBlocksQuery.isLoading ? (
                <div className="text-[12.5px] text-[#6E6E6E] py-3">Loading open blocks…</div>
              ) : openBlocks.length === 0 ? (
                <div className="text-[12.5px] text-[#6E6E6E] py-2">
                  No open blocks yet — create one directly in this slot below.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {openBlocks.map((blk) => {
                    const proj = projectsById.get(blk.projectId);
                    const active = selectedBlockId === blk.id;
                    return (
                      <button
                        key={blk.id}
                        type="button"
                        onClick={() => setSelectedBlockId(blk.id)}
                        className={[
                          'w-full px-3 py-2 rounded-[8px] border text-left transition-colors flex items-center justify-between gap-2',
                          active
                            ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                            : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {proj ? (
                            <ProjectBadge
                              name={proj.name}
                              color={proj.color}
                              icon={proj.icon}
                              size="xs"
                            />
                          ) : null}
                          <span className="text-[13px] font-medium truncate">{blk.title}</span>
                        </div>
                        <span className="text-[11px] text-[#9A9A9A] shrink-0">
                          {blk.bucket === 'scheduled' && blk.scheduledDate
                            ? formatShortDate(blk.scheduledDate)
                            : blk.bucket}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-[11.5px] font-medium text-[#9A9A9A] flex items-center gap-1.5">
                <Clock size={11} />
                Planned window
              </span>
              <div className="grid grid-cols-4 gap-2">
                {[30, 60, 90, 120].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setSlotDurationMins(mins)}
                    className={[
                      'h-8 rounded-[6px] border text-[12px] font-medium tabular-nums transition-colors',
                      slotDurationMins === mins
                        ? 'bg-[#1F2759] border-[#5566F2] text-[#D6DCFF]'
                        : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED]',
                    ].join(' ')}
                  >
                    {formatDuration(mins)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#2A2A2A]">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Plus size={12} />}
                onClick={() => {
                  const startIso = buildLocalIso(slotTarget.date, slotTarget.hour, 0);
                  const endIso = new Date(
                    Date.parse(startIso) + slotDurationMins * 60_000,
                  ).toISOString();
                  setSlotTarget(null);
                  openCreateBlock({
                    bucket: 'scheduled',
                    scheduledDate: slotTarget.date,
                    plannedStartAt: startIso,
                    plannedEndAt: endIso,
                  });
                }}
              >
                New block in slot
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSlotTarget(null)}>
                  <X size={12} /> Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!selectedBlockId || assignSlotMutation.isPending}
                >
                  Place Planned
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </ModalSheet>
      {blockMenu.menu}
      {meetingMenu.menu}
      {sessionMenu.menu}
    </div>
  );
}
