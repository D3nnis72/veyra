import { useQueryClient } from '@tanstack/react-query';
import type { GoalKind } from '@veyra/core/types';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, type DesktopCommandAction, isElectronDesktop } from '../api/client';
import {
  invalidateBlockRelated,
  useFocusQuery,
  useGoalsQuery,
  useProjectsQuery,
  useSettingsQuery,
} from '../api/queries';
import { useLiveSync } from '../api/use-live-sync';
import { BlockDetailDrawer } from '../components/BlockDetailDrawer';
import { DailyNotesDrawer } from '../components/DailyNotesDrawer';
import {
  type ActiveDrawer,
  type AppRoute,
  AppShellContext,
  type AppShellContextValue,
  type CreateBlockDefaults,
  type SettingsSection,
} from './AppShellContext';
import { CommandPalette } from './CommandPalette';
import { CreateBlockModal } from './CreateBlockModal';
import { matchesAnyAccelerator, useHotkeys } from './hotkeys';
import { OnboardingFlow } from './OnboardingFlow';
import { QuickCaptureOverlay, type QuickCaptureTab } from './QuickCaptureOverlay';
import { Sidebar } from './Sidebar';
import { CalendarView } from '../views/CalendarView';
import { CloseGoalSheet } from '../views/CloseGoalSheet';
import { FocusView } from '../views/FocusView';
import { GoalDetailDrawer } from '../views/GoalDetailDrawer';
import { GoalFormDrawer } from '../views/GoalFormDrawer';
import { GoalsView } from '../views/GoalsView';
import { MeetingDetailDrawer } from '../views/MeetingDetailDrawer';
import { PlanView } from '../views/PlanView';
import { ProjectDetailView } from '../views/ProjectDetailView';
import { ProjectModal } from '../views/ProjectModal';
import { ProjectsView } from '../views/ProjectsView';
import { ReviewView } from '../views/ReviewView';
import { SessionDetailDrawer } from '../views/SessionDetailDrawer';
import { SettingsView } from '../views/SettingsView';
import { TodayView } from '../views/TodayView';

export interface AppViewsRegistry {
  today?: () => ReactNode;
  focus?: () => ReactNode;
  plan?: () => ReactNode;
  calendar?: () => ReactNode;
  projects?: () => ReactNode;
  projectDetail?: (projectId: string) => ReactNode;
  goals?: () => ReactNode;
  review?: () => ReactNode;
  settings?: (section: SettingsSection) => ReactNode;
  renderExtraDrawer?: (drawer: ActiveDrawer, onClose: () => void) => ReactNode;
}

export interface AppProps {
  views?: AppViewsRegistry;
}

function isStandaloneRoute(name: 'capture' | 'command'): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname === `/${name}` ||
    window.location.pathname.endsWith(`/${name}`) ||
    window.location.hash === `#/${name}`
  );
}

const COMMAND_ROUTES = new Set<AppRoute>([
  'today',
  'focus',
  'plan',
  'calendar',
  'projects',
  'project-detail',
  'goals',
  'review',
  'settings',
]);
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  'integrations',
  'server',
  'appearance',
]);

export function App({ views }: AppProps) {
  if (isStandaloneRoute('capture')) {
    return <QuickCaptureOverlay open standalone />;
  }
  if (isStandaloneRoute('command')) {
    return <CommandPalette open standalone />;
  }

  return <MainAppShell views={views} />;
}

