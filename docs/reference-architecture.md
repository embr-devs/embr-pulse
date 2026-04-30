# `embr-pulse` Reference Architecture

> Customer-facing distillation of [`design.md`](./design.md). If you want to build an agent-managed app on Embr, copy this architecture.

---

## What this app does

`embr-pulse` is an internal feedback aggregator. A teammate submits a comment in the UI; minutes later their idea ships to production, with no human writing the code. Three agents collaborate on Embr to make that happen.

## The three loops

```
              ┌───────────── LOOP 2: FEEDBACK ─────────────┐
   teammate ─►│ form ─► Foundry triage ─► GH issue + comment│
              │                              │              │
              │                              ▼              │
              │              GH Copilot coding agent (auto-assigned)
              │                              │              │
              │   "shipped" ◄── deploy ◄── merge ◄── PR ◄────┘
              └────────────────────────────────────────────┘
                                 ▲
                                 │ same coding-agent path
                                 │
              ┌───────────── LOOP 1: CODE ─────────────────┐
              │  any GH issue ─► Copilot ─► PR ─► deploy   │
              └────────────────────────────────────────────┘
                                 ▲
                                 │ also feeds Loop 1
                                 │
              ┌───────────── LOOP 3: SELF-HEAL ────────────┐
              │ App Insights ─► SLO breach ─► Foundry monitor
              │                          ─► incident issue │
              │                          ─► Copilot fix PR │
              └────────────────────────────────────────────┘
```

All three loops compose. Copilot doesn't know which loop spawned an issue — it just sees a GitHub issue and goes to work.

## Components and where they run

| Piece | Lives in | Job |
|---|---|---|
| Web app (Next.js 15) | Embr | Public form, feed, admin page; calls triage on submit |
| Postgres | Embr-managed (later: external Postgres Flexible Server, see G-007/008) | Feedback rows, audit events |
| Triage agent | Foundry (called from Embr) | Sharpen title, summarize, propose labels, set confidence, detect duplicates |
| GitHub issue | Repo `seligj95/embr-pulse` | Source of truth; Copilot's input |
| Coding agent | GitHub Copilot | Reads issue + repo, opens PR |
| GitHub App webhook | Embr platform | On merge → build → deploy |
| Monitor agent (Phase 4) | Foundry, scheduled via GH Actions cron | Watch App Insights SLOs, open incident issues |
| Telemetry | App Insights via OpenTelemetry | Structured logs from app, traces from Foundry |

## Loop 2: the path of one feedback item

Concrete trace from issue #8 → PR #9 (merged in under 10 minutes, no human code):

1. **`POST /api/feedback`** — Next.js validates, inserts a row, returns 200 to the user.
2. **Triage** (`lib/triage.ts`) — calls Foundry's OpenAI-compatible endpoint with the user's text and the most recent open-issue titles for dedup. Foundry returns JSON: sharpened title, engineering summary, labels, confidence, optional `dedupeOfIssueNumber`. The agent's instructions live in a string constant in the same file (mirrored from the published Foundry agent).
3. **Issue creation** (`lib/github.ts`) — body is user-authored content + a system metadata block. **No triage output goes in the body** — that flows to a separate comment. Why: keeps the issue body clean for Copilot's context, and gives a clear "the human said X / the agent thought Y" UX.
4. **Triage comment** — posted as a follow-up: `🤖 Triage analysis — confidence 0.95` with summary + suggested labels.
5. **Auto-assign Copilot** — gated on `confidence ≥ 0.7` AND `dedupeOfIssueNumber === null`. Implemented via GraphQL `replaceActorsForAssignable` because Copilot is a `Bot` actor — REST `assignees` won't accept it.
6. **Copilot opens a PR** — typically within 1–5 minutes.
7. **Human merges.** Embr's GitHub App auto-builds and auto-deploys.
8. **(Future)** App polls Embr deployment status; once the new SHA is live, marks the feedback item `shipped` and notifies the submitter.

## Trust boundary

Raw user text is **untrusted**. The deliberate cuts:

| Surface | Sees raw input? | Sees sanitized output? |
|---|---|---|
| Postgres `feedback.body` | Yes (verbatim) | n/a |
| Triage agent | Yes (its job is to sanitize) | n/a |
| GitHub issue body | Yes — but only inside an HTML-ish "user submitted this verbatim" block | — |
| GitHub triage comment | No | Yes |
| Copilot coding agent | Reads the issue body, so technically yes | Yes |
| Confidence < 0.7 | Skips Copilot routing, gets `needs-human-review` label | — |

