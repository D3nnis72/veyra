import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  CalendarRange,
  CheckCircle2,
  FolderKanban,
  NotebookPen,
  Palette,
  Plug,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Sun,
  Target,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient, isElectronDesktop } from '../api/client';
import { invalidateBlockRelated } from '../api/queries';
import { GoalKindIconBadge } from '../components/GoalChip';
import { ProjectBadge } from '../components/ProjectBadge';
import { useGoalContextMenu, useProjectContextMenu } from '../components/entityMenus';
import { formatElapsedTimer } from '../components/icons';
import { type AppRoute, type SettingsSection, useAppShell } from './AppShellContext';

interface PrimaryNavItem {
  id: AppRoute;
  label: string;
  icon: typeof Sun;
}

const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'plan', label: 'Plan', icon: CalendarRange },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'review', label: 'Review', icon: CheckCircle2 },
];

interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: typeof Plug;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'server', label: 'Server & CLI', icon: Server },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

/**
 * Running-focus pill. Click opens the Focus view; the X cancels the session and discards its
 * time, behind a one-click confirmation so a stray click does not delete tracked work.
 */
function LiveFocusPill({
  title,
  blockId,
  elapsedSeconds,
  onOpen,
}: {
  title: string;
  blockId: string;
  elapsedSeconds: number;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const cancelMutation = useMutation({
    mutationFn: () => apiClient.cancelFocus(),
    onSuccess: () => {
      setConfirming(false);
      invalidateBlockRelated(queryClient, blockId);
    },
  });

  if (confirming) {
    return (
      <div className="veyra-no-drag w-full px-3 py-2 rounded-[9px] bg-[#3A2410] border border-[#D9772B]/50 flex items-center justify-between gap-2">
        <span className="text-[12px] text-[#F5B27A] truncate">Discard this session?</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="h-6 px-2 rounded-[6px] text-[11px] font-medium bg-[#D9772B] text-[#1C1C1C] hover:bg-[#E48A42] transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-6 px-2 rounded-[6px] text-[11px] font-medium text-[#F5B27A] hover:bg-white/[0.08] transition-colors"
          >
            Keep
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="veyra-no-drag w-full rounded-[9px] bg-[#1F2759] border border-[#5566F2]/45 hover:bg-[#27316E] transition-colors flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 pl-3 pr-1 py-2.5 flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#4DA3FF] animate-pulse shrink-0" />
          <span className="text-[12.5px] font-medium text-[#D6DCFF] truncate">{title}</span>
        </span>
        <span className="text-[12px] font-semibold text-[#AEB8FF] tabular-nums shrink-0">
          {formatElapsedTimer(elapsedSeconds)}
        </span>
      </button>
      <button
        type="button"
        aria-label="Cancel focus session"
        title="Cancel focus (discards this session)"
        onClick={() => setConfirming(true)}
        className="h-6 w-6 mr-1.5 rounded-[6px] inline-flex items-center justify-center text-[#9AA4E8] hover:text-[#EDEDED] hover:bg-white/[0.1] transition-colors shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function Sidebar() {
  const {
    route,
    previousRoute,
    activeProjectId,
    activeDrawer,
    settingsSection,
    focusStatus,
    liveElapsedSeconds,
    projects,
    goals,
    navigate,
    openProject,
    openGoalDrawer,
    openCreateGoal,
    setSettingsSection,
    openCommandPalette,
    openCreateBlock,
    openDailyNotesDrawer,
  } = useAppShell();

  const projectMenu = useProjectContextMenu();
  const goalMenu = useGoalContextMenu();

  const inElectron = isElectronDesktop();
  const pinnedProjects = projects.filter(
    (p) => p.isPinned && !p.deletedAt && p.status !== 'archived',
  );
  const activeGoals = (goals ?? []).filter((g) => g.status === 'active' && !g.deletedAt);
  const personalGoals = activeGoals.filter((g) => g.kind === 'personal');
  const companyGoals = activeGoals.filter((g) => g.kind === 'company');

  const hasRunningFocus = Boolean(focusStatus?.activeSession && focusStatus?.activeBlock);
  const showLiveFocusPill = hasRunningFocus && route !== 'focus';

  if (route === 'settings') {
    const backTarget = previousRoute === 'settings' ? 'today' : previousRoute;
    const backLabel =
      backTarget === 'today'
        ? 'Back to Today'
        : backTarget === 'project-detail'
          ? 'Back to Project'
          : `Back to ${backTarget.charAt(0).toUpperCase()}${backTarget.slice(1)}`;

    return (
      <aside
        aria-label="Settings navigation"
        className="veyra-glass-sidebar w-[240px] shrink-0 h-full flex flex-col select-none"
      >
        <div
          className={`veyra-drag-region shrink-0 flex items-center px-3.5 ${
            inElectron ? 'h-12 pt-2' : 'h-4'
          }`}
        />

        <div className="px-3.5 pb-4">
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            className="veyra-no-drag w-full h-9 px-3 rounded-[8px] bg-[#262626]/70 border border-[#323232] flex items-center gap-2 text-[13px] font-medium text-[#EDEDED] hover:bg-[#2A2A2A] transition-colors"
          >
            <ArrowLeft size={14} className="text-[#9A9A9A]" />
            <span>{backLabel}</span>
          </button>
        </div>

        <div className="px-4 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
          Settings
        </div>

        <nav className="flex-1 px-3.5 space-y-1 overflow-y-auto">
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon;
            const active = settingsSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSettingsSection(item.id)}
                className={[
                  'veyra-no-drag w-full h-9 px-3 rounded-[8px] flex items-center gap-2.5 text-[13.5px] font-medium transition-colors border',
                  active
                    ? 'bg-[var(--veyra-nav-active-bg)] border-[var(--veyra-nav-active-border)] text-[var(--veyra-nav-active-text)]'
                    : 'border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-white/[0.05]',
                ].join(' ')}
              >
                <Icon size={15} className={active ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {showLiveFocusPill && focusStatus?.activeBlock ? (
          <div className="px-3.5 pb-3.5">
            <LiveFocusPill
              title={focusStatus.activeBlock.title}
              blockId={focusStatus.activeBlock.id}
              elapsedSeconds={liveElapsedSeconds}
              onOpen={() => navigate('focus')}
            />
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      aria-label="Primary navigation"
      className="veyra-glass-sidebar w-[240px] shrink-0 h-full flex flex-col select-none"
    >
      {/* Top macOS traffic-light clearance */}
      <div
        className={`veyra-drag-region shrink-0 flex items-center justify-end px-3.5 ${
          inElectron ? 'h-12' : 'h-4'
        }`}
      />

      {/* Search... ⌘K Glass Pill Trigger (Figma: 38px) */}
      <div className="px-3.5 pb-3.5">
        <button
          type="button"
          onClick={openCommandPalette}
          title={inElectron ? 'Search (⌘K in Veyra, ⌥K anywhere)' : 'Search (⌘K)'}
          className="veyra-no-drag w-full h-[38px] px-3 rounded-[9px] bg-white/[0.045] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.07] hover:border-white/[0.16] flex items-center justify-between gap-2 text-[13px] text-[#9A9A9A] transition-colors"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Search size={14} className="text-[#8A8A8A] shrink-0" />
            <span className="truncate">Search…</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {inElectron ? (
              <kbd className="text-[10.5px] font-medium text-[#6E6E6E] bg-white/[0.05] px-1.5 py-0.5 rounded-[5px] border border-white/[0.08]">
                ⌥K
              </kbd>
            ) : null}
            <kbd className="text-[10.5px] font-medium text-[#8A8A8A] bg-white/[0.05] px-1.5 py-0.5 rounded-[5px] border border-white/[0.08]">
              ⌘K
            </kbd>
          </span>
        </button>
      </div>

      {/* Primary Views */}
      <nav className="px-3.5 space-y-1 shrink-0">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = route === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              className={[
                'veyra-no-drag w-full h-9 px-3 rounded-[8px] flex items-center gap-3 text-[13.5px] font-medium transition-colors border',
                active
                  ? 'bg-[var(--veyra-nav-active-bg)] border-[var(--veyra-nav-active-border)] text-[var(--veyra-nav-active-text)]'
                  : 'border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-white/[0.05]',
              ].join(' ')}
            >
              <Icon size={16} className={active ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Scrollable PINNED Projects + GOALS sections */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-3 pt-3 border-t border-white/[0.06] space-y-4">
        {/* Unlimited PINNED Projects */}
        <div>
          <div className="px-4 pb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Pinned
            </span>
            <button
              type="button"
              onClick={() => openCreateBlock()}
              title="New Block (⌘N)"
              className="veyra-no-drag h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#EDEDED] hover:bg-white/[0.07] transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          <div className="px-3.5 space-y-1">
            {pinnedProjects.length === 0 ? (
              <div className="px-3 py-1.5 text-[12.5px] text-[#6E6E6E]">
                Pin any project to keep it here
              </div>
            ) : (
              pinnedProjects.map((project) => {
                const active = route === 'project-detail' && activeProjectId === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => openProject(project.id)}
                    onContextMenu={(e) => projectMenu.open(e, project)}
                    title="Right-click for project actions"
                    className={[
                      'veyra-no-drag w-full h-9 px-2.5 rounded-[8px] flex items-center justify-between gap-2 text-[13.5px] font-medium transition-colors border',
                      active
                        ? 'bg-[var(--veyra-nav-active-bg)] border-[var(--veyra-nav-active-border)] text-[var(--veyra-nav-active-text)]'
                        : 'border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-white/[0.05]',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <ProjectBadge
                        name={project.name}
                        color={project.color}
                        icon={project.icon}
                        size="sm"
                      />
                      <span className="truncate">{project.name}</span>
                    </span>
                    {project.openBlockCount > 0 ? (
                      <span className="text-[11.5px] text-[#6E6E6E] tabular-nums shrink-0">
                        {project.openBlockCount}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Active GOALS grouped under Personal and Company (zero weekly time bars) */}
        <div className="pt-3 border-t border-white/[0.06] pb-3" aria-label="Sidebar goals">
          <div className="px-4 pb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6E6E6E]">
              Goals
            </span>
            <button
              type="button"
              onClick={() => openCreateGoal('personal')}
              aria-label="New Goal"
              title="New Goal"
              className="veyra-no-drag h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#EDEDED] hover:bg-white/[0.07] transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          <div className="px-3.5 space-y-2.5">
            {activeGoals.length === 0 ? (
              <div className="px-3 py-1 text-[12px] text-[#6E6E6E]">No active goals</div>
            ) : (
              <>
                {personalGoals.length > 0 ? (
                  <div className="space-y-0.5">
                    <div className="px-2.5 pb-1 text-[10.5px] font-medium text-[#6E6E6E]">
                      Personal
                    </div>
                    {personalGoals.map((goal) => {
                      const active = activeDrawer?.kind === 'goal' && activeDrawer.goalId === goal.id;
                      return (
                        <button
                          key={goal.id}
                          type="button"
                          onClick={() => openGoalDrawer(goal.id)}
                          onContextMenu={(e) => goalMenu.open(e, goal)}
                          title="Right-click for goal actions"
                          className={[
                            'veyra-no-drag w-full h-8 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13px] font-medium transition-colors border text-left',
                            active
                              ? 'bg-[var(--veyra-nav-active-bg)] border-[var(--veyra-nav-active-border)] text-[var(--veyra-nav-active-text)]'
                              : 'border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-white/[0.05]',
                          ].join(' ')}
                        >
                          <GoalKindIconBadge kind={goal.kind} color={goal.color} size="xs" />
                          <span className="truncate">{goal.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {companyGoals.length > 0 ? (
                  <div className="space-y-0.5">
                    <div className="px-2.5 pb-1 text-[10.5px] font-medium text-[#6E6E6E]">
                      Company
                    </div>
                    {companyGoals.map((goal) => {
                      const active = activeDrawer?.kind === 'goal' && activeDrawer.goalId === goal.id;
                      return (
                        <button
                          key={goal.id}
                          type="button"
                          onClick={() => openGoalDrawer(goal.id)}
                          onContextMenu={(e) => goalMenu.open(e, goal)}
                          title="Right-click for goal actions"
                          className={[
                            'veyra-no-drag w-full h-8 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13px] font-medium transition-colors border text-left',
                            active
                              ? 'bg-[var(--veyra-nav-active-bg)] border-[var(--veyra-nav-active-border)] text-[var(--veyra-nav-active-text)]'
                              : 'border-transparent text-[#C4C4C4] hover:text-[#EDEDED] hover:bg-white/[0.05]',
                          ].join(' ')}
                        >
                          <GoalKindIconBadge kind={goal.kind} color={goal.color} size="xs" />
                          <span className="truncate">{goal.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Live Focus Pill (when timer runs outside Focus view) */}
      {showLiveFocusPill && focusStatus?.activeBlock ? (
        <div className="px-3.5 pb-2.5">
          <LiveFocusPill
            title={focusStatus.activeBlock.title}
            blockId={focusStatus.activeBlock.id}
            elapsedSeconds={liveElapsedSeconds}
            onOpen={() => navigate('focus')}
          />
        </div>
      ) : null}

      {/* Quiet Footer: Notes + Settings ⌘, */}
      <div className="shrink-0 px-3.5 py-3 border-t border-white/[0.06] space-y-1">
        <button
          type="button"
          onClick={() => openDailyNotesDrawer()}
          className="veyra-no-drag w-full h-9 px-2.5 rounded-[8px] flex items-center justify-between gap-2 text-[13px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-white/[0.05] transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <NotebookPen size={14} className="text-[#6E6E6E]" />
            <span>Notes</span>
          </span>
          <span className="text-[11px] text-[#6E6E6E]">⌘⇧P</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('settings', { settingsSection: 'integrations' })}
          className="veyra-no-drag w-full h-9 px-2.5 rounded-[8px] flex items-center justify-between gap-2 text-[13px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-white/[0.05] transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <SettingsIcon size={14} className="text-[#6E6E6E]" />
            <span>Settings</span>
          </span>
          <span className="text-[11px] text-[#6E6E6E]">⌘,</span>
        </button>
      </div>

      {/* Right-click Context Menus */}
      {projectMenu.menu}
      {goalMenu.menu}
    </aside>
  );
}
