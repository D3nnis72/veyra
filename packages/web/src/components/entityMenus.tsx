import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Block, CalendarEvent, Goal, ProjectWithStats } from '@veyra/core/types';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Ban,
  Briefcase,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Inbox,
  NotebookPen,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Sun,
  Trash2,
  Trophy,
} from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { apiClient, openExternalUrl } from '../api/client';
import { invalidateAllVeyraData, invalidateBlockRelated } from '../api/queries';
import { useAppShell } from '../app/AppShellContext';
import { ContextMenu, type ContextMenuEntry, useContextMenuState } from './ContextMenu';
import { addDaysDateString, getTodayDateString } from './icons';

const ICON = 14;

export interface EntityMenuHandle<T> {
  open: (e: ReactMouseEvent, payload: T) => void;
  menu: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

export function useBlockContextMenu(): EntityMenuHandle<Block> {
  const queryClient = useQueryClient();
  const { openBlockDrawer, startFocusAndNavigate, activeDrawer, closeDrawer } = useAppShell();
  const state = useContextMenuState<Block>();

  const invalidate = (blockId?: string) => invalidateBlockRelated(queryClient, blockId);
  const closeDrawerFor = (blockId: string) => {
    if (activeDrawer?.kind === 'block' && activeDrawer.blockId === blockId) closeDrawer();
  };

  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSettled: () => invalidate(),
  });

  const run = (fn: () => Promise<unknown>) => action.mutate(fn);

  const block = state.payload;
  const todayStr = getTodayDateString();
  const tomorrowStr = addDaysDateString(todayStr, 1);

  let items: Array<ContextMenuEntry | null | false> = [];
  if (block) {
    const isTodo = block.status === 'todo';
    const isToday = block.bucket === 'scheduled' && block.scheduledDate === todayStr;
    const isTomorrow = block.bucket === 'scheduled' && block.scheduledDate === tomorrowStr;
    const isInbox = block.bucket === 'inbox';
    items = [
      isTodo
        ? {
            id: 'start',
            label: 'Start Focus',
            icon: <Play size={ICON} className="text-[#AEB8FF]" />,
            onSelect: () => void startFocusAndNavigate(block.id),
          }
        : {
            id: 'reopen',
            label: 'Reopen Block',
            icon: <RotateCcw size={ICON} className="text-[#AEB8FF]" />,
            onSelect: () => run(() => apiClient.reopenBlock(block.id)),
          },
      {
        id: 'details',
        label: 'Open Details',
        icon: <PanelRight size={ICON} />,
        onSelect: () => openBlockDrawer(block.id),
      },
      isTodo && {
        id: 'complete',
        label: 'Mark Complete',
        icon: <CheckCircle2 size={ICON} className="text-[#7BE0A0]" />,
        onSelect: () => run(() => apiClient.completeFocus({ blockId: block.id })),
      },
      { type: 'divider', id: 'd1' },
      !isToday && {
        id: 'today',
        label: 'Move to Today',
        icon: <Sun size={ICON} />,
        onSelect: () =>
          run(() => apiClient.moveBlock(block.id, { bucket: 'scheduled', scheduledDate: todayStr })),
      },
      !isTomorrow && {
        id: 'tomorrow',
        label: 'Move to Tomorrow',
        icon: <ArrowRight size={ICON} />,
        onSelect: () =>
          run(() =>
            apiClient.moveBlock(block.id, { bucket: 'scheduled', scheduledDate: tomorrowStr }),
          ),
      },
      {
        id: 'later',
        label: 'Park in Later (2w)',
        icon: <Clock3 size={ICON} />,
        onSelect: () =>
          run(() =>
            apiClient.moveBlock(block.id, { bucket: 'later', scheduledDate: null, revisitAt: '2w' }),
          ),
      },
      !isInbox && {
        id: 'inbox',
        label: 'Move to Inbox',
        icon: <Inbox size={ICON} />,
        onSelect: () =>
          run(() => apiClient.moveBlock(block.id, { bucket: 'inbox', scheduledDate: null })),
      },
      {
        id: 'ops',
        label: block.isOps ? 'Unmark Ops' : 'Toggle Ops',
        icon: <Briefcase size={ICON} className={block.isOps ? 'text-[#E8B417]' : undefined} />,
        onSelect: () => run(() => apiClient.updateBlock(block.id, { isOps: !block.isOps })),
      },
      {
        id: 'duplicate',
        label: 'Duplicate Block',
        icon: <Copy size={ICON} />,
        onSelect: () =>
          run(() =>
            apiClient.createBlock({
              title: `${block.title} (copy)`,
              projectId: block.projectId,
              goalId: block.goalId,
              isOps: block.isOps,
              bucket: block.bucket,
              scheduledDate: block.scheduledDate,
              dueDate: block.dueDate,
              notes: block.notes,
              externalLinks: block.externalLinks,
            }),
          ),
      },
      { type: 'divider', id: 'd2' },
      block.status !== 'dropped' && {
        id: 'drop',
        label: 'Drop Block',
        icon: <Ban size={ICON} />,
        destructive: true,
        onSelect: () => run(() => apiClient.dropBlock(block.id)),
      },
      {
        id: 'delete',
        label: 'Delete Block',
        icon: <Trash2 size={ICON} />,
        destructive: true,
        onSelect: () => {
          closeDrawerFor(block.id);
          run(() => apiClient.deleteBlock(block.id));
        },
      },
    ];
  }

  return {
    open: state.open,
    menu: (
      <ContextMenu
        position={state.position}
        header={block?.title}
        items={items}
        onClose={state.close}
        label="Block actions"
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

export function useMeetingContextMenu(): EntityMenuHandle<CalendarEvent> {
  const queryClient = useQueryClient();
  const { openMeetingDrawer, openCreateBlock } = useAppShell();
  const state = useContextMenuState<CalendarEvent>();

  const opsMutation = useMutation({
    mutationFn: (event: CalendarEvent) => apiClient.updateEvent(event.id, { isOps: !event.isOps }),
    onSettled: () => {
      for (const key of ['calendar', 'today', 'plan', 'events', 'review']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const event = state.payload;
  const items: Array<ContextMenuEntry | null | false> = event
    ? [
        {
          id: 'notes',
          label: 'Open Meeting Notes',
          icon: <NotebookPen size={ICON} />,
          onSelect: () => openMeetingDrawer(event.id),
        },
        Boolean(event.meetingUrl) && {
          id: 'join',
          label: 'Open in Teams / Join',
          icon: <ExternalLink size={ICON} className="text-[#7EE3F0]" />,
          onSelect: () => void openExternalUrl(event.meetingUrl!),
        },
        {
          id: 'follow-up',
          label: 'Create Follow-up Block',
          icon: <Plus size={ICON} />,
          onSelect: () =>
            openCreateBlock({
              title: `Follow-up: ${event.title}`,
              ...(event.projectId ? { projectId: event.projectId } : {}),
              goalId: event.goalId,
              isOps: event.isOps,
            }),
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'ops',
          label: event.isOps ? 'Unmark Ops' : 'Toggle Ops',
          icon: <Briefcase size={ICON} className={event.isOps ? 'text-[#E8B417]' : undefined} />,
          onSelect: () => opsMutation.mutate(event),
        },
      ]
    : [];

  return {
    open: state.open,
    menu: (
      <ContextMenu
        position={state.position}
        header={event?.title}
        items={items}
        onClose={state.close}
        label="Meeting actions"
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Focus sessions                                                      */
/* ------------------------------------------------------------------ */

export interface SessionMenuPayload {
  sessionId: string;
  blockId: string;
  title: string;
}

export function useSessionContextMenu(): EntityMenuHandle<SessionMenuPayload> {
  const queryClient = useQueryClient();
  const { openSessionDrawer, openBlockDrawer, activeDrawer, closeDrawer } = useAppShell();
  const state = useContextMenuState<SessionMenuPayload>();

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => apiClient.deleteSession(sessionId),
    onSettled: () => invalidateBlockRelated(queryClient),
  });

  const session = state.payload;
  const items: Array<ContextMenuEntry | null | false> = session
    ? [
        {
          id: 'session',
          label: 'Open Session Details & Trim/Split',
          icon: <Scissors size={ICON} />,
          onSelect: () => openSessionDrawer(session.sessionId),
        },
        {
          id: 'block',
          label: 'Open Block',
          icon: <PanelRight size={ICON} />,
          onSelect: () => openBlockDrawer(session.blockId),
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'delete',
          label: 'Delete Session',
          icon: <Trash2 size={ICON} />,
          destructive: true,
          onSelect: () => {
            if (activeDrawer?.kind === 'session' && activeDrawer.sessionId === session.sessionId) {
              closeDrawer();
            }
            deleteMutation.mutate(session.sessionId);
          },
        },
      ]
    : [];

  return {
    open: state.open,
    menu: (
      <ContextMenu
        position={state.position}
        header={session?.title}
        items={items}
        onClose={state.close}
        label="Session actions"
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export function useProjectContextMenu(): EntityMenuHandle<ProjectWithStats> {
  const queryClient = useQueryClient();
  const { openCreateBlock, openEditProject, activeProjectId, navigate } = useAppShell();
  const state = useContextMenuState<ProjectWithStats>();

  const refresh = () => void invalidateAllVeyraData(queryClient);
  const leaveIfActive = (projectId: string) => {
    if (activeProjectId === projectId) navigate('projects');
  };

  const pinMutation = useMutation({
    mutationFn: (p: ProjectWithStats) => apiClient.updateProject(p.id, { isPinned: !p.isPinned }),
    onSettled: refresh,
  });
  const archiveMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiClient.updateProject(projectId, { status: 'archived', isPinned: false }),
    onSuccess: (_d, projectId) => leaveIfActive(projectId),
    onSettled: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => apiClient.deleteProject(projectId),
    onSuccess: (_d, projectId) => leaveIfActive(projectId),
    onSettled: refresh,
  });

  const project = state.payload;
  const items: Array<ContextMenuEntry | null | false> = project
    ? [
        {
          id: 'new-block',
          label: 'New Block',
          icon: <Plus size={ICON} />,
          onSelect: () =>
            openCreateBlock({
              projectId: project.id,
              ...(project.defaultGoalId ? { goalId: project.defaultGoalId } : {}),
            }),
        },
        {
          id: 'edit',
          label: 'Edit Project',
          icon: <Pencil size={ICON} />,
          onSelect: () => openEditProject(project.id),
        },
        project.status !== 'archived' && {
          id: 'pin',
          label: project.isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar',
          icon: project.isPinned ? <PinOff size={ICON} /> : <Pin size={ICON} />,
          onSelect: () => pinMutation.mutate(project),
        },
        !project.isSystem && { type: 'divider', id: 'd1' },
        !project.isSystem &&
          project.status !== 'archived' && {
            id: 'archive',
            label: 'Archive Project',
            icon: <Archive size={ICON} />,
            onSelect: () => archiveMutation.mutate(project.id),
          },
        !project.isSystem && {
          id: 'delete',
          label: 'Delete Project',
          icon: <Trash2 size={ICON} />,
          destructive: true,
          onSelect: () => deleteMutation.mutate(project.id),
        },
      ]
    : [];

  return {
    open: state.open,
    menu: (
      <ContextMenu
        position={state.position}
        header={project?.name}
        items={items}
        onClose={state.close}
        label="Project actions"
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export function useGoalContextMenu(): EntityMenuHandle<Goal> {
  const queryClient = useQueryClient();
  const {
    openGoalDrawer,
    openEditGoal,
    openCloseGoal,
    openCreateBlock,
    navigate,
    activeDrawer,
    closeDrawer,
  } = useAppShell();
  const state = useContextMenuState<Goal>();

  const refresh = () => void invalidateAllVeyraData(queryClient);

  const reorderMutation = useMutation({
    mutationFn: (vars: { goalId: string; direction: 'up' | 'down' }) =>
      apiClient.reorderGoal(vars.goalId, { direction: vars.direction }),
    onSettled: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: (goalId: string) => apiClient.deleteGoal(goalId),
    onSuccess: (_d, goalId) => {
      if (activeDrawer?.kind === 'goal' && activeDrawer.goalId === goalId) {
        closeDrawer();
      }
    },
    onSettled: refresh,
  });

  const goal = state.payload;
  const items: Array<ContextMenuEntry | null | false> = goal
    ? [
        {
          id: 'details',
          label: 'Open Details',
          icon: <PanelRight size={ICON} />,
          onSelect: () => openGoalDrawer(goal.id),
        },
        {
          id: 'edit',
          label: 'Edit Goal',
          icon: <Pencil size={ICON} />,
          onSelect: () => openEditGoal(goal.id),
        },
        {
          id: 'new-block',
          label: 'New Block for this Goal',
          icon: <Plus size={ICON} />,
          onSelect: () => openCreateBlock({ goalId: goal.id }),
        },
        {
          id: 'review',
          label: 'Show in Review',
          icon: <CheckCircle2 size={ICON} />,
          onSelect: () => navigate('review'),
        },
        {
          id: 'move-up',
          label: 'Move Up',
          icon: <ArrowUp size={ICON} />,
          onSelect: () => reorderMutation.mutate({ goalId: goal.id, direction: 'up' }),
        },
        {
          id: 'move-down',
          label: 'Move Down',
          icon: <ArrowDown size={ICON} />,
          onSelect: () => reorderMutation.mutate({ goalId: goal.id, direction: 'down' }),
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'achieved',
          label: 'Mark Achieved',
          icon: <Trophy size={ICON} className="text-[#7BE0A0]" />,
          onSelect: () => openCloseGoal(goal.id, 'achieved'),
        },
        {
          id: 'let-go',
          label: 'Let Go',
          icon: <Archive size={ICON} />,
          onSelect: () => openCloseGoal(goal.id, 'archived'),
        },
        {
          id: 'delete',
          label: 'Delete Goal',
          icon: <Trash2 size={ICON} />,
          destructive: true,
          onSelect: () => deleteMutation.mutate(goal.id),
        },
      ]
    : [];

  return {
    open: state.open,
    menu: (
      <ContextMenu
        position={state.position}
        header={goal?.name}
        items={items}
        onClose={state.close}
        label="Goal actions"
      />
    ),
  };
}
