# `embr-pulse` Demo Script

Living document. Designed to be the canonical happy-path demo we engineer toward. Every change to the architecture should be checked against this script.

> Status: **Live.** Loops 1–3 are operational on production. Timings below are from real measurements; receipts are linked inline.

---

## Audience & Goals

**Audience**: internal Embr team, then external Embr customers / Microsoft leadership.

**One-liner**: *"This app's entire lifecycle — from a user's idea to a shipped change in production — is driven by agents running on Embr."*

**Goals (in priority order)**:

1. Show the **Feedback Loop** end-to-end live (Loop 2): submit → triage → issue → Copilot PR → merge → deploy → "shipped".
2. Show the **Self-Heal Loop** via a synthetic incident (Loop 3): tripped SLO → monitor opens issue with hypothesis → Copilot proposes fix.
3. Tell the platform-improvement story: "Here's what we learned Embr needs to make this easy for customers."

---

## Pre-Demo Setup (run T-30 minutes)

- [ ] `staging` and `production` environments healthy (`embr environments list`).
- [ ] Reset demo data: drop demo feedback rows, reset GH demo issues to closed/archived.
- [ ] Seed: 2 historical "shipped" feedback items so the feed isn't empty.
- [ ] Confirm Copilot coding agent is responsive (smoke test: assign Copilot to a noop issue, expect PR within 5 min).
- [ ] Confirm Foundry triage agent reachable: `curl POST /api/agents/triage/health`.
- [ ] Confirm App Insights live data (last 5 min has events).
- [ ] Disable `EMBR_PULSE_SIMULATE_FAILURE` flag (will toggle on during synthetic incident demo).
- [ ] Pre-recorded backup video ready in case live agents are slow.

---

## Live Path: Loop 2 (Feedback)

| Step | Actor | Action | Visible UI / Signal | Expected timing |
|------|-------|--------|---------------------|-----------------|
| 1 | Demo human | Submit feedback: "The 'shipped' banner should show submitter name." | Form posts; success toast | Instant |
| 2 | App | Run deterministic checks; write `feedback` row; call triage | Row visible in admin Activity Log | < 1 s |
| 3 | Triage agent (Foundry) | Classify as `feature`, generate sanitized engineering summary, confidence 0.91 | `triaged` event in Activity Log | < 5 s |
| 4 | App | Create GitHub issue with sanitized body + `feedback_id` marker; assign Copilot | Issue link appears on feedback row | < 3 s |
| 5 | Copilot coding agent | Open PR implementing the change | PR link appears on feedback row | 1–5 min ⚠️ |
| 6 | Demo human | Review and merge PR | PR merged | < 1 min |
| 7 | Embr | Build + deploy production | Deployment status updates `pending → building → deployed` on feedback row | 2–5 min ⚠️ |
| 8 | App | Detect deployed SHA; transition feedback to `shipped` | Banner: "Your feedback shipped!" with submitter name visible | Within 30 s of deploy |

⚠️ Steps 5 and 7 are slowest. Plan filler narration (architecture overview, Embr platform tour) during these waits.

---

## Live Path: Loop 3 (Self-Heal, Synthetic Incident)

| Step | Actor | Action | Visible UI / Signal | Expected timing |
|------|-------|--------|---------------------|-----------------|
| 1 | Demo human | Toggle `EMBR_PULSE_SIMULATE_TRIAGE_FAILURE=true` via `embr variables set` (records non-synthetic `triage_failed` events the agent treats as a real signal) | (no immediate UI) | Instant |
| 2 | App | ~30% of `/api/feedback` submissions skip the Foundry triage call and write `triage_failed` system_events rows | Failure breadcrumbs accumulate in Postgres | 1 min for grace window |
| 3 | Demo human | Manually trigger monitor with a `curl` to `/api/agents/monitor/run` (shows `embr-pulse-monitor` cron behavior on demand instead of waiting up to 5 min) | n/a | Manual: instant |
| 4 | Monitor agent (Foundry) | Read signal pack from Postgres, decide `incidentDetected: true`, severity `warning`, confidence ≥ 0.9 | JSON response shows incident decision | < 10 s |
| 5 | App | Create `[INCIDENT]` GitHub issue with sanitized payload + agent hypothesis + suggested action | Issue link in response; visible in repo | < 3 s |
| 6 | Demo human | Re-trigger monitor with the same window | Response shows `dedupedOnto: <issue#>`, no duplicate filed | < 10 s |
| 7 | Demo human | Toggle `EMBR_PULSE_SIMULATE_TRIAGE_FAILURE=false`; (optional) flip `EMBR_PULSE_SIMULATE_FAILURE=true` to show conservatism | Next monitor run sees `syntheticFailureFlagOn: true` and declines to file | < 10 s |

**Receipt for this exact path**: [incident #139](https://github.com/seligj95/embr-pulse/issues/139), filed 2026-04-30, severity `warning`, confidence 0.91. Re-triggered same window: dedupedOnto #139, no duplicate.

For demo brevity: skip Loop 1 fix-PR generation here; the signal we want to land is "the platform noticed and filed actionable work without a human." Mention that Copilot picking up the incident issue and proposing a revert is the natural next step (and how Loop 1 chains in).

---

## Live Path: Loop 1 (Code) — implicit / subsumed

Loop 1 is demonstrated *throughout* the above — it's the path Copilot's PRs take to production. We don't run a standalone Loop 1 demo. Instead, during filler narration in Loop 2 step 7, we walk the audience through the GitHub App webhook → Embr build → deploy pipeline using the actual deploy in progress.

---

## Talk Track Highlights

- **At step 1**: "Notice — this is a real feedback form. The team uses this. The queue you see is real internal feedback."
- **At step 4**: "Here's the trust boundary. We never send the user's raw text to Copilot. Foundry's triage agent generates a sanitized engineering description. That's what Copilot sees."
- **At step 5 (Copilot waiting)**: "While we wait, here's what's running where..." → architecture overview → "...and importantly, the agents managing this app are themselves running on Embr."
- **At step 8**: "The app didn't claim 'shipped' just because the PR merged. It waited for Embr to confirm production is actually serving the new SHA. That distinction matters when agents are running the show."
- **Closing**: "Building this surfaced N concrete things Embr should make first-class. Here's the list..." → show `platform-gaps.md`.

---

## Backup Plans

| Failure | Fallback |
|---------|----------|
| Copilot doesn't pick up issue within 5 min | Cut to pre-recorded clip; manually merge a pre-staged branch |
| Foundry triage timeout | Skip to "here's a triaged item from earlier today" |
| Embr deploy stuck | Show another env's recent deploy; promise a follow-up email with the live deploy result |
| All agents fail | Show `platform-gaps.md` and pivot the demo to "what we learned" |

---

## Open TODOs

- [ ] Capture pre-recorded backup video once Phase 3 lands.
- [ ] Decide on demo persona (real team member vs scripted "Alice").
- [ ] Confirm exact timings once we measure real Copilot/Foundry/Embr latencies.
- [ ] Add screenshots once UI exists.
