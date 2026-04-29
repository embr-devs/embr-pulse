# Design: embr-pulse — An Agent-Managed Internal App on Embr

| Field | Value |
|-------|-------|
| **Date** | 2026-04-28 |
| **Author** | Jordan Selig |
| **Status** | Approved |
| **Tracking issue** | [coreai-microsoft/embr#374](https://github.com/coreai-microsoft/embr/issues/374) |
| **Repo** | `seligj95/embr-pulse` |
| **Milestone** | FY26Q4-W05 |

---

## Problem Statement

The Embr platform claims that GitHub-driven, agent-friendly deployment is a step-change in developer productivity. We need a real, working artifact that demonstrates this end-to-end and gives us a credible evangelism story for customers.

Specifically, we have to answer three questions with running code:

1. Can agents drive the **entire lifecycle** of a real application — design, build, deploy, monitor, fix — on Embr today?
2. What **platform gaps** prevent agent-managed apps from being a smooth out-of-the-box experience?
3. **Where should the management agent live?** Standalone (e.g. inside GitHub Actions) or first-class inside Embr (ADC)? What would each cost us to build?

Without a tangible artifact, every conversation about "agent-managed PaaS" stays abstract. With one, we can demo, dogfood, and let real friction surface platform improvements.

The scenario also has to be **demo-able to customers**. A self-referential read-only dashboard is a fun party trick; a feedback-driven app that *visibly closes the loop from a user's idea to a shipped change* is a story.

## Scope & Audience

This is intentionally a small, self-contained reference implementation. Locking the scope down up front:

- **Audience:** internal Embr team only. No external customers, no EMU/cross-tenant auth, no public surface area beyond an Embr-hosted URL we share with teammates.
- **Feedback content:** primarily *about embr-pulse itself* — UI nits, missing features, bugs, copy changes. This is what makes the agent loop close end-to-end (see below).
- **Issue destination:** `seligj95/embr-pulse` (the app's own repo). Triage agent files issues there; Copilot coding agent fixes them there.
- **Platform gaps go elsewhere:** anything we learn about *Embr the platform* is captured manually in `docs/platform-gaps.md` and ported by hand to `coreai-microsoft/embr` in Phase 5. The app does not auto-file against repos we don't own.

**Why feedback is scoped to the app itself.** For the demo to land, the Copilot coding agent has to actually fix something — which means the issue must be in a repo it can write to *and* the fix must be in code we own. That's `seligj95/embr-pulse`. Generic "feedback inbox" framing would be more general but would break the closing of the loop, which is the whole point of issue #374.

### Sample feedback inventory (what the coding agent can plausibly handle)

These are concrete, scoped, in-codebase changes — Copilot's sweet spot:

| Feedback | What the coding agent does |
|---|---|
| "The feed doesn't show when feedback was submitted." | Adds a timestamp render to `app/page.tsx`. ~10 lines, single file. |
| "I can't filter the feed by category." | Extends the zod schema in `app/api/feedback/route.ts`, threads a `category` filter through `lib/feedback.ts`, adds a `<select>` in `app/page.tsx`. ~50 lines across 3 files. |
| "Submit form lets me type 5000 chars but the API rejects it." | Adds `maxLength={2000}` + a live char counter in `app/submit/page.tsx`. |
| "Rename status label `in-triage` → `reviewing`." | Display-only string changes; DB enum stays. |
| "Open vs shipped count missing from the header." | Adds an aggregate query + small header chip. |

These are explicitly **out of scope** for the coding agent (triage agent labels them `needs-human` or `platform-request`):

- "Sign-in with my work account doesn't work" — MSAL/Entra config, requires secrets and Azure portal access the agent can't reach.
- "Embr CLI is confusing" — platform feedback, not our codebase. Manually ported to `coreai-microsoft/embr` in Phase 5.
- "DB connection drops at midnight" — infra tuning, not a code fix.
- "Make the homepage 10x faster" — too vague for an agent; a human profiles first.

The "killer demo" we're building toward: **user types feedback at 9:00 → triage agent files an issue at 9:01 → Copilot opens a PR at 9:05 → human merges at 9:30 → Embr auto-deploys at 9:32 → user reloads and sees their fix live.** Examples 1, 3, and 4 above are realistic candidates for that narrative.

## Proposed Solution

### Overview

Build **`embr-pulse`** — an internal team feedback aggregator. Anyone on the Embr team submits feedback or feature requests through the app. Each submission becomes a GitHub issue. A Foundry-hosted **triage agent** classifies and routes each issue. The **GitHub Copilot coding agent** picks up issues assigned to it, implements them, and opens PRs. On merge, Embr's GitHub App auto-deploys the change. The app then surfaces "your feedback shipped" back to the original submitter. Separately, a Foundry-hosted **monitor agent** watches Kusto telemetry and opens incident issues when SLOs trip, with optional auto-fix PRs.

The app's *purpose is the feedback loop*. Every submission, classification, fix, and deploy is a live demonstration of agent-managed software. That makes the demo intrinsic, not bolted on.

### The Three Loops (Reference Architecture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LOOP 1 — CODE                                                          │
│                                                                         │
│  GitHub Issue ──► Copilot Coding Agent ──► PR ──► Merge ──► Embr Deploy │
│       ▲                                                          │      │
│       └──────────────── observable in Kusto ─────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  LOOP 2 — FEEDBACK (two-stage; raw input never reaches Copilot)         │
│                                                                         │
│   embr-pulse                  Postgres            Foundry               │
│   form  ──POST──► /api/feedback ──► feedback row (raw, unprocessed)     │
│        ▲                                          │                     │
│        │                                          ▼                     │
│        │                       deterministic checks (rate limit, len,   │
│        │                       allowlist, dedupe)                       │
│        │                                          │                     │
│        │                                          ▼                     │
│        │                       Triage Agent (Foundry) — produces        │
│        │                       SANITIZED work item + confidence         │
│        │                                          │                     │
│        │                                          ▼                     │
│        │                       (a) low conf → human-review queue        │
│        │                       (b) high conf → GitHub Issue             │
│        │                                  (sanitized body only)         │
│        │                                          │                     │
│        │                                          ▼                     │
│        │                       Copilot Coding Agent (assigned)          │
│        │                                          │                     │
│        │                                          ▼                     │
│   "shipped" ◄── deploy verify ◄── Embr Deploy ◄── Merge ◄── PR          │
│   (real deploy status, not just PR merge)                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  LOOP 3 — SELF-HEAL                                                     │
│                                                                         │
│   App-level telemetry (App Insights or OTLP→Kusto)                      │
│         │                                                               │
│         ▼                                                               │
│   SLO query (5xx rate, p95, GH-issue-create failure, DB conn failure,   │
│              triage failure)                                            │
│         │                                                               │
│         ▼                                                               │
│   Foundry Monitor Agent ──► Incident Issue (logs + hypothesis +         │
│   (scheduled — see §Runtime)        recent deploy SHA + trace IDs)      │
│                                │                                        │
│                                ▼                                        │
│                    [optional] Copilot Coding Agent                      │
│                                │                                        │
│                                ▼                                        │
│                       PR (human-approved in v1)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

All three loops compose: feedback in Loop 2 reuses the coding agent from Loop 1, and incidents in Loop 3 may invoke it too. The coding agent doesn't know which loop it's working for — it just sees an issue.

### Trust Boundary & Prompt-Injection Hardening

**Raw user feedback is never sent directly to the coding agent.** This is a hard rule.

| Layer | Trust level | What flows out |
|-------|-------------|----------------|
| Submitted feedback (raw) | **Untrusted** | Stored verbatim in Postgres `feedback.body`, never copied into GH issues or agent prompts |
| Deterministic checks | Filter | Reject early: rate limit, max length, required fields, blocked phrases, submitter allowlist |
| Triage agent output | **Sanitized** | Structured JSON with `category`, `severity`, `engineering_summary`, `acceptance_criteria`, `confidence` — only these fields propagate |
| GitHub issue body | Sanitized + provenance | Built from triage output + a hidden `feedback_id: <uuid>` marker for correlation |
| Copilot coding agent | Sanitized only | Sees the sanitized issue body and our repo custom-instructions; never the raw `feedback.body` |

Any feedback with triage confidence < 0.8, OR matching prompt-injection signals, defaults to a `needs-human-review` queue (in-app admin page). It never auto-creates an issue.

The repo `seligj95/embr-pulse` is **private** unless we deliberately decide otherwise. Issues created from feedback are therefore not public.

### Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend + API | Next.js 15 (App Router) + TypeScript + Server Actions | Single language; matches existing `embr-sample-nextjs-app-router`; tight agent iteration loop |
| Database | Postgres (Embr-managed) | First-class Embr primitive; agents reason about SQL well |
| Auth | **NextAuth (Auth.js) Entra ID provider**, tenant-restricted, group/email allowlist | Standard library, well-supported, runs in Next.js, no Embr-specific auth coupling |
| Hosting | Embr (one project, two environments: `staging`, `production`) | Self-hosting; demonstrates Embr managing its own demo |
| Deployment trigger | Embr GitHub App, push-to-`main` | Zero new infra |
| Coding agent | **GitHub Copilot coding agent** | Locked in. GitHub-native, lowest setup cost, has the right context of the repo |
| Triage / Monitor agents | **Microsoft Foundry agents** (called from Embr-hosted Next.js API routes) | Microsoft-aligned story, ties to issue #383; user provisions manually |
| App-level telemetry | **App Insights SDK** (Node) + structured logs → also exported to Kusto where possible | Embr Kusto tables are platform/proxy signals, not app errors. We need our own. |
| Platform telemetry | Existing Embr Kusto tables (`GlobalControlPlaneEvents`, `YarpAccessLogs`, etc.) | Already populated — useful for *correlating* incidents but not for app-level SLOs |

### Where the Management Agents Live

For v1, the **Foundry triage and monitor agents are invoked from Next.js API routes hosted on Embr**, in the `embr-pulse` repo, alongside the app. The agents themselves are Foundry-hosted; the *invocation, orchestration, and result-handling logic* runs on Embr. We're explicit about this distinction (per critique #9): saying "the agents run on Embr" without nuance overpromises.

Triggers:

- **Triage agent**: by GitHub webhook on `issues.opened` *for sanitized issues we created*, OR by a direct call from `POST /api/feedback` after deterministic checks pass. (We pick one canonical flow — see §Canonical Feedback Flow below.)
- **Monitor agent**: scheduled. v1 uses **GitHub Actions cron as a scheduler shim** that calls `POST /api/agents/monitor/run` on the Embr-hosted app. The execution logic runs on Embr; only the trigger is in Actions. We file "Embr needs first-class scheduled jobs" as one of the platform-improvement issues in Phase 5.

This puts the management plane *on the same platform as the app it manages* (with the noted scheduler caveat). It gives us:

- The strongest evangelism story: "agents managing your app run on the same platform as the app."
- A natural test of whether Embr can host long-lived, intelligent, internet-facing services.
- A direct connection to issue #376 (app exercising DB+storage+BE+FE+cache+agent) and issue #383 (extending into Azure).

We **explicitly defer** the bigger question — "should the management agent be a first-class feature *inside* ADC/Embr itself?" — to Phase 6, where we'll write up what that would take based on what we learn building v1.

### Autonomy Levels (v1 target)

We adopt an explicit autonomy ladder so the demo and the docs are honest about what "agent-managed" means at each phase:

| Level | Description | v1 target for `embr-pulse` |
|-------|-------------|----------------------------|
| 0 | Agent observes only | Loop 3 monitoring (always on) |
| 1 | Agent files an issue | Loop 3 incident creation; Loop 2 sanitized issue creation |
| 2 | Agent opens a PR | **Loops 1 + 2 (the main demo)** |
| 3 | Agent deploys after human merge | **Loops 1 + 2 (Embr GitHub App auto-deploys post-merge)** |
| 4 | Agent auto-merges low-risk changes | One narrow lane in v1: typo/docs PRs with green checks (feature-flag-gated) |
| 5 | Agent remediates production autonomously | Out of scope for v1 |

The "fully managed by agents" demo moment is Level 4 in a constrained safe lane (e.g. the agent fixes a docs typo end-to-end, auto-merges, Embr deploys, app shows "shipped"). Everything else is Level 2/3.

### Identity & Secrets

Concrete actor/auth/secret model — replaces the previous hand-wavy text.

| Actor | Runs where | Calls | Auth mechanism | Secret location | Rotation |
|-------|------------|-------|----------------|-----------------|----------|
| `embr-pulse` Next.js app | Embr | GitHub API (issue create, label, assign Copilot) | GitHub App installation token (short-lived, derived from app private key) | App private key in Embr env var (Key Vault if available) | Rotate via GitHub App settings |
| `embr-pulse` Next.js app | Embr | Postgres | Embr-provided connection string | Embr env var | Rotated by Embr |
| Triage wrapper (Next.js API route) | Embr | Foundry agent endpoint | Foundry API key (or Entra workload identity if Embr supports it) | Embr env var; prefer Key Vault | Manual rotate |
| Monitor wrapper (Next.js API route) | Embr | Foundry agent endpoint | Same as triage | Embr env var | Manual rotate |
| Monitor wrapper | Embr | App Insights / Kusto | Service principal client-secret OR managed identity (preferred if Embr supports) | Embr env var | Manual rotate |
| GitHub → app webhook | n/a | `/api/webhooks/github` | HMAC SHA-256 with replay protection (store delivery IDs, reject duplicates and >5 min old) | Webhook secret in Embr env var | Rotate via GitHub App |
| GH Actions cron → app | GitHub | `/api/agents/monitor/run` | OIDC federated credential (preferred) OR static bearer token | GitHub repo secret | Rotate via GH secret |

Rules:

- **Never log secrets**, including tokens, keys, or webhook payloads with credentials.
- **Separate staging/prod credentials** — different GitHub App installations for staging vs prod, different Foundry projects or at least different keys.
- **Least privilege** on the GitHub App: only `issues: write`, `contents: read`, `pull_requests: write`, `metadata: read`, plus webhook events `issues`, `pull_request`, `installation`.
- If Embr-hosted apps **cannot** use managed identity to Kusto/Foundry today, that becomes one of our Phase 5 platform-improvement issues. We don't claim managed identity in v1 unless verified.

### App Functionality (v1)

| Feature | Description |
|---------|-------------|
| Submit feedback | Form: title, body, category (bug / feature / question), submitter (auto from Entra) |
| Feedback feed | List of all feedback with status: `open`, `triaged`, `in-progress`, `shipped`, `wontfix`. Links to GH issue + PR |
| "Shipped" highlights | Banner / page showing what's shipped recently as a result of feedback |
| Admin (read-only v1) | Triage decisions, time-to-ship metrics, agent confidence scores |
| Auth | Entra login required to submit; reading is team-only |

### Data Model

Postgres schema. Kept small for v1 but with event/run/deployment tables so we can audit, retry, supersede, and dedupe — patterns the agent workflow will hit immediately.

```sql
-- Submissions (raw + UI state)
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_email TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,                        -- raw, untrusted, never propagated to agents
  category TEXT,                             -- bug | feature | question | spam (set by triage)
  status TEXT NOT NULL DEFAULT 'open',       -- open | needs-human-review | triaged | in-progress | shipped | wontfix
  github_issue_number INT,                   -- last/primary linked issue (history in events)
  triage_summary TEXT,                       -- sanitized engineering summary (this *is* propagated)
  triage_confidence REAL,                    -- 0..1
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only audit trail
CREATE TABLE feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES feedback(id),
  type TEXT NOT NULL,                        -- submitted | triaged | issue_created | pr_opened | pr_merged | deployed | shipped | superseded
  source TEXT NOT NULL,                      -- user | triage_agent | github_webhook | monitor_agent | embr
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every agent invocation (triage and monitor)
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,                        -- triage | monitor
  feedback_id UUID REFERENCES feedback(id),
  incident_id UUID REFERENCES incidents(id),
  status TEXT NOT NULL,                      -- pending | succeeded | failed | timed_out
  input_hash TEXT,                           -- for dedupe / cache
  output_summary TEXT,
  confidence REAL,
  github_issue_number INT,
  github_pr_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Deployment tracking — used to verify "shipped"
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_pr_number INT,
  commit_sha TEXT NOT NULL,
  environment TEXT NOT NULL,                 -- staging | production
  embr_deployment_id TEXT,
  status TEXT NOT NULL,                      -- pending | building | deployed | failed | rolled_back
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Self-heal incidents
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_issue_number INT,
  slo TEXT NOT NULL,                         -- e.g. "5xx-rate" | "p95-latency" | "triage-failure-rate"
  hypothesis TEXT,
  signal_summary TEXT,                       -- log/trace/deploy summary
  status TEXT NOT NULL DEFAULT 'open',       -- open | investigating | resolved | dismissed
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- GitHub webhook idempotency
CREATE TABLE github_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Canonical Feedback Flow (idempotent)

To prevent the contradictions in earlier drafts, this is the **only** feedback flow:

1. User submits → `POST /api/feedback`.
2. App runs deterministic checks (rate limit, length, allowlist, duplicate-by-input-hash). On reject → return error, no DB write beyond rate-limit counters.
3. App writes a `feedback` row in status `open`, plus a `submitted` event.
4. App **synchronously** invokes Foundry triage agent (or queues if slow). On result → write `agent_runs` row, update `feedback.category/triage_summary/triage_confidence`, write `triaged` event.
5. If `confidence >= 0.8` AND category != `spam` → app creates GitHub issue with sanitized body containing hidden marker `feedback_id: <uuid>`, stores `github_issue_number`, writes `issue_created` event, sets status `triaged`. Optionally assigns Copilot (see §Copilot Assignment Spike).
6. Otherwise → status `needs-human-review` (visible in admin page); no GH issue.
7. GitHub webhooks (`issues`, `pull_request`) fire on Copilot's actions. Webhook receiver:
   - Verifies HMAC, checks `delivery_id` against `github_deliveries` (insert-or-skip = idempotent).
   - Resolves the feedback by hidden marker in the issue body OR `github_issue_number`.
   - Writes the appropriate `feedback_events` row, updates `feedback.status` if applicable, populates `deployments` on PR merge.
8. `feedback.status = 'shipped'` only after we observe a successful production deployment of the merge SHA (see §Deployment Verification).

### Deployment Verification ("shipped" means shipped)

PR merge ≠ deploy success. The app determines `shipped` via:

- **Primary**: poll Embr API for deployment status by commit SHA, transitioning `deployments.status` through `pending → building → deployed | failed | rolled_back`. (If Embr's deployment-status API is insufficient, that's a Phase 5 platform issue.)
- **Fallback**: query Kusto/App Insights for an "app started serving SHA X in production" signal — could be a startup log line we emit on boot.
- Only when `deployments.status = 'deployed'` AND `environment = 'production'` do we write a `shipped` event and update `feedback.status`.

### Telemetry & SLOs (Loop 3)

Embr's existing Kusto tables alone do not give us app-level error signal. We add:

- **App Insights SDK** in the Next.js app (Node), capturing: requests, dependencies (Postgres, Foundry, GitHub), exceptions, custom events for `feedback_submitted`, `triage_failed`, `issue_create_failed`, `webhook_processed`.
- **Correlation IDs**: every request tagged with `feedback.id` / `incident.id` / `agent_runs.id` and the deployed commit SHA.

v1 SLOs (initial — tunable):

| SLO | Source | Threshold |
|-----|--------|-----------|
| `/api/feedback` 5xx rate | App Insights | > 1% over 10 min |
| `/api/feedback` p95 latency | App Insights | > 2 s over 10 min |
| Triage agent failure rate | `agent_runs` table | > 10% over 1 h |
| GitHub issue creation failure rate | App Insights custom event | > 5% over 30 min |
| Postgres connection failures | App Insights dependency | any over 5 min |

The monitor agent runs a fixed set of KQL/SQL queries, packages results + recent deploys + sample traces into an `incidents` row, and creates a GitHub issue with the sanitized payload as the issue body.

**Synthetic incident path** (for demos): a feature flag `EMBR_PULSE_SIMULATE_FAILURE=true` makes `POST /api/feedback` return 500 for 1% of requests, deliberately tripping the 5xx SLO. The demo flips this on, monitor detects within a cycle, opens an issue, and Copilot proposes the (trivial) fix of removing the flag.

### API Surface (v1)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/feedback` | Entra | Submit new feedback (creates row + GH issue) |
| GET  | `/api/feedback` | Entra | List feedback (filterable by status) |
| GET  | `/api/feedback/[id]` | Entra | Get one |
| POST | `/api/webhooks/github` | HMAC | Receive issue/PR events; update feedback status |
| POST | `/api/agents/triage` | Internal token | Triage agent webhook entry point |
| POST | `/api/agents/monitor/run` | Internal token | Manual / cron-triggered monitor run |
| GET  | `/api/health` | None | Liveness probe |

Triage and monitor agent *implementations* live behind those internal endpoints; they call out to Foundry over HTTPS using credentials in Embr env vars.

### External Dependencies

| Dependency | Provided by | Required at phase |
|---|---|---|
| Embr-managed Postgres | Embr | Phase 1 |
| Embr Kusto telemetry (read access) | Embr | Phase 4 |
| GitHub App (separate from Embr's) — `embr-pulse-bot` | User creates | Phase 1 (issue creation), Phase 3 (issue/PR webhooks) |
| Foundry project + triage agent | User creates | Phase 3 |
| Foundry monitor agent | User creates (can reuse Phase 3 project) | Phase 4 |
| GitHub Copilot coding agent | Already enabled on user's GitHub | Phase 3 |

When we reach Phases 3 and 4, this design doc will be paired with a step-by-step **Foundry setup walkthrough** describing exactly which resources to provision in the Azure portal and which values to surface back (project endpoint, agent ID, model deployment name, key or managed identity client ID, RBAC role assignments — including Kusto read for the monitor agent).

## Phases

| Phase | Goal | Output |
|-------|------|--------|
| 0 | Design doc (this) approved + day-one artifacts | `docs/design.md`, `docs/demo-script.md`, `docs/platform-gaps.md` (running log) |
| 1 | Bootstrap `embr-pulse`, deploy on Embr, App Insights wired | App running, push-to-deploy working, basic feedback CRUD, telemetry visible |
| 2 | Harden Loop 1 (Code) | Documented playbook; ≥1 platform issue captured |
| 3 | Build Loop 2 (Feedback) | Foundry triage agent live; sanitized-issue + Copilot-assignment path works end-to-end |
| 4 | Build Loop 3 (Self-heal) | Foundry monitor agent live; SLOs defined; ≥1 simulated incident handled |
| 5 | File ≥3 platform-improvement issues against `coreai-microsoft/embr` | Issues filed (no PRs to that repo) |
| 6 | Evangelism artifacts | Demo recording + reference architecture writeup + "embed in Embr" analysis, all in `embr-pulse/docs/` |

### Phase Preconditions (user-provided)

Several phases need credentials/resources the user provisions manually. Listed up-front so they don't surprise us mid-implementation.

| Before phase | What user needs to provide |
|--------------|----------------------------|
| **1** | (a) GitHub App `embr-pulse-bot` registered on `seligj95/embr-pulse` with permissions `issues:write`, `contents:read`, `pull_requests:write`, `metadata:read` and events `issues`, `pull_request`, `installation`. App ID, installation ID, private key, webhook secret. (b) Embr project + `staging` env created via Embr CLI. (c) App Insights resource (or accept that we'll create one inline). |
| **3** | (a) **Foundry project + triage agent** with model deployment (gpt-4o-mini or similar), endpoint URL, API key (or workload identity client-id), agent ID, model deployment name. (b) Confirmation that `seligj95/embr-pulse` has GitHub Copilot coding agent enabled (see §Copilot Assignment Spike). (c) `production` environment created on Embr. |
| **4** | (a) Either reuse Phase 3 Foundry project for monitor agent, or new agent in same project. (b) Identity with **Kusto Database Viewer** role on the Embr stamp cluster the user has access to (e.g., the user's private stamp `embr-d-<name>` or staging). |

I will produce a step-by-step Foundry-and-RBAC walkthrough at the start of each phase that needs it.

### Copilot Assignment Spike (Phase 3 prerequisite)

The handoff "GH issue created → Copilot picks it up" is the highest-risk single point in the demo. Before any Loop 2 implementation, we run a **time-boxed spike** that verifies:

- [ ] `seligj95/embr-pulse` has GitHub Copilot coding agent enabled (Copilot Pro/Business/Enterprise on the account/repo)
- [ ] Copilot is exposed as an assignable actor (`copilot-swe-agent` or equivalent)
- [ ] We can assign Copilot to an issue programmatically via the GraphQL/REST API using our GitHub App's installation token (or determine we need a user token / fine-grained PAT instead)
- [ ] The minimum issue-body shape that gets Copilot to start work — labels? front-matter? specific file paths in the body?
- [ ] Copilot opens a PR with the expected linkage back to the issue
- [ ] Repo custom-instructions file (`.github/copilot-instructions.md`) is being honored

Output of the spike: a runnable script `scripts/spike/assign-copilot.ts` that creates an issue and successfully gets Copilot to open a PR for a no-op task ("add a hello-world comment to README"). If the spike fails, we have a documented fallback (manual "Assign to Copilot" in the GH UI) and the demo plans accordingly.

### Day-Zero Artifacts

Two artifacts are created in Phase 0 alongside this design and updated continuously:

- **`docs/demo-script.md`** — the canonical demo path. We design *to* this script. It includes: seeded feedback item, expected GH issue, expected triage labels/timing, expected Copilot PR, expected Embr deploy signal, expected "shipped" UI update, and the synthetic-incident demo path. Includes a backup pre-recorded video reference for when live agents are slow.
- **`docs/platform-gaps.md`** — a running log: gap | where encountered | workaround | impact | proposed Embr platform primitive | filed-as. Populated as we hit friction; mined in Phase 5 for the issues we file against `coreai-microsoft/embr`.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| "What's deployed where" dashboard | Pure dogfood, exercises Embr API hard, useful daily | Read-mostly UX makes Loop 2 (feedback) feel artificial; overlaps with #399 (Grafana agent) | Loop 2 is the centerpiece of #374 and would be grafted on |
| On-call signup tool | Simple CRUD, easy build | Boring; no organic source of feature requests | No compounding feedback loop |
| Internal Embr docs Q&A | Sexy AI demo | Doesn't hit "agent fixes the app based on feedback"; testbed for retrieval, not lifecycle | Wrong loop |
| Build app inside `coreai-microsoft/embr` monorepo | One repo, easier code-sharing | We don't own the repo; muddies "external customer" story | User doesn't own that repo; demo is stronger as an external app |
| Stack: React + .NET + Postgres (mirror Embr) | Most dogfood | Two languages slows agent loop; more files to wrangle | Single-language Next.js wins for agent iteration speed |
| Stack: Cosmos DB | Embr's primary DB | Schema-flexibility makes it harder for agents to reason about; partition-key design is a gotcha | Postgres is cleaner for agent-driven CRUD |
| Coding agent: Claude Code | Strong reasoning | User doesn't have access | Locked in: Copilot |
| Management agents in GitHub Actions only (not Embr-hosted) | No app-side hosting | Loses the "agents run on Embr" evangelism; Actions cron is coarse | We want the dogfood story |

## Testing Strategy

- **App layer** (Next.js): Vitest unit tests for server actions, API route handlers, and the GitHub-issue mapping logic. Playwright for the submit-feedback happy path.
- **Triage agent**: contract tests against the Foundry agent (mock Foundry responses for unit; one real-call integration test gated on a flag).
- **Monitor agent**: snapshot tests against Kusto query results; ability to inject a synthetic SLO breach.
- **End-to-end**: a scripted "submit feedback → expect issue created with correct labels" smoke test, runnable manually.
- Embr testing infrastructure for Next.js samples is well-established; we follow the conventions in existing `embr-sample-nextjs-*` samples.

## Rollout Plan

- **Staging environment** on Embr first; only the team has access. All loops live there before production.
- **Production environment** opens once Loops 1+2 are stable (Loop 3 can ride along in observation-only mode).
- **Feature flags** for risky bits: triage agent confidence-threshold, monitor agent auto-fix toggle. Default both to "advisory" (human-approved) in v1.

## Risks & Open Questions

| Risk | Mitigation |
|------|------------|
| **Prompt-injection via raw feedback** | Two-stage flow: raw never propagates to coding agent. Sanitized triage output only. `needs-human-review` queue for low-confidence items. Repo private. |
| **Copilot assignment doesn't work as imagined** on a personal repo | Phase 3 prerequisite spike verifies before we build on it. Documented manual-assignment fallback. |
| **Triage agent misclassifies and assigns to coding agent too aggressively** | Confidence threshold ≥ 0.8; below → `needs-human-review`. Admin override. |
| **Coding agent opens bad PRs at scale** | Always require human review-and-merge in v1 for non-trivial categories. Level 4 auto-merge limited to docs/typos behind a flag. |
| **Foundry / Copilot costs unbounded if spammed** | Rate limit `/api/feedback`. Deterministic spam filter before LLM. Per-submitter quota. |
| **Feedback stops being used by the team** | Seed with real feedback. Surface "shipped" prominently. Slack/Teams reminder when shipped. |
| **Monitor agent floods incident issues during a real incident** | Dedup by hypothesis-hash + cooldown window + max-N-per-hour. |
| **Agent identity / secret rotation across multiple systems** | Concrete table in §Identity & Secrets. Document any unsupported managed-identity paths as platform gaps. |
| **Kusto access from Embr-hosted app is harder than expected** | Fallback to App Insights as primary signal source; Kusto as enrichment only. File platform issue if managed identity isn't supported. |
| **"Shipped" reported when only PR merged but deploy failed** | Verify against Embr deployment status / app boot signal before transitioning status. |
| **GH webhook duplicates / out-of-order events** | Idempotency table (`github_deliveries`); upsert by `feedback_id`; replay-safe. |
| **App Insights / OTLP not standard on Embr-hosted Next.js samples** | Wire it ourselves in Phase 1; if we hit Embr-side blockers, file a platform issue. |

**Open questions** (resolved during the relevant phase, not now):

- Triage runtime: synchronous in `POST /api/feedback` vs queued (and what queue)? *(Decided in Phase 3 based on Foundry latency.)*
- Foundry project: dedicated for `embr-pulse` vs shared? *(Decided when user provisions in Phase 3.)*
- Loop 3 autonomy: observation-only, advisory PRs, or auto-merge for trivial reverts? *(Start observation-only; revisit after Phase 4.)*
- Notifications back to submitter: Teams webhook, email, or in-app only? *(In-app only for v1.)*
- Whether to wire OIDC federated credentials from GH Actions to Azure for the monitor cron (preferred) or fall back to a static bearer. *(Decided in Phase 4.)*

## Definition of Done (this design)

- [ ] User reviews and approves this design doc
- [ ] Plan in session state aligns with this design
- [ ] Foundry-related questions clearly flagged for user provisioning later
- [ ] Status updated to **Approved** before bootstrapping code in Phase 1
