import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarEvent,
  ExternalLink,
  UpdateCalendarEventInput,
} from '@veyra/core/types';
import {
  Check,
  ChevronDown,
  ExternalLink as ExternalLinkIcon,
  Flame,
  Link2,
  Plus,
  Sparkles,
  Target,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CalendarResponse,
  type PlanResponse,
  type TodayResponse,
  apiClient,
  openExternalUrl,
} from '../api/client';
import { useEventsQuery, useGoalsQuery, useProjectsQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { DockedDrawer } from '../components/DockedDrawer';
import { GoalKindIconBadge } from '../components/GoalChip';
import { LinkChip } from '../components/LinkChip';
import { LinkPickerPopover } from '../components/LinkPickerPopover';
import { goalChipStyle } from '../components/goalTint';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import {
  formatDateHeading,
  formatDuration,
  formatTimeRange,
  getSessionDurationMinutes,
  getTodayDateString,
} from '../components/icons';

export interface MeetingDetailDrawerProps {
  eventId: string | null;
  onClose: () => void;
}

function findEventInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  eventId: string | null,
): CalendarEvent | undefined {
  if (!eventId) return undefined;

  for (const [, data] of queryClient.getQueriesData<CalendarResponse>({ queryKey: ['calendar'] })) {
    const match = data?.events?.find((ev) => ev.id === eventId);
    if (match) return match;
  }

  for (const [, data] of queryClient.getQueriesData<TodayResponse>({ queryKey: ['today'] })) {
    const match =
      data?.todayEvents?.find((ev) => ev.id === eventId) ??
      data?.upcomingEvents?.find((ev) => ev.id === eventId);
    if (match) return match;
  }

  for (const [, data] of queryClient.getQueriesData<PlanResponse>({ queryKey: ['plan'] })) {
    if (!data?.days) continue;
    for (const day of data.days) {
      const match = day.events.find((ev) => ev.id === eventId);
      if (match) return match;
    }
  }

  for (const [, data] of queryClient.getQueriesData<{ events: CalendarEvent[] }>({
    queryKey: ['events'],
  })) {
    const match = data?.events?.find((ev) => ev.id === eventId);
    if (match) return match;
  }

  return undefined;
}

function getMeetingTimingState(ev: CalendarEvent): 'upcoming' | 'live' | 'past' {
  const nowMs = Date.now();
  const startMs = Date.parse(ev.startAt);
  const endMs = Date.parse(ev.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 'upcoming';
  if (nowMs >= startMs && nowMs <= endMs) return 'live';
  if (nowMs > endMs) return 'past';
  return 'upcoming';
}

function getMeetingLocalDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return getTodayDateString();
  return getTodayDateString(dt);
}

