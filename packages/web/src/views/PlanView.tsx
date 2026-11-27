import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Block, CalendarEvent, Goal, ProjectWithStats } from '@veyra/core/types';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  Inbox,
  Link2,
  Play,
  Plus,
  Repeat,
  Video,
} from 'lucide-react';
import { type FormEvent, type MouseEvent as ReactMouseEvent, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateBlockRelated, usePlanQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { useBlockContextMenu, useMeetingContextMenu } from '../components/entityMenus';
import { ProjectBadge } from '../components/ProjectBadge';
import { SelectPopover } from '../components/SelectPopover';
import { activeCardStyle } from '../components/goalTint';
import {
  addDaysDateString,
  formatDuration,
  formatLocalTime,
  formatShortDate,
  getTodayDateString,
} from '../components/icons';

function getMondayOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 Sun, 1 Mon ...
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysDateString(dateStr, diff);
}

function formatDayHeader(dateStr: string): { weekday: string; shortDate: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    dt,
  );
  const shortDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
  return { weekday, shortDate };
}

const DAY_BAR_COLORS: Record<string, string> = {
  Mon: '#3B4BD8',
  Tue: '#2DD4BF',
  Wed: '#A78BFA',
  Thu: '#34D399',
  Fri: '#F59E0B',
  Sat: '#6E7280',
  Sun: '#6E7280',
};

type QuickAddInput = { title: string; projectId?: string; isOps: boolean };

