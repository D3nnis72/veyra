---
id: human.services
type: view
scope: human
sourceVersion: 432c801
derivedFrom:
  - interfaces.http-sse-api
  - interfaces.calendar-sync-webhooks
  - operations.docker-self-hosting
---
# Runtime Services

Veyra has no external database server, queue, or cache dependency in MVP. Everything runs in one Node 22 process backed by SQLite.

## Local Or Docker Service (`veyra`)

- **Process:** `@veyra/server` (`packages/server/dist/index.js`), listening on `127.0.0.1:4173` locally or `0.0.0.0:4173` in Docker (`docker-compose.yml`).
- **Storage:** Single SQLite file (`~/.veyra/veyra.db` locally or `/data/veyra.db` in Docker volume `veyra_data`) with `WAL` mode enabled.
- **Health check:** `GET /api/health` returns `200 OK` without requiring bearer auth.
- **Live stream:** `GET /api/events/stream` pushes real-time SSE updates to connected web and desktop clients.

## In-Process Background Integrations

- **Calendar Sync Runner:** Polls the configured `outlook_cli` or `ics` adapter every `calendarSyncIntervalMin` minutes (default `15`) across `today - 7d` to `today + 28d`, plus on-demand `Sync Now` / `veyra events sync`. See `interfaces.calendar-sync-webhooks`.
- **Webhook Dispatcher:** Sends fire-and-forget JSON `POST` events (`focus.started`, `focus.ended`, `block.completed`) when `webhookUrl` is configured.
