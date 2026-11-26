import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type BlockBucket,
  type BlockSizeMinutes,
  type ExternalLink,
  type RecurrenceRule,
  SYSTEM_OTHER_PROJECT_ID,
} from '@veyra/core/types';
import {
  Calendar,
  CornerDownLeft,
  Flame,
  Link2,
  Play,
  Plus,
  Repeat,
  Target,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateBlockRelated } from '../api/queries';
import { BlockSizePicker } from '../components/BlockSizePicker';
import { Button } from '../components/Button';
import { GoalKindIconBadge } from '../components/GoalChip';
import { LinkChip } from '../components/LinkChip';
import { LinkPickerPopover } from '../components/LinkPickerPopover';
import { ModalSheet } from '../components/ModalSheet';
import { ProjectBadge } from '../components/ProjectBadge';
import { SelectPopover } from '../components/SelectPopover';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { goalChipStyle } from '../components/goalTint';
import { addDaysDateString, getTodayDateString } from '../components/icons';
import { type CreateBlockDefaults, useAppShell } from './AppShellContext';
import { formatHotkeyLabel, matchesAnyAccelerator, useHotkeys } from './hotkeys';

export interface CreateBlockModalProps {
  open: boolean;
  defaults?: CreateBlockDefaults;
  onClose: () => void;
}

type ScheduleChoice = 'today' | 'tomorrow' | 'inbox' | 'later' | 'custom';

