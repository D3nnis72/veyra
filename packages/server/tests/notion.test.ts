import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NOTION_API_VERSION,
  createVeyraServer,
  extractNotionTitle,
  normalizeNotionSearchResults,
  type VeyraServerInstance,
} from '../src/index.js';

const tempDirs: string[] = [];
const runningServers: VeyraServerInstance[] = [];
const auxServers: http.Server[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-notion-test-'));
  tempDirs.push(dir);
  return dir;
}

function startMockNotionServer(
  handler: (
    req: http.IncomingMessage,
    bodyText: string,
    res: http.ServerResponse,
  ) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        handler(req, Buffer.concat(chunks).toString('utf8'), res);
      });
    });
    auxServers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Unexpected mock server address');
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function startTestServer(
  opts?: Partial<Parameters<typeof createVeyraServer>[0]>,
): Promise<{ instance: VeyraServerInstance; baseUrl: string }> {
  const dir = createTempDir();
  const instance = createVeyraServer({
    dbPath: path.join(dir, 'veyra.db'),
    port: 0,
    host: '127.0.0.1',
    notionToken: '',
    ...opts,
  });
  runningServers.push(instance);
  const started = await instance.start();
  return { instance, baseUrl: started.url };
}

afterEach(async () => {
  while (runningServers.length > 0) {
    await runningServers.pop()!.stop();
  }
  while (auxServers.length > 0) {
    const srv = auxServers.pop()!;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Notion result normalization', () => {
  it('extracts page titles from arbitrary title properties, database titles, and falls back to Untitled', () => {
    expect(
      extractNotionTitle({
        object: 'page',
        properties: {
          Status: { type: 'status' },
          'Task Name': {
            type: 'title',
            title: [{ plain_text: 'Ship ' }, { plain_text: 'Inline Picker' }],
          },
        },
      }),
    ).toBe('Ship Inline Picker');

    expect(
      extractNotionTitle({
        object: 'database',
        title: [{ plain_text: 'Product Roadmap' }],
      }),
    ).toBe('Product Roadmap');

    expect(extractNotionTitle({ object: 'page', properties: {} })).toBe('Untitled');
  });

  it('normalizes pages and databases while dropping invalid or unsupported entries', () => {
    const normalized = normalizeNotionSearchResults([
      {
        object: 'page',
        id: 'page-1',
        url: 'https://www.notion.so/Q4-Plan-111',
        last_edited_time: '2026-11-24T10:00:00.000Z',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Q4 Plan' }] },
        },
      },
      {
        object: 'database',
        id: 'db-1',
        url: 'https://www.notion.so/Tasks-DB-222',
        last_edited_time: '2026-11-23T08:30:00.000Z',
        title: [{ plain_text: 'Tasks DB' }],
      },
      {
        object: 'block',
        id: 'blk-ignored',
        url: 'https://www.notion.so/ignored',
      },
      {
        object: 'page',
        id: 'bad-url',
        url: 'javascript:alert(1)',
      },
    ]);

    expect(normalized).toEqual([
      {
        id: 'page-1',
        title: 'Q4 Plan',
        url: 'https://www.notion.so/Q4-Plan-111',
        objectType: 'page',
        lastEditedTime: '2026-11-24T10:00:00.000Z',
      },
      {
        id: 'db-1',
        title: 'Tasks DB',
        url: 'https://www.notion.so/Tasks-DB-222',
        objectType: 'database',
        lastEditedTime: '2026-11-23T08:30:00.000Z',
      },
    ]);
  });
});

