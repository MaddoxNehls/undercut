# Undercut M1–M2 build plan

- [x] Workspace scaffold (pnpm, tsconfig, docker-compose on 5447: 5435 and 5436 were taken by other local projects)
- [x] packages/core: domain types, price parsing, currency table, selector extractor, block classifier, routing policy, hysteresis, alert/extractor interfaces, wire protocol (zod)
- [x] packages/db: SQL migrations, migrator, typed queries (watches, collectors, jobs/leasing, observations, domains), scheduler tick, admin + scheduler bins
- [x] packages/collector-runtime: API client, Playwright capture, robots cache, lease loop (shared by worker + local collector)
- [x] apps/worker: cloud collector (headless)
- [x] apps/collector: local CLI (login/run/status/logout)
- [x] apps/web: collector API routes, watch CRUD, detail + chart, observation log, devices + domain routing
- [x] Tests: core table tests, db leasing race + expiry + idempotency + politeness + routing, Playwright fixture tests
- [x] Live smoke vs books.toscrape.com + screenshot
- [x] README draft (story, diagram, leasing + routing, run locally)
- [x] typecheck / test / build all green

## Review
- typecheck, test (136 tests across 5 packages) and build are all green; the full test suite ran green twice in a row.
- Live smoke: 3 books.toscrape.com watches, 12 cloud jobs over the real HTTP collector API, all ok (A Light in the Attic = GBP 51.77).
- Bugs found during verification and fixed:
  - jsonb double-encoding of `extraction` (the UI fork caught it; now covered by a regression test).
  - A transient robots.txt timeout was treated as a permanent skip; it is now a retryable error.
  - The race test treated one empty SKIP LOCKED lease as "queue drained" under machine load.
  - Turbopack could not resolve `.js` relative imports in workspace packages; they are now extensionless.
- Open for later: chart x-axis padding when all points fall in a short span; Node SEA binary; web UI auth (single-tenant for now).

## M3-M4 review
- M2 gaps closed: local collector ran live (installed Chrome, device maddox-desktop); observation collector_id = device. Chart: fitted time domain + step-after.
- M3: packages/llm (anthropic, openrouter, claude-cli, replay, disk cache), packages/extraction (digest, heuristics, LLM candidates, heal decision), paste-URL flow with crops, healing payload on parse_error, healTick, selector_history UI, proposal accept/reject.
- M4: rule evaluation (debounce, $25 step, quiet hours), transactional idempotent alert recording, email/ntfy/web push with delivery retry, alert rules/history/settings UI.
- No LLM calls made (owner constraint): LLM paths use hand-authored replay fixtures, labeled in README.
- typecheck, test (189 tests), build all green.
