import {
  type NotionObjectType,
  type NotionSearchResponse,
  type NotionSearchResult,
  type NotionTestConnectionResult,
  type NotionTokenSource,
  ValidationError,
  type VeyraDb,
  getSettings,
  resolveNotionToken,
  updateSettings,
} from '@veyra/core';

export const NOTION_API_VERSION = '2022-06-28';
export const DEFAULT_NOTION_API_BASE_URL = 'https://api.notion.com';
export const DEFAULT_NOTION_SEARCH_LIMIT = 12;
export const MAX_NOTION_SEARCH_LIMIT = 50;

export class NotionApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;

  constructor(message: string, options?: { code?: string; statusCode?: number | null }) {
    super(message);
    this.name = 'NotionApiError';
    this.code = options?.code ?? 'NOTION_API_ERROR';
    this.statusCode = options?.statusCode ?? null;
  }
}

export interface NotionClientOptions {
  envToken?: string;
  envOauthClientId?: string;
  envOauthClientSecret?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export interface NotionOAuthExchangeResult {
  accessToken: string;
  workspaceName: string | null;
  botId: string | null;
}

interface NotionRichTextPart {
  plain_text?: unknown;
  text?: { content?: unknown };
}

interface NotionPropertyValue {
  type?: unknown;
  title?: unknown;
}

interface RawNotionSearchItem {
  object?: unknown;
  id?: unknown;
  url?: unknown;
  last_edited_time?: unknown;
  title?: unknown;
  properties?: Record<string, NotionPropertyValue>;
}

function joinRichText(items: unknown): string {
  if (!Array.isArray(items)) return '';
  const parts: string[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const rt = entry as NotionRichTextPart;
    if (typeof rt.plain_text === 'string') {
      parts.push(rt.plain_text);
    } else if (typeof rt.text?.content === 'string') {
      parts.push(rt.text.content);
    }
  }
  return parts.join('').trim();
}

export function extractNotionTitle(item: RawNotionSearchItem): string {
  if (item.object === 'database') {
    const dbTitle = joinRichText(item.title);
    if (dbTitle) return dbTitle;
  }

  if (item.properties && typeof item.properties === 'object') {
    for (const prop of Object.values(item.properties)) {
      if (prop && typeof prop === 'object' && prop.type === 'title') {
        const text = joinRichText(prop.title);
        if (text) return text;
      }
    }
    const fallbackTitleProp = item.properties.title ?? item.properties.Name;
    if (fallbackTitleProp && typeof fallbackTitleProp === 'object') {
      const text = joinRichText(fallbackTitleProp.title);
      if (text) return text;
    }
  }

  const directTitle = joinRichText(item.title);
  if (directTitle) return directTitle;

  return 'Untitled';
}

function isValidHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeNotionSearchResults(rawResults: unknown): NotionSearchResult[] {
  if (!Array.isArray(rawResults)) return [];
  const normalized: NotionSearchResult[] = [];

  for (const entry of rawResults) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as RawNotionSearchItem;
    if (item.object !== 'page' && item.object !== 'database') continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (!isValidHttpUrl(item.url)) continue;

    const objectType: NotionObjectType = item.object;
    normalized.push({
      id: item.id,
      title: extractNotionTitle(item),
      url: item.url,
      objectType,
      lastEditedTime: typeof item.last_edited_time === 'string' ? item.last_edited_time : '',
    });
  }

  return normalized;
}

