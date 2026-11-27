import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, EnergySignal, SenseSignal, UpdateBlockInput } from '@veyra/core/types';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Flame,
  Minus,
  Pause,
  Play,
  Search,
  Target,
  Video,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, isElectronDesktop, queryKeys } from '../api/client';
import {
  invalidateBlockRelated,
  useBlockDetailQuery,
  useTodayQuery,
} from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { matchesAnyAccelerator, useHotkeys } from '../app/hotkeys';
import { Button } from '../components/Button';
import { GoalKindIconBadge } from '../components/GoalChip';
import { ProjectBadge } from '../components/ProjectBadge';
import { goalChipStyle } from '../components/goalTint';
import { formatDuration, formatLocalTime } from '../components/icons';

function formatStopwatchHMS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function isoToLocalHHMM(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function localHHMMToTodayIso(hhmm: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return null;
  const now = new Date();
  const dt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(match[1]),
    Number(match[2]),
    0,
    0,
  );
  return dt.toISOString();
}

export function FocusView() {
  const queryClient = useQueryClient();
  const {
    activeDrawer,
    focusStatus,
    liveElapsedSeconds,
    projects,
    goals,
    navigate,
    openBlockDrawer,
    openMeetingDrawer,
    closeDrawer,
    startFocusAndNavigate,
  } = useAppShell();
  const hotkeys = useHotkeys();

  const todayQuery = useTodayQuery();
  const activeSession = focusStatus?.activeSession ?? null;
  const activeBlock = focusStatus?.activeBlock ?? null;

  const blockDetailQuery = useBlockDetailQuery(activeBlock?.id ?? null);
  const blockDetail = blockDetailQuery.data?.block;

  const [panelMode, setPanelMode] = useState<'none' | 'pause' | 'complete' | 'start-time' | 'gap'>('none');
  const [resumeNoteDraft, setResumeNoteDraft] = useState('');
  const [energySignal, setEnergySignal] = useState<EnergySignal | null>('up');
  const [senseSignal, setSenseSignal] = useState<SenseSignal | null>(null);
  const [outcomeDraft, setOutcomeDraft] = useState('');
  const [startTimeDraft, setStartTimeDraft] = useState('');
  const [startTimeError, setStartTimeError] = useState<string | null>(null);
  const [gapFromDraft, setGapFromDraft] = useState('');
  const [gapToDraft, setGapToDraft] = useState('');
  const [gapError, setGapError] = useState<string | null>(null);
  const [openMetaPicker, setOpenMetaPicker] = useState<'project' | 'goal' | null>(null);
  const [projectSearch, setProjectSearch] = useState('');

  const pauseInputRef = useRef<HTMLInputElement>(null);
  const outcomeInputRef = useRef<HTMLInputElement>(null);
  const metaStripRef = useRef<HTMLDivElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPanelMode('none');
    setResumeNoteDraft('');
    setOutcomeDraft('');
    setEnergySignal('up');
    setSenseSignal(null);
    setStartTimeError(null);
    setOpenMetaPicker(null);
    setProjectSearch('');
  }, [activeSession?.id]);

  useEffect(() => {
    if (!openMetaPicker) return;
    if (openMetaPicker === 'project') {
      window.setTimeout(() => projectSearchRef.current?.focus(), 20);
    }
    const onPointerDown = (e: MouseEvent) => {
      if (metaStripRef.current && !metaStripRef.current.contains(e.target as Node)) {
        setOpenMetaPicker(null);
        setProjectSearch('');
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenMetaPicker(null);
        setProjectSearch('');
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMetaPicker]);

  useEffect(() => {
    const onOpenComplete = () => {
      if (activeSession && activeBlock) {
        setPanelMode('complete');
      }
    };
    window.addEventListener('veyra:focus-open-complete', onOpenComplete);
    return () => window.removeEventListener('veyra:focus-open-complete', onOpenComplete);
  }, [activeSession, activeBlock]);

  useEffect(() => {
    if (panelMode === 'pause') {
      window.setTimeout(() => pauseInputRef.current?.focus(), 20);
    } else if (panelMode === 'complete') {
      window.setTimeout(() => outcomeInputRef.current?.focus(), 20);
    }
  }, [panelMode]);

  const pauseMutation = useMutation({
    mutationFn: (note: string | null) => apiClient.pauseFocus(note),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setPanelMode('none');
      closeDrawer();
      navigate('today');
    },
  });

  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!confirmCancel) return;
    const timer = window.setTimeout(() => setConfirmCancel(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmCancel]);

  const cancelMutation = useMutation({
    mutationFn: () => apiClient.cancelFocus(),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setPanelMode('none');
      setConfirmCancel(false);
      closeDrawer();
      navigate('today');
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiClient.completeFocus({
        blockId: activeBlock?.id,
        energySignal,
        senseSignal,
        outcomeNote: outcomeDraft.trim() || null,
      }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setPanelMode('none');
      closeDrawer();
      navigate('today');
    },
  });

  const updateBlockMetaMutation = useMutation({
    mutationFn: (patch: UpdateBlockInput) => apiClient.updateBlock(activeBlock!.id, patch),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
    },
  });

  const removeGapMutation = useMutation({
    mutationFn: (range: { from: string; to: string }) =>
      apiClient.removeFocusGap(range.from, range.to),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.focus, res.focusStatus);
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setGapError(null);
      setPanelMode('none');
    },
    onError: (err) => {
      setGapError(err instanceof Error ? err.message : 'Could not remove the pause');
    },
  });

  const updateStartTimeMutation = useMutation({
    mutationFn: (startedAt: string) => apiClient.updateFocusStartTime(startedAt),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.focus, res.focusStatus);
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setStartTimeError(null);
      setPanelMode('none');
    },
    onError: (err) => {
      setStartTimeError(err instanceof Error ? err.message : 'Could not update start time');
    },
  });

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== 'archived'),
    [projects],
  );
  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return activeProjects;
    return activeProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [activeProjects, projectSearch]);

  const handleProjectPick = (nextProjectId: string) => {
    if (!activeBlock) return;
    const nextProject = activeProjects.find((p) => p.id === nextProjectId);
    const patch: UpdateBlockInput = { projectId: nextProjectId };
    if (nextProject && !activeBlock.goalId && nextProject.defaultGoalId) {
      patch.goalId = nextProject.defaultGoalId;
    }
    updateBlockMetaMutation.mutate(patch);
    setOpenMetaPicker(null);
    setProjectSearch('');
  };

  const openStartTimeEditor = () => {
    if (!activeSession) return;
    setStartTimeDraft(isoToLocalHHMM(activeSession.startedAt));
    setStartTimeError(null);
    setPanelMode((curr) => (curr === 'start-time' ? 'none' : 'start-time'));
  };

  const openGapEditor = () => {
    if (!activeSession) return;
    const now = Date.now();
    setGapFromDraft(isoToLocalHHMM(new Date(now - 20 * 60_000).toISOString()));
    setGapToDraft(isoToLocalHHMM(new Date(now).toISOString()));
    setGapError(null);
    setPanelMode((curr) => (curr === 'gap' ? 'none' : 'gap'));
  };

  const applyGapMinutes = (minutes: number) => {
    const toIso = localHHMMToTodayIso(gapToDraft) ?? new Date().toISOString();
    setGapFromDraft(isoToLocalHHMM(new Date(Date.parse(toIso) - minutes * 60_000).toISOString()));
    setGapError(null);
  };

  const handleGapSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    const fromIso = localHHMMToTodayIso(gapFromDraft);
    const toIso = localHHMMToTodayIso(gapToDraft);
    if (!fromIso || !toIso) {
      setGapError('Enter both times as HH:MM');
      return;
    }
    if (Date.parse(toIso) <= Date.parse(fromIso)) {
      setGapError('The pause must end after it started');
      return;
    }
    if (Date.parse(toIso) > Date.now()) {
      setGapError('The pause cannot end in the future');
      return;
    }
    if (Date.parse(fromIso) <= Date.parse(activeSession.startedAt)) {
      setGapError(`The pause must start after the session started (${formatLocalTime(activeSession.startedAt)})`);
      return;
    }
    setGapError(null);
    removeGapMutation.mutate({ from: fromIso, to: toIso });
  };

  const applyMinutesAgo = (minutesAgo: number) => {
    const targetIso = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    setStartTimeError(null);
    updateStartTimeMutation.mutate(targetIso);
  };

  const handleStartTimeSubmit = (e: FormEvent) => {
    e.preventDefault();
    const targetIso = localHHMMToTodayIso(startTimeDraft);
    if (!targetIso) {
      setStartTimeError('Enter a valid time (HH:MM)');
      return;
    }
    if (Date.parse(targetIso) > Date.now()) {
      setStartTimeError('Start time cannot be in the future');
      return;
    }
    setStartTimeError(null);
    updateStartTimeMutation.mutate(targetIso);
  };

  // Esc while Pause inline input is open skips note and pauses immediately;
  // Keyboard shortcuts when idle in Focus: P -> Pause, C or ⌘↵ -> Complete, N -> Notes drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (panelMode === 'pause' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!pauseMutation.isPending) {
          pauseMutation.mutate(null);
        }
        return;
      }

      if (panelMode === 'gap' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPanelMode('none');
        setGapError(null);
        return;
      }

      if (panelMode === 'start-time' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPanelMode('none');
        setStartTimeError(null);
        return;
      }

      if (!activeSession || !activeBlock || panelMode !== 'none' || openMetaPicker !== null) return;
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        setPanelMode('complete');
        return;
      }
      if (matchesAnyAccelerator(e, hotkeys.pauseFocus)) {
        e.preventDefault();
        setPanelMode('pause');
      } else if (matchesAnyAccelerator(e, hotkeys.completeBlock)) {
        e.preventDefault();
        setPanelMode('complete');
      } else if (matchesAnyAccelerator(e, hotkeys.toggleNotes)) {
        e.preventDefault();
        if (activeDrawer?.kind === 'block' && activeDrawer.blockId === activeBlock.id) {
          closeDrawer();
        } else {
          openBlockDrawer(activeBlock.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [panelMode, openMetaPicker, pauseMutation, activeSession, activeBlock, activeDrawer, closeDrawer, openBlockDrawer, hotkeys]);

  const currentProject = useMemo(
    () => (activeBlock ? projects.find((p) => p.id === activeBlock.projectId) : undefined),
    [activeBlock, projects],
  );
  const currentGoal = useMemo(
    () => (activeBlock?.goalId ? goals.find((g) => g.id === activeBlock.goalId) : undefined),
    [activeBlock, goals],
  );
  const goalContextLine = useMemo(() => {
    if (!currentGoal) return null;
    const doneWhen = currentGoal.doneWhen?.trim();
    const why = currentGoal.description?.trim();
    if (doneWhen && why) return `${doneWhen} · ${why}`;
    if (doneWhen) return doneWhen;
    if (why) return why;
    return null;
  }, [currentGoal]);

  const elapsedMinuteBucket = Math.floor(liveElapsedSeconds / 60);

  // Upcoming meeting chip ONLY when a real meeting starts within 45 minutes (or is in progress)
  const soonMeeting: CalendarEvent | null = useMemo(() => {
    void elapsedMinuteBucket;
    const events = todayQuery.data?.upcomingEvents ?? [];
    const nowMs = Date.now();
    for (const ev of events) {
      const startMs = Date.parse(ev.startAt);
      const endMs = Date.parse(ev.endAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      if (endMs > nowMs && startMs - nowMs <= 45 * 60_000) {
        return ev;
      }
    }
    return null;
  }, [todayQuery.data?.upcomingEvents, elapsedMinuteBucket]);

  // Multi-day prior focus calculation (sessions other than the currently running one)
  const priorClosedMinutes = useMemo(() => {
    if (!blockDetail) return 0;
    let total = 0;
    for (const s of blockDetail.sessions) {
      if (s.id === activeSession?.id || !s.endedAt) continue;
      const diff = Date.parse(s.endedAt) - Date.parse(s.startedAt);
      if (diff > 0) total += Math.max(1, Math.round(diff / 60_000));
    }
    return total;
  }, [blockDetail, activeSession?.id]);

  const currentSessionMinutes = Math.max(1, Math.round(liveElapsedSeconds / 60));
  const totalBlockMinutes = priorClosedMinutes + currentSessionMinutes;
  const notesDrawerOpen = activeDrawer?.kind === 'block' && activeDrawer.blockId === activeBlock?.id;
  const inElectron = isElectronDesktop();
  const headerPaddingClass = inElectron ? 'pl-[88px] pr-6 h-[52px]' : 'px-8 h-[56px]';

  const handlePauseSubmit = (e: FormEvent) => {
    e.preventDefault();
    pauseMutation.mutate(resumeNoteDraft.trim() || null);
  };

  const handleCompleteSubmit = (e: FormEvent) => {
    e.preventDefault();
    completeMutation.mutate();
  };

  if (!activeSession || !activeBlock) {
    const firstUpNext = todayQuery.data?.upNext?.[0];
    const firstProject = firstUpNext
      ? projects.find((p) => p.id === firstUpNext.projectId)
      : undefined;

    return (
      <div className="min-h-full bg-[#131313] flex flex-col justify-between pb-6">
        <header className={`veyra-drag-region flex items-center justify-between shrink-0 ${headerPaddingClass}`}>
          <Button
            variant="ghost"
            size="sm"
            className="veyra-no-drag"
            leftIcon={<ArrowLeft size={14} />}
            onClick={() => navigate('today')}
          >
            Today
          </Button>
        </header>

        <div className="max-w-[460px] mx-auto text-center space-y-5 px-8 py-12">
          <div className="space-y-1.5">
            <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">
              No active focus session
            </h1>
            <p className="text-[13.5px] text-[#9A9A9A]">
              Pick a block from Today to enter distraction-free focus mode.
            </p>
          </div>

          {firstUpNext ? (
            <div className="veyra-card text-left space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                Up Next
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {firstProject ? (
                    <ProjectBadge
                      name={firstProject.name}
                      color={firstProject.color}
                      icon={firstProject.icon}
                      size="sm"
                    />
                  ) : null}
                  <span className="text-[14px] font-medium text-[#EDEDED] truncate">
                    {firstUpNext.title}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Play size={12} fill="currentColor" />}
                  onClick={() => void startFocusAndNavigate(firstUpNext.id)}
                >
                  Start
                </Button>
              </div>
            </div>
          ) : null}

          <div>
            <Button variant="secondary" size="md" onClick={() => navigate('today')}>
              Back to Today
            </Button>
          </div>
        </div>

        <div className="h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#131313] flex flex-col justify-between pb-6">
      {/* Top Distraction-Free Header */}
      <header
        className={`veyra-drag-region grid grid-cols-3 items-center gap-4 shrink-0 ${headerPaddingClass}`}
      >
        <div className="justify-self-start">
          <Button
            variant="ghost"
            size="sm"
            className="veyra-no-drag"
            leftIcon={<ArrowLeft size={14} />}
            onClick={() => navigate('today')}
          >
            Today
          </Button>
        </div>

        <div className="justify-self-center" />

        <div className="justify-self-end">
          {soonMeeting ? (
            <button
              type="button"
              onClick={() => openMeetingDrawer(soonMeeting.id)}
              className="veyra-no-drag inline-flex items-center gap-2 h-8 px-3 rounded-[8px] bg-[#181818] border border-[#2A2A2A] hover:border-[#3C3C3C] text-[12px] text-[#C4C4C4] transition-colors max-w-[240px]"
            >
              <Video size={12} className="text-[#AEB8FF] shrink-0" />
              <span className="tabular-nums text-[#9A9A9A] shrink-0">
                {formatLocalTime(soonMeeting.startAt)}
              </span>
              <span className="truncate text-[#EDEDED]">{soonMeeting.title}</span>
            </button>
          ) : null}
        </div>
      </header>

      {/* Center Stage: Editable Project/Goal/Ops, Title, Count-up Stopwatch, Start Time, Pause/Complete */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 max-w-[580px] w-full mx-auto space-y-6">
        <div className="text-center space-y-3 max-w-full flex flex-col items-center">
          {/* Editable Project / Goal / Ops Strip directly above the block title */}
          <div
            ref={metaStripRef}
            className="flex items-center justify-center flex-wrap gap-1.5"
          >
            {/* Project Picker */}
            <div className="relative">
              <button
                type="button"
                aria-label="Change focus project"
                aria-expanded={openMetaPicker === 'project'}
                onClick={() => {
                  setProjectSearch('');
                  setOpenMetaPicker((p) => (p === 'project' ? null : 'project'));
                }}
                className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-[7px] bg-[#1C1C1C] border border-[#2A2A2A] hover:border-[#3C3C3C] text-[12px] font-medium text-[#C4C4C4] hover:text-[#EDEDED] transition-colors"
              >
                {currentProject ? (
                  <ProjectBadge
                    name={currentProject.name}
                    color={currentProject.color}
                    icon={currentProject.icon}
                    size="xs"
                  />
                ) : null}
                <span className="max-w-[140px] truncate">{currentProject?.name ?? 'Other'}</span>
                <ChevronDown size={11} className="text-[#6E6E6E]" />
              </button>
              {openMetaPicker === 'project' ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-9 z-30 w-56 rounded-[10px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] overflow-hidden text-left animate-veyra-fade">
                  <div className="flex items-center gap-2 px-2.5 h-8 border-b border-[#2E2E2E]">
                    <Search size={11} className="text-[#6E6E6E] shrink-0" />
                    <input
                      ref={projectSearchRef}
                      type="text"
                      aria-label="Filter projects"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && filteredProjects.length > 0) {
                          e.preventDefault();
                          handleProjectPick(filteredProjects[0].id);
                        }
                      }}
                      placeholder="Filter project…"
                      className="flex-1 bg-transparent text-[12px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {filteredProjects.map((p) => {
                      const active = p.id === activeBlock.projectId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleProjectPick(p.id)}
                          className="w-full px-2.5 py-1.5 rounded-[6px] text-left text-[12.5px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <ProjectBadge name={p.name} color={p.color} icon={p.icon} size="xs" />
                            <span className="truncate">{p.name}</span>
                          </span>
                          {active ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
                        </button>
                      );
                    })}
                    {filteredProjects.length === 0 ? (
                      <div className="px-2.5 py-2 text-[11.5px] text-[#6E6E6E] text-center">
                        No matching projects
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Goal Picker */}
            <div className="relative">
              <button
                type="button"
                aria-label="Change focus goal"
                aria-expanded={openMetaPicker === 'goal'}
                onClick={() => setOpenMetaPicker((p) => (p === 'goal' ? null : 'goal'))}
                style={currentGoal ? goalChipStyle(currentGoal.color) : undefined}
                className={[
                  'inline-flex items-center gap-1.5 h-7 rounded-[7px] border text-[12px] font-medium transition-[color,border-color,filter]',
                  currentGoal
                    ? 'pl-1.5 pr-2.5 hover:brightness-125'
                    : 'px-2.5 bg-[#1C1C1C] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#3C3C3C]',
                ].join(' ')}
              >
                {currentGoal ? (
                  <GoalKindIconBadge kind={currentGoal.kind} color={currentGoal.color} size="xs" />
                ) : (
                  <Target size={11} className="text-[#6E6E6E]" />
                )}
                <span className="max-w-[150px] truncate">{currentGoal?.name ?? '+ Goal'}</span>
                <ChevronDown size={11} className="opacity-60" />
              </button>
              {openMetaPicker === 'goal' ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-9 z-30 w-56 max-h-64 overflow-y-auto p-1 rounded-[10px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] text-left animate-veyra-fade">
                  <button
                    type="button"
                    onClick={() => {
                      updateBlockMetaMutation.mutate({ goalId: null });
                      setOpenMetaPicker(null);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-[6px] text-left text-[12.5px] text-[#9A9A9A] hover:bg-white/[0.07] flex items-center justify-between gap-2"
                  >
                    <span>No goal</span>
                    {!activeBlock.goalId ? <Check size={12} className="text-[#AEB8FF]" /> : null}
                  </button>
                  {goals.map((g) => {
                    const active = g.id === activeBlock.goalId;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          updateBlockMetaMutation.mutate({ goalId: g.id });
                          setOpenMetaPicker(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-[6px] text-left text-[12.5px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <GoalKindIconBadge kind={g.kind} color={g.color} size="xs" />
                          <span className="truncate">{g.name}</span>
                        </span>
                        {active ? <Check size={12} className="text-[#AEB8FF] shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Ops Toggle */}
            <button
              type="button"
              aria-label="Toggle focus Ops"
              onClick={() => updateBlockMetaMutation.mutate({ isOps: !activeBlock.isOps })}
              className={[
                'inline-flex items-center gap-1 h-7 px-2.5 rounded-[7px] border text-[12px] font-medium transition-colors',
                activeBlock.isOps
                  ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                  : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#3C3C3C]',
              ].join(' ')}
            >
              <Flame size={11} />
              <span>{activeBlock.isOps ? 'Ops' : '+ Ops'}</span>
            </button>
          </div>

          <h1 className="font-display text-[24px] font-semibold leading-snug text-[#EDEDED]">
            {activeBlock.title}
          </h1>
          {goalContextLine ? (
            <p
              data-testid="focus-goal-context"
              title={goalContextLine}
              className="text-[12.5px] text-[#9A9A9A] truncate max-w-full"
            >
              {goalContextLine}
            </p>
          ) : null}
          {activeBlock.resumeNote ? (
            <p className="text-[13px] text-[#9A9A9A]">
              Last left off: <span className="text-[#C4C4C4]">{activeBlock.resumeNote}</span>
            </p>
          ) : null}
        </div>

        {/* Large Tabular Stopwatch + Live Start Time Adjuster */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3.5 select-none">
            <span className="w-2.5 h-2.5 rounded-full bg-[#4DA3FF] animate-pulse shrink-0" />
            <div
              aria-label="Elapsed focus time"
              className="font-display text-[64px] leading-none font-semibold tracking-[-0.03em] text-[#EDEDED] tabular-nums"
            >
              {formatStopwatchHMS(liveElapsedSeconds)}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Adjust focus start time"
              onClick={openStartTimeEditor}
              className={[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[12px] tabular-nums transition-colors border',
                panelMode === 'start-time'
                  ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#D6DCFF]'
                  : 'bg-transparent border-transparent text-[#6E6E6E] hover:text-[#C4C4C4] hover:bg-[#1C1C1C] hover:border-[#2A2A2A]',
              ].join(' ')}
            >
              <Clock size={11} />
              <span>Started {formatLocalTime(activeSession.startedAt)}</span>
            </button>

            <button
              type="button"
              aria-label="Remove a pause you forgot to log"
              onClick={openGapEditor}
              className={[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[12px] transition-colors border',
                panelMode === 'gap'
                  ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#D6DCFF]'
                  : 'bg-transparent border-transparent text-[#6E6E6E] hover:text-[#C4C4C4] hover:bg-[#1C1C1C] hover:border-[#2A2A2A]',
              ].join(' ')}
            >
              <Pause size={11} />
              <span>Took a pause?</span>
            </button>
          </div>
        </div>

        {priorClosedMinutes > 0 ? (
          <div className="text-[12px] text-[#9A9A9A] tabular-nums">
            Total on block: {formatDuration(totalBlockMinutes)} ({formatDuration(priorClosedMinutes)}{' '}
            prior + {formatDuration(currentSessionMinutes)} now)
          </div>
        ) : null}

        {/* Inline Start-Time Adjuster Panel */}
        {panelMode === 'start-time' ? (
          <form onSubmit={handleStartTimeSubmit} className="veyra-card w-full max-w-[440px] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#AEB8FF]">
                Started Earlier?
              </span>
              <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                Currently {formatLocalTime(activeSession.startedAt)}
              </span>
            </div>

            <div className="flex items-center flex-wrap gap-1.5">
              {[10, 15, 30, 60].map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={updateStartTimeMutation.isPending}
                  onClick={() => applyMinutesAgo(mins)}
                >
                  {mins === 60 ? '1h ago' : `${mins}m ago`}
                </Button>
              ))}
              {focusStatus?.lastClosedSessionEndedAt &&
              Date.parse(focusStatus.lastClosedSessionEndedAt) < Date.now() ? (
                <Button
                  type="button"
                  variant="accent-soft"
                  size="xs"
                  disabled={updateStartTimeMutation.isPending}
                  onClick={() =>
                    updateStartTimeMutation.mutate(focusStatus.lastClosedSessionEndedAt!)
                  }
                >
                  After last session ({formatLocalTime(focusStatus.lastClosedSessionEndedAt)})
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="time"
                aria-label="Custom focus start time"
                value={startTimeDraft}
                onChange={(e) => setStartTimeDraft(e.target.value)}
                className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={updateStartTimeMutation.isPending}
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPanelMode('none');
                  setStartTimeError(null);
                }}
              >
                Cancel
              </Button>
            </div>

            {startTimeError ? (
              <div className="text-[12px] text-[#FF9EC5]">{startTimeError}</div>
            ) : null}
          </form>
        ) : null}

        {/* Inline Forgotten-Pause Panel */}
        {panelMode === 'gap' ? (
          <form onSubmit={handleGapSubmit} className="veyra-card w-full max-w-[440px] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#AEB8FF]">
                Forgot to log a pause?
              </span>
              <span className="text-[11.5px] text-[#6E6E6E]">The timer keeps running</span>
            </div>
            <p className="text-[12.5px] text-[#9A9A9A]">
              Pick the time you were away. It is cut out of this session, so it does not count as focus time.
            </p>

            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-[11.5px] text-[#6E6E6E]">It lasted</span>
              {[10, 15, 20, 30, 60].map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={removeGapMutation.isPending}
                  onClick={() => applyGapMinutes(mins)}
                >
                  {mins === 60 ? '1h' : `${mins}m`}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="time"
                aria-label="Pause started at"
                value={gapFromDraft}
                onChange={(e) => setGapFromDraft(e.target.value)}
                className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
              />
              <span className="text-[12px] text-[#6E6E6E]">to</span>
              <input
                type="time"
                aria-label="Pause ended at"
                value={gapToDraft}
                onChange={(e) => setGapToDraft(e.target.value)}
                className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
              />
              <Button type="submit" variant="primary" size="sm" disabled={removeGapMutation.isPending}>
                Remove pause
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPanelMode('none');
                  setGapError(null);
                }}
              >
                Cancel
              </Button>
            </div>

            {gapError ? <div className="text-[12px] text-[#FF9EC5]">{gapError}</div> : null}
          </form>
        ) : null}

        {/* Primary Action Buttons: Continue later (primary), Complete (secondary), | Cancel (discard) */}
        {panelMode === 'none' ? (
          <div className="flex items-center gap-2.5 pt-2">
            <Button
              variant="primary"
              size="lg"
              leftIcon={<Pause size={15} />}
              title="Pause session, keep your time, and continue this block later (P)"
              onClick={() => setPanelMode('pause')}
            >
              Continue later
            </Button>
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<CheckCircle2 size={15} />}
              title="Mark this block done (C)"
              onClick={() => setPanelMode('complete')}
            >
              Complete
            </Button>
            <span aria-hidden="true" className="h-5 w-px bg-[#2A2A2A] mx-1" />
            <Button
              variant="ghost"
              size="lg"
              title="Cancel this session and discard its time"
              leftIcon={<X size={13} />}
              onClick={() => (confirmCancel ? cancelMutation.mutate() : setConfirmCancel(true))}
              disabled={cancelMutation.isPending}
              className={confirmCancel ? 'text-[#F5B27A]' : 'text-[#9A9A9A]'}
            >
              {confirmCancel ? 'Discard session?' : 'Cancel'}
            </Button>
          </div>
        ) : null}

        {/* Inline Pause Resume Note */}
        {panelMode === 'pause' ? (
          <form onSubmit={handlePauseSubmit} className="veyra-card w-full space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#AEB8FF]">
                Pause · Continue Later
              </span>
              <span className="text-[11.5px] text-[#6E6E6E]">Esc to pause without note</span>
            </div>
            <input
              ref={pauseInputRef}
              type="text"
              value={resumeNoteDraft}
              onChange={(e) => setResumeNoteDraft(e.target.value)}
              placeholder="Where did you leave off? (optional)"
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
            />
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanelMode('none')}
                disabled={pauseMutation.isPending}
              >
                Keep Focusing
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pauseMutation.isPending}
              >
                Pause Session
              </Button>
            </div>
          </form>
        ) : null}

        {/* Inline Complete Block Picker */}
        {panelMode === 'complete' ? (
          <form onSubmit={handleCompleteSubmit} className="veyra-card w-full max-w-[560px] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7BE0A0]">
                Complete Block
              </span>
              <span className="text-[12px] text-[#9A9A9A] tabular-nums">
                {priorClosedMinutes > 0
                  ? `Session ${formatDuration(currentSessionMinutes)} · Total ${formatDuration(totalBlockMinutes)}`
                  : `Session ${formatDuration(currentSessionMinutes)}`}
              </span>
            </div>

            {/* 3-option energy picker */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A]">
                HOW DID THIS BLOCK FEEL?
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  aria-pressed={energySignal === 'up'}
                  onClick={() => setEnergySignal('up')}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    energySignal === 'up'
                      ? 'bg-[#14331F] border-[#2FB463] text-[#7BE0A0]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <ArrowUp size={13} />
                  <span>Energy +</span>
                </button>
                <button
                  type="button"
                  aria-pressed={energySignal === 'neutral'}
                  onClick={() => setEnergySignal('neutral')}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    energySignal === 'neutral'
                      ? 'bg-[#2A2A2A] border-[#A3A3A3] text-[#EDEDED]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <Minus size={13} />
                  <span>Neutral</span>
                </button>
                <button
                  type="button"
                  aria-pressed={energySignal === 'down'}
                  onClick={() => setEnergySignal('down')}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    energySignal === 'down'
                      ? 'bg-[#3D1A2B] border-[#EC659B] text-[#FF9EC5]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <ArrowDown size={13} />
                  <span>Energy −</span>
                </button>
              </div>
            </div>

            {/* 3-option goal sense-check picker (optional, toggleable) */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A]">
                DID THIS BLOCK MAKE SENSE FOR ITS GOAL?
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  aria-pressed={senseSignal === 'moved'}
                  onClick={() => setSenseSignal((curr) => (curr === 'moved' ? null : 'moved'))}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    senseSignal === 'moved'
                      ? 'bg-[#14331F] border-[#2FB463] text-[#7BE0A0]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <span>✓ Moved the goal</span>
                </button>
                <button
                  type="button"
                  aria-pressed={senseSignal === 'partly'}
                  onClick={() => setSenseSignal((curr) => (curr === 'partly' ? null : 'partly'))}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    senseSignal === 'partly'
                      ? 'bg-[#2A2A2A] border-[#A3A3A3] text-[#EDEDED]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <span>~ Partly</span>
                </button>
                <button
                  type="button"
                  aria-pressed={senseSignal === 'motion'}
                  onClick={() => setSenseSignal((curr) => (curr === 'motion' ? null : 'motion'))}
                  className={[
                    'h-9 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                    senseSignal === 'motion'
                      ? 'bg-[#3D2410] border-[#F07C2A] text-[#F5A66B]'
                      : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <span>✕ Just motion</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="focus-outcome-input"
                className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A] block"
              >
                WHAT ACTUALLY MOVED FORWARD? (OPTIONAL)
              </label>
              <input
                id="focus-outcome-input"
                ref={outcomeInputRef}
                type="text"
                value={outcomeDraft}
                onChange={(e) => setOutcomeDraft(e.target.value)}
                placeholder="Shipped PR #142, unblocked staging deploy…"
                className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#2A2A2A] flex-wrap">
              <div
                data-testid="focus-complete-logged-to"
                className="inline-flex items-center gap-1.5 text-[12px] text-[#9A9A9A] tabular-nums min-w-0"
              >
                <span className="truncate">
                  {currentSessionMinutes}m logged to {currentProject?.name ?? 'Other'}
                </span>
                {currentGoal ? (
                  <>
                    <span className="text-[#6E6E6E] shrink-0">·</span>
                    <GoalKindIconBadge
                      kind={currentGoal.kind}
                      color={currentGoal.color}
                      size="xs"
                    />
                    <span className="text-[#C4C4C4] truncate">{currentGoal.name}</span>
                  </>
                ) : null}
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanelMode('none')}
                  disabled={completeMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  leftIcon={<CheckCircle2 size={13} />}
                  disabled={completeMutation.isPending}
                >
                  Finish Block
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </div>

      {/* Bottom Toggle: Notes & Notion links docked beside stopwatch */}
      <footer className="flex items-center justify-center pt-2">
        <button
          type="button"
          onClick={() => {
            if (notesDrawerOpen) {
              closeDrawer();
            } else {
              openBlockDrawer(activeBlock.id);
            }
          }}
          className={[
            'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[8px] text-[12.5px] font-medium transition-colors border',
            notesDrawerOpen
              ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#D6DCFF]'
              : 'bg-transparent border-[#2A2A2A] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#3C3C3C]',
          ].join(' ')}
        >
          <ChevronRight
            size={13}
            className={`transition-transform ${notesDrawerOpen ? 'rotate-90' : ''}`}
          />
          <span>Notes &amp; Notion links</span>
          {activeBlock.externalLinks.length > 0 ? (
            <span className="text-[11px] text-[#6E6E6E] tabular-nums ml-1">
              ({activeBlock.externalLinks.length})
            </span>
          ) : null}
        </button>
      </footer>
    </div>
  );
}
