---
id: interfaces
type: overview
scope: interfaces
authority: canonical
sourceVersion: 432c801
extends: knowledge.index
includes:
  - interfaces.http-sse-api
  - interfaces.cli-and-agent-skill
  - interfaces.calendar-sync-webhooks
updateWhen:
  - REST routes, SSE events, or auth behavior change
  - CLI subcommands, config resolution, or agent skill change
  - calendar sync adapters or outgoing webhook payloads change
---
# Veyra Interfaces

All external contracts exposed by Veyra: HTTP + SSE API, `veyra` CLI and T3 Code agent skill, and Day-1 calendar sync plus webhooks.

## HTTP And SSE API

Hono REST routes, bearer authentication, test clock override, actor attribution, and `/api/events/stream` live sync hub. See → `interfaces.http-sse-api`

## CLI And Agent Skill

`veyra` command families, `--json` contract, local config resolution, and the T3 Code agent skill in `skills/veyra/SKILL.md`. See → `interfaces.cli-and-agent-skill`

## Calendar Sync And Webhooks

Day-1 `OutlookCliAdapter`, `IcsFeedAdapter`, sync runner preservation guarantees, and outgoing lifecycle webhooks. See → `interfaces.calendar-sync-webhooks`
