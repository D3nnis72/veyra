import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type AwayReturnEvent, apiClient, queryKeys } from '../api/client';
import { invalidateBlockRelated, useFocusQuery } from '../api/queries';
import { Button } from '../components/Button';
import { ModalSheet } from '../components/ModalSheet';
import { formatDuration, formatLocalTime } from '../components/icons';

export interface AwayReturnPromptProps {
  /** Called after the session ended (Focus has nothing left to show). */
  onSessionEnded?: () => void;
}

/**
 * Asks what to do with the time you were away while a focus session kept running. The desktop
 * shell reports the away window (idle time, screen lock or sleep); nothing changes until you pick.
 */
export function AwayReturnPrompt({ onSessionEnded }: AwayReturnPromptProps) {
  const queryClient = useQueryClient();
  const focusQuery = useFocusQuery();
  const [away, setAway] = useState<AwayReturnEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscribe = window.veyraDesktop?.onAwayReturn;
    if (!subscribe) return;
    return subscribe((event) => {
      setError(null);
      setAway(event);
    });
  }, []);

  const activeSession = focusQuery.data?.activeSession ?? null;
  const activeBlockId = focusQuery.data?.activeBlock?.id;

  // The session may have been stopped elsewhere (menu bar, CLI) while the prompt was waiting.
  useEffect(() => {
    if (away && focusQuery.data && !activeSession) setAway(null);
  }, [away, focusQuery.data, activeSession]);

  const finish = () => {
    setAway(null);
    setError(null);
    invalidateBlockRelated(queryClient, activeBlockId);
  };

  const removeMutation = useMutation({
    mutationFn: (event: AwayReturnEvent) =>
      apiClient.removeFocusGap(event.awayStartedAt, event.awayEndedAt),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.focus, res.focusStatus);
      finish();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not remove the time'),
  });

  const endMutation = useMutation({
    mutationFn: (event: AwayReturnEvent) => apiClient.pauseFocus(undefined, event.awayStartedAt),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.focus, res.focusStatus);
      finish();
      onSessionEnded?.();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not end the session'),
  });

  const open = Boolean(away && activeSession);
  if (!away) return null;

  const minutes = Math.round((Date.parse(away.awayEndedAt) - Date.parse(away.awayStartedAt)) / 60_000);
  const busy = removeMutation.isPending || endMutation.isPending;
  const blockTitle = focusQuery.data?.activeBlock?.title;

  return (
    <ModalSheet
      open={open}
      onClose={busy ? undefined : finish}
      title="Welcome back"
      subtitle={
        blockTitle ? (
          <>
            Your focus on <span className="text-[#C4C4C4]">{blockTitle}</span> kept running
          </>
        ) : (
          'Your focus session kept running'
        )
      }
      width={460}
      ariaLabel="You were away"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => removeMutation.mutate(away)}
          >
            Remove {formatDuration(minutes)} and keep going
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={finish}>
            It was work
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            title="Stop the session at the time you left. You can continue the block later."
            onClick={() => endMutation.mutate(away)}
          >
            End at {formatLocalTime(away.awayStartedAt)}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] text-[#EDEDED]">
        You were away for{' '}
        <span className="font-semibold tabular-nums">{formatDuration(minutes)}</span>, from{' '}
        <span className="tabular-nums">{formatLocalTime(away.awayStartedAt)}</span> to{' '}
        <span className="tabular-nums">{formatLocalTime(away.awayEndedAt)}</span>.
      </p>
      <p className="mt-2 text-[12.5px] text-[#9A9A9A]">
        Removing it splits the session around that time, so the pause does not count as focus time and the timer
        continues from now.
      </p>
      {error ? <div className="mt-3 text-[12px] text-[#FF9EC5]">{error}</div> : null}
    </ModalSheet>
  );
}
