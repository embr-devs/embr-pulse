# embr-pulse

> Team feedback aggregator hosted on [Embr](https://github.com/coreai-microsoft/embr) — every part of its lifecycle (development, deployment, monitoring, fixes) is driven by agents.
>
> Reference architecture for [coreai-microsoft/embr#374](https://github.com/coreai-microsoft/embr/issues/374).

## What this is

A real internal app the Embr team uses to give feedback. Each submission becomes a GitHub issue. **GitHub Copilot's coding agent** picks up issues, opens PRs, and Embr auto-deploys them. A **Foundry monitor agent** watches production telemetry and opens incident issues when SLOs trip.

The app's purpose is the agent loop. Building it surfaces what Embr needs to make this experience first-class for customers.

> **Status:** All three loops are operational. Receipts:
> - Loop 1 (code): every PR in this repo merged via Copilot is a Loop 1 receipt.
> - Loop 2 (feedback → ship): [issue #8 → PR #9 in ~25 minutes](docs/customer-story.md).
> - Loop 3 (self-heal): [incident #139](https://github.com/seligj95/embr-pulse/issues/139) — Foundry monitor agent detected a synthetic triage-failure spike, filed a real incident issue with hypothesis + suggested action, and deduplicated subsequent triggers onto the same issue.

## What we learned

Building this surfaced **15 platform-friction points** and one architectural opinion worth surfacing up front:

> **Don't make Embr "an agent platform." Make Embr the platform that agent-driven apps run on.**
>
> Triage prompts, monitor classifiers, and Copilot routing are per-customer code — they belong in the **app**.
> Workload identity, scheduled jobs, deployment-lifecycle webhooks, and observability auto-wiring are per-platform — they belong in **Embr**.

Full reasoning: [`docs/embed-in-embr.md`](docs/embed-in-embr.md).
Upstream impact: 15 gaps lodged against `coreai-microsoft/embr` (11 new issues + 4 comments on existing tracking issues). Catalog: [`docs/platform-gaps.md`](docs/platform-gaps.md).

## Docs

**Start here** (15-min read for anyone landing cold):
- [`docs/customer-story.md`](docs/customer-story.md) — narrative pitch with real receipts (issue #8 → PR #9 in ~25 minutes)
- [`docs/embed-in-embr.md`](docs/embed-in-embr.md) — standalone agent vs ADC-embedded: our recommendation and why

**Customer-facing:**
- [`docs/reference-architecture.md`](docs/reference-architecture.md) — what we built, distilled for customers who want to copy it
- [`docs/demo-script.md`](docs/demo-script.md) — canonical happy-path demo we engineer toward

**Engineering:**
- [`docs/design.md`](docs/design.md) — full architecture and rationale
- [`docs/platform-gaps.md`](docs/platform-gaps.md) — running log of Embr platform improvements (with filed-as links)

## Local development

```bash
# 1. Install
npm install

# 2. Spin up Postgres (any way you like — Docker, Postgres.app, etc.)
#    Then export DATABASE_URL or copy .env.example to .env.local and edit.
cp .env.example .env.local

# 3. Apply schema
npm run db:migrate

# 4. Run dev server
npm run dev
# → http://localhost:3000
```

## Deploy to Embr

```bash
# One-time setup (push to seligj95/embr-pulse, link via Embr GitHub App):
embr quickstart deploy seligj95/embr-pulse -i <installation_id>
```

After that, every push to `main` auto-deploys.

## Stack

| Layer | Tech |
|---|---|
| App | Next.js 15 (App Router) + TypeScript |
| DB | Postgres (Embr-managed) |
| Auth | NextAuth + Microsoft Entra ID |
| Coding agent | GitHub Copilot |
| Triage / Monitor | Microsoft Foundry agents |
| Telemetry | App Insights + existing Embr Kusto |
| Hosting | Embr |