async function readNotionErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.trim()) {
      const parsed = JSON.parse(text) as { message?: unknown; error_description?: unknown; error?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
      if (typeof parsed.error_description === 'string' && parsed.error_description.trim()) {
        return parsed.error_description.trim();
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
    }
  } catch {
    // Fall back to HTTP status
  }
  return `Notion API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

export class NotionClient {
  private readonly veyraDb: VeyraDb;
  private readonly envToken?: string;
  private readonly envOauthClientId?: string;
  private readonly envOauthClientSecret?: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(veyraDb: VeyraDb, options?: NotionClientOptions) {
    this.veyraDb = veyraDb;
    this.envToken = options?.envToken?.trim() || undefined;
    this.envOauthClientId = options?.envOauthClientId?.trim() || undefined;
    this.envOauthClientSecret = options?.envOauthClientSecret?.trim() || undefined;
    this.apiBaseUrl = (options?.apiBaseUrl ?? DEFAULT_NOTION_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 8_000;
    this.fetcher = options?.fetcher ?? fetch;
  }

  resolveToken(): { token: string | null; source: NotionTokenSource | null } {
    const settings = getSettings(this.veyraDb);
    return resolveNotionToken(settings, this.envToken);
  }

  resolveOAuthCredentials(): {
    clientId: string | null;
    clientSecret: string | null;
    redirectUri: string | null;
  } {
    const settings = getSettings(this.veyraDb);
    return {
      clientId: settings.notionOauthClientId?.trim() || this.envOauthClientId || null,
      clientSecret:
        settings.notionOauthClientSecret?.trim() || this.envOauthClientSecret || null,
      redirectUri: settings.notionOauthRedirectUri?.trim() || null,
    };
  }

  buildOAuthAuthorizeUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(`${this.apiBaseUrl}/v1/oauth/authorize`);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('owner', 'user');
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  async exchangeOAuthCode(params: {
    code: string;
    redirectUri: string;
    now?: Date;
  }): Promise<NotionOAuthExchangeResult> {
    const { clientId, clientSecret } = this.resolveOAuthCredentials();
    if (!clientId || !clientSecret) {
      throw new ValidationError('Notion OAuth client ID and client secret are not configured');
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBaseUrl}/v1/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION,
          'User-Agent': 'Veyra/0.1.0',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: params.redirectUri,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new NotionApiError(`Failed to reach Notion OAuth token endpoint: ${detail}`);
    }

    if (!response.ok) {
      const message = await readNotionErrorMessage(response);
      throw new NotionApiError(message, {
        code: response.status === 401 ? 'NOTION_OAUTH_UNAUTHORIZED' : 'NOTION_OAUTH_ERROR',
        statusCode: response.status,
      });
    }

    let json: {
      access_token?: unknown;
      workspace_name?: unknown;
      bot_id?: unknown;
    };
    try {
      json = (await response.json()) as {
        access_token?: unknown;
        workspace_name?: unknown;
        bot_id?: unknown;
      };
    } catch {
      throw new NotionApiError('Notion OAuth token endpoint returned invalid JSON', {
        statusCode: response.status,
      });
    }

    if (typeof json.access_token !== 'string' || !json.access_token.trim()) {
      throw new NotionApiError('Notion OAuth response did not include an access_token', {
        statusCode: response.status,
      });
    }

    const accessToken = json.access_token.trim();
    const workspaceName =
      typeof json.workspace_name === 'string' && json.workspace_name.trim()
        ? json.workspace_name.trim()
        : null;
    const botId =
      typeof json.bot_id === 'string' && json.bot_id.trim() ? json.bot_id.trim() : null;

    updateSettings(
      this.veyraDb,
      {
        notionToken: accessToken,
        notionWorkspaceName: workspaceName,
      },
      { now: params.now, actor: 'user' },
    );

    return { accessToken, workspaceName, botId };
  }

  async search(
    query = '',
    options?: { limit?: number },
  ): Promise<NotionSearchResponse> {
    const { token } = this.resolveToken();
    if (!token) {
      return { configured: false, results: [] };
    }

    const trimmedQuery = query.trim();
    const rawLimit = options?.limit ?? DEFAULT_NOTION_SEARCH_LIMIT;
    const pageSize = Math.min(MAX_NOTION_SEARCH_LIMIT, Math.max(1, Math.floor(rawLimit)));

    const body: Record<string, unknown> = {
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: pageSize,
    };
    if (trimmedQuery) {
      body.query = trimmedQuery;
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBaseUrl}/v1/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
          'User-Agent': 'Veyra/0.1.0',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new NotionApiError(`Failed to reach Notion API: ${detail}`);
    }

    if (!response.ok) {
      const message = await readNotionErrorMessage(response);
      throw new NotionApiError(message, {
        code: response.status === 401 ? 'NOTION_UNAUTHORIZED' : 'NOTION_API_ERROR',
        statusCode: response.status,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new NotionApiError('Notion API returned invalid JSON', {
        statusCode: response.status,
      });
    }

    const rawResults =
      json && typeof json === 'object' && 'results' in json
        ? (json as { results?: unknown }).results
        : [];

    return {
      configured: true,
      results: normalizeNotionSearchResults(rawResults),
    };
  }

  async testConnection(overrideToken?: string): Promise<NotionTestConnectionResult> {
    const token = overrideToken?.trim() || this.resolveToken().token;
    if (!token) {
      throw new ValidationError('Notion integration token is not configured');
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBaseUrl}/v1/users/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
          'User-Agent': 'Veyra/0.1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        statusCode: null,
        workspaceName: null,
        botName: null,
        error: `Could not reach Notion API: ${detail}`,
      };
    }

    if (!response.ok) {
      const message = await readNotionErrorMessage(response);
      return {
        ok: false,
        statusCode: response.status,
        workspaceName: null,
        botName: null,
        error: message,
      };
    }

    let botName: string | null = null;
    let workspaceName: string | null = null;
    try {
      const json = (await response.json()) as {
        name?: unknown;
        bot?: { workspace_name?: unknown };
      };
      if (typeof json.name === 'string' && json.name.trim()) {
        botName = json.name.trim();
      }
      if (typeof json.bot?.workspace_name === 'string' && json.bot.workspace_name.trim()) {
        workspaceName = json.bot.workspace_name.trim();
      }
    } catch {
      // Non-fatal; 200 OK still means token is valid
    }

    return {
      ok: true,
      statusCode: response.status,
      workspaceName,
      botName,
      error: null,
    };
  }
}
