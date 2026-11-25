---
id: human.services
type: view
scope: human
sourceVersion: f62c1c9
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
- **Webhook Dispatcher:** Sends fire-and-forget JSON `POST` events (`focus.started`, `focus.ended`, `block.completed`, `review.completed`) when `webhookUrl` is configured.

## Optional Local Auto-Summary Listener (macOS `launchd`)

To run `veyra hook listen --auto-summary` continuously in the background on macOS, configure `http://127.0.0.1:4174/hooks/veyra` in `Settings → Integrations` and install a user `LaunchAgent` plist at `~/Library/LaunchAgents/ai.veyra.hook-listener.plist` (replacing `/Users/<you>` and any `--workspace` paths with your own directories):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.veyra.hook-listener</string>

    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/Users/&lt;you&gt;/code/veyra/packages/cli/dist/index.js</string>
      <string>hook</string>
      <string>listen</string>
      <string>--port</string>
      <string>4174</string>
      <string>--auto-summary</string>
      <string>--summarizer-cmd</string>
      <string>claude -p</string>
      <string>--min-minutes</string>
      <string>5</string>
      <string>--workspace</string>
      <string>/Users/&lt;you&gt;/code/my-project</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
      <key>VEYRA_SERVER_URL</key>
      <string>http://127.0.0.1:4173</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/veyra-hook-listener.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/veyra-hook-listener.err.log</string>
  </dict>
</plist>
```

Load or unload the agent with `launchctl`:

```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/ai.veyra.hook-listener.plist
launchctl bootout "gui/$(id -u)/ai.veyra.hook-listener"
```

If you also set `VEYRA_WEBHOOK_SECRET` on the Veyra server, add the same key to `EnvironmentVariables` in the plist so the listener enforces HMAC-SHA256 verification.