describe('@veyra/server Notion integration API', () => {
  it('returns { configured: false, results: [] } zero-config and masks notionToken in all settings responses', async () => {
    let notionCalls = 0;
    const mockNotion = await startMockNotionServer((_req, _body, res) => {
      notionCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [] }));
    });

    const { baseUrl } = await startTestServer({
      notionOptions: { apiBaseUrl: mockNotion.url },
    });

    // Zero-config GET /api/settings
    const initialSettingsRes = await fetch(`${baseUrl}/api/settings`);
    expect(initialSettingsRes.status).toBe(200);
    const initialSettings = (await initialSettingsRes.json()) as {
      notionConfigured: boolean;
      settings: Record<string, unknown>;
    };
    expect(initialSettings.notionConfigured).toBe(false);
    expect(initialSettings.settings.notionConfigured).toBe(false);
    expect(initialSettings.settings.notionTokenSource).toBeNull();
    expect('notionToken' in initialSettings.settings).toBe(false);

    // Zero-config search gracefully returns { configured: false, results: [] } without calling Notion
    const searchRes = await fetch(`${baseUrl}/api/integrations/notion/search?q=roadmap`);
    expect(searchRes.status).toBe(200);
    expect(await searchRes.json()).toEqual({ configured: false, results: [] });
    expect(notionCalls).toBe(0);

    // Zero-config test returns 400 VALIDATION_ERROR
    const testUnconfiguredRes = await fetch(`${baseUrl}/api/integrations/notion/test`, {
      method: 'POST',
    });
    expect(testUnconfiguredRes.status).toBe(400);

    // Save secret token via PATCH /api/settings — raw secret must never echo back
    const secret = 'ntn_super_secret_token_987654';
    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionToken: secret }),
    });
    expect(patchRes.status).toBe(200);
    const patchRawText = await patchRes.text();
    expect(patchRawText).not.toContain(secret);
    expect(patchRawText).not.toContain('notionToken"');
    const patchJson = JSON.parse(patchRawText) as {
      notionConfigured: boolean;
      settings: { notionConfigured: boolean; notionTokenSource: string | null };
    };
    expect(patchJson.notionConfigured).toBe(true);
    expect(patchJson.settings.notionConfigured).toBe(true);
    expect(patchJson.settings.notionTokenSource).toBe('settings');

    // Subsequent GET /api/settings also masks token
    const getAfterSaveRes = await fetch(`${baseUrl}/api/settings`);
    const getAfterSaveText = await getAfterSaveRes.text();
    expect(getAfterSaveText).not.toContain(secret);
    expect(JSON.parse(getAfterSaveText).notionConfigured).toBe(true);

    // Unrelated PATCH /api/settings preserves stored token
    const tzPatchRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'UTC' }),
    });
    expect((await tzPatchRes.json()).notionConfigured).toBe(true);

    // Clearing token resets notionConfigured to false
    const clearRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionToken: null }),
    });
    const cleared = (await clearRes.json()) as {
      notionConfigured: boolean;
      settings: { notionTokenSource: string | null };
    };
    expect(cleared.notionConfigured).toBe(false);
    expect(cleared.settings.notionTokenSource).toBeNull();
  });

  it('proxies GET /api/integrations/notion/search to Notion v1/search and supports env token + testConnection', async () => {
    const receivedRequests: Array<{
      method: string | undefined;
      url: string | undefined;
      auth: string | undefined;
      notionVersion: string | string[] | undefined;
      body: unknown;
    }> = [];

    const mockNotion = await startMockNotionServer((req, bodyText, res) => {
      receivedRequests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        notionVersion: req.headers['notion-version'],
        body: bodyText ? JSON.parse(bodyText) : null,
      });

      if (req.url === '/v1/search' && req.method === 'POST') {
        if (req.headers.authorization === 'Bearer ntn_bad_token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'unauthorized', message: 'API token is invalid.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            results: [
              {
                object: 'page',
                id: 'p-100',
                url: 'https://www.notion.so/Architecture-RFC-100',
                last_edited_time: '2026-11-24T12:00:00.000Z',
                properties: {
                  title: {
                    type: 'title',
                    title: [{ plain_text: 'Architecture RFC' }],
                  },
                },
              },
              {
                object: 'database',
                id: 'db-200',
                url: 'https://www.notion.so/Customer-Tasks-200',
                last_edited_time: '2026-11-24T09:15:00.000Z',
                title: [{ plain_text: 'Customer Tasks' }],
              },
            ],
          }),
        );
        return;
      }

      if (req.url === '/v1/users/me' && req.method === 'GET') {
        if (req.headers.authorization === 'Bearer ntn_bad_token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'unauthorized', message: 'API token is invalid.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'user',
            id: 'bot-1',
            name: 'Veyra Bot',
            type: 'bot',
            bot: { workspace_name: 'Veyra Workspace' },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const { baseUrl } = await startTestServer({
      notionToken: 'ntn_env_valid_token',
      notionOptions: { apiBaseUrl: mockNotion.url },
    });

    // Settings reports env source and masks secret
    const settingsRes = await fetch(`${baseUrl}/api/settings`);
    const settingsText = await settingsRes.text();
    expect(settingsText).not.toContain('ntn_env_valid_token');
    expect(JSON.parse(settingsText).settings).toMatchObject({
      notionConfigured: true,
      notionTokenSource: 'env',
    });

    // Search with query string
    const searchRes = await fetch(`${baseUrl}/api/integrations/notion/search?q=Architecture&limit=5`);
    expect(searchRes.status).toBe(200);
    const searchBody = await searchRes.json();
    expect(searchBody).toEqual({
      configured: true,
      results: [
        {
          id: 'p-100',
          title: 'Architecture RFC',
          url: 'https://www.notion.so/Architecture-RFC-100',
          objectType: 'page',
          lastEditedTime: '2026-11-24T12:00:00.000Z',
        },
        {
          id: 'db-200',
          title: 'Customer Tasks',
          url: 'https://www.notion.so/Customer-Tasks-200',
          objectType: 'database',
          lastEditedTime: '2026-11-24T09:15:00.000Z',
        },
      ],
    });

    expect(receivedRequests[0]).toEqual({
      method: 'POST',
      url: '/v1/search',
      auth: 'Bearer ntn_env_valid_token',
      notionVersion: NOTION_API_VERSION,
      body: {
        query: 'Architecture',
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 5,
      },
    });

    // Empty query omits "query" field so Notion returns recent pages
    const recentRes = await fetch(`${baseUrl}/api/integrations/notion/search`);
    expect(recentRes.status).toBe(200);
    expect(receivedRequests[1].body).toEqual({
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 12,
    });

    // Test connection with stored/env token
    const testOkRes = await fetch(`${baseUrl}/api/integrations/notion/test`, {
      method: 'POST',
    });
    expect(testOkRes.status).toBe(200);
    expect(await testOkRes.json()).toEqual({
      result: {
        ok: true,
        statusCode: 200,
        workspaceName: 'Veyra Workspace',
        botName: 'Veyra Bot',
        error: null,
      },
    });

    // Test connection with invalid override token reports error cleanly
    const testBadRes = await fetch(`${baseUrl}/api/integrations/notion/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ntn_bad_token' }),
    });
    expect(testBadRes.status).toBe(200);
    expect(await testBadRes.json()).toEqual({
      result: {
        ok: false,
        statusCode: 401,
        workspaceName: null,
        botName: null,
        error: 'API token is invalid.',
      },
    });

    // Upstream 401 during search maps to 502 NOTION_UNAUTHORIZED without leaking token
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionToken: 'ntn_bad_token' }),
    });
    const failedSearchRes = await fetch(`${baseUrl}/api/integrations/notion/search?q=test`);
    expect(failedSearchRes.status).toBe(502);
    const failedText = await failedSearchRes.text();
    expect(failedText).not.toContain('ntn_bad_token');
    expect(JSON.parse(failedText)).toEqual({
      error: {
        code: 'NOTION_UNAUTHORIZED',
        message: 'API token is invalid.',
      },
    });
  });

  it('protects /api/integrations/notion/search behind server Bearer token auth when enabled', async () => {
    const { baseUrl } = await startTestServer({ bearerToken: 'veyra-secret' });
    const unauth = await fetch(`${baseUrl}/api/integrations/notion/search?q=test`);
    expect(unauth.status).toBe(401);

    const auth = await fetch(`${baseUrl}/api/integrations/notion/search?q=test`, {
      headers: { Authorization: 'Bearer veyra-secret' },
    });
    expect(auth.status).toBe(200);
  });

  it('completes Notion OAuth 2.0 start + callback flow without exposing secrets and enables search', async () => {
    let tokenExchangeAuthHeader: string | undefined;
    let tokenExchangeBody: unknown = null;

    const mockNotion = await startMockNotionServer((req, bodyText, res) => {
      if (req.url === '/v1/oauth/token' && req.method === 'POST') {
        tokenExchangeAuthHeader = req.headers.authorization;
        tokenExchangeBody = bodyText ? JSON.parse(bodyText) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'ntn_oauth_exchanged_secret',
            workspace_name: 'Team Workspace',
            bot_id: 'bot-oauth-1',
          }),
        );
        return;
      }

      if (req.url === '/v1/search' && req.method === 'POST') {
        expect(req.headers.authorization).toBe('Bearer ntn_oauth_exchanged_secret');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            results: [
              {
                object: 'page',
                id: 'oauth-page-1',
                url: 'https://www.notion.so/OAuth-Page-1',
                last_edited_time: '2026-11-24T19:00:00.000Z',
                properties: {
                  title: { type: 'title', title: [{ plain_text: 'OAuth Connected Page' }] },
                },
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const { baseUrl } = await startTestServer({
      bearerToken: 'veyra-bearer',
      notionOptions: { apiBaseUrl: mockNotion.url },
    });

    // Start OAuth flow with client ID + client secret
    const startRes = await fetch(`${baseUrl}/api/integrations/notion/oauth/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer veyra-bearer',
      },
      body: JSON.stringify({
        clientId: 'oauth-client-123',
        clientSecret: 'oauth-secret-xyz',
      }),
    });
    expect(startRes.status).toBe(200);
    const startJson = (await startRes.json()) as {
      authorizeUrl: string;
      redirectUri: string;
    };
    const authorizeParsed = new URL(startJson.authorizeUrl);
    expect(authorizeParsed.pathname).toBe('/v1/oauth/authorize');
    expect(authorizeParsed.searchParams.get('client_id')).toBe('oauth-client-123');
    expect(authorizeParsed.searchParams.get('owner')).toBe('user');
    const state = authorizeParsed.searchParams.get('state');
    expect(state).toBeTruthy();

    // GET /api/settings never leaks clientSecret or token
    const settingsBeforeText = await (
      await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: 'Bearer veyra-bearer' },
      })
    ).text();
    expect(settingsBeforeText).not.toContain('oauth-secret-xyz');
    expect(JSON.parse(settingsBeforeText).settings.notionOauthConfigured).toBe(true);

    // Invalid state is rejected
    const badStateRes = await fetch(
      `${baseUrl}/api/integrations/notion/oauth/callback?code=abc&state=invalid`,
    );
    expect(badStateRes.status).toBe(400);

    // Valid callback succeeds even without Bearer header (browser redirect from Notion)
    const cbRes = await fetch(
      `${baseUrl}/api/integrations/notion/oauth/callback?code=auth-code-99&state=${encodeURIComponent(state!)}`,
    );
    expect(cbRes.status).toBe(200);
    const cbHtml = await cbRes.text();
    expect(cbHtml).toContain('Connected to Notion');
    expect(cbHtml).toContain('Team Workspace');

    // Verify Basic Auth & payload sent to Notion /v1/oauth/token
    const expectedBasic = `Basic ${Buffer.from('oauth-client-123:oauth-secret-xyz').toString('base64')}`;
    expect(tokenExchangeAuthHeader).toBe(expectedBasic);
    expect(tokenExchangeBody).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code-99',
      redirect_uri: startJson.redirectUri,
    });

    // Replaying the same state is rejected (single-use CSRF token)
    const replayRes = await fetch(
      `${baseUrl}/api/integrations/notion/oauth/callback?code=auth-code-99&state=${encodeURIComponent(state!)}`,
    );
    expect(replayRes.status).toBe(400);

    // Search immediately uses the exchanged OAuth access token, and settings reflects workspace
    const searchRes = await fetch(`${baseUrl}/api/integrations/notion/search?q=OAuth`, {
      headers: { Authorization: 'Bearer veyra-bearer' },
    });
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      configured: boolean;
      results: Array<{ title: string }>;
    };
    expect(searchJson.configured).toBe(true);
    expect(searchJson.results[0]?.title).toBe('OAuth Connected Page');

    const settingsAfterText = await (
      await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: 'Bearer veyra-bearer' },
      })
    ).text();
    expect(settingsAfterText).not.toContain('ntn_oauth_exchanged_secret');
    expect(JSON.parse(settingsAfterText).settings.notionWorkspaceName).toBe('Team Workspace');
  });
});
