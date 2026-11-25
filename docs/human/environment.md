---
id: human.environment
type: view
scope: human
sourceVersion: f62c1c9
derivedFrom:
  - interfaces.http-sse-api
  - interfaces.cli-and-agent-skill
  - features.desktop-shell-capture
  - operations.docker-self-hosting
---
# Environment Variables

All runtime environment variables are optional locally and have safe localhost defaults.

## Server (`@veyra/server`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VEYRA_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Bind address for HTTP server |
| `VEYRA_PORT` | `4173` | Listening TCP port |
| `VEYRA_DB_PATH` | `~/.veyra/veyra.db` (`/data/veyra.db` in Docker) | SQLite database file path |
| `VEYRA_TOKEN` | unset | Enables `Authorization: Bearer` auth on `/api/*` (except `/api/health`) |
| `VEYRA_WEB_DIST_DIR` | unset (`/app/packages/web/dist` in Docker) | Serves built `@veyra/web` SPA from the server |
| `VEYRA_ENABLE_TEST_CLOCK` | unset | Set to `1` in test harnesses only to allow `?now=` / `X-Veyra-Now` |

## CLI (`@veyra/cli`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VEYRA_SERVER_URL` | `~/.veyra/config.json` or `http://127.0.0.1:4173` | Target Veyra server URL |
| `VEYRA_TOKEN` | `~/.veyra/config.json` or none | Optional bearer token |
| `VEYRA_ACTOR` | `cli` | Activity log actor (`user`, `cli`, `agent`, `hook`) |
| `VEYRA_CONFIG_PATH` | `~/.veyra/config.json` | Override CLI config file path |
| `VEYRA_NOW` | unset | Sends `X-Veyra-Now` header during test-clock runs |

## Desktop (`@veyra/desktop`)

Inherits `VEYRA_HOST`, `VEYRA_PORT`, `VEYRA_DB_PATH`, `VEYRA_WEB_DIST_DIR`, and `VEYRA_ENABLE_TEST_CLOCK` for its embedded server, plus:

- `VEYRA_WEB_DEV_URL`: Load renderer from a running Vite dev server instead of `packages/web/dist`.
- `VEYRA_DESKTOP_CONFIG_PATH`: Override Electron `client-config.json` path.
- `VEYRA_ALLOW_MULTI_INSTANCE`: Set to `1` to bypass the Electron single-instance lock during testing.
