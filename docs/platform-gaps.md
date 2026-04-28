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

*(empty — populate during Phases 1–4)*

---

## Phase 5 Triage

When we hit Phase 5, we'll:

1. Re-read every entry above.
2. Group duplicates and combine with anything new.
3. Pick the top 3+ HIGH/MED-impact gaps.
4. File one GitHub issue against `coreai-microsoft/embr` per gap, linking back to the relevant section of `embr-pulse` (private repo — link to specific file:line snapshots in the issue body).
5. Update the **Filed as** column above.
