import crypto from 'node:crypto';
import {
  ValidationError,
  getSettings,
  recordActivity,
  type VeyraDb,
  type WebhookEventName,
} from '@veyra/core';

export interface WebhookDispatchResult {
  delivered: boolean;
  skipped: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
}

export interface WebhookDeliveryEvent {
  action: 'webhook.delivered' | 'webhook.failed';
  eventName: string;
  timestamp: string;
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

export interface WebhookDispatcherOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  fetcher?: typeof fetch;
  /** Optional HMAC-SHA256 signing secret (falls back to VEYRA_WEBHOOK_SECRET env var). */
  secret?: string;
  /** Invoked whenever a delivery finishes (delivered or failed) after logging activity. */
  onDelivery?: (event: WebhookDeliveryEvent) => void;
}

export function computeWebhookSignature(secret: string, body: string): string {
  const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });
}

export class WebhookDispatcher {
  private readonly veyraDb: VeyraDb;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly fetcher: typeof fetch;
  private readonly secret: string | undefined;
  private readonly onDelivery?: (event: WebhookDeliveryEvent) => void;

  constructor(veyraDb: VeyraDb, options?: WebhookDispatcherOptions) {
    this.veyraDb = veyraDb;
    this.timeoutMs = options?.timeoutMs ?? 5_000;
    this.retryDelayMs = options?.retryDelayMs ?? 250;
    this.fetcher = options?.fetcher ?? fetch;
    const rawSecret =
      options?.secret !== undefined ? options.secret : process.env.VEYRA_WEBHOOK_SECRET;
    this.secret = rawSecret?.trim() || undefined;
    this.onDelivery = options?.onDelivery;
  }

  async emit(
    eventName: WebhookEventName,
    payload: Record<string, unknown>,
    options?: { now?: Date | string },
  ): Promise<WebhookDispatchResult> {
    let settings: ReturnType<typeof getSettings>;
    try {
      settings = getSettings(this.veyraDb);
    } catch {
      return {
        delivered: false,
        skipped: true,
        attempts: 0,
      };
    }

    const url = settings.webhookUrl?.trim();
    if (!url || !settings.webhookEvents.includes(eventName)) {
      return {
        delivered: false,
        skipped: true,
        attempts: 0,
      };
    }

    return this.deliver(url, eventName, payload, options?.now);
  }

  async sendTestHook(options?: { now?: Date | string }): Promise<WebhookDispatchResult> {
    const settings = getSettings(this.veyraDb);
    const url = settings.webhookUrl?.trim();
    if (!url) {
      throw new ValidationError('Webhook URL is not configured in Settings');
    }

    return this.deliver(
      url,
      'webhook.test',
      { message: 'Test webhook from Veyra' },
      options?.now,
    );
  }

  private async deliver(
    url: string,
    eventName: string,
    data: Record<string, unknown>,
    now?: Date | string,
  ): Promise<WebhookDispatchResult> {
    const nowDate = now ? (typeof now === 'string' ? new Date(now) : now) : new Date();
    const nowIso = nowDate.toISOString();
    const body = JSON.stringify({
      event: eventName,
      timestamp: nowIso,
      data,
    });

    const maxAttempts = 2;
    let attempts = 0;
    let lastStatusCode: number | undefined;
    let lastError: string | undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Veyra-Webhook/0.1.0',
      'X-Veyra-Event': eventName,
    };
    if (this.secret) {
      headers['X-Veyra-Signature-256'] = computeWebhookSignature(this.secret, body);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        const response = await this.fetcher(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        lastStatusCode = response.status;
        await response.body?.cancel().catch(() => {});
        if (response.ok) {
          this.logActivity(
            'webhook.delivered',
            `Delivered webhook '${eventName}' to ${url} (HTTP ${response.status}, attempts: ${attempts})`,
            nowDate,
          );
          this.onDelivery?.({
            action: 'webhook.delivered',
            eventName,
            timestamp: nowIso,
            delivered: true,
            statusCode: response.status,
          });
          return {
            delivered: true,
            skipped: false,
            attempts,
            statusCode: response.status,
          };
        }

        lastError = `HTTP ${response.status} ${response.statusText}`.trim();
        // Retry once on 5xx only; do not retry 4xx client errors
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(this.retryDelayMs);
          continue;
        }
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          await sleep(this.retryDelayMs);
          continue;
        }
      }
    }

    this.logActivity(
      'webhook.failed',
      `Failed to deliver webhook '${eventName}' to ${url} after ${attempts} attempt(s): ${lastError ?? 'unknown error'}`,
      nowDate,
    );
    this.onDelivery?.({
      action: 'webhook.failed',
      eventName,
      timestamp: nowIso,
      delivered: false,
      statusCode: lastStatusCode,
      error: lastError,
    });

    return {
      delivered: false,
      skipped: false,
      attempts,
      statusCode: lastStatusCode,
      error: lastError,
    };
  }

  private logActivity(action: string, summary: string, nowDate: Date): void {
    try {
      recordActivity(this.veyraDb, 'hook', action, summary, nowDate);
    } catch {
      // Ignore logging error if database is closing
    }
  }
}
