---
id: operations.testing-and-verification
type: procedure
scope: operations
authority: canonical
sourceVersion: 432c801
extends: operations
dependsOn:
  - architecture.monorepo-boundaries
groundedIn:
  - package.json
  - vitest.config.ts
  - packages/core/tests/db.test.ts
  - packages/core/tests/blocks-rollover.test.ts
  - packages/core/tests/focus-sessions.test.ts
  - packages/core/tests/review-projects.test.ts
  - packages/server/tests/api.test.ts
  - packages/server/tests/sync-webhooks.test.ts
  - packages/cli/tests/cli.test.ts
  - packages/web/tests/app-flows.test.tsx
  - packages/desktop/tests/client-config.test.ts
  - tests/e2e/daily-driver.test.ts
updateWhen:
  - Vitest project configuration or root package scripts change
  - new test suites or build prerequisites are added
---
# Testing And Verification Procedure

Root `vitest.config.ts` splits automated tests into two Vitest projects:

- **`node` project:** Runs `packages/{core,server,cli,desktop}/tests/**/*.test.ts` and `tests/e2e/**/*.test.ts` under Node 22.
- **`web` project:** Runs `packages/web/tests/**/*.test.{ts,tsx}` under `jsdom` with `@testing-library/react`.

## 1. Run Typecheck And Workspace Build

Always compile `@veyra/core` and upstream packages before running the full test or E2E suite because downstream packages import built declarations and bundles:

```bash
pnpm typecheck
pnpm build
```

## 2. Run Unit, API, CLI, UI, And E2E Suites

```bash
pnpm test
pnpm test:e2e
```

`tests/e2e/daily-driver.test.ts` boots a real `@veyra/server` with `enableTestClock: true`, exercises onboarding, planning, focus sessions, multi-day session edits, ICS and Outlook CLI sync adapters, live SSE events, `veyra` CLI subprocess invocations, midnight rollover + guilt-free recurrence, and Weekly Review KPIs end to end.

## 3. Verify Desktop Native SQLite And Launch

When testing `@veyra/desktop` interactively on macOS after dependency updates:

```bash
pnpm --filter @veyra/desktop rebuild:native
pnpm dev:desktop
```

## 4. Validate Documentation Graph

Run the DocDriven frontmatter, graph, and project audit scripts against `--docs-root docs` after any doc change (commands listed in `docs/agent/validation.md`).
