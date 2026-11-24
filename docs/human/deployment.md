---
id: human.deployment
type: view
scope: human
sourceVersion: 432c801
derivedFrom:
  - operations.docker-self-hosting
  - interfaces.http-sse-api
---
# Deployment Guide

Self-host Veyra on any Docker host (VPS, Railway, Fly.io, or home server) using the root `Dockerfile` and `docker-compose.yml`.

## Quick Deploy

```bash
export VEYRA_TOKEN="$(openssl rand -hex 24)"
docker compose up -d --build
curl -fsS http://127.0.0.1:4173/api/health
```

## Production Notes

- Put TLS termination (Caddy, Nginx, or platform proxy) in front of port `4173` and keep `VEYRA_TOKEN` set whenever exposing Veyra over a network.
- Back up the `veyra_data` volume (`/data/veyra.db`) regularly.
- Set `Settings → Integrations → Calendar Sync` to `ICS / CalDAV Feed` in Docker deployments, since `Outlook CLI (local)` relies on a host-local calendar CLI binary.
- Connect macOS desktop via `Settings → Server & CLI` (`Self-Hosted Docker / VPS`) and CLI via `veyra config set --url https://<host> --token <token> --json`.

Full step-by-step details live in `operations.docker-self-hosting`.