export function MeetingDetailDrawer({ eventId, onClose }: MeetingDetailDrawerProps) {
  const queryClient = useQueryClient();
  const { openCreateBlock } = useAppShell();

  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const goalsQuery = useGoalsQuery({ activeOnly: true });
  const projects = projectsQuery.data?.projects ?? [];
  const goals = goalsQuery.data?.goals ?? [];

  const cachedEvent = findEventInCache(queryClient, eventId);
  const fallbackEventsQuery = useEventsQuery(
    undefined,
    undefined,
    Boolean(eventId) && !cachedEvent,
  );
  const [optimisticEvent, setOptimisticEvent] = useState<CalendarEvent | null>(null);

  const event: CalendarEvent | undefined = useMemo(() => {
    if (optimisticEvent && optimisticEvent.id === eventId) return optimisticEvent;
    if (cachedEvent) return cachedEvent;
    return fallbackEventsQuery.data?.events?.find((ev) => ev.id === eventId);
  }, [optimisticEvent, eventId, cachedEvent, fallbackEventsQuery.data?.events]);

  const [notesDraft, setNotesDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [addingLink, setAddingLink] = useState(false);
  const [openPicker, setOpenPicker] = useState<'project' | 'goal' | null>(null);
  const pickerStripRef = useRef<HTMLDivElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!openPicker) return;
    const onPointerDown = (e: MouseEvent) => {
      if (pickerStripRef.current && !pickerStripRef.current.contains(e.target as Node)) {
        setOpenPicker(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPicker(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openPicker]);

  useEffect(() => {
    const el = notesTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(180, el.scrollHeight)}px`;
  }, [notesDraft, eventId]);

  useEffect(() => {
    if (!eventId) {
      setOptimisticEvent(null);
      setOpenPicker(null);
      setAddingLink(false);
      setSaveState('idle');
    }
  }, [eventId]);

  useEffect(() => {
    if (!event) return;
    setNotesDraft(event.notes);
    setSaveState('idle');
  }, [event?.id, event?.updatedAt]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateCalendarEventInput) => apiClient.updateEvent(eventId!, input),
    onMutate: () => setSaveState('saving'),
    onSuccess: (res) => {
      setOptimisticEvent(res.event);
      setSaveState('saved');
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1400);
    },
    onError: () => setSaveState('idle'),
  });

  const flushNotes = useCallback(() => {
    if (!event) return;
    if (notesDraft !== event.notes) {
      updateMutation.mutate({ notes: notesDraft });
    }
  }, [event, notesDraft, updateMutation]);

  useEffect(() => {
    if (!eventId) return;
    const onGlobalSave = () => flushNotes();
    window.addEventListener('veyra:save', onGlobalSave);
    return () => window.removeEventListener('veyra:save', onGlobalSave);
  }, [eventId, flushNotes]);

  const handleProjectChange = (projectId: string) => {
    const nextProjectId = projectId || null;
    const nextProject = nextProjectId ? projects.find((p) => p.id === nextProjectId) : undefined;
    const patch: UpdateCalendarEventInput = { projectId: nextProjectId };
    if (nextProject && !event?.goalId && nextProject.defaultGoalId) {
      patch.goalId = nextProject.defaultGoalId;
    }
    updateMutation.mutate(patch);
  };

  const handleAddLink = (nextLink: ExternalLink) => {
    if (!event) return;
    if (event.externalLinks.some((l) => l.url === nextLink.url)) return;
    updateMutation.mutate({ externalLinks: [...event.externalLinks, nextLink] });
  };

  const handleRemoveLink = (index: number) => {
    if (!event) return;
    updateMutation.mutate({
      externalLinks: event.externalLinks.filter((_, i) => i !== index),
    });
  };

  const currentProject = event?.projectId
    ? projects.find((p) => p.id === event.projectId)
    : undefined;
  const currentGoal = event?.goalId ? goals.find((g) => g.id === event.goalId) : undefined;

  const timingState = event ? getMeetingTimingState(event) : 'upcoming';
  const durationMins = event ? getSessionDurationMinutes(event.startAt, event.endAt) : 0;
  const meetingDate = event ? getMeetingLocalDate(event.startAt) : '';

  const timingLabel =
    timingState === 'live'
      ? 'Meeting · Live'
      : timingState === 'past'
        ? 'Meeting · Past'
        : 'Meeting · Upcoming';

  return (
    <DockedDrawer
      open={Boolean(eventId)}
      onClose={() => {
        flushNotes();
        onClose();
      }}
      width={520}
      ariaLabel="Meeting detail"
      title={
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-[5px] bg-[#242424] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] shrink-0">
            <Video size={11} />
          </span>
          <span className="text-[12px] font-medium text-[#C4C4C4]">{timingLabel}</span>
          {saveState === 'saving' ? (
            <span className="text-[11px] text-[#6E6E6E]">Saving…</span>
          ) : saveState === 'saved' ? (
            <span className="text-[11px] text-[#7BE0A0] inline-flex items-center gap-1">
              <Check size={11} /> Saved
            </span>
          ) : null}
        </div>
      }
      headerActions={
        event?.meetingUrl ? (
          <Button
            variant="secondary"
            size="xs"
            rightIcon={<ExternalLinkIcon size={11} />}
            onClick={() => openExternalUrl(event.meetingUrl!)}
          >
            Open in Teams
          </Button>
        ) : null
      }
      footer={
        event ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-[#6E6E6E]">
              Source: <span className="text-[#9A9A9A]">{event.source.replace('_', ' ')}</span>
            </span>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={13} />}
              onClick={() => {
                flushNotes();
                onClose();
                openCreateBlock({
                  title: `Follow-up: ${event.title}`,
                  projectId: event.projectId ?? undefined,
                  goalId: event.goalId,
                  isOps: event.isOps,
                  bucket: 'scheduled',
                  scheduledDate: getTodayDateString(),
                });
              }}
            >
              Create Follow-up Block
            </Button>
          </div>
        ) : null
      }
    >
      {!event ? (
        <div className="py-12 text-center text-[13px] text-[#6E6E6E]">
          {fallbackEventsQuery.isLoading ? 'Loading meeting…' : 'Meeting not found.'}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Title & Time */}
          <div className="space-y-1.5">
            <h3 className="font-display text-[20px] font-semibold leading-snug text-[#EDEDED]">
              {event.title}
            </h3>
            <div className="flex items-center gap-2 text-[12.5px] text-[#9A9A9A] tabular-nums">
              <span>{formatDateHeading(meetingDate)}</span>
              <span>·</span>
              <span>{formatTimeRange(event.startAt, event.endAt)}</span>
              <span>·</span>
              <span>{formatDuration(durationMins)}</span>
            </div>
          </div>

          {/* Assignment Pickers: Project / Goal / Ops */}
          <div ref={pickerStripRef} className="flex items-center flex-wrap gap-2">
            <div className="relative">
              <button
                type="button"
                aria-label="Meeting project"
                aria-expanded={openPicker === 'project'}
                onClick={() => setOpenPicker((p) => (p === 'project' ? null : 'project'))}
                className={[
                  'inline-flex items-center gap-2 h-9 pr-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
                  currentProject
                    ? 'pl-2.5 bg-[#262626] border-[#3C3C3C] text-[#EDEDED] hover:border-[#525252]'
                    : 'pl-3.5 bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                ].join(' ')}
              >
                {currentProject ? (
                  <ProjectBadge
                    name={currentProject.name}
                    color={currentProject.color}
                    icon={currentProject.icon}
                    size="xs"
                  />
                ) : null}
                <span className="max-w-[140px] truncate">
                  {currentProject?.name ?? '+ Project'}
                </span>
                <ChevronDown size={12} className="text-[#6E6E6E]" />
              </button>
              {openPicker === 'project' ? (
                <div className="absolute left-0 top-10 z-30 w-60 max-h-80 overflow-y-auto p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] animate-veyra-fade">
                  <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                    Project
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleProjectChange('');
                      setOpenPicker(null);
                    }}
                    className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#9A9A9A] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                  >
                    <span>No project</span>
                    {!event.projectId ? <Check size={13} className="text-[#AEB8FF]" /> : null}
                  </button>
                  {projects.map((p) => {
                    const active = p.id === event.projectId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleProjectChange(p.id);
                          setOpenPicker(null);
                        }}
                        className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <ProjectBadge name={p.name} color={p.color} icon={p.icon} size="xs" />
                          <span className="truncate">{p.name}</span>
                        </span>
                        {active ? <Check size={13} className="text-[#AEB8FF] shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Meeting goal"
                aria-expanded={openPicker === 'goal'}
                onClick={() => setOpenPicker((p) => (p === 'goal' ? null : 'goal'))}
                style={currentGoal ? goalChipStyle(currentGoal.color) : undefined}
                className={[
                  'inline-flex items-center gap-2 h-9 rounded-[8px] border text-[13px] font-medium transition-[color,border-color,filter]',
                  currentGoal
                    ? 'pl-2 pr-3 hover:brightness-125'
                    : 'px-3.5 bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                ].join(' ')}
              >
                {currentGoal ? (
                  <GoalKindIconBadge kind={currentGoal.kind} color={currentGoal.color} size="xs" />
                ) : (
                  <Target size={12} className="text-[#6E6E6E]" />
                )}
                <span className="max-w-[160px] truncate">{currentGoal?.name ?? '+ Goal'}</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>
              {openPicker === 'goal' ? (
                <div className="absolute left-0 top-10 z-30 w-60 max-h-80 overflow-y-auto p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] animate-veyra-fade">
                  <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                    Overarching Goal
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      updateMutation.mutate({ goalId: null });
                      setOpenPicker(null);
                    }}
                    className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#9A9A9A] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                  >
                    <span>No goal</span>
                    {!event.goalId ? <Check size={13} className="text-[#AEB8FF]" /> : null}
                  </button>
                  {goals.map((g) => {
                    const active = g.id === event.goalId;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          updateMutation.mutate({ goalId: g.id });
                          setOpenPicker(null);
                        }}
                        className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <GoalKindIconBadge kind={g.kind} color={g.color} size="xs" />
                          <span className="truncate">{g.name}</span>
                        </span>
                        {active ? <Check size={13} className="text-[#AEB8FF] shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => updateMutation.mutate({ isOps: !event.isOps })}
              className={[
                'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
                event.isOps
                  ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                  : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
              ].join(' ')}
            >
              <Flame size={12} />
              <span>Ops</span>
            </button>
          </div>

          {/* Notion Prep Links */}
          <div className="space-y-2 pt-3 border-t border-[#2A2A2A]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] flex items-center gap-1.5">
                <Link2 size={12} />
                Prep &amp; Notion Links
              </span>
              {!addingLink ? (
                <button
                  type="button"
                  onClick={() => setAddingLink(true)}
                  className="text-[12px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
                >
                  <Plus size={12} />
                  Add link
                </button>
              ) : null}
            </div>

            {event.externalLinks.length > 0 ? (
              <div className="flex items-center flex-wrap gap-1.5">
                {event.externalLinks.map((link, idx) => (
                  <LinkChip
                    key={`${link.url}-${idx}`}
                    link={link}
                    onRemove={() => handleRemoveLink(idx)}
                  />
                ))}
              </div>
            ) : !addingLink ? (
              <div className="text-[12px] text-[#6E6E6E]">
                Link Notion agendas, customer docs, or PRs for quick call prep.
              </div>
            ) : null}

            <LinkPickerPopover
              open={addingLink}
              onClose={() => setAddingLink(false)}
              existingLinks={event.externalLinks}
              onAddLink={handleAddLink}
            />
          </div>

          {/* Open borderless MEETING NOTES & PREP canvas, written straight onto the drawer surface */}
          <div className="space-y-3 pt-4 border-t border-[#2A2A2A]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Meeting Notes &amp; Prep
              </span>
              <Pill tone="violet" icon={<Sparkles size={10} />}>
                For T3 / Agent
              </Pill>
            </div>

            <textarea
              ref={notesTextareaRef}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={flushNotes}
              rows={7}
              aria-label="Meeting notes and prep"
              placeholder="Agenda, questions, decisions, or context your T3 / coding agent should know about this call…"
              className="w-full bg-transparent border-0 p-0 text-[14px] leading-[1.6] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>
        </div>
      )}
    </DockedDrawer>
  );
}
