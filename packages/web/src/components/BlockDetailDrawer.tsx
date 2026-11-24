import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  BlockDetail,
  ExternalLink,
  FocusSession,
  RecurrenceRule,
  UpdateBlockInput,
} from '@veyra/core/types';
import {
  Archive,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Clock,
  Copy,
  Flame,
  Inbox,
  Link2,
  MoreHorizontal,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Scissors,
  Square,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import {
  invalidateBlockRelated,
  useBlockDetailQuery,
  useGoalsQuery,
  useProjectsQuery,
} from '../api/queries';
import { AutoSummarySection } from './AutoSummarySection';
import { Button } from './Button';
import { DockedDrawer } from './DockedDrawer';
import { LinkChip, inferLinkSource, inferLinkTitle } from './LinkChip';
import { goalChipStyle } from './goalTint';
import { Pill } from './Pill';
import { ProjectBadge } from './ProjectBadge';
import {
  addDaysDateString,
  formatDuration,
  formatLocalTime,
  formatShortDate,
  formatTimeRange,
  getSessionDurationMinutes,
  getTodayDateString,
} from './icons';

export interface BlockDetailDrawerProps {
  blockId: string | null;
  onClose: () => void;
  onStartFocus?: (blockId: string) => void;
}

interface ParsedChecklistLine {
  lineIndex: number;
  checked: boolean;
  label: string;
}

function parseChecklistLines(markdown: string): ParsedChecklistLine[] {
  const lines = markdown.split('\n');
  const items: ParsedChecklistLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i]);
    if (match) {
      items.push({
        lineIndex: i,
        checked: match[1].toLowerCase() === 'x',
        label: match[2],
      });
    }
  }
  return items;
}

function toggleChecklistLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return markdown;
  lines[lineIndex] = line.replace(
    /^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/,
    (_full, prefix: string, state: string, suffix: string) =>
      `${prefix}${state.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}`,
  );
  return lines.join('\n');
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

function getSessionLocalDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return getTodayDateString(dt);
}

const RECURRENCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No repeat' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'days:[mon,wed,fri]', label: 'Mon / Wed / Fri' },
  { value: 'days:[tue,thu]', label: 'Tue / Thu' },
];

