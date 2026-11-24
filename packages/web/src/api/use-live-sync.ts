import { useQueryClient } from '@tanstack/react-query';
import type { SseEventPayload } from '@veyra/core/types';
import { useEffect, useState } from 'react';
import { getEventStreamUrl, subscribeClientConfigChange } from './client';

export type LiveSyncStatus = 'connecting' | 'connected' | 'reconnecting';

const CORE_COMPOSITE_KEYS = ['today', 'plan', 'calendar', 'review'] as const;

function getKeysToInvalidate(payload: SseEventPayload | null): string[][] {
  if (!payload) {
    return [
      ['today'],
      ['plan'],
      ['calendar'],
      ['projects'],
      ['project'],
      ['goals'],
      ['blocks'],
      ['block'],
      ['focus'],
      ['notes'],
      ['review'],
      ['settings'],
      ['events'],
      ['activity'],
    ];
  }

  const keys: string[][] = [['activity']];
  const entity = payload.entity ?? '';
  const type = payload.type ?? '';

  if (type === 'rollover.completed') {
    return [
      ['today'],
      ['plan'],
      ['calendar'],
      ['blocks'],
      ['block'],
      ['projects'],
      ['project'],
      ['review'],
      ['focus'],
    ];
  }

  if (entity === 'block' || type.startsWith('block.')) {
    keys.push(['blocks'], ['block'], ['projects'], ['project'], ['focus']);
    for (const key of CORE_COMPOSITE_KEYS) keys.push([key]);
    if (payload.id) keys.push(['block', payload.id]);
    return keys;
  }

  if (entity === 'focus_session' || type.startsWith('focus.') || type.startsWith('session.')) {
    keys.push(['focus'], ['blocks'], ['block'], ['projects'], ['project']);
    for (const key of CORE_COMPOSITE_KEYS) keys.push([key]);
    return keys;
  }

  if (entity === 'project' || type.startsWith('project.')) {
    keys.push(['projects'], ['project'], ['blocks']);
    for (const key of CORE_COMPOSITE_KEYS) keys.push([key]);
    if (payload.id) keys.push(['project', payload.id]);
    return keys;
  }

  if (entity === 'goal' || type.startsWith('goal.')) {
    keys.push(['goals'], ['projects'], ['project'], ['blocks']);
    for (const key of CORE_COMPOSITE_KEYS) keys.push([key]);
    return keys;
  }

  if (entity === 'daily_note' || type.startsWith('daily_note.')) {
    keys.push(['notes'], ['today'], ['review']);
    return keys;
  }

  if (entity === 'weekly_review' || type.startsWith('weekly_review.')) {
    keys.push(['review'], ['today']);
    return keys;
  }

  if (entity === 'calendar_event' || type.startsWith('events.') || type.startsWith('calendar_event.')) {
    keys.push(['events'], ['today'], ['plan'], ['calendar'], ['review'], ['settings']);
    return keys;
  }

  if (entity === 'settings' || type.startsWith('settings.')) {
    keys.push(['settings'], ['notion-search'], ['today'], ['plan'], ['calendar'], ['review']);
    return keys;
  }

  if (entity === 'activity' || type.startsWith('webhook.')) {
    return [['activity']];
  }

  return [
    ['today'],
    ['plan'],
    ['calendar'],
    ['projects'],
    ['project'],
    ['goals'],
    ['blocks'],
    ['block'],
    ['focus'],
    ['notes'],
    ['review'],
    ['settings'],
    ['events'],
  ];
}

/**
 * Subscribes to @veyra/server's `/api/events/stream` SSE hub and immediately
 * invalidates affected TanStack React Query caches whenever mutations occur
 * from any client (Electron, browser, CLI, agents, or midnight rollover).
 */
export function useLiveSync(enabled = true): LiveSyncStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveSyncStatus>('connecting');
  const [configRevision, setConfigRevision] = useState(0);

  useEffect(() => {
    return subscribeClientConfigChange(() => {
      setConfigRevision((rev) => rev + 1);
    });
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = async () => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      let url: string;
      try {
        url = await getEventStreamUrl();
      } catch {
        url = '/api/events/stream';
      }
      if (disposed) return;

      const es = new EventSource(url);
      source = es;

      es.onopen = () => {
        if (disposed) return;
        const wasReconnecting = attempt > 0;
        attempt = 0;
        setStatus('connected');
        if (wasReconnecting) {
          void queryClient.invalidateQueries();
        }
      };

      es.onmessage = (event) => {
        if (disposed) return;
        let payload: SseEventPayload | null = null;
        if (typeof event.data === 'string' && event.data.trim()) {
          try {
            payload = JSON.parse(event.data) as SseEventPayload;
          } catch {
            payload = null;
          }
        }

        const keys = getKeysToInvalidate(payload);
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      };

      es.onerror = () => {
        if (disposed) return;
        es.close();
        if (source === es) {
          source = null;
        }
        setStatus('reconnecting');
        attempt += 1;
        const delayMs = Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 15_000);
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, delayMs);
      };
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (source) {
        source.close();
      }
    };
  }, [enabled, queryClient, configRevision]);

  return status;
}
