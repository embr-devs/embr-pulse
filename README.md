# embr-pulse

> Team feedback aggregator hosted on [Embr](https://github.com/coreai-microsoft/embr) — every part of its lifecycle (development, deployment, monitoring, fixes) is driven by agents.
>
> Reference architecture for [coreai-microsoft/embr#374](https://github.com/coreai-microsoft/embr/issues/374).

## What this is

A real internal app the Embr team uses to give feedback. Each submission becomes a GitHub issue. **GitHub Copilot's coding agent** picks up issues, opens PRs, and Embr auto-deploys them. A **Foundry monitor agent** watches production telemetry and opens incident issues when SLOs trip.

The app's purpose is the agent loop. Building it surfaces what Embr needs to make this experience first-class for customers.

## Docs

**Evangelism:**
- [`docs/customer-story.md`](docs/customer-story.md) — narrative pitch with real receipts (issue #8 → PR #9 in ~25 minutes)
- [`docs/reference-architecture.md`](docs/reference-architecture.md) — what we built, distilled for customers who want to copy it
- [`docs/embed-in-embr.md`](docs/embed-in-embr.md) — what Embr should ship to make this first-class

**Engineering:**
- [`docs/design.md`](docs/design.md) — full architecture and rationale
- [`docs/demo-script.md`](docs/demo-script.md) — canonical happy-path demo we engineer toward
- [`docs/platform-gaps.md`](docs/platform-gaps.md) — running log of Embr platform improvements we'd like to see

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
