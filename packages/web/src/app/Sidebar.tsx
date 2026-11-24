import {
  ArrowLeft,
  Calendar,
  CalendarRange,
  CheckCircle2,
  FolderKanban,
  Keyboard,
  NotebookPen,
  Palette,
  Plug,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Sun,
  Target,
} from 'lucide-react';
import { isElectronDesktop } from '../api/client';
import { ProjectBadge } from '../components/ProjectBadge';
import { useProjectContextMenu } from '../components/entityMenus';
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
  { id: 'review', label: 'Review', icon: CheckCircle2 },
];

interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: typeof Target;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'server', label: 'Server & CLI', icon: Server },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

export function Sidebar() {
  const {
    route,
    previousRoute,
    activeProjectId,
    settingsSection,
    focusStatus,
    liveElapsedSeconds,
    projects,
    navigate,
    openProject,
    setSettingsSection,
    openCommandPalette,
    openCreateBlock,
    openDailyNotesDrawer,
  } = useAppShell();

  const projectMenu = useProjectContextMenu();

  const inElectron = isElectronDesktop();
  const pinnedProjects = projects.filter(
    (p) => p.isPinned && !p.deletedAt && p.status !== 'archived',
  );
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
            <button
              type="button"
              onClick={() => navigate('focus')}
              className="veyra-no-drag w-full px-3 py-2.5 rounded-[9px] bg-[#1F2759] border border-[#5566F2]/40 flex items-center justify-between gap-2 hover:bg-[#26306C] transition-colors text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#4DA3FF] animate-pulse shrink-0" />
                <span className="text-[12.5px] font-medium text-[#D6DCFF] truncate">
                  {focusStatus.activeBlock.title}
                </span>
              </span>
              <span className="text-[12px] font-semibold text-[#AEB8FF] tabular-nums shrink-0">
                {formatElapsedTimer(liveElapsedSeconds)}
              </span>
            </button>
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

      {/* Hairline divider */}
      <div className="mx-4 my-4 border-t border-white/[0.06] shrink-0" />

      {/* Unlimited PINNED Projects */}
      <div className="flex-1 min-h-0 flex flex-col">
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

        <div className="flex-1 overflow-y-auto px-3.5 pb-3 space-y-1">
          {pinnedProjects.length === 0 ? (
            <div className="px-3 py-2 text-[12.5px] text-[#6E6E6E]">
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

      {/* Live Focus Pill (when timer runs outside Focus view) */}
      {showLiveFocusPill && focusStatus?.activeBlock ? (
        <div className="px-3.5 pb-2.5">
          <button
            type="button"
            onClick={() => navigate('focus')}
            className="veyra-no-drag w-full px-3 py-2.5 rounded-[9px] bg-[#1F2759] border border-[#5566F2]/45 hover:bg-[#27316E] transition-colors flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-[#4DA3FF] animate-pulse shrink-0" />
              <span className="text-[12.5px] font-medium text-[#D6DCFF] truncate">
                {focusStatus.activeBlock.title}
              </span>
            </span>
            <span className="text-[12px] font-semibold text-[#AEB8FF] tabular-nums shrink-0">
              {formatElapsedTimer(liveElapsedSeconds)}
            </span>
          </button>
        </div>
      ) : null}

      {/* Quiet Footer: Daily Notes + Settings & Goals ⌘, */}
      <div className="shrink-0 px-3.5 py-3 border-t border-white/[0.06] space-y-1">
        <button
          type="button"
          onClick={() => openDailyNotesDrawer()}
          className="veyra-no-drag w-full h-9 px-2.5 rounded-[8px] flex items-center justify-between gap-2 text-[13px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-white/[0.05] transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <NotebookPen size={14} className="text-[#6E6E6E]" />
            <span>Daily Notes</span>
          </span>
          <span className="text-[11px] text-[#6E6E6E]">⌘⇧P</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('settings', { settingsSection: 'goals' })}
          className="veyra-no-drag w-full h-9 px-2.5 rounded-[8px] flex items-center justify-between gap-2 text-[13px] font-medium text-[#9A9A9A] hover:text-[#EDEDED] hover:bg-white/[0.05] transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <SettingsIcon size={14} className="text-[#6E6E6E]" />
            <span>Settings &amp; Goals</span>
          </span>
          <span className="text-[11px] text-[#6E6E6E]">⌘,</span>
        </button>
      </div>

      {/* Right-click Context Menu for Pinned Projects */}
      {projectMenu.menu}
    </aside>
  );
}