export function PlanView() {
  const queryClient = useQueryClient();
  const {
    activeDrawer,
    projects: shellProjects,
    goals: shellGoals,
    openBlockDrawer,
    openMeetingDrawer,
    openCreateBlock,
    startFocusAndNavigate,
  } = useAppShell();
  const blockMenu = useBlockContextMenu();
  const meetingMenu = useMeetingContextMenu();

  const currentMonday = useMemo(() => getMondayOfDate(getTodayDateString()), []);
  const [weekStart, setWeekStart] = useState<string>(currentMonday);
  const [showInbox, setShowInbox] = useState(true);
  const [showLater, setShowLater] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [activeDragBlockId, setActiveDragBlockId] = useState<string | null>(null);

  const planQuery = usePlanQuery(weekStart);
  const data = planQuery.data;

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

  const allBlocksById = useMemo(() => {
    const map = new Map<string, Block>();
    if (!data) return map;
    for (const b of data.inbox) map.set(b.id, b);
    for (const b of data.later) map.set(b.id, b);
    for (const day of data.days) {
      for (const b of day.blocks) map.set(b.id, b);
    }
    return map;
  }, [data]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const moveMutation = useMutation({
    mutationFn: (args: {
      blockId: string;
      bucket: 'inbox' | 'scheduled' | 'later';
      scheduledDate?: string | null;
      revisitAt?: '2w';
    }) =>
      apiClient.moveBlock(args.blockId, {
        bucket: args.bucket,
        scheduledDate: args.scheduledDate,
        revisitAt: args.revisitAt,
      }),
    onSuccess: (_res, vars) => {
      invalidateBlockRelated(queryClient, vars.blockId);
    },
  });

  const quickCreateMutation = useMutation({
    mutationFn: (input: QuickAddInput & {
      bucket: 'inbox' | 'scheduled';
      scheduledDate?: string | null;
    }) =>
      apiClient.createBlock({
        title: input.title,
        bucket: input.bucket,
        scheduledDate: input.scheduledDate ?? null,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        isOps: input.isOps,
      }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient);
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragBlockId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragBlockId(null);
    const { active, over } = event;
    if (!over) return;

    const blockId = String(active.id);
    const targetId = String(over.id);
    const block = allBlocksById.get(blockId);
    if (!block) return;

    if (targetId === 'inbox') {
      if (block.bucket === 'inbox') return;
      moveMutation.mutate({ blockId, bucket: 'inbox', scheduledDate: null });
    } else if (targetId === 'later') {
      if (block.bucket === 'later') return;
      moveMutation.mutate({ blockId, bucket: 'later', scheduledDate: null, revisitAt: '2w' });
    } else if (targetId.startsWith('day:')) {
      const targetDate = targetId.slice(4);
      if (block.bucket === 'scheduled' && block.scheduledDate === targetDate) return;
      moveMutation.mutate({ blockId, bucket: 'scheduled', scheduledDate: targetDate });
    }
  };

  const todayStr = data?.today ?? getTodayDateString();
  const visibleDays = useMemo(() => {
    const days = data?.days ?? [];
    return showWeekend ? days : days.slice(0, 5);
  }, [data?.days, showWeekend]);

  const isCurrentWeek = weekStart === currentMonday;
  const weekRangeLabel = useMemo(() => {
    const endDate = addDaysDateString(weekStart, showWeekend ? 6 : 4);
    return `${formatShortDate(weekStart)} – ${formatShortDate(endDate)}`;
  }, [weekStart, showWeekend]);

  const quickAddProjects = useMemo(
    () => (data?.projects ?? shellProjects).filter((p) => p.status !== 'archived'),
    [data?.projects, shellProjects],
  );

  const draggedBlock = activeDragBlockId ? allBlocksById.get(activeDragBlockId) : undefined;
  const selectedBlockId = activeDrawer?.kind === 'block' ? activeDrawer.blockId : null;
  const selectedEventId = selectedBlockId;

  return (
    <div className="h-full flex flex-col bg-[#131313]">
      {/* Top Toolbar */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-[#2A2A2A]/70 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-[22px] font-semibold text-[#EDEDED]">Plan</h1>

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
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showInbox ? 'accent-soft' : 'secondary'}
            size="sm"
            leftIcon={<Inbox size={13} />}
            onClick={() => setShowInbox((v) => !v)}
          >
            Inbox
            <span className="tabular-nums opacity-80">({data?.inbox.length ?? 0})</span>
          </Button>
          <Button
            variant={showWeekend ? 'accent-soft' : 'ghost'}
            size="sm"
            onClick={() => setShowWeekend((v) => !v)}
          >
            {showWeekend ? 'Mon–Sun' : 'Mon–Fri'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={13} />}
            onClick={() => openCreateBlock({ bucket: 'inbox' })}
          >
            New Block
          </Button>
        </div>
      </header>

      {/* Week Time Strip */}
      {(data?.projectTimeStrip?.length ?? 0) > 0 ? (
        <section
          aria-label="Week time strip"
          className="shrink-0 flex items-center gap-2.5 px-6 py-2.5 border-b border-[#222222] overflow-x-auto"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] shrink-0">
            Week time
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {(data?.projectTimeStrip ?? []).map((item) => {
              const project = projectsById.get(item.projectId);
              if (!project) return null;
              const timeLabel =
                item.weeklyTimeMinutes !== null
                  ? `${formatDuration(item.plannedMinutes)} / ${formatDuration(item.weeklyTimeMinutes)}`
                  : `${formatDuration(item.plannedMinutes)} planned`;
              return (
                <div
                  key={item.projectId}
                  className="inline-flex items-center gap-2 h-7 px-2.5 rounded-[8px] bg-[#1C1C1C] border border-[#2A2A2A] shrink-0"
                >
                  <ProjectBadge
                    name={project.name}
                    color={project.color}
                    icon={project.icon}
                    size="xs"
                  />
                  <span className="text-[12px] font-medium text-[#C4C4C4] max-w-[130px] truncate">
                    {project.name}
                  </span>
                  <span className="text-[11.5px] text-[#9A9A9A] tabular-nums">{timeLabel}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Borderless Columns Canvas directly on #131313 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-5 min-h-full">
            {/* Toggleable Borderless Inbox + Collapsible Later Column */}
            {showInbox ? (
              <div className="min-w-[272px] w-[272px] shrink-0 flex flex-col gap-3">
                <DroppableColumn id="inbox" className="space-y-2.5 min-h-[120px] rounded-[10px]">
                  <ColumnHeader
                    leading={<Inbox size={14} className="text-[#9A9A9A]" />}
                    label="Inbox"
                    count={data?.inbox.length ?? 0}
                    addLabel="Add block to Inbox"
                    onAdd={() => openCreateBlock({ bucket: 'inbox' })}
                  />

                  {/* Always-visible Quick-Add at the top of Inbox */}
                  <InlineQuickAdd
                    projects={quickAddProjects}
                    onSubmit={(input) =>
                      quickCreateMutation.mutate({ ...input, bucket: 'inbox', scheduledDate: null })
                    }
                    pending={quickCreateMutation.isPending}
                  />

                  <div className="space-y-3">
                    {(data?.inbox ?? []).map((block) => (
                      <DraggablePlanCard
                        key={block.id}
                        block={block}
                        project={projectsById.get(block.projectId)}
                        goal={block.goalId ? goalsById.get(block.goalId) : undefined}
                        todayStr={todayStr}
                        selected={selectedBlockId === block.id}
                        onClick={() => openBlockDrawer(block.id)}
                        onPlay={() => void startFocusAndNavigate(block.id)}
                        onContextMenu={(e) => blockMenu.open(e, block)}
                      />
                    ))}
                  </div>
                </DroppableColumn>

                {/* Collapsible Later Section */}
                <DroppableColumn
                  id="later"
                  className="pt-3 mt-2 border-t border-[#2A2A2A] space-y-2.5 rounded-[10px]"
                >
                  <button
                    type="button"
                    onClick={() => setShowLater((v) => !v)}
                    className="w-full flex items-center justify-between px-0.5 text-left group"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A] group-hover:text-[#EDEDED]">
                      {showLater ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Archive size={12} />
                      <span>Later</span>
                      <span className="text-[#6E6E6E] tabular-nums font-medium">
                        {data?.later.length ?? 0}
                      </span>
                    </span>
                  </button>

                  {showLater ? (
                    <div className="space-y-3">
                      {(data?.later ?? []).length === 0 ? (
                        <div className="px-1 py-2 text-[12px] text-[#6E6E6E]">
                          Drag blocks here to park with a revisit date.
                        </div>
                      ) : (
                        (data?.later ?? []).map((block) => (
                          <DraggablePlanCard
                            key={block.id}
                            block={block}
                            project={projectsById.get(block.projectId)}
                            goal={block.goalId ? goalsById.get(block.goalId) : undefined}
                            todayStr={todayStr}
                            isLater
                            selected={selectedBlockId === block.id}
                            onClick={() => openBlockDrawer(block.id)}
                            onPlay={() => void startFocusAndNavigate(block.id)}
                            onContextMenu={(e) => blockMenu.open(e, block)}
                          />
                        ))
                      )}
                    </div>
                  ) : null}
                </DroppableColumn>
              </div>
            ) : null}

            {/* Borderless Day Columns (Mon–Fri or Mon–Sun) */}
            {visibleDays.map((day) => {
              const { weekday, shortDate } = formatDayHeader(day.date);
              const isToday = day.date === todayStr;

              return (
                <DroppableColumn
                  key={day.date}
                  id={`day:${day.date}`}
                  className="min-w-[272px] w-[272px] shrink-0 space-y-2.5 min-h-[240px] rounded-[10px]"
                >
                  <div className="space-y-0.5">
                    <ColumnHeader
                      leading={
                        <span
                          aria-hidden
                          className="w-[3px] h-4 rounded-full shrink-0"
                          style={{ backgroundColor: DAY_BAR_COLORS[weekday] ?? '#6E7280' }}
                        />
                      }
                      label={weekday}
                      labelClassName={isToday ? 'text-[#AEB8FF]' : 'text-[#EDEDED]'}
                      meta={shortDate}
                      badge={isToday ? <Pill tone="accent">Today</Pill> : null}
                      count={day.blocks.length}
                      addLabel={`Add block for ${weekday}`}
                      onAdd={() => openCreateBlock({ bucket: 'scheduled', scheduledDate: day.date })}
                    />
                    <div className="px-0.5 text-[11.5px] text-[#6E6E6E] tabular-nums">
                      {formatDuration(day.plannedMinutes)} planned · room about{' '}
                      {formatDuration(day.roomMinutes)}
                    </div>
                  </div>

                  {/* Quiet Day-Top Meetings as Prep Context */}
                  {day.events.length > 0 ? (
                    <div className="space-y-1.5">
                      {day.events.map((ev: CalendarEvent) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => openMeetingDrawer(ev.id)}
                          onContextMenu={(e) => meetingMenu.open(e, ev)}
                          style={
                            selectedEventId === ev.id
                              ? activeCardStyle(
                                  ev.projectId ? projectsById.get(ev.projectId)?.color : undefined,
                                )
                              : undefined
                          }
                          className={[
                            'w-full px-3 py-2 rounded-[8px] bg-[#181818] border text-left transition-colors flex items-center gap-2',
                            selectedEventId === ev.id
                              ? ''
                              : 'border-[#2A2A2A] hover:border-[#3C3C3C]',
                          ].join(' ')}
                        >
                          <Video size={11} className="text-[#6E6E6E] shrink-0" />
                          <span className="text-[11px] text-[#9A9A9A] tabular-nums shrink-0">
                            {formatLocalTime(ev.startAt)}
                          </span>
                          <span className="text-[12px] text-[#C4C4C4] truncate">{ev.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* Always-visible Quick-Add at the top of every day column */}
                  <InlineQuickAdd
                    projects={quickAddProjects}
                    onSubmit={(input) =>
                      quickCreateMutation.mutate({
                        ...input,
                        bucket: 'scheduled',
                        scheduledDate: day.date,
                      })
                    }
                    pending={quickCreateMutation.isPending}
                  />

                  {/* Scheduled Blocks */}
                  <div className="space-y-3">
                    {day.blocks.map((block) => (
                      <DraggablePlanCard
                        key={block.id}
                        block={block}
                        project={projectsById.get(block.projectId)}
                        goal={block.goalId ? goalsById.get(block.goalId) : undefined}
                        todayStr={todayStr}
                        selected={selectedBlockId === block.id}
                        onClick={() => openBlockDrawer(block.id)}
                        onPlay={() => void startFocusAndNavigate(block.id)}
                        onContextMenu={(e) => blockMenu.open(e, block)}
                      />
                    ))}
                  </div>
                </DroppableColumn>
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {draggedBlock ? (
            <div className="w-[272px] opacity-95 rotate-[0.5deg] shadow-[var(--shadow-float)]">
              <PlanCardContent
                block={draggedBlock}
                project={projectsById.get(draggedBlock.projectId)}
                goal={draggedBlock.goalId ? goalsById.get(draggedBlock.goalId) : undefined}
                todayStr={todayStr}
                isLater={draggedBlock.bucket === 'later'}
                selected
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {blockMenu.menu}
      {meetingMenu.menu}
    </div>
  );
}

function DroppableColumn({
  id,
  className = '',
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={[
        className,
        'transition-colors',
        isOver ? 'bg-[#1F2759]/25 ring-1 ring-[#5566F2]/50 p-1.5 -m-1.5' : '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function DraggablePlanCard({
  block,
  project,
  goal,
  todayStr,
  isLater = false,
  selected,
  onClick,
  onPlay,
  onContextMenu,
}: {
  block: Block;
  project?: ProjectWithStats;
  goal?: Goal;
  todayStr: string;
  isLater?: boolean;
  selected: boolean;
  onClick: () => void;
  onPlay: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onContextMenu={onContextMenu}
      className={isDragging ? 'opacity-35' : 'focus:outline-none'}
    >
      <PlanCardContent
        block={block}
        project={project}
        goal={goal}
        todayStr={todayStr}
        isLater={isLater}
        selected={selected}
        onClick={onClick}
        onPlay={onPlay}
      />
    </div>
  );
}

function PlanCardContent({
  block,
  project,
  todayStr,
  isLater = false,
  selected,
  onClick,
  onPlay,
}: {
  block: Block;
  project?: ProjectWithStats;
  goal?: Goal;
  todayStr: string;
  isLater?: boolean;
  selected: boolean;
  onClick?: () => void;
  onPlay?: () => void;
}) {
  const isDone = block.status === 'done';
  const revisitIsPast = Boolean(isLater && block.revisitAt && block.revisitAt < todayStr);
  const effectiveSizeMinutes = block.sizeMinutes ?? project?.learnedBlockSizeMinutes ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      style={selected ? activeCardStyle(project?.color) : undefined}
      className={[
        'veyra-card p-4 group flex flex-col gap-2.5 transition-colors cursor-pointer select-none focus:outline-none focus-visible:border-[#5566F2]',
        isDone ? 'bg-[#171717] opacity-80' : '',
        selected ? '' : 'hover:border-[#3C3C3C] hover:bg-[#202020]',
      ].join(' ')}
    >
      {/* Row 1: project identity left, actionable tags right */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {project ? (
            <>
              <ProjectBadge
                name={project.name}
                color={project.color}
                icon={project.icon}
                size="sm"
              />
              <span className="text-[12.5px] font-medium text-[#9A9A9A] truncate">
                {project.name}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {effectiveSizeMinutes !== null ? (
            <span
              title={block.sizeMinutes !== null ? 'Block size' : 'Learned block size'}
              className="inline-flex items-center h-5 px-1.5 rounded-[6px] bg-[#242424] border border-[#2E2E2E] text-[11px] font-medium text-[#9A9A9A] tabular-nums"
            >
              {formatDuration(effectiveSizeMinutes)}
            </span>
          ) : null}
          {block.dueDate ? <Pill tone="due">Due {formatShortDate(block.dueDate)}</Pill> : null}
          {block.isOps ? (
            <Pill tone="ops" dot>
              Ops
            </Pill>
          ) : null}
          {isLater && block.revisitAt ? (
            <Pill tone={revisitIsPast ? 'due' : 'neutral'}>
              {revisitIsPast
                ? `Past ${formatShortDate(block.revisitAt)}`
                : `Revisit ${formatShortDate(block.revisitAt)}`}
            </Pill>
          ) : null}
          {block.recurrenceRule ? (
            <Repeat size={12} aria-label="Repeats" className="text-[#6E6E6E]" />
          ) : null}
          {block.externalLinks.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[#6E6E6E] tabular-nums">
              <Link2 size={11} />
              {block.externalLinks.length}
            </span>
          ) : null}
          {!isDone && onPlay ? (
            <button
              type="button"
              aria-label={`Focus on ${block.title}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="hidden group-hover:inline-flex focus:inline-flex h-6 w-6 rounded-[6px] bg-[#262626] border border-[#3C3C3C] hover:bg-[#3B4BD8] hover:border-[#5566F2] text-[#EDEDED] items-center justify-center shrink-0 transition-colors"
            >
              <Play size={10} fill="currentColor" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Row 2: block title */}
      <div className="flex items-start gap-2 min-w-0">
        {isDone ? (
          <span className="mt-0.5 w-4 h-4 rounded-full bg-[#14331F] text-[#7BE0A0] inline-flex items-center justify-center shrink-0">
            <Check size={10} strokeWidth={2.5} />
          </span>
        ) : null}
        <span
          className={`text-[14px] font-medium leading-snug break-words ${
            isDone ? 'text-[#9A9A9A] line-through' : 'text-[#EDEDED]'
          }`}
        >
          {block.title}
        </span>
      </div>

      {block.resumeNote ? (
        <div className="pt-2 border-t border-[#2A2A2A] text-[11.5px] text-[#9A9A9A] truncate">
          <span className="text-[#AEB8FF] font-medium mr-1">Paused:</span>
          {block.resumeNote}
        </div>
      ) : null}
    </div>
  );
}

function ColumnHeader({
  leading,
  label,
  labelClassName = 'text-[#EDEDED]',
  meta,
  badge,
  count,
  addLabel,
  onAdd,
}: {
  leading: React.ReactNode;
  label: string;
  labelClassName?: string;
  meta?: string;
  badge?: React.ReactNode;
  count: number;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 h-7">
      <div className="flex items-center gap-2 min-w-0">
        {leading}
        <span className={`text-[13px] font-semibold ${labelClassName}`}>{label}</span>
        {meta ? <span className="text-[12.5px] text-[#6E6E6E] tabular-nums">{meta}</span> : null}
        {badge}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">{count}</span>
        <button
          type="button"
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
          className="h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#EDEDED] hover:bg-[#262626] transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function InlineQuickAdd({
  projects,
  onSubmit,
  pending,
}: {
  projects: ProjectWithStats[];
  onSubmit: (input: QuickAddInput) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [focused, setFocused] = useState(false);
  const [projectId, setProjectId] = useState<string>('');
  const [isOps, setIsOps] = useState(false);

  const expanded = focused || title.length > 0;
  const selectedProject = projectId ? projects.find((p) => p.id === projectId) : undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    onSubmit({ title: trimmed, projectId: projectId || undefined, isOps });
    setTitle('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={[
        'rounded-[10px] border transition-colors',
        expanded
          ? 'bg-[#1C1C1C] border-[#5566F2]'
          : 'bg-[#181818] border-transparent hover:border-[#2A2A2A]',
      ].join(' ')}
    >
      <input
        type="text"
        aria-label="Add block"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setTitle('');
            e.currentTarget.blur();
          }
        }}
        placeholder="+ Add block…"
        className="w-full h-9 px-3 bg-transparent text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
      />
      {expanded ? (
        <div className="flex items-center justify-between gap-1.5 px-2 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <SelectPopover
              ariaLabel="Quick-add project"
              size="sm"
              menuTitle="Project"
              menuWidthClass="w-56"
              value={projectId}
              placeholder="Project"
              onChange={(val) => setProjectId(val)}
              options={[
                { value: '', label: 'Other', muted: true },
                ...projects
                  .filter((p) => !p.isSystem)
                  .map((p) => ({
                    value: p.id,
                    label: p.name,
                    leading: (
                      <ProjectBadge name={p.name} color={p.color} icon={p.icon} size="xs" />
                    ),
                  })),
              ]}
            />
            <button
              type="button"
              aria-pressed={isOps}
              onClick={() => setIsOps((v) => !v)}
              className={[
                'inline-flex items-center gap-1 h-7 px-2 rounded-[6px] border text-[12px] font-medium transition-colors',
                isOps
                  ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                  : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED]',
              ].join(' ')}
            >
              <Flame size={11} />
              Ops
            </button>
          </div>
          <button
            type="submit"
            disabled={!title.trim() || pending}
            className="h-7 px-2 rounded-[6px] text-[12px] font-medium text-[#AEB8FF] hover:bg-[#1F2759] disabled:opacity-40 disabled:hover:bg-transparent transition-colors shrink-0"
          >
            ↵ Add
          </button>
        </div>
      ) : null}
    </form>
  );
}
