import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  Pause,
  Play,
  Plus,
  Power,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, isElectronDesktop } from '../api/client';
import {
  invalidateBlockRelated,
  useFocusQuery,
  useProjectsQuery,
  useTodayQuery,
} from '../api/queries';
import { useLiveSync } from '../api/use-live-sync';
import {
  formatElapsedTimer,
  getProjectAccentStyle,
  ProjectIcon,
} from '../components/icons';

const MAX_UP_NEXT = 3;

export function TrayPopover() {
  const queryClient = useQueryClient();
  useLiveSync(true);

  const focusQuery = useFocusQuery();
  const todayQuery = useTodayQuery();
  const projectsQuery = useProjectsQuery({ includeArchived: false });

  const focusStatus = focusQuery.data ?? null;
  const activeSession = focusStatus?.activeSession ?? null;
  const activeBlock = focusStatus?.activeBlock ?? null;

  const projectsById = useMemo(() => {
    const map = new Map<string, { name: string; color: string; icon: string | null }>();
    for (const project of projectsQuery.data?.projects ?? []) {
      map.set(project.id, {
        name: project.name,
        color: project.color,
        icon: project.icon ?? null,
      });
    }
    return map;
  }, [projectsQuery.data?.projects]);

  const activeProject = activeBlock?.projectId
    ? projectsById.get(activeBlock.projectId) ?? null
    : null;
  const activeAccent = getProjectAccentStyle(activeProject?.color ?? '#3B4BD8');

  const upNext = useMemo(
    () => (todayQuery.data?.upNext ?? []).slice(0, MAX_UP_NEXT),
    [todayQuery.data?.upNext],
  );

  // Live 1-second timer anchored to server-reported elapsedSeconds on sync
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const anchorRef = useRef<{ elapsed: number; syncedAt: number }>({
    elapsed: 0,
    syncedAt: Date.now(),
  });

  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0);
      return;
    }
    const baseElapsed = Math.max(0, Math.floor(focusStatus?.elapsedSeconds ?? 0));
    const syncedAt = Date.now();
    anchorRef.current = { elapsed: baseElapsed, syncedAt };
    setElapsedSeconds(baseElapsed);

    const timer = window.setInterval(() => {
      const delta = Math.max(0, Math.floor((Date.now() - anchorRef.current.syncedAt) / 1000));
      setElapsedSeconds(anchorRef.current.elapsed + delta);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.id, focusStatus?.elapsedSeconds]);

  // Refetch cleanly whenever the popover is opened
  useEffect(() => {
    const onShow = () => {
      void queryClient.invalidateQueries({ queryKey: ['focus'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    };
    window.addEventListener('veyra:tray-show', onShow);
    return () => window.removeEventListener('veyra:tray-show', onShow);
  }, [queryClient]);

  // Auto-size Electron popover height to hug rendered content tightly
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !window.veyraDesktop?.resizeTrayPopover) return;

    let lastSent = 0;
    const report = () => {
      const measured = Math.ceil(el.getBoundingClientRect().height);
      if (measured > 0 && measured !== lastSent) {
        lastSent = measured;
        void window.veyraDesktop?.resizeTrayPopover?.(measured);
      }
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setConfirmCancel(false);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!confirmCancel) return;
    const timer = window.setTimeout(() => setConfirmCancel(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmCancel]);

  const runMutation = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      if (busyAction) return;
      setBusyAction(key);
      try {
        await fn();
        setConfirmCancel(false);
        await invalidateBlockRelated(queryClient);
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, queryClient],
  );

  const handlePause = () =>
    void runMutation('pause', () => apiClient.pauseFocus());

  const handleCancel = () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    void runMutation('cancel', () => apiClient.cancelFocus());
  };

  const handleComplete = () =>
    void runMutation('complete', () =>
      apiClient.completeFocus(activeBlock?.id ? { blockId: activeBlock.id } : undefined),
    );

  const handleStartBlock = (blockId: string) =>
    void runMutation(`start:${blockId}`, () => apiClient.startFocus(blockId));

  const handleOpenFocus = () => {
    void window.veyraDesktop?.closeTrayPopover?.();
    void window.veyraDesktop?.focusAndDispatchAction?.({ type: 'navigate', route: 'focus' });
  };

  const handleTrayAction = (action: 'show-window' | 'quick-capture' | 'quick-focus' | 'quit') => {
    void window.veyraDesktop?.trayAction?.(action);
  };

  const isElectron = isElectronDesktop();

  return (
    <div
      ref={rootRef}
      className="w-full select-none bg-[#18181A] text-[#EDEDED] overflow-hidden ring-1 ring-inset ring-white/[0.08]"
      data-testid="tray-popover"
    >
      {activeSession ? (
        <div>
          {/* Subtle project-color top accent hairline */}
          <div
            className="h-[2.5px] w-full"
            style={{ backgroundColor: activeAccent.hex }}
          />

          <div className="px-3.5 pt-3 pb-3">
            {/* Project badge + live elapsed timer */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: activeAccent.hex,
                    boxShadow: `0 0 8px ${activeAccent.hex}AA`,
                  }}
                />
                {activeProject?.icon && (
                  <span style={{ color: activeAccent.text }} className="shrink-0 flex">
                    <ProjectIcon icon={activeProject.icon} size={11} />
                  </span>
                )}
                <span
                  className="text-[11.5px] font-medium truncate"
                  style={{ color: activeAccent.text }}
                >
                  {activeProject?.name ?? 'Focus Session'}
                </span>
              </div>

              <span
                className="font-mono text-[13px] font-semibold tracking-tight tabular-nums text-[#EDEDED] shrink-0"
                data-testid="tray-popover-timer"
              >
                {formatElapsedTimer(elapsedSeconds)}
              </span>
            </div>

            {/* Active block title */}
            <div className="text-[13.5px] font-medium leading-snug text-[#F4F4F5] line-clamp-2 mb-3">
              {activeBlock?.title ?? 'Focusing'}
            </div>

            {/* Primary controls: Pause (primary), Done, Cancel (2-step discard), Open */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handlePause}
                className="flex items-center justify-center gap-1 h-7 rounded-[7px] bg-[#242B5C] hover:bg-[#2C3570] border border-[#4352B8] text-[11.5px] font-medium text-[#D8E0FF] transition-colors disabled:opacity-50"
                title="Pause session and continue later"
              >
                <Pause size={11} />
                <span>Pause</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleComplete}
                className="flex items-center justify-center gap-1 h-7 rounded-[7px] bg-[#242428] hover:bg-[#2E2E34] border border-[#323238] text-[11.5px] font-medium text-[#C4C4C8] transition-colors disabled:opacity-50"
                title="Complete block"
              >
                <Check size={12} />
                <span>Done</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleCancel}
                className={[
                  'flex items-center justify-center gap-1 h-7 rounded-[7px] border text-[11.5px] font-medium transition-colors disabled:opacity-50',
                  confirmCancel
                    ? 'bg-[#3A2815] hover:bg-[#47311A] border-[#9E6B2F] text-[#F5B27A]'
                    : 'bg-[#242428] hover:bg-[#2E2E34] border-[#323238] text-[#9A9A9A]',
                ].join(' ')}
                title="Cancel session and discard its time"
              >
                <X size={11} />
                <span>{confirmCancel ? 'Discard?' : 'Cancel'}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenFocus}
                className="flex items-center justify-center gap-1 h-7 rounded-[7px] bg-[#242428] hover:bg-[#2E2E34] border border-[#323238] text-[11.5px] font-medium text-[#E4E4E7] transition-colors"
                title="Open Focus view"
              >
                <ArrowUpRight size={12} />
                <span>Open</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3.5 pt-3 pb-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#8E8E93]">
              Up Next
            </span>
            <span className="text-[11px] text-[#6E6E73]">Idle</span>
          </div>

          {upNext.length > 0 ? (
            <div className="flex flex-col gap-1">
              {upNext.map((block) => {
                const proj = block.projectId ? projectsById.get(block.projectId) : null;
                const dotColor = proj?.color ?? '#6E7280';
                return (
                  <button
                    key={block.id}
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleStartBlock(block.id)}
                    className="group flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded-[7px] text-left bg-[#202024]/70 hover:bg-[#2A2A30] border border-transparent hover:border-[#34343C] transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="text-[12.5px] text-[#E4E4E7] truncate">
                        {block.title}
                      </span>
                    </div>
                    <Play
                      size={11}
                      className="text-[#8E8E93] group-hover:text-[#EDEDED] shrink-0 transition-colors"
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-between py-1">
              <span className="text-[12px] text-[#8E8E93]">No blocks queued for today</span>
              <button
                type="button"
                onClick={() => handleTrayAction('quick-focus')}
                className="text-[11.5px] font-medium text-[#AEB8FF] hover:text-white transition-colors"
              >
                Start focus
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quiet footer */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-[#26262A] bg-[#141416]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleTrayAction('show-window')}
            className="px-2 py-1 rounded-[5px] text-[11.5px] text-[#A1A1AA] hover:text-[#EDEDED] hover:bg-[#242428] transition-colors"
          >
            Show Veyra
          </button>
          <button
            type="button"
            onClick={() => handleTrayAction('quick-capture')}
            className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11.5px] text-[#A1A1AA] hover:text-[#EDEDED] hover:bg-[#242428] transition-colors"
          >
            <Plus size={11} />
            <span>Capture</span>
          </button>
        </div>

        {isElectron && (
          <button
            type="button"
            onClick={() => handleTrayAction('quit')}
            className="flex items-center gap-1 px-1.5 py-1 rounded-[5px] text-[11px] text-[#71717A] hover:text-[#D4D4D8] hover:bg-[#242428] transition-colors"
            title="Quit Veyra"
          >
            <Power size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
