import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Block,
  CalendarEvent,
  DayLookBackSummary,
  DropReason,
  EnergySignal,
  Goal,
  ProjectWithStats,
  RoomTodaySummary,
  SuggestedOrderItem,
} from '@veyra/core/types';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Flame,
  Link2,
  MessageSquare,
  Minus,
  NotebookPen,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Video,
  X,
} from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, openExternalUrl } from '../api/client';
import { invalidateBlockRelated, useCalendarQuery, useTodayQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { GoalChip } from '../components/GoalChip';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import { TellSomeonePopover } from '../components/TellSomeonePopover';
import { useBlockContextMenu, useMeetingContextMenu } from '../components/entityMenus';
import { activeCardStyle, goalTint } from '../components/goalTint';
import {
  addDaysDateString,
  formatDateHeading,
  formatDuration,
  formatElapsedTimer,
  formatLocalTime,
  formatShortDate,
  formatTimeRange,
  getSessionDurationMinutes,
  getTodayDateString,
} from '../components/icons';

const DAY_LOOK_BACK_DISMISS_PREFIX = 'veyra.dayLookBack.dismissed.';

const DROP_REASON_OPTIONS: ReadonlyArray<{ value: DropReason; label: string }> = [
  { value: 'not_important', label: 'Not important anymore' },
  { value: 'someone_else', label: 'Someone else did it' },
  { value: 'no_room', label: 'No room' },
];

function isLookBackDismissedInStorage(date: string): boolean {
  try {
    return window.localStorage.getItem(`${DAY_LOOK_BACK_DISMISS_PREFIX}${date}`) === '1';
  } catch {
    return false;
  }
}

function persistLookBackDismissed(date: string): void {
  try {
    window.localStorage.setItem(`${DAY_LOOK_BACK_DISMISS_PREFIX}${date}`, '1');
  } catch {
    // Ignore storage errors in restricted environments
  }
}

function computePresetHHMMFromNow(addMinutes: number): string {
  const now = new Date();
  const totalMins = Math.min(23 * 60 + 55, now.getHours() * 60 + now.getMinutes() + addMinutes);
  const rounded = Math.min(23 * 60 + 55, Math.ceil(totalMins / 5) * 5);
  const hh = String(Math.floor(rounded / 60)).padStart(2, '0');
  const mm = String(rounded % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatRoomBudgetTail(room: RoomTodaySummary): string {
  const budgetLabel = room.hasLearnedBaseline
    ? `your usual ${room.weekdayLabel} ${formatDuration(room.baselineFocusMinutes)}`
    : `your ${formatDuration(room.baselineFocusMinutes)}`;
  if (room.hasTodayWorkdayEndOverride) {
    return "· today's end time";
  }
  return `, ${formatDuration(room.focusBudgetLeftMinutes)} of ${budgetLabel} focus budget left`;
}

function canTellSomeone(block: Block): boolean {
  return Boolean(block.dueDate) || /^follow-up:/i.test(block.title.trim());
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
  const queryClient = useQueryClient();
  const {
    activeDrawer,
    focusStatus: shellFocusStatus,
    liveElapsedSeconds,
    projects: shellProjects,
    goals: shellGoals,
    settings: shellSettings,
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

  const serverUpNext = useMemo(
    () => (data?.upNext ?? []).filter((b) => b.id !== activeBlockId),
    [data?.upNext, activeBlockId],
  );
  // Optimistic order after a drag, held until the refetched server order matches it.
  const [localOrderIds, setLocalOrderIds] = useState<string[] | null>(null);
  const upNext = useMemo(() => {
    if (!localOrderIds) return serverUpNext;
    const byId = new Map(serverUpNext.map((b) => [b.id, b]));
    const ordered = localOrderIds.flatMap((id) => {
      const blk = byId.get(id);
      return blk ? [blk] : [];
    });
    const orderedIds = new Set(ordered.map((b) => b.id));
    return [...ordered, ...serverUpNext.filter((b) => !orderedIds.has(b.id))];
  }, [serverUpNext, localOrderIds]);
  const completedToday = data?.completedToday ?? [];
  const upcomingEvents = data?.upcomingEvents ?? [];
  const roomToday = data?.roomToday;
  const suggestedOrder = data?.suggestedOrder ?? [];
  const fitLine = data?.fitLine;
  const dayLookBack = data?.dayLookBack ?? null;

  // Only surface a meeting that is still ahead — never fall back to one that already ended.
  const nextEvent: CalendarEvent | undefined = upcomingEvents[0];
  const blockMenu = useBlockContextMenu();
  const meetingMenu = useMeetingContextMenu();

  // Retain recently dropped blocks in local state so SSE block.dropped refetches do not clear
  // the inline Drop reason / Undo strip before the user chooses a reason, skips, or undoes.
  const [recentlyDroppedBlocks, setRecentlyDroppedBlocks] = useState<Block[]>([]);
  const [openTellSomeoneBlockId, setOpenTellSomeoneBlockId] = useState<string | null>(null);
  const [workdayPopoverOpen, setWorkdayPopoverOpen] = useState(false);
  const [todayEndDraft, setTodayEndDraft] = useState('18:00');
  const [defaultStartDraft, setDefaultStartDraft] = useState('09:00');
  const [defaultEndDraft, setDefaultEndDraft] = useState('18:00');
  const [workdayError, setWorkdayError] = useState<string | null>(null);
  const workdayPopoverRef = useRef<HTMLDivElement>(null);
  const [dismissedLookBackDates, setDismissedLookBackDates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!workdayPopoverOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (workdayPopoverRef.current && !workdayPopoverRef.current.contains(e.target as Node)) {
        setWorkdayPopoverOpen(false);
        setWorkdayError(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWorkdayPopoverOpen(false);
        setWorkdayError(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workdayPopoverOpen]);

  const updateWorkdayMutation = useMutation({
    mutationFn: (patch: Parameters<typeof apiClient.updateSettings>[0]) =>
      apiClient.updateSettings(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      setWorkdayPopoverOpen(false);
      setWorkdayError(null);
    },
    onError: (err) => {
      setWorkdayError(err instanceof Error ? err.message : 'Could not update workday hours');
    },
  });

  const openWorkdayPopover = () => {
    setTodayEndDraft(roomToday?.workdayEnd ?? shellSettings?.workdayEnd ?? '18:00');
    setDefaultStartDraft(shellSettings?.workdayStart ?? roomToday?.workdayStart ?? '09:00');
    setDefaultEndDraft(shellSettings?.workdayEnd ?? '18:00');
    setWorkdayError(null);
    setWorkdayPopoverOpen((prev) => !prev);
  };
  // Keyboard selection is tracked by block id and only highlighted after arrow-key navigation,
  // so a mouse user never sees a card marked as selected that they did not pick.
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);

  const recentlyDroppedIds = useMemo(
    () => new Set(recentlyDroppedBlocks.map((b) => b.id)),
    [recentlyDroppedBlocks],
  );

  const suggestedOrderByBlockId = useMemo(() => {
    const map = new Map<string, SuggestedOrderItem>();
    for (const item of suggestedOrder) {
      map.set(item.blockId, item);
    }
    return map;
  }, [suggestedOrder]);

  const suggestedBlockIds = useMemo(
    () => suggestedOrder.map((item) => item.blockId),
    [suggestedOrder],
  );

  const hasSuggestedOrderDiff = useMemo(() => {
    if (upNext.length < 2 || suggestedBlockIds.length !== upNext.length) {
      return false;
    }
    for (let i = 0; i < upNext.length; i++) {
      if (upNext[i].id !== suggestedBlockIds[i]) {
        return true;
      }
    }
    return false;
  }, [upNext, suggestedBlockIds]);

  const fitLineIndex = fitLine ? Math.min(fitLine.fitLineIndex, upNext.length) : upNext.length;

  const fittingBlocks = useMemo(
    () => upNext.slice(0, fitLineIndex).filter((b) => !recentlyDroppedIds.has(b.id)),
    [upNext, fitLineIndex, recentlyDroppedIds],
  );

  const overflowBlocks = useMemo(
    () => upNext.slice(fitLineIndex).filter((b) => !recentlyDroppedIds.has(b.id)),
    [upNext, fitLineIndex, recentlyDroppedIds],
  );

  const visibleUpNext = useMemo(
    () => [...fittingBlocks, ...overflowBlocks],
    [fittingBlocks, overflowBlocks],
  );
  const visibleUpNextIds = useMemo(() => visibleUpNext.map((b) => b.id), [visibleUpNext]);

  useEffect(() => {
    if (!localOrderIds) return;
    const serverIds = serverUpNext.map((b) => b.id);
    if (
      serverIds.length === localOrderIds.length &&
      serverIds.every((id, idx) => id === localOrderIds[idx])
    ) {
      setLocalOrderIds(null);
    }
  }, [serverUpNext, localOrderIds]);

  const reorderTodayMutation = useMutation({
    mutationFn: (blockIds: string[]) => apiClient.applySuggestedOrder(blockIds),
    onSuccess: () => {
      invalidateBlockRelated(queryClient);
    },
    onError: () => {
      setLocalOrderIds(null);
    },
  });

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // A drag ends with pointerup on the moved card itself, which would also fire a click and open
  // the drawer. This flag swallows that one click.
  const suppressClickRef = useRef(false);

  const handleTodayDragEnd = (event: DragEndEvent) => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = upNext.map((b) => b.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(ids, oldIndex, newIndex);
    setLocalOrderIds(nextIds);
    reorderTodayMutation.mutate(nextIds);
  };

  const showFitLine = Boolean(fitLine && upNext.length > fitLine.fitLineIndex);
  const showOverflowSection = overflowBlocks.length > 0 || recentlyDroppedBlocks.length > 0;
  const showDayLookBack = Boolean(
    dayLookBack &&
      !dismissedLookBackDates[dayLookBack.date] &&
      !isLookBackDismissedInStorage(dayLookBack.date),
  );

  const applySuggestedOrderMutation = useMutation({
    mutationFn: (blockIds: string[]) => apiClient.applySuggestedOrder(blockIds),
    onSuccess: () => {
      invalidateBlockRelated(queryClient);
    },
  });

  const moveTomorrowMutation = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.moveBlock(blockId, {
        bucket: 'scheduled',
        scheduledDate: addDaysDateString(dateStr, 1),
      }),
    onSuccess: (_, blockId) => {
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const parkLaterMutation = useMutation({
    mutationFn: (blockId: string) => apiClient.parkBlock(blockId, { revisitAt: '2w' }),
    onSuccess: (_, blockId) => {
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const dropBlockMutation = useMutation({
    mutationFn: (block: Block) => apiClient.dropBlock(block.id),
    onSuccess: (_, block) => {
      invalidateBlockRelated(queryClient, block.id);
    },
    onError: (_, block) => {
      setRecentlyDroppedBlocks((prev) => prev.filter((item) => item.id !== block.id));
    },
  });

  const updateDropReasonMutation = useMutation({
    mutationFn: ({ blockId, dropReason }: { blockId: string; dropReason: DropReason }) =>
      apiClient.updateBlock(blockId, { dropReason }),
    onSuccess: (_, { blockId }) => {
      setRecentlyDroppedBlocks((prev) => prev.filter((item) => item.id !== blockId));
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const reopenBlockMutation = useMutation({
    mutationFn: (blockId: string) => apiClient.reopenBlock(blockId),
    onSuccess: (_, blockId) => {
      setRecentlyDroppedBlocks((prev) => prev.filter((item) => item.id !== blockId));
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  const handleDropBlock = (block: Block) => {
    if (openTellSomeoneBlockId === block.id) {
      setOpenTellSomeoneBlockId(null);
    }
    setRecentlyDroppedBlocks((prev) =>
      prev.some((item) => item.id === block.id) ? prev : [...prev, block],
    );
    dropBlockMutation.mutate(block);
  };

  const handleDismissLookBack = (lookBack: DayLookBackSummary) => {
    persistLookBackDismissed(lookBack.date);
    setDismissedLookBackDates((prev) => ({ ...prev, [lookBack.date]: true }));
  };

  useEffect(() => {
    if (selectedBlockId && !visibleUpNextIds.includes(selectedBlockId)) {
      setSelectedBlockId(null);
    }
  }, [visibleUpNextIds, selectedBlockId]);

  // Any pointer interaction ends keyboard mode so the keyboard highlight does not linger.
  useEffect(() => {
    const onPointerDown = () => setKeyboardNavActive(false);
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

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
      if (activeDrawer !== null || openTellSomeoneBlockId !== null || visibleUpNextIds.length === 0) {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const count = visibleUpNextIds.length;
        const current =
          keyboardNavActive && selectedBlockId ? visibleUpNextIds.indexOf(selectedBlockId) : -1;
        const nextIndex =
          e.key === 'ArrowDown'
            ? (current + 1) % count
            : current <= 0
              ? count - 1
              : current - 1;
        setKeyboardNavActive(true);
        setSelectedBlockId(visibleUpNextIds[nextIndex] ?? null);
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const chosen =
          (keyboardNavActive && selectedBlockId
            ? visibleUpNext.find((b) => b.id === selectedBlockId)
            : undefined) ?? visibleUpNext[0];
        if (chosen) {
          e.preventDefault();
          void startFocusAndNavigate(chosen.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeDrawer,
    openTellSomeoneBlockId,
    visibleUpNext,
    visibleUpNextIds,
    keyboardNavActive,
    selectedBlockId,
    startFocusAndNavigate,
  ]);

  const drawerSelectedBlockId = activeDrawer?.kind === 'block' ? activeDrawer.blockId : null;
  const drawerSelectedEventId = drawerSelectedBlockId;
  const keyboardSelectedBlockId =
    !drawerSelectedBlockId && keyboardNavActive ? selectedBlockId : null;

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
        {/* Header Row: Date + Room today + Weekly Rule on left; Focused pill on right */}
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

          {roomToday ? (
            <div ref={workdayPopoverRef} className="relative">
              <p
                data-testid="room-today-line"
                className="text-[13px] text-[#9A9A9A] tabular-nums flex items-center flex-wrap gap-x-1 gap-y-1"
              >
                <span>
                  Room today ≈ {formatDuration(roomToday.roomMinutes)} ·{' '}
                  {formatDuration(roomToday.freeTimeLeftMinutes)} free
                </span>
                <button
                  type="button"
                  aria-label="Set working end time for today"
                  aria-expanded={workdayPopoverOpen}
                  onClick={openWorkdayPopover}
                  className={[
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] transition-colors border',
                    roomToday.hasTodayWorkdayEndOverride
                      ? 'bg-[#1F2759] border-[#5566F2]/45 text-[#D6DCFF] hover:brightness-115'
                      : 'bg-transparent border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-[#1C1C1C] hover:border-[#2A2A2A]',
                  ].join(' ')}
                >
                  <Clock size={11} className="shrink-0" />
                  <span>until {roomToday.workdayEnd}</span>
                </button>
                <span>{formatRoomBudgetTail(roomToday)}</span>
              </p>

              {workdayPopoverOpen ? (
                <div
                  role="dialog"
                  aria-label="Workday hours"
                  className="absolute left-0 top-full mt-2 z-30 w-[330px] rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] p-3.5 space-y-3.5 animate-veyra-fade"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A]">
                        Working until today
                      </span>
                      {roomToday.hasTodayWorkdayEndOverride ? (
                        <button
                          type="button"
                          disabled={updateWorkdayMutation.isPending}
                          onClick={() =>
                            updateWorkdayMutation.mutate({
                              workdayEndOverrideDate: null,
                              workdayEndOverrideTime: null,
                            })
                          }
                          className="text-[11px] text-[#AEB8FF] hover:text-[#D6DCFF]"
                        >
                          Reset ({shellSettings?.workdayEnd ?? '18:00'})
                        </button>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[
                        { label: '+1h', mins: 60 },
                        { label: '+2h', mins: 120 },
                        { label: '+3h', mins: 180 },
                      ].map((preset) => (
                        <Button
                          key={preset.label}
                          type="button"
                          variant="secondary"
                          size="xs"
                          disabled={updateWorkdayMutation.isPending}
                          onClick={() =>
                            updateWorkdayMutation.mutate({
                              workdayEndOverrideDate: dateStr,
                              workdayEndOverrideTime: computePresetHHMMFromNow(preset.mins),
                            })
                          }
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label="Today end time"
                        value={todayEndDraft}
                        onChange={(e) => setTodayEndDraft(e.target.value)}
                        className="flex-1 h-8 px-2.5 rounded-[7px] bg-[#171717] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="xs"
                        disabled={updateWorkdayMutation.isPending}
                        onClick={() =>
                          updateWorkdayMutation.mutate({
                            workdayEndOverrideDate: dateStr,
                            workdayEndOverrideTime: todayEndDraft,
                          })
                        }
                      >
                        Set for today
                      </Button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#2E2E2E] space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] block">
                      Default workday
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label="Default workday start"
                        value={defaultStartDraft}
                        onChange={(e) => setDefaultStartDraft(e.target.value)}
                        className="w-[96px] h-8 px-2 rounded-[7px] bg-[#171717] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                      />
                      <span className="text-[12px] text-[#6E6E6E]">to</span>
                      <input
                        type="time"
                        aria-label="Default workday end"
                        value={defaultEndDraft}
                        onChange={(e) => setDefaultEndDraft(e.target.value)}
                        className="w-[96px] h-8 px-2 rounded-[7px] bg-[#171717] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        disabled={updateWorkdayMutation.isPending}
                        onClick={() =>
                          updateWorkdayMutation.mutate({
                            workdayStart: defaultStartDraft,
                            workdayEnd: defaultEndDraft,
                          })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  {workdayError ? (
                    <div className="text-[11.5px] text-[#FF9EC5]">{workdayError}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

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

        {/* Quiet Day Look Back Card */}
        {showDayLookBack && dayLookBack ? (
          <DayLookBackCard
            lookBack={dayLookBack}
            onDismiss={() => handleDismissLookBack(dayLookBack)}
          />
        ) : null}

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
              {activeBlockId === nextEvent.id ? (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate('focus');
                  }}
                >
                  Focusing
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="xs"
                  leftIcon={<Play size={10} fill="currentColor" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    void startFocusAndNavigate(nextEvent.id);
                  }}
                >
                  Start Focus
                </Button>
              )}
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

        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={() => {
            suppressClickRef.current = true;
          }}
          onDragCancel={() => {
            suppressClickRef.current = false;
          }}
          onDragEnd={handleTodayDragEnd}
        >
        <SortableContext items={visibleUpNextIds} strategy={verticalListSortingStrategy}>
        {/* UP NEXT Section */}
        <section className="space-y-3" aria-label="Up Next">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Up Next
                </h2>
                <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">{upNext.length}</span>
              </div>
              {upNext.length > 0 ? (
                <p className="text-[11.5px] text-[#6E6E6E]">
                  Order: commitments, goal work, project time, Ops last
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {hasSuggestedOrderDiff ? (
                <Button
                  variant="secondary"
                  size="xs"
                  leftIcon={<ArrowUpDown size={11} />}
                  loading={applySuggestedOrderMutation.isPending}
                  onClick={() => applySuggestedOrderMutation.mutate(suggestedBlockIds)}
                >
                  Use suggested order
                </Button>
              ) : null}
              {upNext.length > 0 ? (
                <span className="text-[11.5px] text-[#6E6E6E]">
                  Press <kbd className="text-[#9A9A9A] font-medium">Enter</kbd> to start focus
                </span>
              ) : null}
            </div>
          </div>

          {todayQuery.isLoading ? (
            <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading today’s blocks…</div>
          ) : upNext.length === 0 && recentlyDroppedBlocks.length === 0 ? (
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
              {fittingBlocks.map((block) => {
                const project = projectsById.get(block.projectId);
                const goal = block.goalId ? goalsById.get(block.goalId) : undefined;
                const suggested = suggestedOrderByBlockId.get(block.id);
                const isRunning = activeBlockId === block.id;
                const isSelected =
                  drawerSelectedBlockId === block.id || keyboardSelectedBlockId === block.id;

                return (
                  <SortableTodayRow key={block.id} id={block.id} suppressClickRef={suppressClickRef}>
                  <TodayBlockCard
                    block={block}
                    project={project}
                    goal={goal}
                    suggested={suggested}
                    isRunning={isRunning}
                    isSelected={isSelected}
                    onSelect={() => {
                      setSelectedBlockId(block.id);
                      setKeyboardNavActive(false);
                      openBlockDrawer(block.id);
                    }}
                    onPlay={() => void startFocusAndNavigate(block.id)}
                    onContextMenu={(e) => blockMenu.open(e, block)}
                  />
                  </SortableTodayRow>
                );
              })}
            </div>
          )}
        </section>

        {/* Fit Line Divider */}
        {showFitLine && fitLine ? (
          <div className="flex items-center gap-3 py-0.5" role="separator" aria-label="Fit line">
            <div className="flex-1 h-px bg-[#2A2A2A]" />
            <span className="text-[11.5px] font-medium text-[#9A9A9A] tabular-nums shrink-0">
              {fitLine.remainingMinutes > 0
                ? `fits today · about ${formatDuration(fitLine.remainingMinutes)} left`
                : 'fits today · room full'}
            </span>
            <div className="flex-1 h-px bg-[#2A2A2A]" />
          </div>
        ) : null}

        {/* PROBABLY NOT TODAY Section */}
        {showOverflowSection ? (
          <section className="space-y-3" aria-label="Probably not today">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Probably not today
                </h2>
                {overflowBlocks.length > 0 && fitLine ? (
                  <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                    {overflowBlocks.length} {overflowBlocks.length === 1 ? 'block' : 'blocks'} ·{' '}
                    {formatDuration(fitLine.overflowMinutes)} past the room
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              {overflowBlocks.map((block) => {
                const project = projectsById.get(block.projectId);
                const goal = block.goalId ? goalsById.get(block.goalId) : undefined;
                const suggested = suggestedOrderByBlockId.get(block.id);
                const effectiveSize = suggested?.effectiveSizeMinutes ?? block.sizeMinutes ?? 60;
                const isDrawerOpen = drawerSelectedBlockId === block.id;
                const isKeyboardSelected = keyboardSelectedBlockId === block.id;
                const showTellSomeone = canTellSomeone(block);
                const isPopoverOpen = openTellSomeoneBlockId === block.id;

                const selectOverflow = () => {
                  setSelectedBlockId(block.id);
                  setKeyboardNavActive(false);
                  openBlockDrawer(block.id);
                };

                return (
                  <SortableTodayRow key={block.id} id={block.id} suppressClickRef={suppressClickRef}>
                  <div className="relative">
                    <div
                      data-overflow-row={block.id}
                      role="button"
                      tabIndex={0}
                      onClick={selectOverflow}
                      onContextMenu={(e) => blockMenu.open(e, block)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectOverflow();
                        }
                      }}
                      className={[
                        'rounded-[12px] bg-[#171717] border p-[18px] space-y-3 transition-colors cursor-pointer focus:outline-none focus-visible:border-[#5566F2]',
                        isDrawerOpen
                          ? 'border-[#5566F2]'
                          : isKeyboardSelected
                            ? 'border-[#5566F2]/70'
                            : 'border-[#2A2A2A] hover:border-[#3C3C3C]',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[14px] font-medium leading-snug text-[#C4C4C4]">
                              {block.title}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-[#242424] border border-[#2A2A2A] text-[11px] font-medium text-[#9A9A9A] tabular-nums">
                              {formatDuration(effectiveSize)}
                            </span>
                          </div>

                          <div className="flex items-center flex-wrap gap-1.5">
                            {project ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9A9A9A] mr-1">
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

                          {suggested?.reason ? (
                            <p className="text-[12px] text-[#6E6E6E] truncate">
                              {suggested.reason}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {/* Quiet inline exits beneath a single 1px hairline — zero card-in-card */}
                      <div
                        className="pt-2.5 border-t border-[#2A2A2A] flex items-center justify-between gap-2 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={moveTomorrowMutation.isPending}
                            onClick={() => moveTomorrowMutation.mutate(block.id)}
                          >
                            Tomorrow
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={parkLaterMutation.isPending}
                            onClick={() => parkLaterMutation.mutate(block.id)}
                          >
                            Later
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={dropBlockMutation.isPending}
                            onClick={() => handleDropBlock(block)}
                          >
                            Drop
                          </Button>
                        </div>

                        {showTellSomeone ? (
                          <Button
                            variant={isPopoverOpen ? 'accent-soft' : 'secondary'}
                            size="xs"
                            leftIcon={<MessageSquare size={11} />}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() =>
                              setOpenTellSomeoneBlockId((current) =>
                                current === block.id ? null : block.id,
                              )
                            }
                          >
                            Tell someone
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {isPopoverOpen ? (
                      <div className="absolute right-0 top-full mt-2 z-30">
                        <TellSomeonePopover
                          block={block}
                          project={project}
                          todayDate={dateStr}
                          onClose={() => setOpenTellSomeoneBlockId(null)}
                        />
                      </div>
                    ) : null}
                  </div>
                  </SortableTodayRow>
                );
              })}

              {/* Inline Drop Reason & Undo strips retained across SSE refetches */}
              {recentlyDroppedBlocks.map((block) => (
                <div
                  key={block.id}
                  data-dropped-row={block.id}
                  className="rounded-[12px] bg-[#171717] border border-[#2A2A2A] p-[18px] space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13.5px] text-[#6E6E6E] line-through truncate">
                      {block.title}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11.5px] font-medium text-[#9A9A9A]">Dropped</span>
                      <Button
                        variant="secondary"
                        size="xs"
                        leftIcon={<RotateCcw size={11} />}
                        disabled={reopenBlockMutation.isPending}
                        onClick={() => reopenBlockMutation.mutate(block.id)}
                      >
                        Undo
                      </Button>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[#2A2A2A] flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] text-[#9A9A9A] mr-1">Why? (optional)</span>
                    {DROP_REASON_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        variant="secondary"
                        size="xs"
                        disabled={updateDropReasonMutation.isPending}
                        onClick={() =>
                          updateDropReasonMutation.mutate({
                            blockId: block.id,
                            dropReason: opt.value,
                          })
                        }
                      >
                        {opt.label}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setRecentlyDroppedBlocks((prev) =>
                          prev.filter((item) => item.id !== block.id),
                        )
                      }
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        </SortableContext>
        </DndContext>

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

interface DayLookBackCardProps {
  lookBack: DayLookBackSummary;
  onDismiss: () => void;
}

function DayLookBackCard({ lookBack, onDismiss }: DayLookBackCardProps) {
  const blockWord = lookBack.movedGoalCount === 1 ? 'block' : 'blocks';
  const dayLabel = lookBack.isYesterday
    ? `Yesterday · ${formatShortDate(lookBack.date)}`
    : `Today · ${formatShortDate(lookBack.date)}`;

  return (
    <section
      aria-label="Day look back"
      className="veyra-card space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9A9A9A]">
            DAY LOOK BACK
          </span>
          <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">{dayLabel}</span>
        </div>
        <button
          type="button"
          aria-label="Dismiss day look back"
          onClick={onDismiss}
          className="h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#9A9A9A] hover:bg-[#262626] hover:text-[#EDEDED] transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>

      <p className="font-display text-[16px] font-semibold text-[#EDEDED] tabular-nums">
        {formatDuration(lookBack.focusedMinutes)} focused · {lookBack.goalSharePct}% on goals ·{' '}
        {lookBack.movedGoalCount} {blockWord} moved a goal
      </p>

      {lookBack.notFitBlocks.length > 0 ? (
        <div className="pt-2.5 border-t border-[#2A2A2A] space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6E6E6E]">
            Did not fit
          </div>
          <ul className="space-y-1">
            {lookBack.notFitBlocks.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 text-[12.5px]"
              >
                <span className="text-[#C4C4C4] truncate">{item.title}</span>
                <span className="text-[11.5px] text-[#6E6E6E] shrink-0">{item.destination}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[12px] text-[#6E6E6E]">What did not fit is capacity, not failure.</p>
    </section>
  );
}

function SortableTodayRow({
  id,
  suppressClickRef,
  children,
}: {
  id: string;
  suppressClickRef: { current: boolean };
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      data-sortable-row={id}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.9 : undefined,
        cursor: isDragging ? 'grabbing' : undefined,
      }}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      {...listeners}
    >
      {children}
    </div>
  );
}

interface TodayBlockCardProps {
  block: Block;
  project?: ProjectWithStats;
  goal?: Goal;
  suggested?: SuggestedOrderItem;
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
  suggested,
  isRunning,
  isSelected,
  onSelect,
  onPlay,
  onContextMenu,
}: TodayBlockCardProps) {
  const highlighted = isSelected || isRunning;
  const projectColor = project?.color ?? '#3B4BD8';
  const effectiveSize = suggested?.effectiveSizeMinutes ?? block.sizeMinutes ?? 60;

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
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-[#242424] border border-[#2A2A2A] text-[11px] font-medium text-[#9A9A9A] tabular-nums">
                {formatDuration(effectiveSize)}
              </span>
              {block.plannedStartAt ? (
                <span className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                  {formatLocalTime(block.plannedStartAt)}
                </span>
              ) : null}
            </div>
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

          {suggested?.reason ? (
            <p className="text-[12px] text-[#9A9A9A] truncate">{suggested.reason}</p>
          ) : null}
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
