# Embr Platform Gaps — Running Log

Captured during `embr-pulse` development. Each entry is friction we hit while building an agent-managed app on Embr that the platform should arguably handle natively.

This file is mined in **Phase 5** of the [design](./design.md) to file GitHub issues against `coreai-microsoft/embr` (issues only — we don't push code there).

> Status: **All four phases shipped.** Loops 1–3 are operational on production. This file is now a steady-state list of platform improvements with concrete receipts behind each one. Currently 15 entries (G-001 → G-015); 4 filed (#744, #745, #746, #750), 11 ready to file.

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
- **Where encountered**: Phase 2 — first end-to-end test of the Copilot coding agent loop. We watched the agent open PR #2, Embr auto-deploy the preview, merge succeed, prod deploy succeed (Copilot's fix shipping at https://production-embr-pulse-e617a008.app.embr.azure shows "17m ago" relative timestamps), and then a "❌ Failed" comment appeared on the closed PR for an unrelated stray deploy. **Live example to look at**: https://github.com/seligj95/embr-pulse/pull/4 — scroll past the merge to see the post-merge `embr-platform Bot ❌ Failed` comment with the "Environment 'env_xxx...' not found" error. (PR #2 had the same pattern earlier in the session, but PR #4's red ❌ is preserved on the PR thread for inspection.)
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
- **Filed as**: [coreai-microsoft/embr#746](https://github.com/coreai-microsoft/embr/issues/746).
- **Validation note (added 2026-04-29)**: We hit option (1) trap exactly during PR #4 testing — Copilot's char-counter PR opened a preview, the preview rendered with `Could not load feedback: DATABASE_URL is not set`, and to actually test it we promoted all 4 vars (DATABASE_URL, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, APPLICATIONINSIGHTS_CONNECTION_STRING) from env-scope to project-scope. This unblocked the preview but **the preview now writes to the production DB**. Acceptable for our internal-team demo (we control all the input), but a real customer with this app would either: (a) be unable to test PR previews end-to-end, or (b) accidentally mutate prod from a preview env, possibly via untrusted PRs. Either failure mode is bad. This is exactly why the platform needs a primitive better than "all-or-nothing inheritance."

---

### G-012 · `env.activeDeploymentId` can stay pinned to a superseded deployment, leaving prod 404'ing while platform reports "active"

- **Gap**: Embr tracks "what's active" in two separate places that can disagree:
  1. The **deployment** carries its own `status` (`building` → `provisioning` → `active` / `superseded` / `failed`).
  2. The **environment** carries an `activeDeploymentId` that the gateway uses to route traffic.
  When deploy N+1 transitions to `active`, the gateway flip-over (stop instances of N, set `env.activeDeploymentId = N+1`) is supposed to be atomic. We hit a state where rev 17 had `status: active` with a healthy running instance, but `env.activeDeploymentId` was still pointing at superseded rev 16, whose container had already been torn down. Result: every route returned `HTTP 404 {"error":"Not found"}` with `x-adc-response-details: platform` (so the 404 was from Embr's gateway, not our app — gateway was routing to a dead deployment ID). Recovery options were also broken: `embr deployments activate <new-deploy>` returned `400 ValidationFailed errorCode=18` (because the new deploy already considered itself active from its own perspective), and `embr deployments restore` returned the same. The only way out was to trigger yet another deploy.
- **Where encountered**: Phase 2, immediately after PR #4 was merged. Sequence: rev 16 deployed cc11810 (Copilot's char-counter merge) and went active. Then rev 17 auto-deployed 3adeff7 (a doc-only commit) on top. Rev 17's own status flipped to `active`, instance was running, but `env.activeDeploymentId` never updated → all of prod returned 404 for ~10 minutes. Diagnosis required checking `embr environments list --json` against `embr deployments list --json` and noticing the ID mismatch.
- **Workaround**: Trigger a fresh deploy (`embr deployments trigger -c <sha>`). Rev 18→19 cleanly took over and the env updated. This is a "throw a deploy at the platform until consistency returns" workaround — fine for a demo, terrible for a real outage.
- **Impact**: **HIGH** — production-down with no usable recovery primitive. `activate` and `restore` both refuse to operate on a deploy that already says it's active. The `embr deployments` CLI surface has no "force-flip env to point at this deploy" or "resync env metadata" command. A customer hitting this would be stuck on hold support.
- **Proposed primitive**:
  1. **Self-heal**: when `env.activeDeploymentId` points at a superseded deployment, the platform should detect this on its next reconciliation tick and force-update to the actual newest active deployment. (This is a control-plane invariant: env active deployment must never be in `superseded` or `failed` state.)
  2. **Operator escape hatch**: `embr environments resync-active -e <env>` or similar — a no-cost CLI to re-derive the env's `activeDeploymentId` from the latest active deployment in that env.
  3. **The `activate` validation should be relaxed** when the env is pointing somewhere stale: if `env.activeDeploymentId != <target>` and `<target>.status == active`, the `activate` API should succeed (effectively repointing the env), not 400.
  4. **Visibility**: this state mismatch should surface as a warning on `embr environments get` (e.g., "⚠️ Env active deployment is superseded; prod is likely 404'ing"). Today nothing in the CLI output hints at it.
- **Filed as**: [coreai-microsoft/embr#745](https://github.com/coreai-microsoft/embr/issues/745).

---

### G-013 · Some `_next/static/chunks/*.js` requests hang indefinitely from browsers (but succeed via curl), preventing React hydration on a healthy "active" deploy

- **Gap**: Immediately after rev 19 was reported `active` on prod, the homepage and `/submit` rendered correctly via SSR — HTML loaded, all forms visible — but the page never became interactive. Specifically:
  - `<input>`/`<textarea>` had no `__reactFiber`/`__reactProps` keys (= React never hydrated).
  - The character-counter from PR #4 stayed at `0 / 4000` regardless of typed input.
  - The submit button fell back to native form POST (to `action=""`) which returned `HTTP 500`, so users saw "nothing happens" when clicking submit.
  - Root cause: two specific JS chunks loaded by `<script async>` tags — the webpack runtime (`webpack-<hash>.js`) and the route bundle (`app/submit/page-<hash>.js`) — **hung forever** when fetched by the browser. Without webpack, no other chunks could link, so React never bootstrapped.
  - Critically: the **same chunk URLs returned HTTP 200 in <100ms when fetched via `curl`**. The hang was browser-specific. Both Safari (in user's screenshot) and headless Chromium (Playwright reproduction) hit it. The other 5 chunks served by `<script async>` tags from the same HTML loaded fine.
  - Fix-by-redeploy: triggering a no-op redeploy regenerated the chunks with new hashes (`page-921be1e4...` instead of `page-0d7de43e...`); after that, all chunks loaded in <300ms and hydration worked. So the issue is per-asset / per-deploy, not per-route.
- **Where encountered**: Phase 2 — after Copilot's PR #4 (char counter) merged + rev 19 auto-deployed. User reported "the counter is not working and the share feedback button doesn't do anything." Initially looked like a code bug in `app/submit/FeedbackForm.tsx`, but the diff was clean (~16 lines, just `useState` + `onChange` + a counter `<div>`) and the same bug affected the homepage too. Playwright instrumentation showed those two specific chunks pending forever while curl served them instantly. Live example PR: https://github.com/seligj95/embr-pulse/pull/4.
- **Workaround**: `embr deployments trigger -c <sha>` again to get fresh chunk hashes. There's no way for an app developer to debug or recover from this short of "redeploy and pray." Worse: Embr posts a green ✅ "Deployed" comment on the PR, so to anyone reading the PR thread the deploy looks healthy.
- **Impact**: **HIGH** — silent prod outage where:
  1. Healthchecks pass (`/api/health` is a server-rendered route, doesn't need hydration).
  2. SSR HTML renders correctly, so static crawlers / monitors look healthy.
  3. End-users see a page that *looks* fine but is non-interactive (counters frozen, buttons dead, navigation works only via plain `<a>` links). No visible error.
  4. There's nothing in `embr deployments logs` or `embr deployments get` that hints at it. Runtime logs say "Runtime logs are not yet available."
- **Proposed primitive**:
  1. **Investigate the gateway/CDN race**: hash-named immutable assets shouldn't ever hang. Likely a race between blob upload completion and the proxy serving the asset URL, or an HTTP/2 stream-priority bug specific to `<link rel=preload>` + `<script async>` for the same hash.
  2. **Synthetic browser healthcheck**: Embr already does HTTP healthchecks; add a headless-browser hydration check (load `/`, wait for hydration marker, fail the deploy if it doesn't hydrate within N seconds). This is what would have prevented the "looks healthy, isn't" failure mode.
  3. **Surface chunk-load failures in deployment status**: if browser-side metrics (RUM via App Insights) show >5% of clients failing to load any chunk, the deployment should be flagged or auto-rolled-back.
  4. **CLI inspection**: `embr deployments verify <id>` that does a real browser load and reports asset load times — would let us catch this before promoting/announcing a deploy.
- **Filed as**: [coreai-microsoft/embr#744](https://github.com/coreai-microsoft/embr/issues/744).

### G-014 · Embr-hosted apps cannot authenticate to Azure Monitor / App Insights without a self-managed service principal

- **Gap**: An Embr-hosted application has no path to call Azure Monitor APIs (or any AAD-gated Azure API) using its *own* identity. Specifically: while building Loop 3 (self-heal), we needed the embr-pulse monitor agent to query App Insights for 5xx rates, latency p95s, and exception counts. App Insights API Keys are deprecated (retire March 2026) and AAD now requires a service principal or managed identity calling the `api.applicationinsights.io` resource. We have no way to create a service principal in the corporate tenant (lack of permissions), and Embr does not yet expose a workload identity per app, so neither path is available.
- **Where encountered**: Loop 3 implementation. We had to fall back to **synthetic signals** — assembling a "signal pack" from the app's own Postgres state (feedback events + a `system_events` audit table) and calling the Foundry monitor agent on that. This works for the demo, but it's a strictly weaker signal than App Insights (which captures HTTP errors that never reach our DB writes, cold-start latency, etc.) and it's load-bearing for the customer story: a self-heal loop that can't actually read the platform's telemetry isn't really self-healing.
- **Workaround**: In-app synthetic signal pack assembled from local Postgres. See `samples/embr-pulse/lib/signals.ts`. The seam is intentional: the agent prompt and signal-pack shape don't change, so when workload identity ships we swap one file (`signals.ts`) and the rest of Loop 3 keeps working unchanged.
- **Impact**: **HIGH** — this is the single biggest unlock for "agents managing the app *on* Embr." Today, customers who want to do agent-driven self-heal must either (a) have permissions to create AAD service principals, or (b) pipe everything through their own observability backend. Embr should give every app a workload identity, and document the federated trust path to App Insights / Log Analytics / Cosmos / etc.
- **Proposed primitive**:
  1. Provision a **workload identity** for every Embr app (federated to AKS namespace's service account).
  2. Auto-grant the identity **read access on the app's own App Insights** resource (we already provision App Insights per app).
  3. Document the pattern (`@azure/identity` `DefaultAzureCredential`) in the docs site so apps can call any AAD-protected Azure API as themselves.
  4. Extension: let `embr.yaml` declare additional resource-scope grants (e.g. "this app can read Cosmos account X") that Embr fulfills via role assignment.
- **Filed as**: _(ready to file — see [Phase 5 filing list](#phase-5-filing-list) below.)_

### G-015 · React Server Action failures return opaque digest-only 500s with no way for the app developer to see the actual error

- **Gap**: The `/submit` page used a Next.js 15 React Server Action (`submitFeedbackAction`) that called `insertFeedback()` then `revalidatePath("/")` then `redirect("/?submitted=1")`. In production, every form submission returned `HTTP 500` with the standard Next.js error overlay: *"Application error: a server-side exception has occurred. Digest: 3084417019@E80."* The same `insertFeedback()` call invoked through the sibling `/api/feedback` route returned `HTTP 201` and worked end-to-end (DB insert + Foundry triage + GH issue creation). The bug was specific to the server action runtime path.
  - We had **zero visibility** into what threw. `embr deployments logs <id>` returns "Runtime logs are not yet available" (related to G-014 — App Insights signed-in but app can't push structured logs). `kubectl`-style pod log access isn't exposed. The only thing the developer sees is a digest hash.
  - Reproducing locally would have required wiring the production Postgres to a dev box (which we can't, by design — the external DB is firewalled to the AKS subnet, G-007).
  - We worked around it by **deleting the server action entirely** and rewriting the form as a client-side `fetch("/api/feedback")`. That fixed it instantly *and* surfaced an unrelated bonus bug: the server action only inserted a feedback row + redirected, while the API route runs the full pipeline (insert → triage → issue → Copilot routing). So every form submission since Phase 1 had been *silently* skipping triage and issue creation. We only noticed because the action started 500'ing for an unrelated reason.
- **Where encountered**: Phase 4 (Loop 3 ship). After deploy `dpl_bbc2e868c1994ac2a2799832af63389f` (commit `50c35a9`), the form started 500'ing on every submission. Curl reproduction with the exact `Next-Action` header confirmed the action path was broken; curl POST to `/api/feedback` with the same payload succeeded. Fix shipped as commit `9ce6d74`.
- **Workaround**: Two compounding workarounds:
  1. Don't use React Server Actions on Embr — use Route Handlers (`app/api/*/route.ts`) instead. Route Handlers fail with normal HTTP semantics and let you `return Response.json({ error: ... }, { status: 500 })` so the client can surface the message.
  2. Even with Route Handlers, you still can't see *server-side* throws — but at least you control what comes back to the client.
- **Impact**: **HIGH** — this is the broader observability gap (G-014) showing up in a specific way. App developers on Embr cannot debug *any* server-side exception in production. Today the playbook is "redeploy and pray" or "rewrite the failing path until something works." That's not viable for real customer apps. Worse, Next.js 15 / React 19 push Server Actions as the recommended form-handling pattern, so any customer following Vercel-style guides on Embr will hit this same wall the first time something throws.
- **Proposed primitive**:
  1. **`embr deployments logs <id> --tail`** that actually streams stdout/stderr from the pod. This is the single biggest fix — even before workload identity (G-014) lands, just exposing the container's own logs would unblock 90% of debugging.
  2. **Per-app App Insights with workload identity** (depends on G-014). Once apps can push their own structured logs, server action failures with stack traces would land in the app's `traces` table.
  3. **CLI digest decoder**: when an Embr-hosted Next.js app returns a digest, expose `embr deployments decode-digest <id> <digest>` that maps the digest hash back to a stack trace by reading the source map from the deploy artifacts. (Next.js already writes the digest → error mapping to the pod's stderr; this just surfaces it.)
  4. **Document the Server Actions caveat**: until the above ship, the docs should explicitly recommend Route Handlers over Server Actions for any error-prone path on Embr.
- **Filed as**: [coreai-microsoft/embr#750](https://github.com/coreai-microsoft/embr/issues/750).

---

## Phase 5 filing list

Filed (4):

| ID  | Issue | Severity |
|-----|-------|----------|
| G-011 | [coreai-microsoft/embr#746](https://github.com/coreai-microsoft/embr/issues/746) — PR previews don't see env-scoped variables | HIGH |
| G-012 | [coreai-microsoft/embr#745](https://github.com/coreai-microsoft/embr/issues/745) — `activeDeploymentId` can pin to a stale deploy | HIGH |
| G-013 | [coreai-microsoft/embr#744](https://github.com/coreai-microsoft/embr/issues/744) — chunk hangs prevent React hydration | HIGH |
| G-015 | [coreai-microsoft/embr#750](https://github.com/coreai-microsoft/embr/issues/750) — opaque digest-only Server Action 500s | HIGH |

Ready to file (11): G-001, G-002, G-003, G-004, G-005, G-006, G-007, G-008, G-009, G-010, G-014. Each entry above has the receipt, workaround, impact, and proposed primitive — they're filing-ready as written.

When we file each:
1. `gh issue create -R coreai-microsoft/embr -t "<title>" -F <body-file>`
2. Update **Filed as** in the entry above.
3. Cross-reference the issue from the relevant code in `embr-pulse` (e.g. add `// see coreai-microsoft/embr#NNN` near the workaround code).