export function CreateBlockModal({ open, defaults, onClose }: CreateBlockModalProps) {
  const queryClient = useQueryClient();
  const { projects, goals, startFocusAndNavigate } = useAppShell();
  const hotkeys = useHotkeys();
  const titleRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const todayStr = getTodayDateString();
  const tomorrowStr = addDaysDateString(todayStr, 1);

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== 'archived'),
    [projects],
  );

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string>(SYSTEM_OTHER_PROJECT_ID);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [goalId, setGoalId] = useState<string>('');
  const selectedGoal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  const [scheduleChoice, setScheduleChoice] = useState<ScheduleChoice>('today');
  const [customDate, setCustomDate] = useState(todayStr);
  const [dueDate, setDueDate] = useState('');
  const [sizeMinutes, setSizeMinutes] = useState<BlockSizeMinutes | null>(null);
  const [isOps, setIsOps] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize fields only when modal transitions from closed -> open
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const defaultProjId =
      defaults?.projectId ??
      activeProjects.find((p) => !p.isSystem)?.id ??
      activeProjects[0]?.id ??
      SYSTEM_OTHER_PROJECT_ID;
    const defaultProj = activeProjects.find((p) => p.id === defaultProjId);

    setTitle(defaults?.title ?? '');
    setProjectId(defaultProjId);
    setGoalId(
      defaults?.goalId !== undefined
        ? (defaults.goalId ?? '')
        : (defaultProj?.defaultGoalId ?? ''),
    );

    if (defaults?.bucket === 'inbox') {
      setScheduleChoice('inbox');
    } else if (defaults?.bucket === 'later') {
      setScheduleChoice('later');
    } else if (defaults?.scheduledDate) {
      if (defaults.scheduledDate === todayStr) {
        setScheduleChoice('today');
      } else if (defaults.scheduledDate === tomorrowStr) {
        setScheduleChoice('tomorrow');
      } else {
        setScheduleChoice('custom');
        setCustomDate(defaults.scheduledDate);
      }
    } else {
      setScheduleChoice('today');
      setCustomDate(todayStr);
    }

    setDueDate('');
    setSizeMinutes(null);
    setIsOps(Boolean(defaults?.isOps));
    setRecurrenceRule('');
    setNotes('');
    setLinks([]);
    setLinkInputOpen(false);
    setProjectPickerOpen(false);
    setError(null);

    window.setTimeout(() => titleRef.current?.focus(), 30);
  }, [open, defaults, activeProjects, todayStr, tomorrowStr]);

  const handleProjectChange = (nextId: string) => {
    setProjectId(nextId);
    const proj = activeProjects.find((p) => p.id === nextId);
    if (proj?.defaultGoalId) {
      setGoalId(proj.defaultGoalId);
    }
  };

  const handleAddLink = (nextLink: ExternalLink) => {
    setLinks((prev) =>
      prev.some((l) => l.url === nextLink.url) ? prev : [...prev, nextLink],
    );
    setError(null);
  };

  const buildPayload = () => {
    let bucket: BlockBucket = 'scheduled';
    let scheduledDate: string | null = todayStr;
    let revisitAt: '2w' | null = null;

    if (scheduleChoice === 'inbox') {
      bucket = 'inbox';
      scheduledDate = null;
    } else if (scheduleChoice === 'later') {
      bucket = 'later';
      scheduledDate = null;
      revisitAt = '2w';
    } else if (scheduleChoice === 'tomorrow') {
      bucket = 'scheduled';
      scheduledDate = tomorrowStr;
    } else if (scheduleChoice === 'custom') {
      bucket = 'scheduled';
      scheduledDate = customDate || todayStr;
    }

    return {
      title: title.trim(),
      projectId,
      goalId: goalId || null,
      isOps,
      bucket,
      scheduledDate,
      plannedStartAt: defaults?.plannedStartAt ?? null,
      plannedEndAt: defaults?.plannedEndAt ?? null,
      dueDate: dueDate || null,
      revisitAt,
      sizeMinutes,
      recurrenceRule: (recurrenceRule || null) as RecurrenceRule | null,
      notes,
      externalLinks: links,
    };
  };

  const createMutation = useMutation({
    mutationFn: async (opts: { startFocus: boolean }) => {
      const res = await apiClient.createBlock(buildPayload());
      return { block: res.block, startFocus: opts.startFocus };
    },
    onSuccess: async ({ block, startFocus }) => {
      invalidateBlockRelated(queryClient);
      if (startFocus) {
        onClose();
        await startFocusAndNavigate(block.id);
        return;
      }
      if (createAnother) {
        setTitle('');
        setNotes('');
        setLinks([]);
        setError(null);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create block');
    },
  });

  const submit = (startFocus: boolean) => {
    if (!title.trim() || createMutation.isPending) return;
    setError(null);
    createMutation.mutate({ startFocus });
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };

  // Global ⌘↵ (Create), ⌘⇧↵ (Create & Focus), and ⌃P (searchable Project picker) shortcuts inside modal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesAnyAccelerator(e, hotkeys.cycleProject)) {
        e.preventDefault();
        e.stopPropagation();
        setProjectPickerOpen((prev) => {
          if (prev) {
            window.setTimeout(() => titleRef.current?.focus(), 10);
          }
          return !prev;
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !projectPickerOpen) {
        e.preventDefault();
        submit(e.shiftKey);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const projectHotkeyLabel = formatHotkeyLabel(hotkeys.cycleProject);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      dismissOnEscape={!projectPickerOpen}
      width={640}
      ariaLabel="Create Block"
      title="New Block"
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ToggleSwitch
            size="sm"
            checked={createAnother}
            onChange={setCreateAnother}
            label="Create another"
          />

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Play size={13} />}
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => submit(true)}
            >
              Create &amp; Focus
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => submit(false)}
              rightIcon={
                <span className="text-[11px] opacity-80 inline-flex items-center gap-0.5">
                  ⌘<CornerDownLeft size={11} />
                </span>
              }
            >
              Create Block
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleFormSubmit} className="space-y-4">
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you want to finish in this block?"
          className="w-full bg-transparent font-display text-[20px] font-semibold text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
        />

        {/* Property Chips Strip (#262626 + #3C3C3C) */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Project */}
          <SelectPopover
            ariaLabel="Project"
            menuTitle={projectHotkeyLabel ? `Project · ${projectHotkeyLabel}` : 'Project'}
            triggerTitle={projectHotkeyLabel ? `Select project (${projectHotkeyLabel})` : 'Select project'}
            value={projectId}
            open={projectPickerOpen}
            onOpenChange={setProjectPickerOpen}
            searchable
            searchPlaceholder="Filter projects…"
            onCloseFocus={() => window.setTimeout(() => titleRef.current?.focus(), 10)}
            onChange={(val) => handleProjectChange(val)}
            options={activeProjects.map((p) => ({
              value: p.id,
              label: p.name,
              leading: <ProjectBadge name={p.name} color={p.color} icon={p.icon} size="xs" />,
            }))}
          />

          {/* Goal */}
          <SelectPopover
            ariaLabel="Goal"
            menuTitle="Overarching Goal"
            value={goalId}
            placeholder="No goal"
            onChange={(val) => setGoalId(val)}
            triggerStyle={selectedGoal ? goalChipStyle(selectedGoal.color) : undefined}
            triggerClassName={selectedGoal ? '' : 'text-[#9A9A9A]'}
            leading={
              selectedGoal ? (
                <GoalKindIconBadge kind={selectedGoal.kind} color={selectedGoal.color} size="xs" />
              ) : (
                <Target size={12} className="text-[#6E6E6E] shrink-0" />
              )
            }
            options={[
              { value: '', label: 'No goal', muted: true },
              ...goals.map((g) => ({
                value: g.id,
                label: g.name,
                leading: <GoalKindIconBadge kind={g.kind} color={g.color} size="xs" />,
              })),
            ]}
          />

          {/* Schedule */}
          <SelectPopover
            ariaLabel="Schedule"
            menuTitle="Schedule"
            menuWidthClass="w-48"
            value={scheduleChoice}
            leading={<Calendar size={12} className="text-[#9A9A9A] shrink-0" />}
            onChange={(val) => setScheduleChoice(val as ScheduleChoice)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'inbox', label: 'Inbox' },
              { value: 'later', label: 'Later (2w)' },
              { value: 'custom', label: 'Pick date…' },
            ]}
          />

          {scheduleChoice === 'custom' ? (
            <input
              type="date"
              aria-label="Custom scheduled date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
            />
          ) : null}

          {/* Due Date */}
          <label
            className={[
              'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] cursor-pointer',
              dueDate
                ? 'bg-[#3D2410] border-[#F07C2A]/45 text-[#F5A66B]'
                : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A]',
            ].join(' ')}
          >
            <span>Due</span>
            <input
              type="date"
              aria-label="Due date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-transparent text-[13px] focus:outline-none tabular-nums cursor-pointer"
            />
            {dueDate ? (
              <button
                type="button"
                aria-label="Clear due date"
                onClick={(e) => {
                  e.preventDefault();
                  setDueDate('');
                }}
              >
                <X size={10} />
              </button>
            ) : null}
          </label>

          {/* Ops */}
          <button
            type="button"
            onClick={() => setIsOps((v) => !v)}
            className={[
              'inline-flex items-center gap-2 h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
              isOps
                ? 'bg-[#3A3110] border-[#E8B417]/45 text-[#F2D06B]'
                : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED]',
            ].join(' ')}
          >
            <Flame size={12} />
            <span>Ops</span>
          </button>

          {/* Repeat */}
          <SelectPopover
            ariaLabel="Repeat"
            menuTitle="Repeat"
            menuWidthClass="w-48"
            value={recurrenceRule}
            leading={<Repeat size={12} className="shrink-0" />}
            onChange={(val) => setRecurrenceRule(val)}
            triggerClassName={
              recurrenceRule
                ? 'bg-[#291F45] border-[#9D7FF7]/40 text-[#C9B6FF]'
                : 'text-[#9A9A9A]'
            }
            options={[
              { value: '', label: 'No repeat', muted: true },
              { value: 'weekdays', label: 'Weekdays' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'days:[mon,wed,fri]', label: 'Mon / Wed / Fri' },
            ]}
          />

          {/* Block size: Auto / 30m / 1h / 2h presets plus Custom */}
          <BlockSizePicker value={sizeMinutes} onChange={setSizeMinutes} />
        </div>

        {/* Links */}
        <div className="space-y-2 pt-2 border-t border-[#2A2A2A]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] inline-flex items-center gap-1.5">
              <Link2 size={12} />
              Notion &amp; URL Links
            </span>
            {!linkInputOpen ? (
              <button
                type="button"
                onClick={() => setLinkInputOpen(true)}
                className="text-[12px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
              >
                <Plus size={12} />
                Add link
              </button>
            ) : null}
          </div>

          {links.length > 0 ? (
            <div className="flex items-center flex-wrap gap-1.5">
              {links.map((link, idx) => (
                <LinkChip
                  key={`${link.url}-${idx}`}
                  link={link}
                  onRemove={() => setLinks((prev) => prev.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          ) : null}

          <LinkPickerPopover
            open={linkInputOpen}
            onClose={() => setLinkInputOpen(false)}
            existingLinks={links}
            onAddLink={handleAddLink}
          />
        </div>

        {/* Open NOTES & AI CONTEXT */}
        <div className="space-y-1.5 pt-2 border-t border-[#2A2A2A]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
            Notes &amp; AI Context
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Write freeform context, acceptance criteria, or - [ ] checklist items…"
            className="w-full px-3 py-2.5 rounded-[8px] bg-[#171717] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] leading-relaxed text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-y"
          />
        </div>

        {error ? <div className="text-[12px] text-[#FF9EC5]">{error}</div> : null}
      </form>
    </ModalSheet>
  );
}
