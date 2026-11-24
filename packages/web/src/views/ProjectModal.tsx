import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PROJECT_ACCENT_COLORS,
  PROJECT_ICON_KEYS,
  type Project,
  type ProjectIconKey,
  type ProjectStatus,
  type ProjectWithStats,
} from '@veyra/core/types';
import { Archive, Check, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useGoalsQuery } from '../api/queries';
import { Button } from '../components/Button';
import { DockedDrawer } from '../components/DockedDrawer';
import { ProjectBadge } from '../components/ProjectBadge';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { goalTint } from '../components/goalTint';
import { ProjectIcon, getProjectMonogram, isProjectIconKey } from '../components/icons';

export interface ProjectModalProps {
  open: boolean;
  project?: ProjectWithStats | null;
  onClose: () => void;
  onSaved?: (project: Project) => void;
  onDeleted?: (projectId: string) => void;
}

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

export function ProjectModal({
  open,
  project = null,
  onClose,
  onSaved,
  onDeleted,
}: ProjectModalProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(project);
  const isSystem = Boolean(project?.isSystem);

  const goalsQuery = useGoalsQuery({ includeArchived: false });
  const goals = goalsQuery.data?.goals ?? [];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [badgeMode, setBadgeMode] = useState<'icon' | 'monogram'>('icon');
  const [selectedIcon, setSelectedIcon] = useState<ProjectIconKey>('Rocket');
  const [color, setColor] = useState<string>(PROJECT_ACCENT_COLORS[0]);
  const [defaultGoalId, setDefaultGoalId] = useState<string | null>(null);
  const [notionUrl, setNotionUrl] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [error, setError] = useState<string | null>(null);

  // Inline "+ New Goal" creator state
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalColor, setNewGoalColor] = useState<string>(PROJECT_ACCENT_COLORS[0]);
  const [newGoalError, setNewGoalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setName(project.name);
      setDescription(project.description);
      if (isProjectIconKey(project.icon)) {
        setBadgeMode('icon');
        setSelectedIcon(project.icon);
      } else {
        setBadgeMode('monogram');
        setSelectedIcon('Rocket');
      }
      setColor(project.color || PROJECT_ACCENT_COLORS[0]);
      setDefaultGoalId(project.defaultGoalId);
      setNotionUrl(project.notionUrl ?? '');
      setKeywordsText((project.matchKeywords ?? []).join(', '));
      setIsPinned(project.isPinned);
      setStatus(project.status);
    } else {
      setName('');
      setDescription('');
      setBadgeMode('icon');
      setSelectedIcon('Rocket');
      setColor(PROJECT_ACCENT_COLORS[0]);
      setDefaultGoalId(null);
      setNotionUrl('');
      setKeywordsText('');
      setIsPinned(true);
      setStatus('active');
    }
    setError(null);
    setCreatingGoal(false);
    setNewGoalName('');
    setNewGoalColor(PROJECT_ACCENT_COLORS[0]);
    setNewGoalError(null);
  }, [open, project]);

  const invalidateProjectQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['project'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    void queryClient.invalidateQueries({ queryKey: ['plan'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
  };

  const createGoalMutation = useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      apiClient.createGoal({ name: input.name, color: input.color }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      setDefaultGoalId(res.goal.id);
      setNewGoalName('');
      setCreatingGoal(false);
      setNewGoalError(null);
    },
    onError: (err) => {
      setNewGoalError(err instanceof Error ? err.message : 'Failed to create goal');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Project name is required.');
      }

      let normalizedNotion: string | null = null;
      const rawNotion = notionUrl.trim();
      if (rawNotion) {
        const candidate = /^https?:\/\//i.test(rawNotion) ? rawNotion : `https://${rawNotion}`;
        try {
          new URL(candidate);
          normalizedNotion = candidate;
        } catch {
          throw new Error('Notion hub URL must be a valid URL.');
        }
      }

      const iconValue = badgeMode === 'icon' ? selectedIcon : null;
      const matchKeywords = keywordsText
        .split(',')
        .map((kw) => kw.trim())
        .filter((kw) => kw.length > 0);

      if (project) {
        const res = await apiClient.updateProject(project.id, {
          name: trimmedName,
          description: description.trim(),
          color,
          icon: iconValue,
          defaultGoalId,
          isPinned,
          status: isSystem ? 'active' : status,
          notionUrl: normalizedNotion,
          matchKeywords,
        });
        return res.project;
      }

      const res = await apiClient.createProject({
        name: trimmedName,
        description: description.trim(),
        color,
        icon: iconValue,
        defaultGoalId,
        isPinned,
        status,
        notionUrl: normalizedNotion,
        matchKeywords,
      });
      return res.project;
    },
    onSuccess: (saved) => {
      invalidateProjectQueries();
      onSaved?.(saved);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save project');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (nextStatus: ProjectStatus) =>
      apiClient.updateProject(project!.id, { status: nextStatus }),
    onSuccess: (res) => {
      invalidateProjectQueries();
      onSaved?.(res.project);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update project status');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteProject(project!.id),
    onSuccess: () => {
      invalidateProjectQueries();
      onDeleted?.(project!.id);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    },
  });

  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saveMutation.isPending) return;
    setError(null);
    saveMutation.mutate();
  };

  // ⌘↵ / Ctrl+↵ submits from anywhere inside the drawer
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleCreateGoalInline = () => {
    const trimmed = newGoalName.trim();
    if (!trimmed) {
      setNewGoalError('Goal name is required.');
      return;
    }
    setNewGoalError(null);
    createGoalMutation.mutate({ name: trimmed, color: newGoalColor });
  };

  const previewIcon = badgeMode === 'icon' ? selectedIcon : null;
  const previewName = name.trim() || 'Project';

  const sectionLabel =
    'text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]';
  const fieldInput =
    'w-full h-10 px-3.5 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none transition-colors';
  const segmentButton = (active: boolean, compact = false) =>
    [
      'h-full rounded-[6px] font-medium transition-colors',
      compact ? 'px-3 text-[12px]' : 'px-3.5 text-[13px]',
      active ? 'bg-[#3B4BD8] text-white' : 'text-[#9A9A9A] hover:text-[#EDEDED]',
    ].join(' ');

  const headerActions =
    isEdit && !isSystem ? (
      <button
        type="button"
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        title="Delete project"
        aria-label="Delete project"
        className="h-7 w-7 rounded-[7px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#9A9A9A] hover:text-[#FF9EC5] hover:border-[#EC659B]/50 hover:bg-[#3D1A2B]/50 transition-colors disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    ) : null;

  return (
    <DockedDrawer
      open={open}
      onClose={onClose}
      width={520}
      ariaLabel={isEdit ? 'Edit project' : 'Create project'}
      title={
        <span className="text-[12.5px] font-medium text-[#9A9A9A] truncate">
          {isEdit ? 'Edit Project' : 'New Project'}
        </span>
      }
      headerActions={headerActions}
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center">
            {isEdit && !isSystem ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Archive size={13} />}
                onClick={() =>
                  archiveMutation.mutate(project?.status === 'archived' ? 'active' : 'archived')
                }
                disabled={archiveMutation.isPending}
              >
                {project?.status === 'archived' ? 'Unarchive' : 'Archive'}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="veyra-project-form"
              variant="primary"
              size="md"
              disabled={!name.trim() || saveMutation.isPending}
              aria-label={isEdit ? 'Save Changes' : 'Create Project'}
            >
              {isEdit ? 'Save Changes' : 'Create Project'}
              <span className="ml-2 text-[11px] opacity-70" aria-hidden="true">
                ⌘↵
              </span>
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="veyra-project-form"
        ref={formRef}
        onSubmit={handleSubmit}
        className="space-y-6"
      >
        {error ? (
          <div className="px-3.5 py-2.5 rounded-[8px] bg-[#3D1A2B]/60 border border-[#C94A6A]/50 text-[12.5px] text-[#FF9EC5]">
            {error}
          </div>
        ) : null}

        {isSystem ? (
          <p className="text-[12.5px] text-[#9A9A9A]">
            Built-in system project — cannot be archived or deleted.
          </p>
        ) : null}

        {/* Hero identity: live badge preview + borderless name and description */}
        <div className="flex items-start gap-4">
          <ProjectBadge
            name={previewName}
            color={color}
            icon={previewIcon}
            size="lg"
            className="w-12! h-12! rounded-[12px]! mt-0.5"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <label htmlFor="project-name-input" className="sr-only">
              Project name
            </label>
            <input
              id="project-name-input"
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-full bg-transparent border-0 p-0 font-display text-[22px] font-semibold leading-tight text-[#EDEDED] placeholder:text-[#4E4E4E] focus:outline-none"
            />
            <label htmlFor="project-description-input" className="sr-only">
              Short description
            </label>
            <input
              id="project-description-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a one-line description"
              className="w-full bg-transparent border-0 p-0 text-[13.5px] text-[#C4C4C4] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>
        </div>

        {/* Badge & Accent */}
        <section className="border-t border-[#2A2A2A] pt-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className={sectionLabel}>Badge &amp; Accent</span>
            <div className="inline-flex h-8 rounded-[8px] bg-[#262626] border border-[#3C3C3C] p-0.5">
              <button
                type="button"
                onClick={() => setBadgeMode('icon')}
                className={segmentButton(badgeMode === 'icon', true)}
              >
                Icon
              </button>
              <button
                type="button"
                onClick={() => setBadgeMode('monogram')}
                className={segmentButton(badgeMode === 'monogram', true)}
              >
                Monogram
              </button>
            </div>
          </div>

          {badgeMode === 'icon' ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project icon">
              {PROJECT_ICON_KEYS.map((iconKey) => {
                const active = selectedIcon === iconKey;
                return (
                  <button
                    key={iconKey}
                    type="button"
                    aria-label={iconKey}
                    aria-pressed={active}
                    onClick={() => setSelectedIcon(iconKey)}
                    className={[
                      'w-[38px] h-[38px] rounded-[9px] border inline-flex items-center justify-center transition-colors',
                      active
                        ? 'bg-[#1F2759] border-[#5566F2] text-[#D6DCFF]'
                        : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#4E4E4E]',
                    ].join(' ')}
                  >
                    <ProjectIcon icon={iconKey} size={16} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 h-[38px]">
              <ProjectBadge name={previewName} color={color} icon={null} size="md" />
              <span className="text-[13px] text-[#9A9A9A]">
                Auto-generated monogram{' '}
                <strong className="text-[#EDEDED]">{getProjectMonogram(previewName)}</strong>
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Accent color">
            {PROJECT_ACCENT_COLORS.map((swatch) => {
              const active = color.toUpperCase() === swatch.toUpperCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Color ${swatch}`}
                  aria-pressed={active}
                  onClick={() => setColor(swatch)}
                  style={{ backgroundColor: swatch }}
                  className={[
                    'w-7 h-7 rounded-full inline-flex items-center justify-center transition-all',
                    active
                      ? 'ring-2 ring-offset-2 ring-offset-[#1C1C1C] ring-white'
                      : 'opacity-75 hover:opacity-100',
                  ].join(' ')}
                >
                  {active ? <Check size={13} className="text-white" strokeWidth={2.5} /> : null}
                </button>
              );
            })}
          </div>
        </section>

        {/* Default Goal */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className={sectionLabel}>Default Goal</span>
            {!creatingGoal ? (
              <button
                type="button"
                onClick={() => {
                  setCreatingGoal(true);
                  setNewGoalError(null);
                }}
                className="text-[12.5px] font-medium text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
              >
                <Plus size={13} />
                New Goal
              </button>
            ) : null}
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDefaultGoalId(null)}
              className={[
                'h-9 px-3.5 rounded-[8px] border text-[13px] font-medium transition-colors',
                defaultGoalId === null
                  ? 'bg-[#2A2A2A] border-[#6E6E6E] text-[#EDEDED]'
                  : 'bg-[#171717] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED] hover:border-[#4E4E4E]',
              ].join(' ')}
            >
              None
            </button>
            {goals.map((goal) => {
              const active = defaultGoalId === goal.id;
              const tint = goalTint(goal.color);
              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => setDefaultGoalId(goal.id)}
                  style={
                    active
                      ? { backgroundColor: tint.bg, borderColor: tint.borderHover, color: tint.text }
                      : undefined
                  }
                  className={[
                    'h-9 px-3.5 rounded-[8px] border text-[13px] font-medium inline-flex items-center gap-2 transition-colors',
                    active
                      ? ''
                      : 'bg-[#171717] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                  ].join(' ')}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tint.dot }}
                  />
                  <span>{goal.name}</span>
                </button>
              );
            })}
          </div>

          {creatingGoal ? (
            <div className="p-3.5 rounded-[10px] bg-[#171717] border border-[#2A2A2A] space-y-3">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  aria-label="New goal name"
                  value={newGoalName}
                  onChange={(e) => setNewGoalName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      handleCreateGoalInline();
                    }
                  }}
                  placeholder="Goal name (e.g. Ship v1, Grow ARR)"
                  className="flex-1 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreateGoalInline}
                  disabled={createGoalMutation.isPending}
                >
                  Create Goal
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCreatingGoal(false);
                    setNewGoalError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {PROJECT_ACCENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Goal color ${c}`}
                    onClick={() => setNewGoalColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-5 h-5 rounded-full ${
                      newGoalColor === c
                        ? 'ring-2 ring-offset-2 ring-offset-[#171717] ring-white'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
              {newGoalError ? (
                <div className="text-[12px] text-[#FF9EC5]">{newGoalError}</div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Links & calendar matching */}
        <section className="border-t border-[#2A2A2A] pt-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="project-notion-input" className={`${sectionLabel} block`}>
              Notion Hub URL
            </label>
            <input
              id="project-notion-input"
              type="text"
              value={notionUrl}
              onChange={(e) => setNotionUrl(e.target.value)}
              placeholder="https://notion.so/…"
              className={fieldInput}
            />
          </div>

          {!isSystem ? (
            <div className="space-y-2">
              <label htmlFor="project-keywords-input" className={`${sectionLabel} block`}>
                Calendar Sync Keywords
              </label>
              <input
                id="project-keywords-input"
                type="text"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="e.g. Acme, AC"
                className={fieldInput}
              />
              <p className="text-[12px] text-[#6E6E6E]">
                Auto-matches synced Outlook meetings by title. Comma-separated.
              </p>
            </div>
          ) : null}
        </section>

        {/* Sidebar & Status */}
        <section className="border-t border-[#2A2A2A] pt-5 space-y-4">
          <span className={`${sectionLabel} block`}>Sidebar &amp; Status</span>
          <ToggleSwitch
            id="project-pin-toggle"
            checked={isPinned}
            onChange={setIsPinned}
            label="Pin to sidebar"
            description="Keep in the left sidebar — pin as many projects as you like"
          />

          {!isSystem ? (
            <div
              className="inline-flex h-9 rounded-[8px] bg-[#262626] border border-[#3C3C3C] p-0.5"
              role="radiogroup"
              aria-label="Project status"
            >
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={status === opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={segmentButton(status === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </form>
    </DockedDrawer>
  );
}
