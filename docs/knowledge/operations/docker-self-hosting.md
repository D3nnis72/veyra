---
id: operations.docker-self-hosting
type: procedure
scope: operations
authority: canonical
sourceVersion: 48164b1
extends: operations
dependsOn:
  - interfaces.http-sse-api
groundedIn:
  - Dockerfile
  - docker-compose.yml
  - packages/server/src/index.ts
updateWhen:
  - Dockerfile stages, base image, volume mounts, or healthcheck change
  - docker-compose.yml environment defaults change
---
# Docker Self-Hosting Procedure

Veyra deploys as one self-contained Node 22 container that serves both the Hono REST/SSE API and the built `@veyra/web` SPA against a persistent SQLite volume.

## Container Build Architecture

`Dockerfile` uses four stages (`source`, `builder`, `prod-deps`, `runtime`) on `node:22-slim` with `pnpm@12` and `ELECTRON_SKIP_BINARY_DOWNLOAD=1`:

1. Strips any host `node_modules` or `dist` directories from `core`, `server`, and `web`.
2. Installs workspace dependencies and compiles native `better-sqlite3` plus TypeScript/Vite bundles for `@veyra/core`, `@veyra/server`, and `@veyra/web`.
3. Installs production-only dependencies for `@veyra/server...`.
4. Copies compiled artifacts and `/app/packages/web/dist` into a slim runtime image running as non-root user `node` on port `4173` with `VOLUME ["/data"]` and a `HEALTHCHECK` against `GET /api/health`.

## 1. Configure Environment And Start Compose

Export a strong `VEYRA_TOKEN` before exposing the container beyond localhost, then build and start with Docker Compose:

```bash
export VEYRA_TOKEN="$(openssl rand -hex 24)"
docker compose up -d --build
```

`docker-compose.yml` mounts the named `veyra_data` volume at `/data`, sets `VEYRA_DB_PATH=/data/veyra.db`, `VEYRA_HOST=0.0.0.0`, `VEYRA_PORT=4173`, and `VEYRA_WEB_DIST_DIR=/app/packages/web/dist`.

## 2. Verify Health And Persistence

```bash
curl -fsS http://127.0.0.1:4173/api/health
```

Confirm `{"ok":true,"version":"0.1.0","dbReady":true}` and that SQLite writes persist across `docker compose restart`.

## 3. Connect Desktop And CLI Clients

- **Desktop:** Open `Settings → Server & CLI`, select `Self-Hosted Docker / VPS`, enter the remote URL and `VEYRA_TOKEN`, and save.
- **CLI:** Run `veyra config set --url https://<host> --token <VEYRA_TOKEN> --json` (or set `VEYRA_SERVER_URL` and `VEYRA_TOKEN` env vars).
- **Calendar Sync in Docker:** Use `ICS / CalDAV Feed` mode inside Docker because `Outlook CLI (local)` invokes a host-local calendar CLI binary.
