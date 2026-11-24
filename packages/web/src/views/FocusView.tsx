import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, EnergySignal } from '@veyra/core/types';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Minus,
  Pause,
  Play,
  Square,
  Video,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, isElectronDesktop } from '../api/client';
import {
  invalidateBlockRelated,
  useBlockDetailQuery,
  useTodayQuery,
} from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { ProjectBadge } from '../components/ProjectBadge';
import { formatDuration, formatLocalTime } from '../components/icons';

function formatStopwatchHMS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
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
    openProject,
    openBlockDrawer,
    openMeetingDrawer,
    closeDrawer,
    startFocusAndNavigate,
  } = useAppShell();

  const todayQuery = useTodayQuery();
  const activeSession = focusStatus?.activeSession ?? null;
  const activeBlock = focusStatus?.activeBlock ?? null;

  const blockDetailQuery = useBlockDetailQuery(activeBlock?.id ?? null);
  const blockDetail = blockDetailQuery.data?.block;

  const [panelMode, setPanelMode] = useState<'none' | 'pause' | 'complete'>('none');
  const [resumeNoteDraft, setResumeNoteDraft] = useState('');
  const [energySignal, setEnergySignal] = useState<EnergySignal | null>('up');
  const [outcomeDraft, setOutcomeDraft] = useState('');

  const pauseInputRef = useRef<HTMLInputElement>(null);
  const outcomeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPanelMode('none');
    setResumeNoteDraft('');
    setOutcomeDraft('');
    setEnergySignal('up');
  }, [activeSession?.id]);

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

  const stopMutation = useMutation({
    mutationFn: () => apiClient.stopFocus(),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setPanelMode('none');
      closeDrawer();
      navigate('today');
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiClient.completeFocus({
        blockId: activeBlock?.id,
        energySignal,
        outcomeNote: outcomeDraft.trim() || null,
      }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, activeBlock?.id);
      setPanelMode('none');
      closeDrawer();
      navigate('today');
    },
  });

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

      if (!activeSession || !activeBlock || panelMode !== 'none') return;
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        setPanelMode('pause');
      } else if (key === 'c') {
        e.preventDefault();
        setPanelMode('complete');
      } else if (key === 'n') {
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
  }, [panelMode, pauseMutation, activeSession, activeBlock, activeDrawer, closeDrawer, openBlockDrawer]);

  const currentProject = useMemo(
    () => (activeBlock ? projects.find((p) => p.id === activeBlock.projectId) : undefined),
    [activeBlock, projects],
  );
  const currentGoal = useMemo(
    () => (activeBlock?.goalId ? goals.find((g) => g.id === activeBlock.goalId) : undefined),
    [activeBlock, goals],
  );

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

        <div className="justify-self-center flex items-center gap-2 min-w-0">
          {currentProject ? (
            <button
              type="button"
              onClick={() => openProject(currentProject.id)}
              className="veyra-no-drag inline-flex items-center gap-2 px-2.5 py-1 rounded-[8px] hover:bg-[#1C1C1C] transition-colors min-w-0"
            >
              <ProjectBadge
                name={currentProject.name}
                color={currentProject.color}
                icon={currentProject.icon}
                size="sm"
              />
              <span className="text-[13px] font-medium text-[#C4C4C4] truncate">
                {currentProject.name}
              </span>
            </button>
          ) : null}
          {currentGoal ? (
            <Pill tone="goal" dot dotColor={currentGoal.color}>
              {currentGoal.name}
            </Pill>
          ) : null}
        </div>

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

      {/* Center Stage: Title, Count-up Stopwatch, Pause/Complete Inline Controls */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 max-w-[580px] w-full mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-[24px] font-semibold leading-snug text-[#EDEDED]">
            {activeBlock.title}
          </h1>
          {activeBlock.resumeNote ? (
            <p className="text-[13px] text-[#9A9A9A]">
              Last left off: <span className="text-[#C4C4C4]">{activeBlock.resumeNote}</span>
            </p>
          ) : null}
        </div>

        {/* Large Tabular Stopwatch */}
        <div className="flex items-center gap-3.5 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-[#4DA3FF] animate-pulse shrink-0" />
          <div
            aria-label="Elapsed focus time"
            className="font-display text-[64px] leading-none font-semibold tracking-[-0.03em] text-[#EDEDED] tabular-nums"
          >
            {formatStopwatchHMS(liveElapsedSeconds)}
          </div>
        </div>

        {priorClosedMinutes > 0 ? (
          <div className="text-[12px] text-[#9A9A9A] tabular-nums">
            Total on block: {formatDuration(totalBlockMinutes)} ({formatDuration(priorClosedMinutes)}{' '}
            prior + {formatDuration(currentSessionMinutes)} now)
          </div>
        ) : null}

        {/* Primary Action Buttons */}
        {panelMode === 'none' ? (
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<Pause size={15} />}
              onClick={() => setPanelMode('pause')}
            >
              Pause
            </Button>
            <Button
              variant="primary"
              size="lg"
              leftIcon={<CheckCircle2 size={15} />}
              onClick={() => setPanelMode('complete')}
            >
              Complete Block
            </Button>
            <Button
              variant="ghost"
              size="lg"
              title="Stop without pause note"
              leftIcon={<Square size={13} />}
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="text-[#9A9A9A]"
            >
              Stop
            </Button>
          </div>
        ) : null}

        {/* Inline Pause Resume Note */}
        {panelMode === 'pause' ? (
          <form onSubmit={handlePauseSubmit} className="veyra-card w-full space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#AEB8FF]">
                Pause &amp; Leave Breadcrumb
              </span>
              <span className="text-[11.5px] text-[#6E6E6E]">Esc to skip &amp; pause</span>
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
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => pauseMutation.mutate(null)}
                  disabled={pauseMutation.isPending}
                >
                  Skip Note
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
            </div>
          </form>
        ) : null}

        {/* Inline Complete Block Picker */}
        {panelMode === 'complete' ? (
          <form onSubmit={handleCompleteSubmit} className="veyra-card w-full space-y-4">
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
              <div className="text-[11.5px] text-[#9A9A9A]">How did this block feel?</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
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

            <div className="space-y-1.5">
              <label htmlFor="focus-outcome-input" className="text-[11.5px] text-[#9A9A9A] block">
                One-line outcome (optional)
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

            <div className="flex items-center justify-end gap-2 pt-1">
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
