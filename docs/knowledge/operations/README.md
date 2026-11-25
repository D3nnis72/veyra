---
id: operations
type: overview
scope: operations
authority: canonical
sourceVersion: f62c1c9
extends: knowledge.index
includes:
  - operations.docker-self-hosting
  - operations.testing-and-verification
updateWhen:
  - Docker packaging, runtime environment variables, or health checks change
  - test runner setup, build order, or E2E verification steps change
---
# Veyra Operations

Self-hosted deployment procedures and automated verification across all workspace packages.

## Docker Self-Hosting

Multi-stage Node 22 Docker image, persistent `/data` SQLite volume, bearer token auth, and remote client connection. See → `operations.docker-self-hosting`

## Testing And Verification

Vitest node and jsdom projects, workspace build and typecheck commands, Electron native rebuilds, and the daily-driver E2E suite. See → `operations.testing-and-verification`
