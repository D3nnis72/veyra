# Validation Commands

Run the narrowest command for the touched route first, then full workspace checks before merging.

## Code Validation

- Full typecheck: `pnpm typecheck`
- Full workspace build: `pnpm build`
- Full test suite (node + web jsdom): `pnpm test`
- End-to-end daily-driver suite: `pnpm test:e2e`
- Package-scoped tests:
  - `pnpm --filter @veyra/core test`
  - `pnpm --filter @veyra/server test`
  - `pnpm --filter @veyra/cli test`
  - `pnpm --filter @veyra/web test`
  - `pnpm --filter @veyra/desktop test`
- Electron native SQLite rebuild: `pnpm --filter @veyra/desktop rebuild:native`
- Docker image build: `docker compose build`

## Documentation Validation

Run against `--docs-root docs`:

```bash
node ~/.claude/skills/docdriven-audit/scripts/check-frontmatter.mjs --root . --docs-root docs
node ~/.claude/skills/docdriven-audit/scripts/check-graph.mjs --root . --docs-root docs
node ~/.claude/skills/docdriven-audit/scripts/audit-docdriven.mjs --root . --docs-root docs
node ~/.claude/skills/docdriven-audit/scripts/check-staleness.mjs --root . --docs-root docs
```
