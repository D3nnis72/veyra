import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Block,
  EnergySignal,
  Goal,
  GoalReviewItem,
  OpsRadarItem,
  ProgressFeedItem,
  ProjectReviewBucketItem,
  ProjectWithStats,
  RuleKept,
  SenseSignal,
  WeeklyReviewSnapshot,
} from '@veyra/core/types';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarCheck2,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Lightbulb,
  Minus,
  NotebookPen,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Video,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, type ReviewResponse } from '../api/client';
import { invalidateBlockRelated, useReviewQuery } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { GoalChip } from '../components/GoalChip';
import { NoteTagChip } from '../components/NoteTags';
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

type ChapterId = 1 | 2 | 3 | 4;
type ProgressGrouping = 'goal' | 'project';

const CHAPTERS: Array<{ id: ChapterId; label: string; anchor: string }> = [
  { id: 1, label: 'Week', anchor: 'review-chapter-1' },
  { id: 2, label: 'Progress', anchor: 'review-chapter-2' },
  { id: 3, label: 'Time', anchor: 'review-chapter-3' },
  { id: 4, label: 'Next week', anchor: 'review-chapter-4' },
];

function getMondayOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysDateString(dateStr, diff);
}

function getIsoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const daysSinceYearStart = Math.floor((dt.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  return Math.ceil(daysSinceYearStart / 7);
}

function getNextIsoWeekNumber(weekStartDate: string): number {
  return getIsoWeekNumber(addDaysDateString(weekStartDate, 7));
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(el);
    return copied;
  } catch {
    return false;
  }
}

function formatSignedDuration(minutes: number | null): string {
  if (minutes === null) return '–';
  if (minutes === 0) return '0m';
  const prefix = minutes > 0 ? '+' : '−';
  return `${prefix}${formatDuration(Math.abs(minutes))}`;
}

function formatHoursInputValue(minutes: number | null): string {
  if (minutes === null) return '';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
}

function parseHoursToMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const mins = Math.round(parsed * 60);
  return Math.min(4800, Math.max(15, mins));
}