function MainAppShell({ views }: AppProps) {
  const queryClient = useQueryClient();
  const liveSyncStatus = useLiveSync(true);

  const settingsQuery = useSettingsQuery();
  const hotkeys = useHotkeys();
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const goalsQuery = useGoalsQuery({ activeOnly: true });
  const focusQuery = useFocusQuery();

  const [route, setRoute] = useState<AppRoute>('today');
  const [previousRoute, setPreviousRoute] = useState<AppRoute>('today');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('integrations');
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [quickCaptureState, setQuickCaptureState] = useState<{
    open: boolean;
    tab: QuickCaptureTab;
  }>({ open: false, tab: 'daily-note' });
  const [createBlockState, setCreateBlockState] = useState<{
    open: boolean;
    defaults?: CreateBlockDefaults;
  }>({ open: false });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [goalFormState, setGoalFormState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    goalId?: string | null;
    defaultKind?: GoalKind;
  }>({ open: false, mode: 'create' });
  const [closeGoalState, setCloseGoalState] = useState<{
    open: boolean;
    goalId: string | null;
    initialStatus: 'achieved' | 'archived';
  }>({ open: false, goalId: null, initialStatus: 'achieved' });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const focusStatus = focusQuery.data ?? null;

  // Live 1-second timer tick derived from activeSession.startedAt
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);
  useEffect(() => {
    const activeSession = focusStatus?.activeSession;
    if (!activeSession) {
      setLiveElapsedSeconds(0);
      return;
    }

    const computeElapsed = () => {
      const startMs = Date.parse(activeSession.startedAt);
      if (Number.isNaN(startMs)) return focusStatus.elapsedSeconds ?? 0;
      return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    };

    setLiveElapsedSeconds(computeElapsed());
    const interval = window.setInterval(() => {
      setLiveElapsedSeconds(computeElapsed());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focusStatus?.activeSession?.id, focusStatus?.activeSession?.startedAt]);

  const navigate = useCallback(
    (nextRoute: AppRoute, opts?: { projectId?: string; settingsSection?: SettingsSection }) => {
      setRoute((current) => {
        if (current !== nextRoute && current !== 'settings') {
          setPreviousRoute(current);
        }
        return nextRoute;
      });
      setActiveDrawer(null);
      if (opts?.projectId !== undefined) {
        setActiveProjectId(opts.projectId);
      }
      if (opts?.settingsSection) {
        setSettingsSection(opts.settingsSection);
      }
    },
    [],
  );

  const openProject = useCallback(
    (projectId: string) => {
      navigate('project-detail', { projectId });
    },
    [navigate],
  );

  const openBlockDrawer = useCallback((blockId: string) => {
    setActiveDrawer({ kind: 'block', blockId });
  }, []);

  const openGoalDrawer = useCallback((goalId: string) => {
    setGoalFormState((prev) => ({ ...prev, open: false }));
    setActiveDrawer({ kind: 'goal', goalId });
  }, []);

  const openCreateGoal = useCallback((defaultKind: GoalKind = 'personal') => {
    setCommandPaletteOpen(false);
    setQuickCaptureState((prev) => ({ ...prev, open: false }));
    setActiveDrawer(null);
    setGoalFormState({ open: true, mode: 'create', goalId: null, defaultKind });
  }, []);

  const openEditGoal = useCallback((goalId: string) => {
    setCommandPaletteOpen(false);
    setQuickCaptureState((prev) => ({ ...prev, open: false }));
    setActiveDrawer(null);
    setGoalFormState({ open: true, mode: 'edit', goalId });
  }, []);

  const openCloseGoal = useCallback(
    (goalId: string, initialStatus: 'achieved' | 'archived' = 'achieved') => {
      setCloseGoalState({ open: true, goalId, initialStatus });
    },
    [],
  );

  const openDailyNotesDrawer = useCallback((date?: string) => {
    setActiveDrawer({ kind: 'daily-notes', date });
  }, []);

  const openMeetingDrawer = useCallback((eventId: string) => {
    setActiveDrawer({ kind: 'meeting', eventId });
  }, []);

  const openSessionDrawer = useCallback((sessionId: string) => {
    setActiveDrawer({ kind: 'session', sessionId });
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  const openCommandPalette = useCallback(() => {
    setQuickCaptureState((prev) => ({ ...prev, open: false }));
    setCreateBlockState({ open: false });
    setCommandPaletteOpen(true);
  }, []);

  const openQuickCapture = useCallback((tab: QuickCaptureTab = 'daily-note') => {
    setCommandPaletteOpen(false);
    setCreateBlockState({ open: false });
    setQuickCaptureState({ open: true, tab });
  }, []);

  const openCreateBlock = useCallback((defaults?: CreateBlockDefaults) => {
    setCommandPaletteOpen(false);
    setQuickCaptureState((prev) => ({ ...prev, open: false }));
    setCreateBlockState({ open: true, defaults });
  }, []);

  const openEditProject = useCallback((projectId: string) => {
    setCommandPaletteOpen(false);
    setQuickCaptureState((prev) => ({ ...prev, open: false }));
    setEditingProjectId(projectId);
  }, []);

  const startFocusAndNavigate = useCallback(
    async (blockId: string) => {
      await apiClient.startFocus(blockId);
      invalidateBlockRelated(queryClient, blockId);
      setActiveDrawer(null);
      navigate('focus');
    },
    [queryClient, navigate],
  );

  // Actions picked in the floating desktop command window (⌥K) arrive here over IPC.
  useEffect(() => {
    const subscribe = window.veyraDesktop?.onCommandAction;
    if (!subscribe) return;
    return subscribe((action: DesktopCommandAction) => {
      setCommandPaletteOpen(false);
      setQuickCaptureState((prev) => ({ ...prev, open: false }));
      switch (action.type) {
        case 'navigate': {
          const nextRoute = action.route as AppRoute;
          if (!COMMAND_ROUTES.has(nextRoute)) return;
          if (nextRoute === 'project-detail' && action.projectId) {
            openProject(action.projectId);
            return;
          }
          const section = action.settingsSection as SettingsSection | undefined;
          navigate(nextRoute, {
            settingsSection: section && SETTINGS_SECTIONS.has(section) ? section : undefined,
          });
          return;
        }
        case 'start-focus':
          void startFocusAndNavigate(action.blockId).catch(() => {});
          return;
        case 'open-block':
          openBlockDrawer(action.blockId);
          return;
        case 'open-create-block':
          openCreateBlock(action.title ? { title: action.title } : undefined);
          return;
        case 'open-daily-notes':
          openDailyNotesDrawer();
          return;
        case 'open-quick-capture':
          openQuickCapture();
          return;
      }
    });
  }, [
    navigate,
    openProject,
    startFocusAndNavigate,
    openBlockDrawer,
    openCreateBlock,
    openDailyNotesDrawer,
    openQuickCapture,
  ]);

  // In-window keyboard shortcuts. The rebindable ones come from Settings → Shortcuts
  // (defaults: ⌘K palette, ⌘N new block, ⌘S save, ⌘, settings, ⌘⇧P capture, ⌘⇧O / ⌃O Focus Now).
  // ⌘1-6 and Esc stay fixed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (matchesAnyAccelerator(e, hotkeys.quickFocus)) {
        e.preventDefault();
        setCommandPaletteOpen(false);
        setCreateBlockState({ open: false });
        if (focusStatus?.activeSession && focusStatus?.activeBlock) {
          setQuickCaptureState((prev) => ({ ...prev, open: false }));
          navigate('focus');
          return;
        }
        setQuickCaptureState((prev) =>
          prev.open && prev.tab === 'focus'
            ? { open: false, tab: 'focus' }
            : { open: true, tab: 'focus' },
        );
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.commandPalette)) {
        e.preventDefault();
        setQuickCaptureState((prev) => ({ ...prev, open: false }));
        setCreateBlockState({ open: false });
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.quickCapture)) {
        e.preventDefault();
        setCommandPaletteOpen(false);
        setCreateBlockState({ open: false });
        setQuickCaptureState((prev) =>
          prev.open && prev.tab === 'daily-note'
            ? { open: false, tab: 'daily-note' }
            : { open: true, tab: 'daily-note' },
        );
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.newBlock)) {
        e.preventDefault();
        setCommandPaletteOpen(false);
        setQuickCaptureState((prev) => ({ ...prev, open: false }));
        setCreateBlockState({ open: true });
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.saveDrawer)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('veyra:save'));
        return;
      }

      if (matchesAnyAccelerator(e, hotkeys.openSettings)) {
        e.preventDefault();
        navigate('settings', { settingsSection: 'integrations' });
        return;
      }

      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const navByDigit: Record<string, AppRoute> = {
          '1': 'today',
          '2': 'plan',
          '3': 'calendar',
          '4': 'projects',
          '5': 'goals',
          '6': 'review',
        };
        if (navByDigit[key]) {
          e.preventDefault();
          navigate(navByDigit[key]);
          return;
        }
      }

      if (e.key === 'Escape') {
        if (closeGoalState.open) {
          setCloseGoalState((prev) => ({ ...prev, open: false }));
        } else if (goalFormState.open) {
          setGoalFormState((prev) => ({ ...prev, open: false }));
        } else if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (quickCaptureState.open) {
          setQuickCaptureState((prev) => ({ ...prev, open: false }));
        } else if (createBlockState.open) {
          setCreateBlockState({ open: false });
        } else if (activeDrawer) {
          setActiveDrawer(null);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeGoalState.open,
    goalFormState.open,
    commandPaletteOpen,
    quickCaptureState.open,
    createBlockState.open,
    activeDrawer,
    focusStatus,
    navigate,
    hotkeys,
  ]);

  const shellValue = useMemo<AppShellContextValue>(
    () => ({
      route,
      previousRoute,
      activeProjectId,
      settingsSection,
      activeDrawer,
      liveSyncStatus,
      focusStatus,
      liveElapsedSeconds,
      projects: projectsQuery.data?.projects ?? [],
      goals: goalsQuery.data?.goals ?? [],
      settings: settingsQuery.data?.settings ?? null,
      navigate,
      openProject,
      setSettingsSection,
      openBlockDrawer,
      openGoalDrawer,
      openCreateGoal,
      openEditGoal,
      openCloseGoal,
      openDailyNotesDrawer,
      openMeetingDrawer,
      openSessionDrawer,
      closeDrawer,
      openCommandPalette,
      openQuickCapture,
      openCreateBlock,
      openEditProject,
      startFocusAndNavigate,
    }),
    [
      route,
      previousRoute,
      activeProjectId,
      settingsSection,
      activeDrawer,
      liveSyncStatus,
      focusStatus,
      liveElapsedSeconds,
      projectsQuery.data,
      goalsQuery.data,
      settingsQuery.data,
      navigate,
      openProject,
      openBlockDrawer,
      openGoalDrawer,
      openCreateGoal,
      openEditGoal,
      openCloseGoal,
      openDailyNotesDrawer,
      openMeetingDrawer,
      openSessionDrawer,
      closeDrawer,
      openCommandPalette,
      openQuickCapture,
      openCreateBlock,
      openEditProject,
      startFocusAndNavigate,
    ],
  );

  const showOnboarding =
    !onboardingDismissed && settingsQuery.data?.settings.onboardingCompleted === false;

  const renderActiveRoute = () => {
    switch (route) {
      case 'today':
        return views?.today ? views.today() : <TodayView />;
      case 'focus':
        return views?.focus ? views.focus() : <FocusView />;
      case 'plan':
        return views?.plan ? views.plan() : <PlanView />;
      case 'calendar':
        return views?.calendar ? views.calendar() : <CalendarView />;
      case 'projects':
        return views?.projects ? views.projects() : <ProjectsView />;
      case 'project-detail':
        if (views?.projectDetail && activeProjectId) {
          return views.projectDetail(activeProjectId);
        }
        return activeProjectId ? <ProjectDetailView projectId={activeProjectId} /> : <ProjectsView />;
      case 'goals':
        return views?.goals ? views.goals() : <GoalsView />;
      case 'review':
        return views?.review ? views.review() : <ReviewView />;
      case 'settings':
        return views?.settings ? (
          views.settings(settingsSection)
        ) : (
          <SettingsView section={settingsSection} />
        );
    }
  };

  const inElectron = isElectronDesktop();
  const isFocusRoute = route === 'focus';
  const closeGoalTarget = closeGoalState.goalId
    ? (goalsQuery.data?.goals.find((g) => g.id === closeGoalState.goalId) ?? null)
    : null;

  return (
    <AppShellContext.Provider value={shellValue}>
      <div className="h-screen w-screen overflow-hidden flex bg-[#131313] text-[#EDEDED]">
        {!isFocusRoute ? <Sidebar /> : null}

        <div className="flex-1 min-w-0 h-full flex flex-col bg-[#131313]">
          {inElectron && !isFocusRoute ? <div className="veyra-drag-region h-7 shrink-0" /> : null}
          {/* Only Focus reserves room for the docked drawer; every other view lets it overlay. */}
          <main
            className={`flex-1 min-h-0 overflow-y-auto transition-[padding] duration-200 ${
              activeDrawer && isFocusRoute ? 'lg:pr-[520px]' : ''
            }`}
          >
            {renderActiveRoute()}
          </main>
        </div>

        {/* Shared Docked Right Drawers */}
        <BlockDetailDrawer
          blockId={activeDrawer?.kind === 'block' ? activeDrawer.blockId : null}
          onClose={closeDrawer}
          onStartFocus={(id) => void startFocusAndNavigate(id)}
        />

        <GoalDetailDrawer
          goalId={activeDrawer?.kind === 'goal' ? activeDrawer.goalId : null}
          onClose={closeDrawer}
          dismissOnEscape={false}
        />

        <GoalFormDrawer
          open={goalFormState.open}
          mode={goalFormState.mode}
          goalId={goalFormState.goalId}
          defaultKind={goalFormState.defaultKind}
          onClose={() => setGoalFormState((prev) => ({ ...prev, open: false }))}
          dismissOnEscape={false}
        />

        <DailyNotesDrawer
          open={activeDrawer?.kind === 'daily-notes'}
          date={activeDrawer?.kind === 'daily-notes' ? activeDrawer.date : undefined}
          onClose={closeDrawer}
        />

        <MeetingDetailDrawer
          eventId={activeDrawer?.kind === 'meeting' ? activeDrawer.eventId : null}
          onClose={closeDrawer}
        />

        <SessionDetailDrawer
          sessionId={activeDrawer?.kind === 'session' ? activeDrawer.sessionId : null}
          onClose={closeDrawer}
        />

        {views?.renderExtraDrawer ? views.renderExtraDrawer(activeDrawer, closeDrawer) : null}

        {/* Global Overlays */}
        <CloseGoalSheet
          open={closeGoalState.open}
          goal={closeGoalTarget}
          goalId={closeGoalState.goalId}
          initialStatus={closeGoalState.initialStatus}
          onClose={() => setCloseGoalState((prev) => ({ ...prev, open: false }))}
          dismissOnEscape={false}
          onClosed={() => {
            if (activeDrawer?.kind === 'goal' && activeDrawer.goalId === closeGoalState.goalId) {
              closeDrawer();
            }
          }}
        />

        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />

        <QuickCaptureOverlay
          open={quickCaptureState.open}
          initialTab={quickCaptureState.tab}
          onClose={() => setQuickCaptureState((prev) => ({ ...prev, open: false }))}
        />

        <CreateBlockModal
          open={createBlockState.open}
          defaults={createBlockState.defaults}
          onClose={() => setCreateBlockState({ open: false })}
        />

        <ProjectModal
          open={Boolean(editingProjectId)}
          project={
            editingProjectId
              ? (projectsQuery.data?.projects.find((p) => p.id === editingProjectId) ?? null)
              : null
          }
          onClose={() => setEditingProjectId(null)}
          onDeleted={(deletedId) => {
            if (activeProjectId === deletedId) {
              navigate('projects');
            }
            setEditingProjectId(null);
          }}
        />

        <OnboardingFlow
          open={showOnboarding}
          onComplete={() => setOnboardingDismissed(true)}
        />
      </div>
    </AppShellContext.Provider>
  );
}
