import type { SseEventPayload } from '@veyra/core';

interface SseClient {
  send: (chunk: Uint8Array) => boolean;
  close: () => void;
}

const encoder = new TextEncoder();

export class SseHub {
  private readonly clients = new Set<SseClient>();
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { heartbeatIntervalMs?: number }) {
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 25_000;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  createResponse(signal?: AbortSignal): Response {
    let client: SseClient | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (client) {
        this.clients.delete(client);
        client = null;
      }
      this.maybeStopHeartbeat();
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (chunk: Uint8Array): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(chunk);
            return true;
          } catch {
            cleanup();
            return false;
          }
        };

        const close = () => {
          if (closed) return;
          cleanup();
          try {
            controller.close();
          } catch {
            // Stream already closed
          }
        };

        client = { send, close };
        this.clients.add(client);
        this.ensureHeartbeat();

        // Send initial SSE comment so response headers flush immediately
        send(encoder.encode(': connected\n\n'));

        if (signal) {
          if (signal.aborted) {
            close();
          } else {
            signal.addEventListener('abort', close, { once: true });
          }
        }
      },
      cancel: () => {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  broadcast(event: SseEventPayload): void {
    if (this.clients.size === 0) {
      return;
    }
    const payload = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const client of Array.from(this.clients)) {
      client.send(payload);
    }
  }

  closeAll(): void {
    for (const client of Array.from(this.clients)) {
      client.close();
    }
    this.clients.clear();
    this.maybeStopHeartbeat();
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null || this.clients.size === 0) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      const ping = encoder.encode(': heartbeat\n\n');
      for (const client of Array.from(this.clients)) {
        client.send(ping);
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private maybeStopHeartbeat(): void {
    if (this.clients.size === 0 && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
