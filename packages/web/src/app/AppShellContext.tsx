import type {
  BlockBucket,
  FocusStatus,
  GoalKind,
  GoalWithStats,
  ProjectWithStats,
  PublicSettings,
} from '@veyra/core/types';
import { createContext, useContext } from 'react';
import type { LiveSyncStatus } from '../api/use-live-sync';

export type AppRoute =
  | 'today'
  | 'focus'
  | 'plan'
  | 'calendar'
  | 'projects'
  | 'project-detail'
  | 'goals'
  | 'review'
  | 'settings';

export type SettingsSection = 'integrations' | 'server' | 'appearance';

export type ActiveDrawer =
  | { kind: 'block'; blockId: string }
  | { kind: 'goal'; goalId: string }
  | { kind: 'daily-notes'; date?: string }
  | { kind: 'session'; sessionId: string }
  | null;

export interface CreateBlockDefaults {
  title?: string;
  projectId?: string;
  goalId?: string | null;
  bucket?: BlockBucket;
  scheduledDate?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  isOps?: boolean;
}

export interface AppShellContextValue {
  route: AppRoute;
  previousRoute: AppRoute;
  activeProjectId: string | null;
  settingsSection: SettingsSection;
  activeDrawer: ActiveDrawer;
  liveSyncStatus: LiveSyncStatus;
  focusStatus: FocusStatus | null;
  liveElapsedSeconds: number;
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
  settings: PublicSettings | null;
  navigate: (route: AppRoute, opts?: { projectId?: string; settingsSection?: SettingsSection }) => void;
  openProject: (projectId: string) => void;
  setSettingsSection: (section: SettingsSection) => void;
  openBlockDrawer: (blockId: string) => void;
  openGoalDrawer: (goalId: string) => void;
  openCreateGoal: (defaultKind?: GoalKind) => void;
  openEditGoal: (goalId: string) => void;
  openCloseGoal: (goalId: string, initialStatus?: 'achieved' | 'archived') => void;
  openDailyNotesDrawer: (date?: string) => void;
  openMeetingDrawer: (eventId: string) => void;
  openSessionDrawer: (sessionId: string) => void;
  closeDrawer: () => void;
  openCommandPalette: () => void;
  openQuickCapture: () => void;
  openCreateBlock: (defaults?: CreateBlockDefaults) => void;
  openEditProject: (projectId: string) => void;
  startFocusAndNavigate: (blockId: string) => Promise<void>;
}

export const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) {
    throw new Error('useAppShell must be used inside <AppShellContext.Provider>');
  }
  return ctx;
}
