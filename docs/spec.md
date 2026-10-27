# Undercut: Spec (v1)

> Track the price of anything on any site, even the ones that block bots, and get alerted the moment it drops.

## Origin
Generalized from the personal Cancun resort tracker (`MaddoxNehls/cancun-price-watch`), which hit a real constraint: travel sites bot-block datacenter IPs, so cloud scrapers fail and only a real browser on a home IP gets prices. Undercut turns that hard-won architecture into a product.

## Core idea: hybrid collection
- **Cloud workers** scrape sites that allow it (fast, cheap)
- A **local collector agent** (a small desktop app/CLI on the user's machine) runs a real headless browser from the residential IP for sites that block the cloud. It pulls jobs from the server and pushes results back.
- The scheduler routes each watch to the right collector based on its observed block rate per domain. Routing is **learned, not configured**.

## Adding a watch
- Paste a URL. An LLM-assisted extractor finds the price element and proposes a selector + parsing rule, which the user confirms.
- Self-healing: when the selector breaks (layout change), the LLM re-derives it from the page and the change is logged
- Multi-variant watches: e.g. date windows × room types (from the Cancun use case), shown as a heatmap

## Alerts and history
- Rules: below a target, drops by X%, a new all-time low; re-alert hysteresis (the Cancun tracker's "$25 step" rule) to avoid spam
- Channels: email, web push, ntfy/Telegram
- Price-history charts, and "as-of" timestamps on every price, since prices flap hourly

## Stack
- Next.js app (Vercel) + Postgres (Neon) + a queue (Vercel Queues or a Postgres-backed job table)
- Cloud workers in TypeScript + Playwright (Fly.io)
- The local collector is a Node CLI packaged as a single binary, with long-poll job pickup and authenticated device tokens
- The `claude -p` + Playwright approach from the original tracker is an optional "agentic collector" for complex multi-step sites

## Engineering highlights
- Anti-flap logic, per-domain politeness/rate limits, robots.txt respect, and job leasing with timeouts (at-least-once collection without double alerts)

## Milestones
1. Data model, watch CRUD, cloud collector, price history
2. Local collector + job leasing + device auth
3. LLM-assisted selector extraction + self-healing
4. Alert engine + channels
5. Learned routing + block-rate dashboard
6. Deploy, migrate the Cancun watches as the showcase, README, write-up
