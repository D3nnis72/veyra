import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  EnergySignal,
  ExternalLink,
  FocusSession,
  UpdateBlockInput,
} from '@veyra/core/types';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Flame,
  Link2,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  type CalendarResponse,
  type CalendarSessionItem,
  apiClient,
} from '../api/client';
import {
  invalidateBlockRelated,
  useBlockDetailQuery,
  useCalendarQuery,
  useGoalsQuery,
  useProjectsQuery,
} from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { AutoSummarySection } from '../components/AutoSummarySection';
import { Button } from '../components/Button';
import { DockedDrawer } from '../components/DockedDrawer';
import { GoalChip } from '../components/GoalChip';
import { LinkChip, inferLinkSource, inferLinkTitle } from '../components/LinkChip';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import {
  formatDuration,
  formatLocalTime,
  formatShortDate,
  getSessionDurationMinutes,
  getTodayDateString,
} from '../components/icons';

export interface SessionDetailDrawerProps {
  sessionId: string | null;
  onClose: () => void;
}

function toDatetimeLocalValue(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours(),
  )}:${pad(dt.getMinutes())}`;
}

function fromDatetimeLocalValue(val: string): string | null {
  const dt = new Date(val);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function findSessionInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string | null,
): CalendarSessionItem | undefined {
  if (!sessionId) return undefined;
  for (const [, data] of queryClient.getQueriesData<CalendarResponse>({ queryKey: ['calendar'] })) {
    const match = data?.sessions?.find((s) => s.id === sessionId);
    if (match) return match;
  }
  return undefined;
}

export function SessionDetailDrawer({ sessionId, onClose }: SessionDetailDrawerProps) {
  const queryClient = useQueryClient();
  const { openBlockDrawer } = useAppShell();

  const cachedSession = findSessionInCache(queryClient, sessionId);
  const fallbackCalendarQuery = useCalendarQuery(
    undefined,
    undefined,
    Boolean(sessionId) && !cachedSession,
  );
  const calendarSession: CalendarSessionItem | undefined =
    cachedSession ?? fallbackCalendarQuery.data?.sessions?.find((s) => s.id === sessionId);

  const blockId = calendarSession?.blockId ?? null;
  const blockDetailQuery = useBlockDetailQuery(blockId);
  const block = blockDetailQuery.data?.block;

  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const goalsQuery = useGoalsQuery({ includeArchived: true });
  const projects = projectsQuery.data?.projects ?? [];
  const goals = goalsQuery.data?.goals ?? [];

  const session: FocusSession | CalendarSessionItem | undefined = useMemo(() => {
    const fresh = block?.sessions.find((s) => s.id === sessionId);
    return fresh ?? calendarSession;
  }, [block?.sessions, sessionId, calendarSession]);

  // Trim / split state
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitBreakStart, setSplitBreakStart] = useState('');
  const [splitBreakMinutes, setSplitBreakMinutes] = useState('15');
  const [timeMessage, setTimeMessage] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);

  // Outcome & Notes drafts
  const [outcomeDraft, setOutcomeDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Add link inline state
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setStartLocal(toDatetimeLocalValue(session.startedAt));
    setEndLocal(toDatetimeLocalValue(session.endedAt ?? new Date().toISOString()));
    const sMs = Date.parse(session.startedAt);
    const eMs = session.endedAt ? Date.parse(session.endedAt) : Date.now();
    if (!Number.isNaN(sMs) && !Number.isNaN(eMs) && eMs > sMs) {
      setSplitBreakStart(
        toDatetimeLocalValue(new Date(sMs + Math.floor((eMs - sMs) / 2)).toISOString()),
      );
    }
    setSplitOpen(false);
    setTimeError(null);
    setTimeMessage(null);
  }, [session?.id, session?.startedAt, session?.endedAt]);

  useEffect(() => {
    if (!block) return;
    setOutcomeDraft(block.outcomeNote ?? '');
    setNotesDraft(block.notes);
    setSaveState('idle');
  }, [block?.id, block?.updatedAt]);

  const trimMutation = useMutation({
    mutationFn: (input: { startedAt: string; endedAt: string }) =>
      apiClient.trimSession(sessionId!, input),
    onSuccess: () => {
      setTimeError(null);
      setTimeMessage('Session time saved');
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      window.setTimeout(() => setTimeMessage(null), 1600);
    },
    onError: (err) => {
      setTimeError(err instanceof Error ? err.message : 'Failed to trim session');
    },
  });

  const splitMutation = useMutation({
    mutationFn: (input: { breakStartAt: string; breakMinutes: number }) =>
      apiClient.splitSession(sessionId!, input),
    onSuccess: () => {
      setSplitOpen(false);
      setTimeError(null);
      setTimeMessage('Break split into two sessions');
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      window.setTimeout(() => setTimeMessage(null), 2000);
    },
    onError: (err) => {
      setTimeError(err instanceof Error ? err.message : 'Failed to split session');
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => apiClient.deleteSession(sessionId!),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      onClose();
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiClient.reopenBlock(blockId!),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
  });

  const updateBlockMutation = useMutation({
    mutationFn: (input: UpdateBlockInput) => apiClient.updateBlock(blockId!, input),
    onMutate: () => setSaveState('saving'),
    onSuccess: () => {
      setSaveState('saved');
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1400);
    },
    onError: () => setSaveState('idle'),
  });

  const flushBlockEdits = useCallback(() => {
    if (!block || !blockId) return;
    const patch: UpdateBlockInput = {};
    const nextOutcome = outcomeDraft.trim() || null;
    if (nextOutcome !== (block.outcomeNote ?? null)) {
      patch.outcomeNote = nextOutcome;
    }
    if (notesDraft !== block.notes) {
      patch.notes = notesDraft;
    }
    if (Object.keys(patch).length > 0) {
      updateBlockMutation.mutate(patch);
    }
  }, [block, blockId, outcomeDraft, notesDraft, updateBlockMutation]);

  useEffect(() => {
    if (!sessionId) return;
    const onGlobalSave = () => flushBlockEdits();
    window.addEventListener('veyra:save', onGlobalSave);
    return () => window.removeEventListener('veyra:save', onGlobalSave);
  }, [sessionId, flushBlockEdits]);

  const handleSaveTime = (e: FormEvent) => {
    e.preventDefault();
    const sIso = fromDatetimeLocalValue(startLocal);
    const eIso = fromDatetimeLocalValue(endLocal);
    if (!sIso || !eIso || Date.parse(eIso) <= Date.parse(sIso)) {
      setTimeError('End time must be after start time.');
      return;
    }
    trimMutation.mutate({ startedAt: sIso, endedAt: eIso });
  };

  const handleSplitSubmit = (e: FormEvent) => {
    e.preventDefault();
    const breakIso = fromDatetimeLocalValue(splitBreakStart);
    const mins = Number.parseInt(splitBreakMinutes, 10);
    if (!breakIso || Number.isNaN(mins) || mins < 1) {
      setTimeError('Enter a valid break start time and break duration.');
      return;
    }
    splitMutation.mutate({ breakStartAt: breakIso, breakMinutes: mins });
  };

  const handleAddLink = (e: FormEvent) => {
    e.preventDefault();
    if (!block) return;
    const rawUrl = linkUrl.trim();
    if (!rawUrl) return;
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      new URL(normalizedUrl);
    } catch {
      setLinkError('Enter a valid URL');
      return;
    }
    const nextLink: ExternalLink = {
      url: normalizedUrl,
      title: linkTitle.trim() || inferLinkTitle(normalizedUrl),
      source: inferLinkSource(normalizedUrl),
    };
    setLinkError(null);
    setLinkUrl('');
    setLinkTitle('');
    setAddingLink(false);
    updateBlockMutation.mutate({ externalLinks: [...block.externalLinks, nextLink] });
  };

  const handleRemoveLink = (index: number) => {
    if (!block) return;
    updateBlockMutation.mutate({
      externalLinks: block.externalLinks.filter((_, i) => i !== index),
    });
  };

  const durationMins = session ? getSessionDurationMinutes(session.startedAt, session.endedAt) : 0;
  const project = projects.find(
    (p) => p.id === (block?.projectId ?? calendarSession?.projectId ?? ''),
  );
  const goal = goals.find((g) => g.id === (block?.goalId ?? calendarSession?.goalId ?? ''));
  const sessionDate = session ? getTodayDateString(new Date(session.startedAt)) : '';
  const isDone = (block?.status ?? calendarSession?.blockStatus) === 'done';

  return (
    <DockedDrawer
      open={Boolean(sessionId)}
      onClose={() => {
        flushBlockEdits();
        onClose();
      }}
      width={520}
      ariaLabel="Session detail"
      title={
        <div className="flex items-center gap-2">
          <Pill tone={isDone ? 'energy-up' : 'accent'} dot>
            {isDone ? `Done · ${formatDuration(durationMins)}` : `Logged · ${formatDuration(durationMins)}`}
          </Pill>
          {project ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9A9A9A] min-w-0">
              <ProjectBadge
                name={project.name}
                color={project.color}
                icon={project.icon}
                size="xs"
              />
              <span className="truncate">{project.name}</span>
            </span>
          ) : null}
        </div>
      }
      headerActions={
        <div className="flex items-center gap-1.5">
          {saveState === 'saved' ? (
            <span className="text-[11px] text-[#7BE0A0] inline-flex items-center gap-1">
              <Check size={11} /> Saved
            </span>
          ) : null}
          {isDone && blockId ? (
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<RotateCcw size={11} />}
              onClick={() => reopenMutation.mutate()}
              disabled={reopenMutation.isPending}
            >
              Reopen
            </Button>
          ) : null}
        </div>
      }
      footer={
        session && blockId ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 size={13} />}
              onClick={() => deleteSessionMutation.mutate()}
              disabled={deleteSessionMutation.isPending}
              className="text-[#9A9A9A] hover:text-[#FF9EC5] hover:bg-[#3D1A2B]/60"
            >
              Delete session
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                flushBlockEdits();
                openBlockDrawer(blockId);
              }}
            >
              Open Full Block
            </Button>
          </div>
        ) : null
      }
    >
      {!session ? (
        <div className="py-12 text-center text-[13px] text-[#6E6E6E]">
          {fallbackCalendarQuery.isLoading ? 'Loading session…' : 'Session not found.'}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Block Title & Metadata */}
          <div className="space-y-2">
            <h3 className="font-display text-[20px] font-semibold leading-snug text-[#EDEDED]">
              {block?.title ?? calendarSession?.blockTitle ?? 'Focus Session'}
            </h3>
            <div className="flex items-center flex-wrap gap-1.5">
              {sessionDate ? (
                <Pill tone="neutral" icon={<Clock size={10} />} className="tabular-nums">
                  {formatShortDate(sessionDate)} · {formatLocalTime(session.startedAt)} –{' '}
                  {session.endedAt ? formatLocalTime(session.endedAt) : 'now'}
                </Pill>
              ) : null}
              {goal ? (
                <GoalChip name={goal.name} kind={goal.kind} color={goal.color} />
              ) : null}
              {block?.isOps || calendarSession?.isOps ? (
                <Pill tone="ops" icon={<Flame size={10} />}>
                  Ops
                </Pill>
              ) : null}
              {block && block.totalFocusMinutes > durationMins ? (
                <Pill tone="neutral" className="tabular-nums">
                  Block total {formatDuration(block.totalFocusMinutes)}
                </Pill>
              ) : null}
            </div>
          </div>

          {/* LOGGED SESSION · TRIM OR SPLIT */}
          <section className="space-y-3 pt-3 border-t border-[#2A2A2A]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Logged Session · Trim or Split
              </span>
              {session.endedAt ? (
                <button
                  type="button"
                  onClick={() => {
                    setSplitOpen((v) => !v);
                    setTimeError(null);
                  }}
                  className="text-[12px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
                >
                  <Scissors size={12} />
                  {splitOpen ? 'Hide split' : 'Split out break'}
                </button>
              ) : null}
            </div>

            <form onSubmit={handleSaveTime} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="text-[11px] text-[#9A9A9A] block">Start</span>
                  <input
                    type="datetime-local"
                    aria-label="Session start"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    disabled={!session.endedAt}
                    className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2] disabled:opacity-50"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#9A9A9A] block">End</span>
                  <input
                    type="datetime-local"
                    aria-label="Session end"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    disabled={!session.endedAt}
                    className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2] disabled:opacity-50"
                  />
                </label>
              </div>

              {session.endedAt ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px]">
                    {timeError ? <span className="text-[#FF9EC5]">{timeError}</span> : null}
                    {!timeError && timeMessage ? (
                      <span className="text-[#7BE0A0]">{timeMessage}</span>
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="xs"
                    disabled={trimMutation.isPending}
                  >
                    Save time
                  </Button>
                </div>
              ) : (
                <div className="text-[12px] text-[#9A9A9A]">
                  Session is currently running — pause or complete it in Focus to trim.
                </div>
              )}
            </form>

            {splitOpen && session.endedAt ? (
              <form
                onSubmit={handleSplitSubmit}
                className="space-y-2.5 pt-3 border-t border-[#2A2A2A]"
              >
                <div className="text-[12px] text-[#C4C4C4]">
                  Remove an untracked break in the middle of this session:
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-[11px] text-[#9A9A9A] block">Break start</span>
                    <input
                      type="datetime-local"
                      aria-label="Break start"
                      value={splitBreakStart}
                      onChange={(e) => setSplitBreakStart(e.target.value)}
                      className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-[#9A9A9A] block">Break minutes</span>
                    <input
                      type="number"
                      aria-label="Break minutes"
                      min={1}
                      max={300}
                      value={splitBreakMinutes}
                      onChange={(e) => setSplitBreakMinutes(e.target.value)}
                      className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setSplitOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="accent-soft"
                    size="xs"
                    disabled={splitMutation.isPending}
                  >
                    Split out break
                  </Button>
                </div>
              </form>
            ) : null}
          </section>

          {/* OUTCOME + ENERGY */}
          {block ? (
            <section className="space-y-2.5 pt-3 border-t border-[#2A2A2A]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Outcome
                </span>
                <div className="flex items-center gap-1">
                  {(['up', 'neutral', 'down'] as EnergySignal[]).map((sig) => {
                    const active = block.energySignal === sig;
                    const label = sig === 'up' ? 'Energy +' : sig === 'down' ? 'Energy −' : 'Neutral';
                    const Icon = sig === 'up' ? ArrowUp : sig === 'down' ? ArrowDown : Minus;
                    return (
                      <button
                        key={sig}
                        type="button"
                        onClick={() =>
                          updateBlockMutation.mutate({
                            energySignal: active ? null : sig,
                          })
                        }
                        className={[
                          'h-6 px-2 rounded-[6px] text-[11px] font-medium inline-flex items-center gap-1 border transition-colors',
                          active
                            ? sig === 'up'
                              ? 'bg-[#14331F] border-[#2FB463]/60 text-[#7BE0A0]'
                              : sig === 'down'
                                ? 'bg-[#3D1A2B] border-[#EC659B]/60 text-[#FF9EC5]'
                                : 'bg-[#2A2A2A] border-[#A3A3A3]/50 text-[#EDEDED]'
                            : 'bg-transparent border-[#2A2A2A] text-[#6E6E6E] hover:text-[#C4C4C4] hover:border-[#3C3C3C]',
                        ].join(' ')}
                      >
                        <Icon size={10} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <input
                type="text"
                value={outcomeDraft}
                onChange={(e) => setOutcomeDraft(e.target.value)}
                onBlur={flushBlockEdits}
                placeholder="One-line outcome for this completed block…"
                className="w-full h-9 px-3 rounded-[8px] bg-[#171717] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </section>
          ) : null}

          {/* AUTO SUMMARY */}
          {block ? (
            <AutoSummarySection
              summary={block.autoSummary}
              onSave={(next) => updateBlockMutation.mutate({ autoSummary: next })}
              saving={updateBlockMutation.isPending}
            />
          ) : null}

          {/* LINKS */}
          {block ? (
            <section className="space-y-2 pt-3 border-t border-[#2A2A2A]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] flex items-center gap-1.5">
                  <Link2 size={12} />
                  Links
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

              {block.externalLinks.length > 0 ? (
                <div className="flex items-center flex-wrap gap-1.5">
                  {block.externalLinks.map((link, idx) => (
                    <LinkChip
                      key={`${link.url}-${idx}`}
                      link={link}
                      onRemove={() => handleRemoveLink(idx)}
                    />
                  ))}
                </div>
              ) : !addingLink ? (
                <div className="text-[12px] text-[#6E6E6E]">No links attached.</div>
              ) : null}

              {addingLink ? (
                <form onSubmit={handleAddLink} className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://notion.so/…"
                      className="flex-1 h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                    />
                    <input
                      type="text"
                      value={linkTitle}
                      onChange={(e) => setLinkTitle(e.target.value)}
                      placeholder="Label"
                      className="w-32 h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                    />
                  </div>
                  {linkError ? <div className="text-[11.5px] text-[#FF9EC5]">{linkError}</div> : null}
                  <div className="flex items-center gap-1.5">
                    <Button type="submit" variant="primary" size="xs">
                      Save link
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setAddingLink(false);
                        setLinkError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}

          {/* NOTES & AI CONTEXT */}
          {block ? (
            <section className="space-y-2 pt-3 border-t border-[#2A2A2A]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Notes &amp; AI Context
                </span>
                <span className="text-[11px] text-[#6E6E6E]">⌘S to save</span>
              </div>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={flushBlockEdits}
                rows={6}
                placeholder="Notes, implementation links, or AI context…"
                className="w-full px-3 py-2.5 rounded-[8px] bg-[#171717] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] leading-relaxed text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-y"
              />
            </section>
          ) : null}
        </div>
      )}
    </DockedDrawer>
  );
}