function buildSnapshotMarkdown(snapshot: WeeklyReviewSnapshot): string {
  const lines: string[] = [];
  lines.push(`# Week ${snapshot.weekNumber} Review (${snapshot.weekStartDate} – ${snapshot.weekEndDate})`);
  lines.push('');
  lines.push('## Focus & rhythm');
  lines.push(
    `- Focus: ${formatDuration(snapshot.totalFocusMinutes)} (Room ${formatDuration(snapshot.roomMinutesTotal)} · Planned ${formatDuration(snapshot.plannedMinutesTotal)})`,
  );
  lines.push(
    `- Goal alignment: ${snapshot.goalAlignmentPct}% (Company ${snapshot.companyGoalPct}% · Personal ${snapshot.personalGoalPct}%)`,
  );
  lines.push(
    `- Build vs. Ops: ${formatDuration(snapshot.buildMinutes)} / ${formatDuration(snapshot.opsMinutes)}`,
  );
  lines.push(
    `- Sense: ${snapshot.senseCounts.moved} moved · ${snapshot.senseCounts.partly} partly · ${snapshot.senseCounts.motion} motion`,
  );
  lines.push(
    `- Energy: ${snapshot.energyCounts.up}+ · ${snapshot.energyCounts.neutral}· · ${snapshot.energyCounts.down}−`,
  );
  if (snapshot.previousRuleText) {
    lines.push(
      `- Last week's rule: ${snapshot.previousRuleText}${snapshot.previousRuleKept ? ` (Kept: ${snapshot.previousRuleKept})` : ''}`,
    );
  }
  lines.push('');
  lines.push('## Goals moved');
  if (snapshot.goalsMoved.length === 0) {
    lines.push('- No active goal focus logged this week.');
  } else {
    for (const g of snapshot.goalsMoved) {
      const measurePart = g.measure ? ` · Measure: ${g.measure}` : '';
      lines.push(
        `- **${g.name}** (${g.kind}): ${formatDuration(g.focusMinutes)} · ${g.blockCount} blocks · ${g.movedCount} moved${measurePart}`,
      );
      for (const outcome of g.topOutcomes) {
        lines.push(`  - ${outcome}`);
      }
    }
  }
  lines.push('');
  lines.push(`## Week ${getNextIsoWeekNumber(snapshot.weekStartDate)} commitments`);
  lines.push(`- Rule for next week: ${snapshot.ruleForNextWeek || 'None set'}`);
  for (const p of snapshot.projectWeeklyTimes) {
    const planLabel = p.weeklyTimeMinutes !== null ? formatDuration(p.weeklyTimeMinutes) : 'No plan';
    lines.push(`- ${p.name}: ${planLabel} / week (real: ${formatDuration(p.realMinutes)})`);
  }
  return lines.join('\n');
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

function SensePill({ signal }: { signal: SenseSignal | null | undefined }) {
  if (!signal) return null;
  if (signal === 'moved') {
    return <Pill tone="energy-up">Moved the goal</Pill>;
  }
  if (signal === 'partly') {
    return <Pill tone="due">Partly</Pill>;
  }
  return <Pill tone="neutral">Just motion</Pill>;
}

function MiniSparkline({ values }: { values: number[] }) {
  const safe = values.length > 0 ? values : [0, 0, 0, 0];
  const max = Math.max(1, ...safe);
  return (
    <div
      className="inline-flex items-end gap-0.5 h-5 w-11"
      aria-label={`4-week trend: ${safe.map((v) => formatDuration(v)).join(', ')}`}
    >
      {safe.map((val, idx) => {
        const pct = val <= 0 ? 10 : Math.max(18, Math.round((val / max) * 100));
        const isLast = idx === safe.length - 1;
        return (
          <span
            key={idx}
            className={[
              'w-2 rounded-[2px] transition-all',
              val <= 0 ? 'bg-[#2A2A2A]' : isLast ? 'bg-[#5566F2]' : 'bg-[#4E4E4E]',
            ].join(' ')}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
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
    openGoalDrawer,
    openCloseGoal,
    openCreateBlock,
    openProject,
  } = useAppShell();

  const currentMonday = useMemo(() => getMondayOfDate(getTodayDateString()), []);
  const [weekStart, setWeekStart] = useState<string>(currentMonday);
  const [progressGrouping, setProgressGrouping] = useState<ProgressGrouping>('goal');

  const [activeChapter, setActiveChapter] = useState<ChapterId>(1);
  const [seenChapters, setSeenChapters] = useState<Set<ChapterId>>(() => new Set([1]));

  const [dailyNotesExpanded, setDailyNotesExpanded] = useState(false);
  const [onTrackExpanded, setOnTrackExpanded] = useState(false);

  const [ruleDraft, setRuleDraft] = useState('');
  const [ruleSaved, setRuleSaved] = useState(false);
  const [localRuleKept, setLocalRuleKept] = useState<RuleKept | null>(null);

  const [measureDrafts, setMeasureDrafts] = useState<Record<string, string>>({});
  const [savedMeasures, setSavedMeasures] = useState<Record<string, boolean>>({});
  const [datePickerState, setDatePickerState] = useState<{
    goalId: string;
    mode: 'continue' | 'pause';
    date: string;
  } | null>(null);
  const [dismissedQuietGoals, setDismissedQuietGoals] = useState<Set<string>>(() => new Set());

  const [projectTimeDrafts, setProjectTimeDrafts] = useState<Record<string, string>>({});
  const [modifiedProjectTimes, setModifiedProjectTimes] = useState<Record<string, number | null>>({});

  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  const ruleInputRef = useRef<HTMLInputElement | null>(null);
  const lastMeasureWeekRef = useRef<string | null>(null);
  const dirtyMeasuresRef = useRef<Set<string>>(new Set());
  const lastProjectTimeWeekRef = useRef<string | null>(null);
  const dirtyProjectTimesRef = useRef<Set<string>>(new Set());

  const reviewQuery = useReviewQuery(weekStart);
  const data = reviewQuery.data;

  const effectiveWeekStart = data?.weekStartDate ?? weekStart;
  const effectiveWeekEnd = data?.weekEndDate ?? addDaysDateString(weekStart, 6);
  const effectiveWeekNumber = data?.weekNumber ?? getIsoWeekNumber(effectiveWeekStart);
  const nextMonday = addDaysDateString(effectiveWeekStart, 7);
  const nextWeekNumber = getIsoWeekNumber(nextMonday);

  useEffect(() => {
    setRuleDraft(data?.ruleForNextWeek ?? '');
  }, [data?.weekStartDate, data?.ruleForNextWeek]);

  useEffect(() => {
    setLocalRuleKept(data?.previousRuleKept ?? null);
  }, [data?.weekStartDate, data?.previousRuleKept]);

  useEffect(() => {
    setRuleSaved(false);
  }, [data?.weekStartDate]);

  useEffect(() => {
    setActiveChapter(1);
    setSeenChapters(new Set([1]));
    setDailyNotesExpanded(false);
    setOnTrackExpanded(false);
    setDatePickerState(null);
  }, [weekStart]);

  useEffect(() => {
    if (!data?.goalReviews) return;
    const weekChanged = lastMeasureWeekRef.current !== data.weekStartDate;
    if (weekChanged) {
      lastMeasureWeekRef.current = data.weekStartDate;
      dirtyMeasuresRef.current.clear();
      const next: Record<string, string> = {};
      for (const g of data.goalReviews) {
        next[g.goalId] = g.measure ?? '';
      }
      setMeasureDrafts(next);
      return;
    }
    setMeasureDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const g of data.goalReviews) {
        next[g.goalId] =
          dirtyMeasuresRef.current.has(g.goalId) && prev[g.goalId] !== undefined
            ? prev[g.goalId]
            : (g.measure ?? '');
      }
      return next;
    });
  }, [data?.weekStartDate, data?.goalReviews]);

  useEffect(() => {
    const sourceProjects = data?.projects ?? shellProjects;
    const currentWeekKey = data?.weekStartDate ?? weekStart;
    const weekChanged = lastProjectTimeWeekRef.current !== currentWeekKey;
    if (weekChanged) {
      lastProjectTimeWeekRef.current = currentWeekKey;
      dirtyProjectTimesRef.current.clear();
      const next: Record<string, string> = {};
      for (const p of sourceProjects) {
        next[p.id] = formatHoursInputValue(p.weeklyTimeMinutes);
      }
      setProjectTimeDrafts(next);
      setModifiedProjectTimes({});
      return;
    }
    setProjectTimeDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const p of sourceProjects) {
        next[p.id] =
          dirtyProjectTimesRef.current.has(p.id) && prev[p.id] !== undefined
            ? prev[p.id]
            : formatHoursInputValue(p.weeklyTimeMinutes);
      }
      return next;
    });
  }, [data?.weekStartDate, weekStart, data?.projects, shellProjects]);

  // IntersectionObserver for sticky Chapter Bar (never locks navigation order)
  useEffect(() => {
    if (data?.completedAt) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const elements = CHAPTERS.map((c) => document.getElementById(c.anchor)).filter(
      (el): el is HTMLElement => Boolean(el),
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const matched = CHAPTERS.find((c) => c.anchor === entry.target.id);
          if (matched) {
            setActiveChapter(matched.id);
            setSeenChapters((prev) => {
              if (prev.has(matched.id)) return prev;
              const next = new Set(prev);
              next.add(matched.id);
              return next;
            });
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0.05 },
    );

    for (const el of elements) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [data?.completedAt, data?.weekStartDate]);

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

  const editableProjects = useMemo(() => {
    const source = data?.projects ?? shellProjects;
    return source.filter((p) => !p.isSystem && p.status !== 'archived');
  }, [data?.projects, shellProjects]);

  const totalNextWeekPlannedMinutes = useMemo(() => {
    let total = 0;
    for (const p of editableProjects) {
      const draft = projectTimeDrafts[p.id];
      const mins = draft !== undefined ? parseHoursToMinutes(draft) : p.weeklyTimeMinutes;
      if (mins !== null) total += mins;
    }
    return total;
  }, [editableProjects, projectTimeDrafts]);

  const saveRuleMutation = useMutation({
    mutationFn: (vars: { ruleForNextWeek?: string; previousRuleKept?: RuleKept | null }) =>
      apiClient.setWeeklyRule({
        weekStartDate: effectiveWeekStart,
        ...(vars.ruleForNextWeek !== undefined ? { ruleForNextWeek: vars.ruleForNextWeek } : {}),
        ...(vars.previousRuleKept !== undefined
          ? { previousRuleKept: vars.previousRuleKept }
          : {}),
      }),
    onSuccess: (_res, variables) => {
      if (variables.ruleForNextWeek !== undefined) {
        setRuleSaved(true);
        window.setTimeout(() => setRuleSaved(false), 1800);
      }
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const completeReviewMutation = useMutation({
    mutationFn: () => {
      const mergedProjectTimes: Record<string, number | null> = { ...modifiedProjectTimes };
      for (const p of editableProjects) {
        const draft = projectTimeDrafts[p.id];
        if (draft === undefined) continue;
        const parsed = parseHoursToMinutes(draft);
        if (parsed !== p.weeklyTimeMinutes) {
          mergedProjectTimes[p.id] = parsed;
        }
      }
      return apiClient.completeReview({
        weekStartDate: effectiveWeekStart,
        ruleForNextWeek: ruleDraft.trim(),
        previousRuleKept: localRuleKept,
        ...(Object.keys(mergedProjectTimes).length > 0
          ? { projectWeeklyTimes: mergedProjectTimes }
          : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });

  const reopenReviewMutation = useMutation({
    mutationFn: () => apiClient.reopenReview(effectiveWeekStart),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: (vars: {
      goalId: string;
      input: { measure?: string | null; measureWeekStartDate?: string; checkInDate?: string | null };
    }) => apiClient.updateGoal(vars.goalId, vars.input),
    onSuccess: (_res, vars) => {
      if (vars.input.measure !== undefined) {
        dirtyMeasuresRef.current.delete(vars.goalId);
        setSavedMeasures((prev) => ({ ...prev, [vars.goalId]: true }));
        window.setTimeout(() => {
          setSavedMeasures((prev) => ({ ...prev, [vars.goalId]: false }));
        }, 1600);
      }
      if (vars.input.checkInDate !== undefined) {
        setDatePickerState(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      void queryClient.invalidateQueries({ queryKey: ['goal', vars.goalId] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const updateProjectTimeMutation = useMutation({
    mutationFn: (vars: { projectId: string; weeklyTimeMinutes: number | null }) =>
      apiClient.updateProject(vars.projectId, { weeklyTimeMinutes: vars.weeklyTimeMinutes }),
    onSuccess: (_res, vars) => {
      dirtyProjectTimesRef.current.delete(vars.projectId);
      setModifiedProjectTimes((prev) => ({
        ...prev,
        [vars.projectId]: vars.weeklyTimeMinutes,
      }));
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['project', vars.projectId] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
    },
  });

  const planNextWeekMutation = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.moveBlock(blockId, {
        bucket: 'scheduled',
        scheduledDate: nextMonday,
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

  const handleJumpChapter = (chapter: (typeof CHAPTERS)[number]) => {
    setActiveChapter(chapter.id);
    setSeenChapters((prev) => {
      const next = new Set(prev);
      next.add(chapter.id);
      return next;
    });
    const el = document.getElementById(chapter.anchor);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const handleKeptToggle = (choice: RuleKept) => {
    const nextValue = localRuleKept === choice ? null : choice;
    setLocalRuleKept(nextValue);
    saveRuleMutation.mutate({
      previousRuleKept: nextValue,
    });
  };

  const handleRuleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveRuleMutation.mutate({
      ruleForNextWeek: ruleDraft.trim(),
      previousRuleKept: localRuleKept,
    });
  };

  const handleSelectSuggestedRule = (suggestion: string) => {
    setRuleDraft(suggestion);
    ruleInputRef.current?.focus();
  };

  const handleCommitProjectTime = (project: ProjectWithStats) => {
    const raw = projectTimeDrafts[project.id] ?? '';
    const nextMinutes = parseHoursToMinutes(raw);
    if (nextMinutes === project.weeklyTimeMinutes) {
      dirtyProjectTimesRef.current.delete(project.id);
      return;
    }
    setProjectTimeDrafts((prev) => ({
      ...prev,
      [project.id]: formatHoursInputValue(nextMinutes),
    }));
    updateProjectTimeMutation.mutate({
      projectId: project.id,
      weeklyTimeMinutes: nextMinutes,
    });
  };

  const handleCopyMarkdown = async (snapshot: WeeklyReviewSnapshot) => {
    const ok = await copyText(buildSnapshotMarkdown(snapshot));
    if (ok) {
      setCopiedMarkdown(true);
      window.setTimeout(() => setCopiedMarkdown(false), 1800);
    }
  };

  const weekRangeLabel = `${formatShortDate(effectiveWeekStart)} – ${formatShortDate(effectiveWeekEnd)}`;

  const energy = data?.energyCounts ?? { up: 0, neutral: 0, down: 0 };
  const energyDisplay = `${energy.up}+ · ${energy.neutral}· · ${energy.down}−`;
  const sense = data?.senseCounts ?? { moved: 0, partly: 0, motion: 0 };

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

  const sortedGoalReviews = useMemo(() => {
    const list = [...(data?.goalReviews ?? [])];
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'company' ? -1 : 1;
      return a.rankInKind - b.rankInKind;
    });
    return list;
  }, [data?.goalReviews]);

  const groupedProgressFeed = useMemo(() => {
    const items = data?.progressFeed ?? [];
    if (progressGrouping === 'goal') {
      const map = new Map<string, { key: string; goal: Goal | null; items: ProgressFeedItem[] }>();
      for (const item of items) {
        const key = item.goalId ?? '__no_goal__';
        const existing = map.get(key);
        if (existing) {
          existing.items.push(item);
        } else {
          map.set(key, {
            key,
            goal: item.goalId ? (goalsById.get(item.goalId) ?? null) : null,
            items: [item],
          });
        }
      }
      return Array.from(map.values()).sort((a, b) => {
        if (a.goal && !b.goal) return -1;
        if (!a.goal && b.goal) return 1;
        if (a.goal && b.goal && a.goal.kind !== b.goal.kind) {
          return a.goal.kind === 'company' ? -1 : 1;
        }
        return 0;
      });
    }

    const map = new Map<
      string,
      { key: string; project: ProjectWithStats | null; items: ProgressFeedItem[] }
    >();
    for (const item of items) {
      const key = item.projectId ?? '__no_project__';
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(key, {
          key,
          project: item.projectId ? (projectsById.get(item.projectId) ?? null) : null,
          items: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [data?.progressFeed, progressGrouping, goalsById, projectsById]);

  const isCompleted = Boolean(data?.completedAt);

  return (
    <div className="max-w-[1040px] mx-auto px-7 py-7 space-y-6">
      {/* Topbar: Title + Week Navigation + By Goal / By Project Toggle */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h1 className="font-display text-[26px] font-semibold leading-tight text-[#EDEDED]">
            Weekly Review
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Walk the week in four calm chapters — facts, movement, project time, and next week’s
            rule.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {!isCompleted ? (
            <div
              role="group"
              aria-label="Progress grouping"
              className="inline-flex items-center rounded-[8px] bg-[#1C1C1C] border border-[#2A2A2A] p-0.5"
            >
              <button
                type="button"
                aria-pressed={progressGrouping === 'goal'}
                onClick={() => setProgressGrouping('goal')}
                className={[
                  'h-7 px-2.5 rounded-[6px] text-[12px] font-medium transition-colors',
                  progressGrouping === 'goal'
                    ? 'bg-[#262626] text-[#EDEDED]'
                    : 'text-[#9A9A9A] hover:text-[#EDEDED]',
                ].join(' ')}
              >
                By Goal
              </button>
              <button
                type="button"
                aria-pressed={progressGrouping === 'project'}
                onClick={() => setProgressGrouping('project')}
                className={[
                  'h-7 px-2.5 rounded-[6px] text-[12px] font-medium transition-colors',
                  progressGrouping === 'project'
                    ? 'bg-[#262626] text-[#EDEDED]'
                    : 'text-[#9A9A9A] hover:text-[#EDEDED]',
                ].join(' ')}
              >
                By Project
              </button>
            </div>
          ) : null}

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
              Week {effectiveWeekNumber} · {weekRangeLabel}
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
      </header>

      {reviewQuery.isLoading ? (
        <div className="veyra-card text-[13px] text-[#6E6E6E]">Loading review…</div>
      ) : isCompleted && data ? (
        <CompletedReviewView
          data={data}
          weekNumber={effectiveWeekNumber}
          copiedMarkdown={copiedMarkdown}
          onCopyMarkdown={(snapshot) => void handleCopyMarkdown(snapshot)}
          onReopen={() => reopenReviewMutation.mutate()}
          isReopening={reopenReviewMutation.isPending}
          onOpenGoal={openGoalDrawer}
        />
      ) : (
        <>
          {/* Sticky Chapter Bar */}
          <nav
            aria-label="Review chapters"
            className="sticky top-0 z-10 -mx-1 px-1 py-2.5 bg-[#131313]/95 backdrop-blur-sm border-b border-[#2A2A2A] flex items-center gap-2 flex-wrap"
          >
            {CHAPTERS.map((chapter) => {
              const isCurrent = activeChapter === chapter.id;
              const isSeen = seenChapters.has(chapter.id);
              return (
                <button
                  key={chapter.id}
                  type="button"
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => handleJumpChapter(chapter)}
                  className={[
                    'h-8 px-3 rounded-[8px] border text-[12.5px] font-medium inline-flex items-center gap-2 transition-colors',
                    isCurrent
                      ? 'bg-[#1F2759] border-[#5566F2]/60 text-[#D6DCFF]'
                      : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#C4C4C4] hover:border-[#3C3C3C] hover:text-[#EDEDED]',
                  ].join(' ')}
                >
                  <span className="tabular-nums text-[11.5px] opacity-80">{chapter.id}</span>
                  <span>{chapter.label}</span>
                  {isSeen ? (
                    <Check
                      size={11}
                      className={isCurrent ? 'text-[#AEB8FF]' : 'text-[#7BE0A0]'}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* ================================================================= */}
          {/* CHAPTER 1 · WHAT HAPPENED?                                        */}
          {/* ================================================================= */}
          <section
            id="review-chapter-1"
            aria-label="Chapter 1: What happened?"
            className="space-y-4 scroll-mt-16"
          >
            <div className="space-y-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF]">
                1 · What happened?
              </h2>
              <p className="font-display text-[19px] font-semibold text-[#EDEDED] leading-snug">
                {data?.chapterOpeningSentences?.week ??
                  'Review your measured focus, goal share, and daily rhythm.'}
              </p>
            </div>

            {/* Last week's rule card + inline Kept it? */}
            <div className="veyra-card flex items-center justify-between gap-4 flex-wrap">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#9A9A9A]">
                  <Sparkles size={11} className="text-[#AEB8FF]" />
                  <span>Last week’s rule</span>
                </div>
                {data?.activeRuleText ? (
                  <p className="text-[14px] font-medium text-[#EDEDED]">{data.activeRuleText}</p>
                ) : (
                  <p className="text-[13px] text-[#6E6E6E]">
                    No rule carried into this week — set one in Chapter 4 for next week’s Today
                    header.
                  </p>
                )}
              </div>

              {data?.activeRuleText ? (
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <span className="text-[12px] text-[#9A9A9A]">Kept it?</span>
                  <div
                    role="group"
                    aria-label="Kept last week's rule"
                    className="inline-flex items-center rounded-[8px] bg-[#242424] border border-[#3C3C3C] p-0.5"
                  >
                    {(
                      [
                        { id: 'yes', label: 'Yes' },
                        { id: 'partly', label: 'Partly' },
                        { id: 'no', label: 'No' },
                      ] as Array<{ id: RuleKept; label: string }>
                    ).map((opt) => {
                      const active = localRuleKept === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          disabled={saveRuleMutation.isPending}
                          onClick={() => handleKeptToggle(opt.id)}
                          className={[
                            'h-7 px-2.5 rounded-[6px] text-[12px] font-medium transition-colors',
                            active
                              ? 'bg-[#3B4BD8] text-white'
                              : 'text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-[#2F2F2F]',
                          ].join(' ')}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 5 Flat KPI Tiles directly on canvas */}
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
              aria-label="Weekly metrics"
            >
              <div className="veyra-card space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Focus
                </div>
                <div className="font-display text-[24px] font-semibold text-[#EDEDED] tabular-nums leading-tight">
                  {formatDuration(data?.totalFocusMinutes ?? 0)}
                </div>
                <div className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                  Room {formatDuration(data?.roomMinutesTotal ?? 0)} · Planned{' '}
                  {formatDuration(data?.plannedMinutesTotal ?? 0)}
                </div>
              </div>

              <div className="veyra-card space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Goals
                </div>
                <div className="font-display text-[24px] font-semibold text-[#EDEDED] tabular-nums leading-tight">
                  {data?.goalAlignmentPct ?? 0}%
                </div>
                <div className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                  Company {data?.companyGoalPct ?? 0}% · Personal {data?.personalGoalPct ?? 0}%
                </div>
              </div>

              <div className="veyra-card space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Build vs. Ops
                </div>
                <div className="font-display text-[21px] font-semibold text-[#EDEDED] tabular-nums leading-tight pt-0.5">
                  {formatDuration(data?.buildMinutes ?? 0)}{' '}
                  <span className="text-[#6E6E6E] font-normal">/</span>{' '}
                  <span className="text-[#F2D06B]">{formatDuration(data?.opsMinutes ?? 0)}</span>
                </div>
                <div className="text-[11.5px] text-[#9A9A9A]">Build focus vs. Ops load</div>
              </div>

              <div className="veyra-card space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Sense
                </div>
                <div className="font-display text-[21px] font-semibold text-[#EDEDED] tabular-nums leading-tight pt-0.5">
                  {sense.moved}{' '}
                  <span className="text-[13px] font-normal text-[#7BE0A0]">moved</span>
                </div>
                <div className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                  {sense.partly} partly · {sense.motion} motion
                </div>
              </div>

              {/* Energy Tile — strictly raw counts, NEVER a percentage score */}
              <div className="veyra-card space-y-1.5" data-testid="review-energy-tile">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  Energy
                </div>
                <div className="font-display text-[21px] font-semibold text-[#EDEDED] tabular-nums leading-tight pt-0.5">
                  {energyDisplay}
                </div>
                <div className="text-[11.5px] text-[#9A9A9A]">Up · Neutral · Down blocks</div>
              </div>
            </div>

            {/* Mon–Fri Day-by-Day Strip */}
            <section className="veyra-card space-y-3" aria-label="Mon–Fri day strip">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Mon–Fri rhythm
                </h3>
                <div className="flex items-center gap-3 text-[11px] text-[#9A9A9A]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2 rounded-[2px] bg-[#3B4BD8]" />
                    Focus
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2 rounded-[2px] bg-[#2F3347]" />
                    Planned
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-0.5 h-3 bg-[#EDEDED]/70" />
                    Room
                  </span>
                </div>
              </div>

              <div className="space-y-0">
                {(data?.dayStrip ?? []).map((day, idx, arr) => {
                  const maxScale = Math.max(
                    60,
                    ...arr.map((d) => Math.max(d.focusMinutes, d.plannedMinutes, d.roomMinutes)),
                  );
                  const focusPct = Math.min(100, Math.round((day.focusMinutes / maxScale) * 100));
                  const plannedPct = Math.min(
                    100,
                    Math.round((day.plannedMinutes / maxScale) * 100),
                  );
                  const roomPct = Math.min(100, Math.round((day.roomMinutes / maxScale) * 100));

                  return (
                    <div
                      key={day.date}
                      className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 grid grid-cols-12 items-center gap-3"
                    >
                      <div className="col-span-2 sm:col-span-1 text-[12.5px] font-medium text-[#EDEDED]">
                        {day.weekday}
                      </div>
                      <div className="col-span-6 sm:col-span-7 relative h-5 rounded-[6px] bg-[#171717] overflow-hidden">
                        {/* Shaded planned bar */}
                        {day.plannedMinutes > 0 ? (
                          <div
                            className="absolute inset-y-0 left-0 bg-[#2A2F4A]/80 rounded-r-[4px]"
                            style={{ width: `${plannedPct}%` }}
                          />
                        ) : null}
                        {/* Solid focus bar */}
                        {day.focusMinutes > 0 ? (
                          <div
                            className="absolute inset-y-1 left-0 bg-[#3B4BD8] rounded-r-[4px]"
                            style={{ width: `${focusPct}%` }}
                          />
                        ) : null}
                        {/* Vertical room line */}
                        {day.roomMinutes > 0 ? (
                          <div
                            className="absolute inset-y-0 w-[2px] bg-[#EDEDED]/75"
                            style={{ left: `calc(${roomPct}% - 1px)` }}
                            title={`Room ${formatDuration(day.roomMinutes)}`}
                          />
                        ) : null}
                      </div>
                      <div className="col-span-4 text-right text-[11.5px] text-[#9A9A9A] tabular-nums flex items-center justify-end gap-2.5 flex-wrap">
                        <span className="text-[#EDEDED] font-medium">
                          {formatDuration(day.focusMinutes)}
                        </span>
                        <span>room {formatDuration(day.roomMinutes)}</span>
                        <span className="text-[#6E6E6E]">
                          {day.meetingMinutes > 0 ? `${formatDuration(day.meetingMinutes)} mtg` : '0m mtg'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Collapsible Notes This Week */}
            <section className="veyra-card space-y-3" aria-label="Notes This Week">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={dailyNotesExpanded}
                  onClick={() => setDailyNotesExpanded((v) => !v)}
                  className="inline-flex items-center gap-2 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-[#C4C4C4] hover:text-[#EDEDED] transition-colors"
                >
                  {dailyNotesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <NotebookPen size={12} className="text-[#9A9A9A]" />
                  <span>Notes this week</span>
                  <span className="text-[11px] font-medium text-[#6E6E6E] tabular-nums">
                    ({data?.dailyNotes.length ?? 0})
                  </span>
                </button>
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
                  No notes captured this week. Press ⌘⇧P anytime to jot a quick bullet.
                </div>
              ) : !dailyNotesExpanded ? (
                <div className="text-[12.5px] text-[#9A9A9A] truncate">
                  <span className="text-[#6E6E6E] mr-1.5">Latest:</span>
                  {data?.dailyNotes[data.dailyNotes.length - 1]?.content}
                </div>
              ) : (
                <ul className="border-t border-[#2A2A2A]">
                  {(data?.dailyNotes ?? []).map((note) => {
                    const proj = note.projectId ? projectsById.get(note.projectId) : undefined;
                    return (
                      <li
                        key={note.id}
                        className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-1"
                      >
                        <div className="text-[13px] text-[#EDEDED] leading-snug">
                          {note.content}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#6E6E6E] tabular-nums">
                          <span>{formatShortDate(note.date)}</span>
                          <span>·</span>
                          <span>{formatLocalTime(note.createdAt)}</span>
                          {proj ? <span className="text-[#9A9A9A]">· {proj.name}</span> : null}
                          {note.isOps ? <Pill tone="ops">Ops</Pill> : null}
                          {(note.tags ?? []).map((tag) => (
                            <NoteTagChip key={tag} tag={tag} />
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </section>

          {/* ================================================================= */}
          {/* CHAPTER 2 · WHAT MOVED?                                           */}
          {/* ================================================================= */}
          <section
            id="review-chapter-2"
            aria-label="Chapter 2: What moved?"
            className="space-y-4 pt-2 scroll-mt-16"
          >
            <div className="space-y-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF]">
                2 · What moved?
              </h2>
              <p className="font-display text-[19px] font-semibold text-[#EDEDED] leading-snug">
                {data?.chapterOpeningSentences?.progress ??
                  'Check what actually advanced your active Company and Personal goals.'}
              </p>
            </div>

            {/* Active Goals List (Company first, measured time only, zero weekly targets) */}
            <section className="veyra-card space-y-3" aria-label="Goals moved">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Active goals
                </h3>
                <span className="text-[12px] text-[#9A9A9A] tabular-nums">
                  Company {formatDuration(data?.companyGoalMinutes ?? 0)} · Personal{' '}
                  {formatDuration(data?.personalGoalMinutes ?? 0)}
                </span>
              </div>

              {sortedGoalReviews.length === 0 ? (
                <div className="text-[13px] text-[#6E6E6E]">
                  No active goals yet. Create a goal in the Goals view to track weekly movement.
                </div>
              ) : (
                <div className="border-t border-[#2A2A2A]">
                  {sortedGoalReviews.map((goal) => {
                    const quietKey = `${effectiveWeekStart}:${goal.goalId}`;
                    const quietDismissed = dismissedQuietGoals.has(quietKey);
                    const draftMeasure = measureDrafts[goal.goalId] ?? '';
                    const measureChanged = draftMeasure.trim() !== (goal.measure ?? '').trim();
                    const activeDatePicker =
                      datePickerState?.goalId === goal.goalId ? datePickerState : null;

                    return (
                      <div
                        key={goal.goalId}
                        className="py-3.5 border-b border-[#2A2A2A] last:border-b-0 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                            <GoalChip
                              name={goal.name}
                              kind={goal.kind}
                              color={goal.color}
                              onClick={() => openGoalDrawer(goal.goalId)}
                            />
                            <span className="text-[11.5px] text-[#6E6E6E] capitalize">
                              {goal.kind}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[12px] text-[#9A9A9A] tabular-nums flex-wrap">
                            <span className="text-[#EDEDED] font-medium">
                              {formatDuration(goal.focusMinutes)}
                            </span>
                            <span>
                              {goal.blockCount} {goal.blockCount === 1 ? 'block' : 'blocks'}
                            </span>
                            {goal.senseCounts.moved > 0 ||
                            goal.senseCounts.partly > 0 ||
                            goal.senseCounts.motion > 0 ? (
                              <span className="text-[#9A9A9A]">
                                {goal.senseCounts.moved} moved · {goal.senseCounts.partly} partly ·{' '}
                                {goal.senseCounts.motion} motion
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {goal.topOutcomes.length > 0 ? (
                          <ul className="space-y-1 pl-1">
                            {goal.topOutcomes.slice(0, 3).map((outcome, idx) => (
                              <li
                                key={`${goal.goalId}-out-${idx}`}
                                className="text-[12.5px] text-[#C4C4C4] flex items-baseline gap-2"
                              >
                                <span className="text-[#6E6E6E]">·</span>
                                <span>{outcome}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {/* Inline "Where are you now?" measure input */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <label
                            htmlFor={`goal-measure-${goal.goalId}`}
                            className="text-[11.5px] text-[#9A9A9A] shrink-0"
                          >
                            Where are you now?
                          </label>
                          <input
                            id={`goal-measure-${goal.goalId}`}
                            aria-label={`Where are you now for ${goal.name}`}
                            type="text"
                            value={draftMeasure}
                            onChange={(e) => {
                              dirtyMeasuresRef.current.add(goal.goalId);
                              setMeasureDrafts((prev) => ({
                                ...prev,
                                [goal.goalId]: e.target.value,
                              }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && measureChanged) {
                                e.preventDefault();
                                updateGoalMutation.mutate({
                                  goalId: goal.goalId,
                                  input: {
                                    measure: draftMeasure.trim() || null,
                                    measureWeekStartDate: effectiveWeekStart,
                                  },
                                });
                              }
                            }}
                            placeholder="e.g. 2 / 3 customers live…"
                            className="flex-1 min-w-[180px] h-8 px-2.5 rounded-[6px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
                          />
                          <Button
                            variant="secondary"
                            size="xs"
                            aria-label={`Save measure for ${goal.name}`}
                            disabled={!measureChanged || updateGoalMutation.isPending}
                            onClick={() =>
                              updateGoalMutation.mutate({
                                goalId: goal.goalId,
                                input: {
                                  measure: draftMeasure.trim() || null,
                                  measureWeekStartDate: effectiveWeekStart,
                                },
                              })
                            }
                          >
                            Save
                          </Button>
                          {savedMeasures[goal.goalId] ? (
                            <span className="text-[11.5px] text-[#7BE0A0] inline-flex items-center gap-1">
                              <Check size={11} /> Updated
                            </span>
                          ) : null}
                        </div>

                        {/* Calm conditional prompts */}
                        <GoalConditionalPrompts
                          goal={goal}
                          nextMonday={nextMonday}
                          defaultDeferDate={addDaysDateString(effectiveWeekEnd, 28)}
                          quietDismissed={quietDismissed}
                          activeDatePicker={activeDatePicker}
                          isSaving={updateGoalMutation.isPending}
                          onOpenCloseGoal={openCloseGoal}
                          onOpenCreateBlock={openCreateBlock}
                          onStartDatePicker={(mode, initialDate) =>
                            setDatePickerState({ goalId: goal.goalId, mode, date: initialDate })
                          }
                          onChangeDatePicker={(date) =>
                            setDatePickerState((prev) => (prev ? { ...prev, date } : prev))
                          }
                          onCancelDatePicker={() => setDatePickerState(null)}
                          onSaveDatePicker={(checkInDate) =>
                            updateGoalMutation.mutate({
                              goalId: goal.goalId,
                              input: { checkInDate },
                            })
                          }
                          onDismissQuiet={() =>
                            setDismissedQuietGoals((prev) => {
                              const next = new Set(prev);
                              next.add(quietKey);
                              return next;
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Progress Feed grouped by Goal or Project */}
            <section className="space-y-3" aria-label="Progress Feed">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Progress Feed · {progressGrouping === 'goal' ? 'By Goal' : 'By Project'}
                </h3>
                <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                  {data?.progressFeed.length ?? 0} items
                </span>
              </div>

              {(data?.progressFeed.length ?? 0) === 0 ? (
                <div className="veyra-card text-center py-6 text-[13px] text-[#6E6E6E]">
                  No completed blocks or goal-linked meetings recorded this week yet.
                </div>
              ) : (
                <div
                  className="space-y-3"
                  data-testid={
                    progressGrouping === 'goal' ? 'progress-group-goal' : 'progress-group-project'
                  }
                >
                  {groupedProgressFeed.map((group) => {
                    const isGoalGroup = 'goal' in group;
                    return (
                      <div key={group.key} className="veyra-card space-y-2.5">
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#2A2A2A]">
                          {isGoalGroup ? (
                            group.goal ? (
                              <GoalChip
                                name={group.goal.name}
                                kind={group.goal.kind}
                                color={group.goal.color}
                                onClick={() => openGoalDrawer(group.goal!.id)}
                              />
                            ) : (
                              <span className="text-[12.5px] font-medium text-[#9A9A9A]">
                                Unlinked to a goal
                              </span>
                            )
                          ) : group.project ? (
                            <button
                              type="button"
                              onClick={() => openProject(group.project!.id)}
                              className="inline-flex items-center gap-2 text-[13px] font-medium text-[#EDEDED] hover:text-[#AEB8FF] transition-colors"
                            >
                              <ProjectBadge
                                name={group.project.name}
                                color={group.project.color}
                                icon={group.project.icon}
                                size="xs"
                              />
                              <span>{group.project.name}</span>
                            </button>
                          ) : (
                            <span className="text-[12.5px] font-medium text-[#9A9A9A]">
                              Unassigned project
                            </span>
                          )}
                          <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                            {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                          </span>
                        </div>

                        <div>
                          {group.items.map((item) => {
                            const project = item.projectId
                              ? projectsById.get(item.projectId)
                              : undefined;
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
                                  className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-1.5 cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 rounded-[6px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#5566F2]"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Video size={12} className="text-[#9A9A9A] shrink-0" />
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
                                      <GoalChip
                                        name={goal.name}
                                        kind={goal.kind}
                                        color={goal.color}
                                      />
                                    ) : null}
                                    {item.isOps ? (
                                      <Pill tone="ops" icon={<Flame size={10} />}>
                                        Ops
                                      </Pill>
                                    ) : null}
                                  </div>

                                  {item.notes ? (
                                    <p className="text-[12.5px] text-[#9A9A9A] line-clamp-2">
                                      {item.notes}
                                    </p>
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
                                className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-1.5 cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 rounded-[6px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#5566F2]"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {project ? (
                                      <ProjectBadge
                                        name={project.name}
                                        color={project.color}
                                        icon={project.icon}
                                        size="xs"
                                      />
                                    ) : null}
                                    <span className="text-[13.5px] font-medium text-[#EDEDED] truncate">
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
                                    <GoalChip
                                      name={goal.name}
                                      kind={goal.kind}
                                      color={goal.color}
                                    />
                                  ) : null}
                                  {item.isOps ? (
                                    <Pill tone="ops" icon={<Flame size={10} />}>
                                      Ops
                                    </Pill>
                                  ) : null}
                                  <SensePill signal={item.senseSignal} />
                                  <EnergyPill signal={item.energySignal} />
                                </div>

                                {item.outcomeNote ? (
                                  <p className="text-[12.5px] text-[#C4C4C4]">{item.outcomeNote}</p>
                                ) : null}

                                {item.autoSummary ? (
                                  <div className="pt-1.5 flex items-center gap-1.5 text-[12px] leading-relaxed text-[#9A9A9A]">
                                    <Sparkles size={11} className="text-[#AEB8FF] shrink-0" />
                                    <p className="min-w-0 break-words">{item.autoSummary}</p>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Worth a second look (partly / motion blocks) */}
            {(data?.worthSecondLook.length ?? 0) > 0 ? (
              <section className="veyra-card space-y-3" aria-label="Worth a second look">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#F5A66B]">
                    Worth a second look
                  </h3>
                  <span className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                    {data?.worthSecondLook.length ?? 0} partly / motion
                  </span>
                </div>

                <div className="border-t border-[#2A2A2A]">
                  {(data?.worthSecondLook ?? []).map((block) => {
                    const proj = projectsById.get(block.projectId);
                    return (
                      <div
                        key={block.id}
                        className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openBlockDrawer(block.id)}
                            className="inline-flex items-center gap-2 text-left text-[13px] font-medium text-[#EDEDED] hover:text-[#AEB8FF] transition-colors min-w-0"
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
                          <SensePill signal={block.senseSignal} />
                        </div>
                        {block.outcomeNote ? (
                          <p className="text-[12px] text-[#9A9A9A]">{block.outcomeNote}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </section>

          {/* ================================================================= */}
          {/* CHAPTER 3 · WHERE DID THE TIME GO?                                */}
          {/* ================================================================= */}
          <section
            id="review-chapter-3"
            aria-label="Chapter 3: Where did the time go?"
            className="space-y-4 pt-2 scroll-mt-16"
          >
            <div className="space-y-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF]">
                3 · Where did the time go?
              </h2>
              <p className="font-display text-[19px] font-semibold text-[#EDEDED] leading-snug">
                {data?.chapterOpeningSentences?.time ??
                  'Compare real focus against your project weekly time intentions.'}
              </p>
            </div>

            {/* Projects Variance Table */}
            <section className="veyra-card space-y-4" aria-label="Project time breakdown">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                  Projects against weekly time
                </h3>
                <span className="text-[11.5px] text-[#6E6E6E]">
                  Weekly time is an intention, not a quota
                </span>
              </div>

              <ProjectVarianceTable
                buckets={data?.projectBuckets}
                projectsById={projectsById}
                goalsById={goalsById}
                onTrackExpanded={onTrackExpanded}
                onToggleOnTrack={() => setOnTrackExpanded((v) => !v)}
                onOpenProject={openProject}
              />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Ops & Automation Radar (leading icon inline on title line) */}
              <section
                className="lg:col-span-6 veyra-card space-y-3"
                aria-label="Ops and Automation Radar"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#F2D06B] inline-flex items-center gap-1.5">
                    <Flame size={12} className="shrink-0" />
                    <span>Ops &amp; Automation Radar</span>
                  </h3>
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
                      <div className="space-y-1">
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
                      <div className="space-y-1 pt-2 border-t border-[#2A2A2A]">
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

              {/* What your planning taught you */}
              <section
                className="lg:col-span-6 veyra-card space-y-3"
                aria-label="What your planning taught you"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF] inline-flex items-center gap-1.5">
                    <Lightbulb size={12} className="shrink-0" />
                    <span>What your planning taught you</span>
                  </h3>
                  <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                    {(data?.planningFindings ?? []).slice(0, 3).length} findings
                  </span>
                </div>

                {(data?.planningFindings.length ?? 0) === 0 ? (
                  <p className="text-[12.5px] text-[#6E6E6E]">
                    Patterns surface once at least 3 weeks of focus and planning history exist.
                  </p>
                ) : (
                  <div className="border-t border-[#2A2A2A]">
                    {(data?.planningFindings ?? []).slice(0, 3).map((finding) => (
                      <div
                        key={finding.kind}
                        className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-1.5"
                      >
                        <div className="text-[13px] font-medium text-[#EDEDED]">
                          {finding.title}
                        </div>
                        <p className="text-[12px] text-[#9A9A9A] leading-relaxed">
                          {finding.summary}
                        </p>
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() => handleSelectSuggestedRule(finding.suggestedRule)}
                            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] transition-colors"
                          >
                            <Sparkles size={10} />
                            <span>Use as rule: “{finding.suggestedRule}”</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>

          {/* ================================================================= */}
          {/* CHAPTER 4 · WHAT CHANGES NEXT WEEK?                               */}
          {/* ================================================================= */}
          <section
            id="review-chapter-4"
            aria-label="Chapter 4: What changes next week?"
            className="space-y-5 pt-2 scroll-mt-16"
          >
            <div className="space-y-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF]">
                4 · What changes next week?
              </h2>
              <p className="font-display text-[19px] font-semibold text-[#EDEDED] leading-snug">
                {data?.chapterOpeningSentences?.nextWeek ??
                  'Decide carryovers, tune project weekly times, and pick one rule for next week.'}
              </p>
            </div>

            {/* Two-column row: Backlog/Carryovers left, Weekly time for Week N+1 right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left: Backlog, Carryovers & Later Check-In */}
              <section
                className="lg:col-span-6 veyra-card space-y-3"
                aria-label="Backlog, Carryovers and Later Check-In"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E] inline-flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    <span>Backlog, Carryovers &amp; Later Check-In</span>
                  </h3>
                  <span className="text-[11.5px] text-[#6E6E6E] tabular-nums">
                    {checkInBlocks.length}
                  </span>
                </div>

                {checkInBlocks.length === 0 ? (
                  <div className="text-[12.5px] text-[#6E6E6E]">
                    No chronic carryovers (3+) or past-revisit Later items right now.
                  </div>
                ) : (
                  <ul className="border-t border-[#2A2A2A]">
                    {checkInBlocks.map(({ block, reason }) => {
                      const proj = projectsById.get(block.projectId);
                      return (
                        <li
                          key={block.id}
                          className="py-2.5 border-b border-[#2A2A2A] last:border-b-0 space-y-2"
                        >
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

              {/* Right: Weekly time for Week N+1 (inline editable) */}
              <section
                className="lg:col-span-6 veyra-card space-y-3"
                aria-label="Weekly time for next week"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
                    Weekly time for Week {nextWeekNumber}
                  </h3>
                  <span className="text-[11.5px] text-[#9A9A9A] tabular-nums">
                    {formatDuration(totalNextWeekPlannedMinutes)} planned /{' '}
                    {formatDuration(data?.roomMinutesTotal ?? 0)} room
                  </span>
                </div>

                {editableProjects.length === 0 ? (
                  <div className="text-[12.5px] text-[#6E6E6E]">No active projects to plan.</div>
                ) : (
                  <div className="border-t border-[#2A2A2A]">
                    {editableProjects.map((project) => {
                      const draftVal =
                        projectTimeDrafts[project.id] ??
                        formatHoursInputValue(project.weeklyTimeMinutes);
                      return (
                        <div
                          key={project.id}
                          className="py-2 border-b border-[#2A2A2A] last:border-b-0 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ProjectBadge
                              name={project.name}
                              color={project.color}
                              icon={project.icon}
                              size="xs"
                            />
                            <span className="text-[13px] text-[#EDEDED] truncate">
                              {project.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="80"
                              aria-label={`Weekly time hours for ${project.name}`}
                              value={draftVal}
                              onChange={(e) => {
                                dirtyProjectTimesRef.current.add(project.id);
                                setProjectTimeDrafts((prev) => ({
                                  ...prev,
                                  [project.id]: e.target.value,
                                }));
                              }}
                              onBlur={() => handleCommitProjectTime(project)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleCommitProjectTime(project);
                                }
                              }}
                              placeholder="–"
                              className="w-16 h-7 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-right text-[12.5px] text-[#EDEDED] tabular-nums focus:outline-none"
                            />
                            <span className="text-[11.5px] text-[#6E6E6E] w-8">h/wk</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Rule for next week — DIRECTLY on #131313 canvas (ZERO card-in-card) */}
            <div
              data-testid="review-rule-canvas"
              className="pt-5 border-t border-[#2A2A2A] space-y-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label
                  htmlFor="review-next-week-rule"
                  className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF] inline-flex items-center gap-1.5"
                >
                  <Sparkles size={12} />
                  <span>Rule for next week</span>
                </label>
                {ruleSaved ? (
                  <Pill tone="energy-up" icon={<Check size={10} />}>
                    Saved for next week
                  </Pill>
                ) : null}
              </div>

              {(data?.ruleSuggestions.length ?? 0) > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {(data?.ruleSuggestions ?? []).slice(0, 3).map((suggestion) => {
                    const selected = ruleDraft.trim() === suggestion.trim();
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSelectSuggestedRule(suggestion)}
                        className={[
                          'px-3 py-1.5 rounded-[8px] border text-[12px] transition-colors text-left',
                          selected
                            ? 'bg-[#1F2759] border-[#5566F2] text-[#D6DCFF]'
                            : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E] hover:text-[#EDEDED]',
                        ].join(' ')}
                      >
                        {suggestion}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <form onSubmit={handleRuleSubmit} className="flex items-center gap-2.5 flex-wrap">
                <input
                  ref={ruleInputRef}
                  id="review-next-week-rule"
                  type="text"
                  value={ruleDraft}
                  onChange={(e) => setRuleDraft(e.target.value)}
                  placeholder="One calm rule to carry into Monday’s Today header…"
                  className="flex-1 min-w-[260px] h-10 px-3.5 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={saveRuleMutation.isPending}
                >
                  Save Rule
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  leftIcon={<CheckCircle2 size={15} />}
                  disabled={completeReviewMutation.isPending}
                  onClick={() => completeReviewMutation.mutate()}
                >
                  Complete Review
                </Button>
              </form>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goal Conditional Prompts (Check-in Due, 2 Quiet Weeks, Stalled)
// ---------------------------------------------------------------------------

function GoalConditionalPrompts({
  goal,
  nextMonday,
  defaultDeferDate,
  quietDismissed,
  activeDatePicker,
  isSaving,
  onOpenCloseGoal,
  onOpenCreateBlock,
  onStartDatePicker,
  onChangeDatePicker,
  onCancelDatePicker,
  onSaveDatePicker,
  onDismissQuiet,
}: {
  goal: GoalReviewItem;
  nextMonday: string;
  defaultDeferDate: string;
  quietDismissed: boolean;
  activeDatePicker: { goalId: string; mode: 'continue' | 'pause'; date: string } | null;
  isSaving: boolean;
  onOpenCloseGoal: (goalId: string, initialStatus?: 'achieved' | 'archived') => void;
  onOpenCreateBlock: (defaults?: { goalId?: string | null; scheduledDate?: string | null }) => void;
  onStartDatePicker: (mode: 'continue' | 'pause', initialDate: string) => void;
  onChangeDatePicker: (date: string) => void;
  onCancelDatePicker: () => void;
  onSaveDatePicker: (checkInDate: string) => void;
  onDismissQuiet: () => void;
}) {
  const showCheckIn = goal.isCheckInDue;
  const showQuiet = !showCheckIn && goal.isQuietTwoWeeks;
  const showStalled = goal.isStalled && Boolean(goal.ifItStalls.trim());

  if (!showCheckIn && !showQuiet && !showStalled) return null;

  return (
    <div className="pt-2 border-t border-[#262626] space-y-2">
      {showCheckIn ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12px] text-[#F5A66B]">
              Check-in date reached
              {goal.checkInDate ? ` (${formatShortDate(goal.checkInDate)})` : ''} — how do you want
              to proceed?
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="accent-soft"
                size="xs"
                onClick={() => onOpenCloseGoal(goal.goalId, 'achieved')}
              >
                Mark Achieved
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onStartDatePicker('continue', defaultDeferDate)}
              >
                Continue until…
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onOpenCloseGoal(goal.goalId, 'archived')}
              >
                Let Go
              </Button>
            </div>
          </div>

          {activeDatePicker?.mode === 'continue' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                aria-label={`Continue until date for ${goal.name}`}
                value={activeDatePicker.date}
                onChange={(e) => onChangeDatePicker(e.target.value)}
                className="h-7 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
              />
              <Button
                variant="primary"
                size="xs"
                disabled={!activeDatePicker.date || isSaving}
                onClick={() => onSaveDatePicker(activeDatePicker.date)}
              >
                Save date
              </Button>
              <Button variant="ghost" size="xs" onClick={onCancelDatePicker}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showQuiet ? (
        quietDismissed ? (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12px] text-[#9A9A9A]">Kept active for next week.</span>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<CalendarPlus size={11} />}
              onClick={() =>
                onOpenCreateBlock({ goalId: goal.goalId, scheduledDate: nextMonday })
              }
            >
              + Queue Monday block
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] text-[#9A9A9A]">
                2 quiet weeks — keep active, defer check-in, or let go?
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button variant="secondary" size="xs" onClick={onDismissQuiet}>
                  Keep
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onStartDatePicker('pause', defaultDeferDate)}
                >
                  Pause
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onOpenCloseGoal(goal.goalId, 'archived')}
                >
                  Let Go
                </Button>
              </div>
            </div>

            {activeDatePicker?.mode === 'pause' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11.5px] text-[#9A9A9A]">Defer check-in to:</span>
                <input
                  type="date"
                  aria-label={`Defer check-in date for ${goal.name}`}
                  value={activeDatePicker.date}
                  onChange={(e) => onChangeDatePicker(e.target.value)}
                  className="h-7 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                />
                <Button
                  variant="primary"
                  size="xs"
                  disabled={!activeDatePicker.date || isSaving}
                  onClick={() => onSaveDatePicker(activeDatePicker.date)}
                >
                  Save check-in
                </Button>
                <Button variant="ghost" size="xs" onClick={onCancelDatePicker}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {showStalled ? (
        <div className="text-[12px] text-[#9A9A9A]">
          <span className="text-[#6E6E6E] mr-1">If it stalls:</span>
          {goal.ifItStalls}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter 3 · Project Variance Table
// ---------------------------------------------------------------------------

function ProjectVarianceTable({
  buckets,
  projectsById,
  goalsById,
  onTrackExpanded,
  onToggleOnTrack,
  onOpenProject,
}: {
  buckets: ReviewResponse['projectBuckets'] | undefined;
  projectsById: Map<string, ProjectWithStats>;
  goalsById: Map<string, Goal>;
  onTrackExpanded: boolean;
  onToggleOnTrack: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const visibleGroups: Array<{ label: string; items: ProjectReviewBucketItem[] }> = [
    { label: 'More than planned', items: buckets?.moreThanPlanned ?? [] },
    { label: 'Less than planned', items: buckets?.lessThanPlanned ?? [] },
    { label: 'Wanted but untouched', items: buckets?.wantedUntouched ?? [] },
    { label: 'Time without a plan', items: buckets?.timeWithoutPlan ?? [] },
  ].filter((g) => g.items.length > 0);

  const onTrackItems = buckets?.onTrack ?? [];

  if (visibleGroups.length === 0 && onTrackItems.length === 0) {
    return (
      <div className="text-[13px] text-[#6E6E6E]">
        No project focus or weekly time plans recorded for this week yet.
      </div>
    );
  }

  const renderRows = (items: ProjectReviewBucketItem[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#2A2A2A] text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            <th className="py-1.5 pr-3">Project</th>
            <th className="py-1.5 px-2 text-right">Weekly time</th>
            <th className="py-1.5 px-2 text-right">Real</th>
            <th className="py-1.5 px-2 text-right">Diff</th>
            <th className="py-1.5 px-2 text-right">Blocks</th>
            <th className="py-1.5 px-2 text-right">Carry</th>
            <th className="py-1.5 pl-2 text-right">4w</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const proj = projectsById.get(item.projectId);
            const goal = proj?.defaultGoalId ? goalsById.get(proj.defaultGoalId) : undefined;
            return (
              <tr
                key={item.projectId}
                className="border-b border-[#2A2A2A] last:border-b-0 text-[12.5px]"
              >
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {proj ? (
                      <button
                        type="button"
                        onClick={() => onOpenProject(proj.id)}
                        className="inline-flex items-center gap-2 text-[#EDEDED] font-medium hover:text-[#AEB8FF] transition-colors"
                      >
                        <ProjectBadge
                          name={proj.name}
                          color={proj.color}
                          icon={proj.icon}
                          size="xs"
                        />
                        <span>{proj.name}</span>
                      </button>
                    ) : (
                      <span className="text-[#EDEDED]">{item.projectId}</span>
                    )}
                    {goal ? (
                      <GoalChip name={goal.name} kind={goal.kind} color={goal.color} />
                    ) : null}
                  </div>
                </td>
                <td className="py-2.5 px-2 text-right text-[#9A9A9A] tabular-nums whitespace-nowrap">
                  {item.weeklyTimeMinutes !== null ? formatDuration(item.weeklyTimeMinutes) : '–'}
                </td>
                <td className="py-2.5 px-2 text-right text-[#EDEDED] font-medium tabular-nums whitespace-nowrap">
                  {formatDuration(item.realMinutes)}
                </td>
                <td className="py-2.5 px-2 text-right text-[#C4C4C4] tabular-nums whitespace-nowrap">
                  {formatSignedDuration(item.differenceMinutes)}
                </td>
                <td className="py-2.5 px-2 text-right text-[#9A9A9A] tabular-nums">
                  {item.blockCount}
                </td>
                <td className="py-2.5 px-2 text-right text-[#9A9A9A] tabular-nums">
                  {item.carryoverCount}
                </td>
                <td className="py-2.5 pl-2 text-right">
                  <MiniSparkline values={item.trend4w} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      {visibleGroups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="text-[11.5px] font-semibold text-[#C4C4C4]">{group.label}</div>
          {renderRows(group.items)}
        </div>
      ))}

      {onTrackItems.length > 0 ? (
        <div className="pt-2 border-t border-[#2A2A2A] space-y-2">
          <button
            type="button"
            aria-expanded={onTrackExpanded}
            onClick={onToggleOnTrack}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] transition-colors"
          >
            {onTrackExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>On track ({onTrackItems.length})</span>
          </button>
          {onTrackExpanded ? renderRows(onTrackItems) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ops & Automation Radar List (strict inline title icons)
// ---------------------------------------------------------------------------

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
    <ul className="border-t border-[#262626]">
      {items.map((item) => {
        const proj = projectsById.get(item.projectId);
        const latestBlockId = item.blockIds[item.blockIds.length - 1];
        const summaries = item.autoSummaries ?? [];
        const visibleSummaries = summaries.slice(0, 2);
        const hiddenCount = summaries.length - visibleSummaries.length;
        return (
          <li key={item.key} className="py-2.5 border-b border-[#262626] last:border-b-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => latestBlockId && onOpenBlock(latestBlockId)}
                className="inline-flex items-center gap-2 min-w-0 text-left hover:text-[#AEB8FF] transition-colors"
              >
                <Flame size={12} className="text-[#F2D06B] shrink-0" aria-hidden="true" />
                {proj ? (
                  <ProjectBadge
                    name={proj.name}
                    color={proj.color}
                    icon={proj.icon}
                    size="xs"
                  />
                ) : null}
                <span className="text-[12.5px] font-medium text-[#EDEDED] truncate">
                  {item.title}
                </span>
              </button>
              <span className="text-[11.5px] text-[#9A9A9A] tabular-nums shrink-0">
                {item.occurrenceCount > 1 ? `×${item.occurrenceCount} · ` : ''}
                {formatDuration(item.totalMinutes)}
              </span>
            </div>
            {visibleSummaries.length > 0 ? (
              <div className="space-y-1">
                {visibleSummaries.map((summary, idx) => (
                  <div
                    key={`${item.key}-sum-${idx}`}
                    className="flex items-center gap-1.5 text-[11.5px] leading-snug text-[#9A9A9A]"
                  >
                    <Sparkles size={10} className="text-[#F2D06B]/75 shrink-0" />
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

// ---------------------------------------------------------------------------
// State 5 · Completed & Auto-Synced View
// ---------------------------------------------------------------------------

function CompletedReviewView({
  data,
  weekNumber,
  copiedMarkdown,
  onCopyMarkdown,
  onReopen,
  isReopening,
  onOpenGoal,
}: {
  data: ReviewResponse;
  weekNumber: number;
  copiedMarkdown: boolean;
  onCopyMarkdown: (snapshot: WeeklyReviewSnapshot) => void;
  onReopen: () => void;
  isReopening: boolean;
  onOpenGoal: (goalId: string) => void;
}) {
  const snapshot: WeeklyReviewSnapshot = data.snapshot ?? {
    weekStartDate: data.weekStartDate,
    weekEndDate: data.weekEndDate,
    weekNumber,
    completedAt: data.completedAt ?? new Date().toISOString(),
    totalFocusMinutes: data.totalFocusMinutes,
    roomMinutesTotal: data.roomMinutesTotal,
    plannedMinutesTotal: data.plannedMinutesTotal,
    goalAlignmentPct: data.goalAlignmentPct,
    companyGoalPct: data.companyGoalPct,
    personalGoalPct: data.personalGoalPct,
    buildMinutes: data.buildMinutes,
    opsMinutes: data.opsMinutes,
    senseCounts: data.senseCounts,
    energyCounts: data.energyCounts,
    previousRuleText: data.activeRuleText,
    previousRuleKept: data.previousRuleKept,
    ruleForNextWeek: data.ruleForNextWeek ?? '',
    goalsMoved: data.goalReviews.map((g) => ({
      goalId: g.goalId,
      name: g.name,
      kind: g.kind,
      color: g.color,
      focusMinutes: g.focusMinutes,
      blockCount: g.blockCount,
      movedCount: g.senseCounts.moved,
      measure: g.measure,
      topOutcomes: g.topOutcomes,
    })),
    projectWeeklyTimes: [],
  };

  return (
    <div className="space-y-5">
      {/* Wrapped & Auto-Synced Banner */}
      <section
        className="veyra-card border-[#2E9E6F]/40 flex items-center justify-between gap-4 flex-wrap"
        aria-label="Review completed banner"
      >
        <div className="space-y-1 min-w-0">
          <div className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#EDEDED]">
            <CheckCircle2 size={16} className="text-[#7BE0A0] shrink-0" />
            <span>Week {snapshot.weekNumber} wrapped · automatically synced to T3 Code</span>
          </div>
          <p className="text-[12.5px] text-[#9A9A9A]">
            Snapshot saved to SQLite and dispatched via{' '}
            <code className="text-[#AEB8FF]">review.completed</code> hook so Monday picks up your
            rule automatically.
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RotateCcw size={12} />}
          disabled={isReopening}
          onClick={onReopen}
        >
          Reopen review
        </Button>
      </section>

      {/* Snapshot Card */}
      <section className="veyra-card space-y-4" aria-label="Weekly Review Snapshot">
        <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-[#2A2A2A]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#AEB8FF]">
            WEEK {snapshot.weekNumber} SNAPSHOT · AUTO-SYNCED VIA LOCAL HOOK
          </div>
          <Button
            variant="secondary"
            size="xs"
            leftIcon={copiedMarkdown ? <Check size={11} /> : <Copy size={11} />}
            onClick={() => onCopyMarkdown(snapshot)}
          >
            {copiedMarkdown ? 'Copied Markdown' : 'Copy Markdown'}
          </Button>
        </div>

        {/* Section 1: Focus & rhythm (inline title icon) */}
        <div className="pb-4 border-b border-[#2A2A2A] space-y-2">
          <h3 className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#EDEDED]">
            <Clock size={14} className="text-[#AEB8FF] shrink-0" />
            <span>Focus &amp; rhythm</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[12.5px] text-[#C4C4C4] tabular-nums">
            <div>
              <span className="text-[#6E6E6E] block text-[11px] uppercase">Focus</span>
              <span>
                {formatDuration(snapshot.totalFocusMinutes)} / room{' '}
                {formatDuration(snapshot.roomMinutesTotal)}
              </span>
            </div>
            <div>
              <span className="text-[#6E6E6E] block text-[11px] uppercase">Goals</span>
              <span>
                {snapshot.goalAlignmentPct}% (Company {snapshot.companyGoalPct}% · Personal{' '}
                {snapshot.personalGoalPct}%)
              </span>
            </div>
            <div>
              <span className="text-[#6E6E6E] block text-[11px] uppercase">Sense</span>
              <span>
                {snapshot.senseCounts.moved} moved · {snapshot.senseCounts.partly} partly ·{' '}
                {snapshot.senseCounts.motion} motion
              </span>
            </div>
            <div>
              <span className="text-[#6E6E6E] block text-[11px] uppercase">Energy</span>
              <span>
                {snapshot.energyCounts.up}+ · {snapshot.energyCounts.neutral}· ·{' '}
                {snapshot.energyCounts.down}−
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Goals moved (inline title icon + GoalChip) */}
        <div className="pb-4 border-b border-[#2A2A2A] space-y-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#EDEDED]">
            <Target size={14} className="text-[#7BE0A0] shrink-0" />
            <span>Goals moved</span>
          </h3>
          {snapshot.goalsMoved.length === 0 ? (
            <p className="text-[12.5px] text-[#6E6E6E]">No goal focus recorded this week.</p>
          ) : (
            <div>
              {snapshot.goalsMoved.map((goal) => (
                <div
                  key={goal.goalId}
                  className="py-2 border-b border-[#262626] last:border-b-0 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <GoalChip
                      name={goal.name}
                      kind={goal.kind}
                      color={goal.color}
                      onClick={() => onOpenGoal(goal.goalId)}
                    />
                    <span className="text-[12px] text-[#9A9A9A] tabular-nums">
                      {formatDuration(goal.focusMinutes)} · {goal.blockCount} blocks ·{' '}
                      {goal.movedCount} moved
                      {goal.measure ? ` · ${goal.measure}` : ''}
                    </span>
                  </div>
                  {goal.topOutcomes.length > 0 ? (
                    <div className="text-[12px] text-[#C4C4C4] pl-1">
                      {goal.topOutcomes.join(' · ')}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: Week N+1 commitments (inline title icon) */}
        <div className="space-y-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#EDEDED]">
            <CalendarCheck2 size={14} className="text-[#AEB8FF] shrink-0" />
            <span>Week {getNextIsoWeekNumber(snapshot.weekStartDate)} commitments</span>
          </h3>

          <div className="text-[13px] text-[#EDEDED]">
            <span className="text-[#9A9A9A] mr-1.5">Rule for next week:</span>
            <span className="font-medium">
              {snapshot.ruleForNextWeek || 'No rule set for next week'}
            </span>
          </div>

          {snapshot.projectWeeklyTimes.length > 0 ? (
            <div className="pt-1 border-t border-[#262626]">
              {snapshot.projectWeeklyTimes.map((proj) => (
                <div
                  key={proj.projectId}
                  className="py-1.5 border-b border-[#262626] last:border-b-0 flex items-center justify-between text-[12.5px] tabular-nums"
                >
                  <span className="text-[#EDEDED]">{proj.name}</span>
                  <span className="text-[#9A9A9A]">
                    {proj.weeklyTimeMinutes !== null
                      ? `${formatDuration(proj.weeklyTimeMinutes)} / wk`
                      : 'No plan'}{' '}
                    <span className="text-[#6E6E6E]">
                      (this week {formatDuration(proj.realMinutes)})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
