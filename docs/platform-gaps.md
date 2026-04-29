# Embr Platform Gaps — Running Log

Captured during `embr-pulse` development. Each entry is friction we hit while building an agent-managed app on Embr that the platform should arguably handle natively.

This file is mined in **Phase 5** of the [design](./design.md) to file ≥3 GitHub issues against `coreai-microsoft/embr` (issues only — we don't push code there).

> Status: **Pre-implementation.** Pre-seeded with gaps the design phase already anticipated. Will grow as we build.

---

## Schema

Each gap should capture:

- **Gap**: 1-line description.
- **Where encountered**: phase + concrete file/scenario.
- **Workaround**: what we did instead.
- **Impact**: how badly it hurts the agent-managed-app story (LOW / MED / HIGH).
- **Proposed primitive**: what we'd want Embr to expose.
- **Filed as**: GH issue link (populated in Phase 5).

---

## Anticipated Gaps (from design phase, pre-implementation)

### G-001 · First-class scheduled / background jobs on Embr

- **Gap**: Embr-hosted apps don't appear to have a native scheduled-job primitive. Loop 3's monitor agent needs a periodic trigger.
- **Where encountered**: design (Phase 0), Loop 3.
- **Workaround**: GitHub Actions cron calls an Embr-hosted endpoint. Works but the scheduler lives off-platform, weakening the "agents run on Embr" story.
- **Impact**: **MED**. Functional but evangelism-weakening.
- **Proposed primitive**: `embr.yaml` schedule field, e.g. `jobs: [{ name: monitor, schedule: "*/5 * * * *", endpoint: /api/agents/monitor/run }]`.
- **Filed as**: TBD

### G-002 · Application-level managed identity for outbound Azure calls

- **Gap**: Apps hosted on Embr need to call Foundry, Kusto, App Insights, Key Vault. Without managed identity, we fall back to long-lived keys in env vars.
- **Where encountered**: design (Phase 0), §Identity & Secrets.
- **Workaround**: Static API keys in Embr env vars. Manual rotation.
- **Impact**: **HIGH**. Security posture and customer trust.
- **Proposed primitive**: Each Embr app gets a managed identity (or federated credential) usable for Azure RBAC role assignments — one of the most common asks in real customer apps.
- **Filed as**: TBD

### G-003 · Programmatic deployment status / lifecycle webhook

- **Gap**: To verify "shipped" honestly, the app needs to know when an Embr deployment for a given commit SHA actually became active in production. Polling the Embr API or Kusto works but is bespoke.
- **Where encountered**: design (Phase 0), §Deployment Verification.
- **Workaround**: Custom polling against Embr deployment endpoints + a startup-log boot signal.
- **Impact**: **MED**. Every customer building an "agent-managed" app will hit this.
- **Proposed primitive**: Embr emits a webhook (configurable target URL) on deployment lifecycle events: `building`, `deployed`, `failed`, `rolled_back`, with commit SHA + environment.
- **Filed as**: TBD

### G-004 · Native feedback / comments primitive (or sample pattern)

- **Gap**: Many "agent-managed" customer apps will want some form of "user submits feedback / comments". We're building this end-to-end; many customers will too.
- **Where encountered**: design (Phase 0), entire Loop 2.
- **Workaround**: Build it ourselves in `embr-pulse`.
- **Impact**: **LOW**. Arguably out of scope for a PaaS, but a reusable sample pattern is high-leverage.
- **Proposed primitive**: A reference implementation in Embr samples (`samples/embr-feedback-loop`) plus a documented "agent-managed app" template.
- **Filed as**: TBD

### G-005 · Agent-identity pattern documentation

- **Gap**: Beyond G-002 (managed identity), there's no documented pattern for how an *agent* (vs a human or a service) authenticates across Embr + GitHub + Foundry + Kusto with appropriate scopes and rotation.
- **Where encountered**: design (Phase 0), §Identity & Secrets.
- **Workaround**: Per-system keys, manually wired up. Each customer will reinvent.
- **Impact**: **HIGH** for evangelism. This is the "how do agents safely operate at scale" question.
- **Proposed primitive**: A documented reference pattern: how an Embr-hosted service obtains short-lived tokens for GitHub (via App), Foundry (via Entra), and Kusto (via Entra/MI), with rotation guidance.
- **Filed as**: TBD

---

## Live Gaps (populated as we build)

### G-006 · Transient `database_provision` failure with no auto-retry

- **Gap**: Auto-deploy of commit `16c39d8` (adding `database:` block to `embr.yaml`) failed at the `database_provision` step with `Failed to install tunnel on DB sandbox 'c56d9b7b-fa7b-48ca-86fe-f90c637fb377'`. The build sandbox + clone + build all succeeded — only DB provisioning failed. Manually re-triggering the deploy at the same SHA succeeded.
- **Where encountered**: Phase 1, second deploy of `seligj95/embr-pulse` after enabling internal Postgres in `embr.yaml`. Failed deployment: `dpl_04295731dd6f473cbb6480f9c6148805`.
- **Workaround**: Manual `embr deployments trigger -p ... -e ... --commit 16c39d8`.
- **Impact**: **MED** — In the agent-managed-app story this would manifest as: developer pushes, deploy fails, *no human is watching*, app never updates. The agent loop assumes pushes deploy successfully; a transient platform failure with no auto-retry breaks that assumption silently. For the Loop 2 demo, a feedback PR that fails to deploy would never flip its status to `shipped`, leaving the loop visibly broken.
- **Proposed primitive**:
  1. Auto-retry transient DB-provision failures (1–2x with backoff) before marking the deploy failed.
  2. Surface a typed error code (`DB_TUNNEL_INSTALL_FAILED`) so the UI/CLI/agent can distinguish "transient infra" from "your code is broken" and react accordingly.
  3. Emit a webhook or status-update event when a deploy fails so the app/agents can react (currently we only know by polling `embr status`).
- **Filed as**: TBD (Phase 5).

### G-007 · No graceful "use external DB while managed DB is broken" path

- **Gap**: When G-006 hit, falling back to an external DB took five manual steps the platform could simplify: (1) `az postgres flexible-server create`, (2) firewall rule for Azure services, (3) allowlist `pgcrypto` via `azure.extensions` server parameter, (4) apply schema manually, (5) `embr dbs connect`. Plus you have to comment out the `database:` block in `embr.yaml` or future deploys keep retrying the broken managed-DB provision. There's no `embr dbs adopt` or a flag like `database.fallbackToExternal` that says "if managed provision fails, use this external connection automatically." Also: `embr dbs connect` doesn't apply schema for you the way `framework: raw + schema: db/schema.sql` does, even though Embr already knows that schema file path from `embr.yaml`.
- **Where encountered**: Phase 1, recovering from G-006.
- **Workaround**: All five manual steps above, plus this commit's removal of the `database:` block.
- **Impact**: **MED** — Demoable but story-weakening. The agent-managed-app pitch is "Embr handles the boring parts." When the boring parts break, the *human* recovery path is multi-step and undocumented. An agent attempting auto-recovery here would have an even harder time.
- **Proposed primitive**:
  1. `embr dbs adopt --schema db/schema.sql ...` — connect external DB *and* apply schema in one command.
  2. `database.fallback:` block in `embr.yaml` for declarative "use this connection if managed provision fails" — keeps source-of-truth in code, not in CLI flags.
  3. EastUS Postgres Flexible Server SKU restriction is a separate but adjacent gap — Embr's quickstart doesn't tell you up front which regions support managed Postgres.
- **Filed as**: TBD (Phase 5).

---

### G-008 · `embr dbs connect` doesn't actually inject `DATABASE_URL` at runtime

- **Gap**: The CLI subcommand presents itself as injecting a `DATABASE_URL` env var (and the design doc's external-DB path assumes it). Reality: after `embr dbs connect`, `embr variables list` shows no new var, and `process.env.DATABASE_URL` is undefined inside the running container. To make the app actually reach the external DB you must `embr variables set DATABASE_URL '<conn-string>' --secret` separately *and* trigger a redeploy (env-var changes don't auto-roll the active deploy).
- **Where encountered**: Phase 1, after the redeploy that landed the `/api/ready` endpoint — the probe returned `503 DATABASE_URL is not set` even though `embr dbs list` showed the connection.
- **Workaround**: Set `DATABASE_URL` manually as a `--secret` variable, then `embr deployments trigger --commit <same sha>` to redeploy.
- **Impact**: **MED** — Silent data plane disconnect. Liveness probes pass, the app appears up, but every DB query fails. An agent automating this end-to-end would not catch the gap unless it specifically wrote a readiness probe and watched the failure mode.
- **Proposed primitive**:
  1. `embr dbs connect` should auto-inject `DATABASE_URL` (and surface it in `variables list`, even if the value is masked) — and auto-trigger a redeploy or print a clear "you must redeploy for this to take effect" hint.
  2. Document explicitly which env vars the platform manages on the user's behalf — right now there's no list.
  3. Setting any variable should optionally trigger a rolling redeploy (`--apply` flag) — current behavior of "set it but require manual redeploy" is footgun-y.
- **Filed as**: TBD (Phase 5).

### G-009 · PR preview environments work, but the feature is undocumented and undiscoverable

- **Gap**: Embr *does* support first-class PR preview environments — when GitHub Copilot opened a PR for our repo, the `embr-platform` bot automatically deployed `copilot/add-timestamp-to-feedback-cards` to a preview URL (`https://pr-copilot-add-timestamp-to-feedback-cards-2-embr-puls-00a00fb5.app.embr.azure`) and posted the URL as a PR comment with status, branch, commit, and revision metadata. **This is great.** The gap is purely documentation/discoverability: nothing in the embr CLI help, the embr-pulse onboarding flow, the GitHub App install README, or the design-time docs surfaces this. I (Copilot CLI agent) initially logged this as "missing feature" and proposed a CLI shape — embarrassingly wrong, because the platform already does it. If I missed it, real customers will too, which means the feature is undersold.
- **Where encountered**: Phase 2 — opened a Copilot PR against issue #1, expected to need to spin up a preview env manually, was about to log "no PR previews" as a gap, then saw the bot comment on the merged PR and realized the platform already had the feature.
- **Workaround**: None needed for the feature itself; the workaround is to *write down* that this exists somewhere a developer or agent will find it.
- **Impact**: **MED** — Major positive surface area going to waste. "Embr ships every PR to a unique URL with zero config" is one of the strongest pitch points for an agent-managed PaaS (it's how Vercel beat Heroku) and it's currently a hidden Easter egg.
- **Proposed fix** (not platform code, but platform docs/UX):
  1. `embr environments list` should show preview envs alongside long-lived ones, with a `pr=` column linking to the PR.
  2. `embr deployments list` should label PR-preview deploys explicitly so they're distinguishable from main-branch deploys at a glance.
  3. Add a "PR Previews" section to the embr CLI README and to the top-level `embr --help` examples.
  4. The bot comment is good; add a one-liner to the README of any `embr quickstart`-generated repo telling new devs "your PR will get a preview URL automatically."
  5. (Possibly) docs on configurable TTL, opt-out per repo, and how preview envs share/don't share secrets and DBs with the parent environment — none of which I've verified yet.
- **Filed as**: TBD (Phase 5).
- **Open questions** (for follow-up Phase 5 investigation):
  - ~~Does the preview env share `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, and `DATABASE_URL` from the parent `production` env?~~ **Answered (see G-011): NO. Preview envs do NOT inherit env vars from the parent.** Good for security, brutal for usability.
  - When does the preview env get torn down? On PR close, on PR merge, or after a TTL? **Partial answer (see G-010)**: at least on merge, possibly tied to branch deletion, but the cleanup races with stray deploy events.
  - Are preview envs counted against any quota?

### G-010 · Embr posts an alarming "❌ Failed" deploy comment on a successfully-merged PR after the preview env is cleaned up

- **Gap**: Sequence: (1) Copilot opens PR #2, (2) Embr creates preview env `env_79db0c0556f04e00b17049a900a00fb5` and posts "✅ Deployed" with the preview URL, (3) PR is merged, main deploys to prod successfully (rev 13), preview env is torn down, (4) the branch is deleted (manually), (5) Embr tries to deploy *something* to the now-deleted preview env, fails with `Environment 'env_79db...' not found in project 'prj_020bf32...'`, (6) the `embr-platform` bot posts a "❌ Failed" comment on the merged PR. Production is unaffected — the failure is on the dead preview env — but the failure comment makes a healthy merge look broken to anyone reading the PR thread later.
- **Where encountered**: Phase 2 — first end-to-end test of the Copilot coding agent loop. We watched the agent open PR #2, Embr auto-deploy the preview, merge succeed, prod deploy succeed (Copilot's fix shipping at https://production-embr-pulse-e617a008.app.embr.azure shows "17m ago" relative timestamps), and then a "❌ Failed" comment appeared on the closed PR for an unrelated stray deploy.
- **Workaround**: Ignore the failure comment. Verify production state out-of-band (via `embr deployments list` showing rev 13 active on the production env, or by hitting the live URL).
- **Impact**: **MED** — Pure UX, no functional impact on production. But "did our deploy fail?" is a top-five thing engineers panic about, and a false-positive "Failed" comment burns trust in the platform's signaling fast. In a customer demo this is the kind of thing that gets pointed at and remembered.
- **Proposed fix** (likely platform orchestration):
  1. When a preview env is being torn down (PR close/merge), drain or cancel any in-flight or queued deploy events targeting that env BEFORE deleting it.
  2. If a deploy event arrives for a deleted env, suppress the GitHub PR comment entirely (or at most, post an info-level "preview env already torn down" rather than a red ❌).
  3. The bot's "Failed" comment template should distinguish *production* failures (alarming, real, actionable) from *preview* failures (often noise) — different colors, different language, possibly only post the latter when the PR is still open.
- **Filed as**: TBD (Phase 5).

### G-011 · PR previews don't see env-scoped variables, even though Embr's "preview from production" mental model implies they should

- **Gap**: Embr supports two variable scopes — **project-level** (inherited by all environments, including PR previews) and **environment-level** (visible only to the specific env). PR preview environments inherit project-level vars but **not** env-level vars from the parent (e.g., `production`). When a developer runs `embr variables set DATABASE_URL ... -e env_prod...` (the natural CLI invocation when working in a single-env app), the var is scoped to `production` only. The PR preview boots without it and crashes on first config lookup. The user clicks the preview URL and sees their app's "missing config" error page (in our case: `Could not load feedback: DATABASE_URL is not set`). The mental model "preview is a copy of production with the PR's code on top" is wrong; preview is "an empty environment with the PR's code on top, plus whatever happens to be project-level."
- **Where encountered**: Phase 2 — clicking the preview URL on Copilot's PR #4 (`copilot/add-live-character-counter`). The homepage failed because `DATABASE_URL` was set on the `production` env (via `embr variables set ... -e env_2c40970...`). All four of our app's vars (`DATABASE_URL`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPLICATIONINSIGHTS_CONNECTION_STRING`) were env-scoped, so 0 of them reached the preview. Static-only pages (e.g., `/submit`) still rendered, but the actual product (the feed at `/`) was inaccessible.
- **Workaround**: Move vars to project-level scope (`embr variables set ... ` without `-e`). For our demo this is OK because we're single-env. For real apps, it's a tradeoff: project-level vars are shared across `production`, `staging`, every PR preview, etc. — so `DATABASE_URL` at project level means **PR previews write to prod DB**, which is a worse problem than the original.
- **Impact**: **HIGH** — Two failure modes:
  1. **Devs scope to env** (most natural CLI default for single-env apps): previews are useless because they have no config.
  2. **Devs scope to project** to fix #1: previews now share secrets and DBs with prod, which is the classic "preview-app-deletes-prod-data" trap.
  Neither default is right. The platform needs a *third* option that today doesn't exist: per-env-class config inheritance.
- **Proposed primitive** — graduated options, easy to hard:
  1. **Better CLI defaults / docs**: when running `embr variables set`, prompt: "Make this available to PR previews? [Y/n]" — basically a UX nudge to think about scope. And in the dashboard, the Variables tab should explain *why* the toggle exists, not just show "Show inherited from project."
  2. **"Inherit-from on preview create"**: a project setting like "PR previews should inherit env vars from environment X" — defaults to none, but lets a project owner say "previews get a *copy* of production's env vars at preview-create time." Snapshot semantics avoid the live-shared-DB trap.
  3. **Preview-specific overrides**: the project owner can declare a per-key rule: `DATABASE_URL` → "use this preview-DB connection string when running in a PR preview env"; `GITHUB_TOKEN` → "same as production"; etc. This is the Vercel/Netlify pattern and is the "right" answer.
  4. **Visible warning in the bot's preview comment**: "⚠️ This preview has 0 env vars inherited from production. If your app needs config, set it at project scope or use a preview-specific override." Today, you only learn the limitation when you click the URL and see a stack trace.
- **Filed as**: TBD (Phase 5).
- **Validation note (added 2026-04-29)**: We hit option (1) trap exactly during PR #4 testing — Copilot's char-counter PR opened a preview, the preview rendered with `Could not load feedback: DATABASE_URL is not set`, and to actually test it we promoted all 4 vars (DATABASE_URL, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, APPLICATIONINSIGHTS_CONNECTION_STRING) from env-scope to project-scope. This unblocked the preview but **the preview now writes to the production DB**. Acceptable for our internal-team demo (we control all the input), but a real customer with this app would either: (a) be unable to test PR previews end-to-end, or (b) accidentally mutate prod from a preview env, possibly via untrusted PRs. Either failure mode is bad. This is exactly why the platform needs a primitive better than "all-or-nothing inheritance."

When we hit Phase 5, we'll:
2. Group duplicates and combine with anything new.
3. Pick the top 3+ HIGH/MED-impact gaps.
4. File one GitHub issue against `coreai-microsoft/embr` per gap, linking back to the relevant section of `embr-pulse` (private repo — link to specific file:line snapshots in the issue body).
5. Update the **Filed as** column above.
