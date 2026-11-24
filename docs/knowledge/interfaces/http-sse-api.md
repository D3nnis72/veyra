---
id: interfaces.http-sse-api
type: architecture
scope: interfaces
authority: canonical
sourceVersion: 432c801
extends: interfaces
dependsOn:
  - architecture.monorepo-boundaries
  - architecture.domain-invariants
groundedIn:
  - packages/server/src/app.ts
  - packages/server/src/index.ts
  - packages/server/src/notion.ts
  - packages/server/src/sse.ts
  - packages/web/src/api/client.ts
  - packages/web/src/api/use-live-sync.ts
updateWhen:
  - API routes, authentication headers, error shapes, or SSE event types change
  - static web serving or test-clock behavior changes
---
# HTTP And SSE API Contract

`@veyra/server` exposes a typed Hono HTTP + SSE server (`packages/server/src/app.ts`) that serves `@veyra/web`, `@veyra/desktop`, and `@veyra/cli`. All request and response payloads validate against `@veyra/core/types`.

## Authentication, Actor Attribution, And Test Clock

- **Optional bearer auth:** When `VEYRA_TOKEN` (or `bearerToken` option) is set, every `/api/*` route except `GET /api/health` requires `Authorization: Bearer <token>` (or `?token=<token>` for browser `EventSource` connections on `/api/events/stream`). Static SPA assets stay public so the login/config shell can load.
- **Actor attribution:** Callers may send `X-Veyra-Actor` (`user`, `cli`, `agent`, `hook`; defaults to `user`) so `activity_log` records distinguish human clicks, CLI calls, autonomous agent actions, and hooks.
- **Deterministic test clock:** Disabled in normal operation. Only when `VEYRA_ENABLE_TEST_CLOCK=1` (or `enableTestClock: true` in tests) does the server honor `?now=<ISO>` or `X-Veyra-Now: <ISO>` to verify midnight rollover and weekly boundaries deterministically.
- **Error envelope:** Domain errors map cleanly to HTTP status codes (`ValidationError` -> `400`, `SystemProjectError` -> `400`, `NotFoundError` -> `404`, `ConflictError` -> `409`, uncaught `CalendarSyncError` or `NotionApiError` -> `502`, while `POST /api/events/sync` catches sync failures and returns structured diagnostics in `status` + `error`) returning `{ "error": { "code", "message" } }`.

## REST Resource Groups

Exact route handlers live in `packages/server/src/app.ts`:

- **Health & Live Stream:** `GET /api/health`, `GET /api/events/stream`
- **Aggregated Views:** `GET /api/today`, `GET /api/plan`, `GET /api/calendar`, `GET /api/review`, `PUT /api/review/rule`
- **Goals & Projects:** `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`, `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- **Blocks:** `GET/POST /api/blocks`, `GET/PATCH/DELETE /api/blocks/:id`, `POST /api/blocks/:id/{move,reorder,park,drop,reopen}`
- **Focus & Sessions:** `GET /api/focus`, `POST /api/focus/{start,resume,pause,stop,complete}`, `POST /api/sessions`, `PATCH /api/sessions/:id/trim`, `POST /api/sessions/:id/split`, `DELETE /api/sessions/:id`
- **Daily Notes:** `GET/POST /api/notes`, `PATCH/DELETE /api/notes/:id`
- **Calendar Events:** `GET /api/events`, `POST /api/events/{upsert,sync,auto-match}`, `PATCH /api/events/:id`
- **Settings & Activity:** `GET/PATCH /api/settings`, `POST /api/settings/test-hook`, `GET /api/activity`
  - `Settings.notionToken` (or the `VEYRA_NOTION_TOKEN` env var fallback) is stored server-side and always stripped from `GET/PATCH /api/settings` responses, which return `notionConfigured: boolean` and `settings.notionTokenSource: 'settings' | 'env' | null` instead.
- **Integrations (Notion Link Proxy):** `GET /api/integrations/notion/search?q=...&limit=...`, `POST /api/integrations/notion/test`
  - Proxies `POST https://api.notion.com/v1/search` (`Notion-Version: 2022-06-28`) and returns `{ configured, results: [{ id, title, url, objectType: 'page' | 'database', lastEditedTime }] }`. When no Notion token is set, returns `200 { configured: false, results: [] }` so direct URL paste stays zero-config.
  - `POST /api/integrations/notion/test` verifies an optional candidate `{ token }` or the stored/env token against `GET https://api.notion.com/v1/users/me` and returns `{ result: { ok, statusCode, workspaceName, botName, error } }`.

## Live SSE Broadcast Hub

`SseHub` (`packages/server/src/sse.ts`) flushes an immediate `: connected` comment, emits `: heartbeat` comments every 25 seconds, and broadcasts `data: <SseEventPayload>\n\n` on every state mutation and calendar sync run. `@veyra/web` (`packages/web/src/api/use-live-sync.ts`) subscribes over `EventSource` with automatic reconnection and invalidates affected TanStack Query keys so CLI or agent mutations appear live without page reload.

## Static Web Serving

When `VEYRA_WEB_DIST_DIR` (or `webDistDir` option) points to a built `@veyra/web/dist` directory, `@veyra/server` serves static assets and falls back non-`/api/*` GET requests to `index.html` for SPA routing.