For v1 we accept that Copilot does see the verbatim user content (the issue body), because the user's text *is* the requirement and stripping it loses too much fidelity. The mitigations are: confidence gating, repository scoping (Copilot can only modify `seligj95/embr-pulse`), human-in-the-loop merge, and per-feedback labels for retraction.

## Identity

Today: long-lived secrets in Embr environment variables.

| Identity | What it accesses | How |
|---|---|---|
| App | GitHub Issues / GraphQL | GitHub App PAT (scope: `repo`, `workflow`) — installed on `seligj95/embr-pulse` |
| App | Foundry | Static API key on the OpenAI-compatible endpoint |
| App | App Insights | Connection string |
| Foundry agent | (read-only; no outbound) | n/a |
| Monitor agent (future) | Kusto, App Insights | Foundry-managed identity (planned) |

We deliberately documented this as a **gap** (G-002, G-005). A first-class story needs Embr-issued workload identity. Until then: rotate via Foundry portal → Embr Variables UI; saving triggers a redeploy.

## Telemetry

```
app emits ──► console.log JSON line  ─┐
                                      ├─► OTel LoggerProvider (configured in instrumentation.ts)
            log.info/warn/error  ─────┘                    │
                                                           ▼
                                              Azure Monitor exporter
                                                           │
                                                           ▼
                                            App Insights (resource shared with Foundry)
```

`lib/log.ts` emits JSON to stdout *and* an OTel `LogRecord` so events appear both in `embr logs` (raw stream) and in App Insights (queryable). The OTel emit is lazy and a no-op if `useAzureMonitor` hasn't initialized — safe in unit tests.

## Repo layout (the parts that matter)

```
embr-pulse/
├── app/
│   ├── api/feedback/route.ts          # the orchestrator (validate → insert → triage → issue → comment → assign)
│   └── page.tsx                        # feed UI
├── lib/
│   ├── triage.ts                       # Foundry call + JSON parse + structured logs
│   ├── github.ts                       # issue create, triage comment, Copilot assign (GraphQL)
│   ├── log.ts                          # JSON-line + OTel LogRecord emitter
│   └── feedback.ts                     # DB read/write + audit events
├── instrumentation.ts                  # useAzureMonitor() boot
├── embr.yaml                           # Embr deployment config
└── docs/
    ├── design.md                       # full rationale
    ├── reference-architecture.md       # ← you are here
    ├── platform-gaps.md                # what we wish Embr did natively
    ├── customer-story.md               # narrative for evangelism
    └── embed-in-embr.md                # what would it take to make this first-class on Embr?
```

## How to copy this for your own app

If you want the same agentic loop on Embr:

1. **Create the GitHub repo** Copilot will work in. Enable Copilot coding agent (Settings → Copilot).
2. **Provision a Foundry agent** with a triage prompt (template in `lib/triage.ts`). Get the OpenAI-compatible endpoint and a key.
3. **Create an Embr project** linked to the repo (`embr quickstart deploy`).
4. **Set environment variables** on the Embr project: `GITHUB_TOKEN`, `FOUNDRY_API_KEY`, `FOUNDRY_BASE_URL`, `FOUNDRY_DEPLOYMENT`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`.
5. **Wire `instrumentation.ts`** with `useAzureMonitor` so OpenTelemetry exports to App Insights.
6. **Mirror `lib/triage.ts`, `lib/github.ts`, `lib/log.ts`** into your app, adapt the prompt and label set.
7. Submit a test feedback. Watch issue → comment → Copilot assignment → PR appear.

The whole pattern fits in ~600 lines of TypeScript across three files (excluding tests). The hard parts were the Copilot-via-GraphQL assignment, the trust-boundary discipline, and figuring out that `useAzureMonitor` doesn't auto-capture `console.log` (you need explicit OTel `LogRecord`s).

## What this architecture intentionally does *not* do

- **No background jobs on Embr.** Loop 3 will use a GitHub Actions cron shim until Embr ships scheduled jobs (G-001).
- **No managed identity.** Static keys until Embr ships workload identity (G-002).
- **No deploy-status webhook.** Today the app would have to poll Embr to mark "shipped"; we want a webhook (G-003).
- **No auto-merge.** Every Copilot PR goes through human review. This is the demo's punchline and the answer to every CISO question.
- **No agent-on-agent loops.** Triage and monitor agents file issues; only Copilot writes code.