export function BlockDetailDrawer({ blockId, onClose, onStartFocus }: BlockDetailDrawerProps) {
  const queryClient = useQueryClient();
  const detailQuery = useBlockDetailQuery(blockId);
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const goalsQuery = useGoalsQuery({ includeArchived: false });

  const block: BlockDetail | undefined = detailQuery.data?.block;
  const projects = projectsQuery.data?.projects ?? [];
  const goals = goalsQuery.data?.goals ?? [];

  const [titleDraft, setTitleDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    'project' | 'goal' | 'schedule' | 'due' | 'repeat' | null
  >(null);

  // Add link inline state
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  // Log time inline state
  const [loggingTime, setLoggingTime] = useState(false);
  const [logStart, setLogStart] = useState('');
  const [logEnd, setLogEnd] = useState('');
  const [logNote, setLogNote] = useState('');
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Edit session inline state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editNote, setEditNote] = useState('');
  const [splittingSessionId, setSplittingSessionId] = useState<string | null>(null);
  const [splitBreakStart, setSplitBreakStart] = useState('');
  const [splitBreakMinutes, setSplitBreakMinutes] = useState('15');

  const menuRef = useRef<HTMLDivElement>(null);
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
      if (e.key === 'Escape') {
        setOpenPicker(null);
      }
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
    el.style.height = `${Math.max(150, el.scrollHeight)}px`;
  }, [notesDraft, blockId]);

  useEffect(() => {
    if (!block) return;
    setTitleDraft(block.title);
    setNotesDraft(block.notes);
    setSaveState('idle');
  }, [block?.id, block?.updatedAt]);

  useEffect(() => {
    if (!blockId) {
      setMenuOpen(false);
      setAddingLink(false);
      setLoggingTime(false);
      setEditingSessionId(null);
      setSplittingSessionId(null);
    }
  }, [blockId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateBlockInput) => apiClient.updateBlock(blockId!, input),
    onMutate: () => setSaveState('saving'),
    onSuccess: () => {
      setSaveState('saved');
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1400);
    },
    onError: () => setSaveState('idle'),
  });

  const moveMutation = useMutation({
    mutationFn: (input: Parameters<typeof apiClient.moveBlock>[1]) =>
      apiClient.moveBlock(blockId!, input),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
  });

  const parkMutation = useMutation({
    mutationFn: (revisitAt: '2w' | 'next-week' | 'next-month') =>
      apiClient.parkBlock(blockId!, { revisitAt }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      onClose();
    },
  });

  const dropMutation = useMutation({
    mutationFn: (stopSeries?: boolean) => apiClient.dropBlock(blockId!, { stopSeries }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
      onClose();
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => apiClient.completeFocus({ blockId: blockId! }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiClient.reopenBlock(blockId!),
    onSuccess: () => {
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () =>
      apiClient.createBlock({
        title: `${block!.title} (copy)`,
        projectId: block!.projectId,
        goalId: block!.goalId,
        isOps: block!.isOps,
        bucket: block!.bucket,
        scheduledDate: block!.scheduledDate,
        dueDate: block!.dueDate,
        notes: block!.notes,
        externalLinks: block!.externalLinks,
      }),
    onSuccess: () => {
      invalidateBlockRelated(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteBlock(blockId!),
    onSuccess: () => {
      invalidateBlockRelated(queryClient);
      onClose();
    },
  });

  const logSessionMutation = useMutation({
    mutationFn: (input: { startedAt: string; endedAt: string; note?: string | null }) =>
      apiClient.logSession({ blockId: blockId!, ...input }),
    onSuccess: () => {
      setLoggingTime(false);
      setLogNote('');
      setSessionError(null);
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
    onError: (err) => {
      setSessionError(err instanceof Error ? err.message : 'Failed to log session');
    },
  });

  const trimSessionMutation = useMutation({
    mutationFn: (args: { id: string; startedAt: string; endedAt: string; note?: string | null }) =>
      apiClient.trimSession(args.id, {
        startedAt: args.startedAt,
        endedAt: args.endedAt,
        note: args.note,
      }),
    onSuccess: () => {
      setEditingSessionId(null);
      setSessionError(null);
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
    onError: (err) => {
      setSessionError(err instanceof Error ? err.message : 'Failed to update session');
    },
  });

  const splitSessionMutation = useMutation({
    mutationFn: (args: { id: string; breakStartAt: string; breakMinutes: number }) =>
      apiClient.splitSession(args.id, {
        breakStartAt: args.breakStartAt,
        breakMinutes: args.breakMinutes,
      }),
    onSuccess: () => {
      setSplittingSessionId(null);
      setSessionError(null);
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
    onError: (err) => {
      setSessionError(err instanceof Error ? err.message : 'Failed to split session');
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteSession(id),
    onSuccess: () => {
      setEditingSessionId(null);
      invalidateBlockRelated(queryClient, blockId ?? undefined);
    },
  });

  const flushPendingEdits = useCallback(() => {
    if (!block) return;
    const patch: UpdateBlockInput = {};
    const trimmedTitle = titleDraft.trim();
    if (trimmedTitle && trimmedTitle !== block.title) {
      patch.title = trimmedTitle;
    }
    if (notesDraft !== block.notes) {
      patch.notes = notesDraft;
    }
    if (Object.keys(patch).length > 0) {
      updateMutation.mutate(patch);
    }
  }, [block, titleDraft, notesDraft, updateMutation]);

  // Listen for global ⌘S save shortcut
  useEffect(() => {
    if (!blockId) return;
    const onGlobalSave = () => flushPendingEdits();
    window.addEventListener('veyra:save', onGlobalSave);
    return () => window.removeEventListener('veyra:save', onGlobalSave);
  }, [blockId, flushPendingEdits]);

  const checklistItems = useMemo(() => parseChecklistLines(notesDraft), [notesDraft]);

  const handleToggleChecklist = (lineIndex: number) => {
    const nextNotes = toggleChecklistLine(notesDraft, lineIndex);
    setNotesDraft(nextNotes);
    updateMutation.mutate({ notes: nextNotes });
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
      setLinkError('Enter a valid URL (e.g. https://notion.so/...)');
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
    updateMutation.mutate({ externalLinks: [...block.externalLinks, nextLink] });
  };

  const handleRemoveLink = (index: number) => {
    if (!block) return;
    const next = block.externalLinks.filter((_, i) => i !== index);
    updateMutation.mutate({ externalLinks: next });
  };

  const openLogTimeForm = () => {
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 60_000);
    setLogStart(toDatetimeLocalValue(thirtyAgo.toISOString()));
    setLogEnd(toDatetimeLocalValue(now.toISOString()));
    setLogNote('');
    setSessionError(null);
    setLoggingTime(true);
  };

  const handleLogSessionSubmit = (e: FormEvent) => {
    e.preventDefault();
    const s = fromDatetimeLocalValue(logStart);
    const en = fromDatetimeLocalValue(logEnd);
    if (!s || !en || Date.parse(en) <= Date.parse(s)) {
      setSessionError('End time must be after start time.');
      return;
    }
    logSessionMutation.mutate({
      startedAt: s,
      endedAt: en,
      note: logNote.trim() || null,
    });
  };

  const startEditSession = (session: FocusSession) => {
    setSplittingSessionId(null);
    setEditingSessionId(session.id);
    setEditStart(toDatetimeLocalValue(session.startedAt));
    setEditEnd(toDatetimeLocalValue(session.endedAt ?? new Date().toISOString()));
    setEditNote(session.note ?? '');
    setSessionError(null);
  };

  const handleTrimSubmit = (e: FormEvent, sessionId: string) => {
    e.preventDefault();
    const s = fromDatetimeLocalValue(editStart);
    const en = fromDatetimeLocalValue(editEnd);
    if (!s || !en || Date.parse(en) <= Date.parse(s)) {
      setSessionError('End time must be after start time.');
      return;
    }
    trimSessionMutation.mutate({
      id: sessionId,
      startedAt: s,
      endedAt: en,
      note: editNote.trim() || null,
    });
  };

  const startSplitSession = (session: FocusSession) => {
    setEditingSessionId(null);
    setSplittingSessionId(session.id);
    const sMs = Date.parse(session.startedAt);
    const eMs = session.endedAt ? Date.parse(session.endedAt) : Date.now();
    const midMs = sMs + Math.floor((eMs - sMs) / 2);
    setSplitBreakStart(toDatetimeLocalValue(new Date(midMs).toISOString()));
    setSplitBreakMinutes('15');
    setSessionError(null);
  };

  const handleSplitSubmit = (e: FormEvent, sessionId: string) => {
    e.preventDefault();
    const breakIso = fromDatetimeLocalValue(splitBreakStart);
    const mins = Number.parseInt(splitBreakMinutes, 10);
    if (!breakIso || Number.isNaN(mins) || mins < 1) {
      setSessionError('Provide a valid break start time and duration.');
      return;
    }
    splitSessionMutation.mutate({
      id: sessionId,
      breakStartAt: breakIso,
      breakMinutes: mins,
    });
  };

  const todayStr = getTodayDateString();
  const tomorrowStr = addDaysDateString(todayStr, 1);
  const currentProject = block ? projects.find((p) => p.id === block.projectId) : undefined;
  const currentGoal = block?.goalId ? goals.find((g) => g.id === block.goalId) : undefined;

  const scheduleSelectValue = useMemo(() => {
    if (!block) return 'inbox';
    if (block.bucket === 'inbox') return 'inbox';
    if (block.bucket === 'later') return 'later';
    if (block.scheduledDate === todayStr) return 'today';
    if (block.scheduledDate === tomorrowStr) return 'tomorrow';
    return 'custom';
  }, [block, todayStr, tomorrowStr]);

  const handleScheduleModeChange = (value: string) => {
    if (value === 'today') {
      moveMutation.mutate({ bucket: 'scheduled', scheduledDate: todayStr });
    } else if (value === 'tomorrow') {
      moveMutation.mutate({ bucket: 'scheduled', scheduledDate: tomorrowStr });
    } else if (value === 'inbox') {
      moveMutation.mutate({ bucket: 'inbox', scheduledDate: null });
    } else if (value === 'later') {
      moveMutation.mutate({ bucket: 'later', revisitAt: '2w' });
    }
  };

  const handleProjectChange = (projectId: string) => {
    const nextProject = projects.find((p) => p.id === projectId);
    const patch: UpdateBlockInput = { projectId };
    if (nextProject && !block?.goalId && nextProject.defaultGoalId) {
      patch.goalId = nextProject.defaultGoalId;
    }
    updateMutation.mutate(patch);
  };

  const scheduleLabel = useMemo(() => {
    if (!block) return 'Inbox';
    if (block.bucket === 'inbox') return 'Inbox';
    if (block.bucket === 'later') {
      return block.revisitAt ? `Later · ${formatShortDate(block.revisitAt)}` : 'Later';
    }
    if (block.scheduledDate === todayStr) return `Today · ${formatShortDate(todayStr)}`;
    if (block.scheduledDate === tomorrowStr) return `Tomorrow · ${formatShortDate(tomorrowStr)}`;
    return block.scheduledDate ? formatShortDate(block.scheduledDate) : 'Scheduled';
  }, [block, todayStr, tomorrowStr]);

  const repeatLabel = useMemo(() => {
    if (!block?.recurrenceRule) return 'Repeat';
    return RECURRENCE_OPTIONS.find((o) => o.value === block.recurrenceRule)?.label ?? 'Repeat';
  }, [block?.recurrenceRule]);

  const displayTotalFocusMinutes = useMemo(() => {
    if (!block) return 0;
    const summed = block.sessions.reduce(
      (acc, s) => acc + getSessionDurationMinutes(s.startedAt, s.endedAt),
      0,
    );
    return Math.max(block.totalFocusMinutes, summed);
  }, [block]);

  const headerActions = block ? (
    <div className="flex items-center gap-1.5 relative" ref={menuRef}>
      {saveState === 'saving' ? (
        <span className="text-[11px] text-[#6E6E6E] mr-1">Saving…</span>
      ) : saveState === 'saved' ? (
        <span className="text-[11px] text-[#7BE0A0] inline-flex items-center gap-1 mr-1">
          <Check size={11} /> Saved
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        title="Delete block"
        aria-label="Delete block"
        className="h-7 w-7 rounded-[7px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#FF9EC5] hover:border-[#EC659B]/50 hover:bg-[#3D1A2B]/50 transition-colors"
      >
        <Trash2 size={14} />
      </button>

      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Block actions"
        className="h-7 w-7 rounded-[7px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252] transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>

      {menuOpen ? (
        <div className="absolute right-0 top-9 z-30 w-48 p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)]">
          {block.status === 'todo' ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                completeMutation.mutate();
              }}
              className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center gap-2.5"
            >
              <CheckCircle2 size={13} className="text-[#7BE0A0]" />
              Mark complete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                reopenMutation.mutate();
              }}
              className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center gap-2.5"
            >
              <RotateCcw size={13} className="text-[#AEB8FF]" />
              Reopen block
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              duplicateMutation.mutate();
            }}
            className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center gap-2.5"
          >
            <Copy size={13} className="text-[#9A9A9A]" />
            Duplicate block
          </button>
          {block.recurrenceRule ? (
            <>
              <div className="my-1 border-t border-[#2E2E2E]" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  dropMutation.mutate(true);
                }}
                className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#FF9EC5] hover:bg-[#3D1A2B]/60 flex items-center gap-2.5"
              >
                <Repeat size={13} />
                Stop recurring series
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <DockedDrawer
      open={Boolean(blockId)}
      onClose={() => {
        flushPendingEdits();
        onClose();
      }}
      width={520}
      ariaLabel="Block detail"
      title={
        block ? (
          <div className="flex items-center gap-2">
            {currentProject ? (
              <ProjectBadge
                name={currentProject.name}
                color={currentProject.color}
                icon={currentProject.icon}
                size="xs"
              />
            ) : null}
            <span className="text-[12.5px] font-medium text-[#9A9A9A] truncate">
              {currentProject?.name ?? 'Block'}
            </span>
            {block.status === 'done' ? (
              <Pill tone="energy-up" dot>
                Done
              </Pill>
            ) : block.status === 'dropped' ? (
              <Pill tone="neutral">Dropped</Pill>
            ) : null}
            {block.carryoverCount > 0 ? (
              <Pill tone="due">Carried ×{block.carryoverCount}</Pill>
            ) : null}
          </div>
        ) : (
          'Block Detail'
        )
      }
      headerActions={headerActions}
      footer={
        block ? (
          <div className="flex items-center justify-between gap-3 flex-wrap text-[12.5px]">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() =>
                  moveMutation.mutate({ bucket: 'scheduled', scheduledDate: tomorrowStr })
                }
                disabled={moveMutation.isPending}
                className="inline-flex items-center gap-1.5 font-medium text-[#C4C4C4] hover:text-[#EDEDED] transition-colors disabled:opacity-50"
              >
                <CalendarClock size={13} className="text-[#9A9A9A]" />
                <span>Move to Tomorrow</span>
              </button>
              <button
                type="button"
                onClick={() => parkMutation.mutate('2w')}
                disabled={parkMutation.isPending}
                className="inline-flex items-center gap-1.5 font-medium text-[#9A9A9A] hover:text-[#EDEDED] transition-colors disabled:opacity-50"
              >
                <Archive size={13} className="text-[#6E6E6E]" />
                <span>Park in Later (2w)</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => dropMutation.mutate(false)}
              disabled={dropMutation.isPending}
              className="font-medium text-[#FF9EC5]/85 hover:text-[#FF9EC5] transition-colors disabled:opacity-50"
            >
              Drop block
            </button>
          </div>
        ) : null
      }
    >
      {detailQuery.isLoading || !block ? (
        <div className="py-12 text-center text-[13px] text-[#6E6E6E]">
          {detailQuery.isError ? 'Block could not be loaded.' : 'Loading block…'}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Editable Title + Compact Custom Property Chips */}
          <div className="space-y-4">
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={flushPendingEdits}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Block title"
              className="w-full bg-transparent font-display text-[22px] font-semibold leading-snug text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />

            {/* Sleek Custom Property Picker Strip */}
            <div ref={pickerStripRef} className="flex items-center flex-wrap gap-2">
              {/* Custom Project Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPicker((p) => (p === 'project' ? null : 'project'))}
                  className="inline-flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-[8px] bg-[#262626] border border-[#3C3C3C] hover:border-[#525252] text-[13px] font-medium text-[#EDEDED] transition-colors"
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
                  <ChevronDown size={12} className="text-[#6E6E6E]" />
                </button>
                {openPicker === 'project' ? (
                  <div className="absolute left-0 top-10 z-30 w-60 max-h-80 overflow-y-auto p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] animate-veyra-fade">
                    <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                      Project
                    </div>
                    {projects.map((p) => {
                      const active = p.id === block.projectId;
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
                            <ProjectBadge
                              name={p.name}
                              color={p.color}
                              icon={p.icon}
                              size="xs"
                            />
                            <span className="truncate">{p.name}</span>
                          </span>
                          {active ? <Check size={13} className="text-[#AEB8FF] shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Custom Goal Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPicker((p) => (p === 'goal' ? null : 'goal'))}
                  style={currentGoal ? goalChipStyle(currentGoal.color) : undefined}
                  className={[
                    'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-[color,border-color,filter]',
                    currentGoal
                      ? 'hover:brightness-125'
                      : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                  ].join(' ')}
                >
                  {currentGoal ? (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: currentGoal.color }}
                    />
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
                      {!block.goalId ? <Check size={13} className="text-[#AEB8FF]" /> : null}
                    </button>
                    {goals.map((g) => {
                      const active = g.id === block.goalId;
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
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: g.color }}
                            />
                            <span className="truncate">{g.name}</span>
                          </span>
                          {active ? <Check size={13} className="text-[#AEB8FF] shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Unified Schedule / Date Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPicker((p) => (p === 'schedule' ? null : 'schedule'))}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] bg-[#262626] border border-[#3C3C3C] hover:border-[#525252] text-[13px] font-medium text-[#EDEDED] transition-colors tabular-nums"
                >
                  {block.bucket === 'inbox' ? (
                    <Inbox size={12} className="text-[#9A9A9A]" />
                  ) : (
                    <Calendar size={12} className="text-[#9A9A9A]" />
                  )}
                  <span>{scheduleLabel}</span>
                  <ChevronDown size={12} className="text-[#6E6E6E]" />
                </button>
                {openPicker === 'schedule' ? (
                  <div className="absolute left-0 top-10 z-30 w-56 p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] animate-veyra-fade">
                    {[
                      { id: 'today', label: 'Today' },
                      { id: 'tomorrow', label: 'Tomorrow' },
                      { id: 'inbox', label: 'Inbox' },
                      { id: 'later', label: 'Later (2 weeks)' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          handleScheduleModeChange(opt.id);
                          setOpenPicker(null);
                        }}
                        className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                      >
                        <span>{opt.label}</span>
                        {scheduleSelectValue === opt.id ? (
                          <Check size={13} className="text-[#AEB8FF]" />
                        ) : null}
                      </button>
                    ))}
                    <div className="mt-1.5 pt-2 px-3 pb-1 border-t border-[#2E2E2E] space-y-1">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] block">
                        Pick specific day
                      </span>
                      <input
                        type="date"
                        aria-label="Scheduled date"
                        value={block.scheduledDate ?? ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            moveMutation.mutate({
                              bucket: 'scheduled',
                              scheduledDate: e.target.value,
                            });
                            setOpenPicker(null);
                          }
                        }}
                        className="w-full h-8 px-2 rounded-[6px] bg-[#171717] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Quiet Due Date Chip */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPicker((p) => (p === 'due' ? null : 'due'))}
                  className={[
                    'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors tabular-nums',
                    block.dueDate
                      ? 'bg-[#3D2410] border-[#F07C2A]/45 text-[#F5A66B]'
                      : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                  ].join(' ')}
                >
                  <span>{block.dueDate ? `Due ${formatShortDate(block.dueDate)}` : '+ Due'}</span>
                  {block.dueDate ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear due date"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateMutation.mutate({ dueDate: null });
                        setOpenPicker(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          updateMutation.mutate({ dueDate: null });
                        }
                      }}
                      className="ml-0.5 hover:text-white"
                    >
                      <X size={11} />
                    </span>
                  ) : null}
                </button>
                {openPicker === 'due' ? (
                  <div className="absolute left-0 top-10 z-30 w-52 p-3 rounded-[10px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] space-y-2 animate-veyra-fade">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] block">
                      Real cutoff date
                    </span>
                    <input
                      type="date"
                      aria-label="Due date"
                      value={block.dueDate ?? ''}
                      onChange={(e) => {
                        updateMutation.mutate({ dueDate: e.target.value ? e.target.value : null });
                        setOpenPicker(null);
                      }}
                      className="w-full h-8 px-2 rounded-[6px] bg-[#171717] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                    />
                  </div>
                ) : null}
              </div>

              {/* Ops Toggle Chip */}
              <button
                type="button"
                onClick={() => updateMutation.mutate({ isOps: !block.isOps })}
                className={[
                  'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
                  block.isOps
                    ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                    : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                ].join(' ')}
              >
                <Flame size={12} />
                <span>{block.isOps ? 'Ops' : '+ Ops'}</span>
              </button>

              {/* Repeat Picker Chip */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPicker((p) => (p === 'repeat' ? null : 'repeat'))}
                  className={[
                    'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
                    block.recurrenceRule
                      ? 'bg-[#291F45] border-[#9D7FF7]/40 text-[#C9B6FF]'
                      : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#525252]',
                  ].join(' ')}
                >
                  <Repeat size={12} />
                  <span>{repeatLabel}</span>
                </button>
                {openPicker === 'repeat' ? (
                  <div className="absolute left-0 top-10 z-30 w-48 p-1.5 rounded-[11px] bg-[#222222] border border-[#3C3C3C] shadow-[var(--shadow-float)] animate-veyra-fade">
                    {RECURRENCE_OPTIONS.map((opt) => {
                      const active = (block.recurrenceRule ?? '') === opt.value;
                      return (
                        <button
                          key={opt.value || 'none'}
                          type="button"
                          onClick={() => {
                            updateMutation.mutate({
                              recurrenceRule: (opt.value || null) as RecurrenceRule | null,
                            });
                            setOpenPicker(null);
                          }}
                          className="w-full px-3 py-2 rounded-[7px] text-left text-[13px] text-[#EDEDED] hover:bg-white/[0.07] flex items-center justify-between gap-2.5"
                        >
                          <span>{opt.label}</span>
                          {active ? <Check size={13} className="text-[#AEB8FF]" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Clickable External LinkChips + Add link */}
          <div className="space-y-2.5 pt-4 border-t border-[#2A2A2A]">
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
              <div className="flex items-center flex-wrap gap-2">
                {block.externalLinks.map((link, idx) => (
                  <LinkChip
                    key={`${link.url}-${idx}`}
                    link={link}
                    onRemove={() => handleRemoveLink(idx)}
                  />
                ))}
              </div>
            ) : !addingLink ? (
              <div className="text-[12.5px] text-[#6E6E6E]">
                Attach Notion docs, PRs, Figma frames, or specs
              </div>
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
                    placeholder="Label (optional)"
                    className="w-36 h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
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
          </div>

          {/* Action Bar: Start Focus + Finish stacked full-width beneath a clean divider */}
          {block.status === 'todo' ? (
            <div className="pt-5 border-t border-[#2A2A2A] flex flex-col gap-2">
              {onStartFocus ? (
                <Button
                  variant="primary"
                  size="lg"
                  leftIcon={<Play size={14} fill="currentColor" />}
                  onClick={() => onStartFocus(block.id)}
                  className="w-full h-10 text-[13.5px] font-semibold"
                >
                  {block.resumeNote ? 'Resume Focus' : 'Start Focus'}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="lg"
                leftIcon={<CheckCircle2 size={14} className="text-[#7BE0A0]" />}
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="w-full h-10 text-[13.5px] font-medium hover:border-[#2FB463]/60 hover:bg-[#14331F]/60 hover:text-[#7BE0A0]"
              >
                Finish
              </Button>
            </div>
          ) : (
            <div className="pt-5 border-t border-[#2A2A2A] flex flex-col gap-2">
              <Button
                variant="secondary"
                size="lg"
                leftIcon={<RotateCcw size={14} className="text-[#AEB8FF]" />}
                onClick={() => reopenMutation.mutate()}
                disabled={reopenMutation.isPending}
                className="w-full h-10 text-[13.5px] font-medium"
              >
                Reopen Block
              </Button>
            </div>
          )}

          {/* Quiet Hairline AUTO SUMMARY (rendered when block.autoSummary is present) */}
          <AutoSummarySection
            summary={block.autoSummary}
            onSave={(next) => updateMutation.mutate({ autoSummary: next })}
            saving={updateMutation.isPending}
          />

          {/* Open Borderless Freeform NOTES & AI CONTEXT Canvas (zero nested box!) */}
          <div className="space-y-3 pt-4 border-t border-[#2A2A2A]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Notes &amp; AI Context
              </span>
              <span className="text-[11px] text-[#6E6E6E]">Readable by T3 Code · ⌘S to save</span>
            </div>

            {checklistItems.length > 0 ? (
              <div className="space-y-1.5 pb-1">
                {checklistItems.map((item) => (
                  <button
                    key={item.lineIndex}
                    type="button"
                    onClick={() => handleToggleChecklist(item.lineIndex)}
                    className="w-full flex items-start gap-2.5 py-1 px-1 rounded-[6px] hover:bg-white/[0.04] text-left transition-colors"
                  >
                    {item.checked ? (
                      <CheckSquare size={15} className="mt-0.5 text-[#7BE0A0] shrink-0" />
                    ) : (
                      <Square size={15} className="mt-0.5 text-[#6E6E6E] shrink-0" />
                    )}
                    <span
                      className={`text-[13.5px] leading-relaxed ${
                        item.checked ? 'line-through text-[#6E6E6E]' : 'text-[#EDEDED]'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <textarea
              ref={notesTextareaRef}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={flushPendingEdits}
              rows={6}
              placeholder={
                'Write freeform notes, checklists (- [ ] step), or context for T3 Code agents…'
              }
              className="w-full bg-transparent border-0 p-0 text-[14px] leading-[1.6] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>

          {/* Pause Resume Note */}
          {block.resumeNote ? (
            <div className="pt-4 border-t border-[#2A2A2A] flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#AEB8FF]">
                  Resume Note
                </div>
                <p className="text-[13px] text-[#C4C4C4] break-words">{block.resumeNote}</p>
              </div>
              <button
                type="button"
                onClick={() => updateMutation.mutate({ resumeNote: null })}
                title="Clear resume note"
                className="text-[11.5px] text-[#6E6E6E] hover:text-[#EDEDED] shrink-0"
              >
                Clear
              </button>
            </div>
          ) : null}

          {/* Multi-day SESSIONS · Xh Ym TOTAL */}
          <div className="space-y-2.5 pt-4 border-t border-[#2A2A2A]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] flex items-center gap-1.5 tabular-nums">
                <Clock size={12} />
                Sessions · {formatDuration(displayTotalFocusMinutes)} total
              </span>
              {!loggingTime ? (
                <button
                  type="button"
                  onClick={openLogTimeForm}
                  className="text-[12px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
                >
                  <Plus size={12} />
                  Log time
                </button>
              ) : null}
            </div>

            {sessionError ? (
              <div className="text-[12px] text-[#FF9EC5]">{sessionError}</div>
            ) : null}

            {loggingTime ? (
              <form
                onSubmit={handleLogSessionSubmit}
                className="space-y-2 py-2.5 border-y border-[#2A2A2A]"
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-[#9A9A9A]">Start</span>
                    <input
                      type="datetime-local"
                      value={logStart}
                      onChange={(e) => setLogStart(e.target.value)}
                      className="w-full h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-[#9A9A9A]">End</span>
                    <input
                      type="datetime-local"
                      value={logEnd}
                      onChange={(e) => setLogEnd(e.target.value)}
                      className="w-full h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="Optional session note"
                  className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                />
                <div className="flex items-center gap-1.5">
                  <Button
                    type="submit"
                    variant="primary"
                    size="xs"
                    disabled={logSessionMutation.isPending}
                  >
                    Save session
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setLoggingTime(false);
                      setSessionError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}

            {block.sessions.length === 0 ? (
              <div className="text-[12px] text-[#6E6E6E]">No focus sessions logged yet.</div>
            ) : (
              <ul className="divide-y divide-[#262626]">
                {block.sessions.map((session) => {
                  const mins = getSessionDurationMinutes(session.startedAt, session.endedAt);
                  const sessionDate = getSessionLocalDate(session.startedAt);
                  const isEditing = editingSessionId === session.id;
                  const isSplitting = splittingSessionId === session.id;

                  return (
                    <li key={session.id} className="py-2 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[12.5px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11.5px] font-medium text-[#9A9A9A] tabular-nums w-12 shrink-0">
                            {formatShortDate(sessionDate)}
                          </span>
                          <span className="text-[#EDEDED] tabular-nums">
                            {formatTimeRange(session.startedAt, session.endedAt)}
                          </span>
                          <span className="text-[#6E6E6E] tabular-nums">
                            ({formatDuration(mins)})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {session.endedAt ? (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditSession(session)}
                                className="px-1.5 py-0.5 rounded-[5px] text-[11.5px] text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-[#262626]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => startSplitSession(session)}
                                title="Split break out of session"
                                className="p-1 rounded-[5px] text-[#6E6E6E] hover:text-[#EDEDED] hover:bg-[#262626]"
                              >
                                <Scissors size={12} />
                              </button>
                            </>
                          ) : (
                            <Pill tone="accent" dot>
                              Live
                            </Pill>
                          )}
                        </div>
                      </div>

                      {session.note && !isEditing ? (
                        <div className="pl-14 text-[12px] text-[#9A9A9A]">{session.note}</div>
                      ) : null}

                      {isEditing ? (
                        <form
                          onSubmit={(e) => handleTrimSubmit(e, session.id)}
                          className="space-y-2 pt-1 pl-2 border-l-2 border-[#3B4BD8]"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="datetime-local"
                              value={editStart}
                              onChange={(e) => setEditStart(e.target.value)}
                              className="h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[11.5px] text-[#EDEDED] tabular-nums"
                            />
                            <input
                              type="datetime-local"
                              value={editEnd}
                              onChange={(e) => setEditEnd(e.target.value)}
                              className="h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[11.5px] text-[#EDEDED] tabular-nums"
                            />
                          </div>
                          <input
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Session note"
                            className="w-full h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED]"
                          />
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="submit"
                                variant="primary"
                                size="xs"
                                disabled={trimSessionMutation.isPending}
                              >
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setEditingSessionId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => deleteSessionMutation.mutate(session.id)}
                              className="text-[#FF9EC5] hover:bg-[#3D1A2B]/60 hover:text-[#FF9EC5]"
                            >
                              Delete
                            </Button>
                          </div>
                        </form>
                      ) : null}

                      {isSplitting ? (
                        <form
                          onSubmit={(e) => handleSplitSubmit(e, session.id)}
                          className="space-y-2 pt-1 pl-2 border-l-2 border-[#9D7FF7]"
                        >
                          <div className="text-[11.5px] text-[#C4C4C4]">
                            Split a break out of {formatLocalTime(session.startedAt)} –{' '}
                            {session.endedAt ? formatLocalTime(session.endedAt) : 'now'}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="datetime-local"
                              value={splitBreakStart}
                              onChange={(e) => setSplitBreakStart(e.target.value)}
                              className="h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[11.5px] text-[#EDEDED] tabular-nums"
                            />
                            <input
                              type="number"
                              min={1}
                              max={300}
                              value={splitBreakMinutes}
                              onChange={(e) => setSplitBreakMinutes(e.target.value)}
                              placeholder="Break mins"
                              className="h-8 px-3 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#EDEDED] tabular-nums"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="submit"
                              variant="primary"
                              size="xs"
                              disabled={splitSessionMutation.isPending}
                            >
                              Split session
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setSplittingSessionId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </DockedDrawer>
  );
}
