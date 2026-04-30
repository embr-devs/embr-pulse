# EmbrAgent — A Managed Agent Runtime as a First-Class Embr Feature

> Vision doc proposing **EmbrAgent**, a platform-level agent runtime baked into Embr.
>
> This doc revises the position taken in [`embed-in-embr.md`](./embed-in-embr.md), which was too binary. Building [`embr-pulse`](../README.md) showed that ~80% of every "agent" we wrote was platform plumbing, not agent logic — which is the opportunity Embr should claim.

---

## TL;DR

**EmbrAgent is a managed runtime for declarative agents that live alongside Embr-hosted apps.** Customers describe what they want an agent to do (signal, classification, action) in `embr.yaml`; Embr provides the substrate (identity, scheduling, retry, dedup, audit, observability) the agent runs on.

```yaml
embragent:
  identity: managed

  instances:
    - name: monitor
      type: monitor
      schedule: "*/5 * * * *"
      signal:
        kql: "requests | where resultCode >= 500 | summarize count() by bin(timestamp, 5m)"
      threshold: { error_rate_pct: 1.0, window: 5m }
      action:
        file_issue:
          repo: ${GITHUB_REPO}
          labels: [incident, auto-filed]
          dedup: by_signal_signature_within_24h

    - name: triage
      type: triage
      on: issue.opened
      classifier:
        model: gpt-5-foundry
        rubric: ./agents/triage-rubric.md
      output:
        labels_from: ./agents/labels.yaml
        assignees: copilot

    - name: shipped-flag
      type: lifecycle
      on: deploy.completed
      action:
        http: POST ${HOST}/api/internal/deployment-events
```

That's it. Three production-grade agents in ~30 lines of YAML, replacing ~700 lines of hand-written code in `embr-pulse`.

---

## Why this exists

Building `embr-pulse` produced concrete evidence that the per-customer logic / per-platform plumbing ratio in any "agent for an app" is roughly **20 / 80**.

| Component | Total LOC | Per-customer logic | Platform plumbing |
|---|---|---|---|
| `lib/triage.ts` | ~250 | ~50 (the prompt) | ~200 (auth, retry, JSON-mode parsing, OTel, idempotency, error envelopes) |
| `lib/monitor.ts` | ~150 | ~30 (KQL + threshold) | ~120 (Kusto auth, dedup, issue formatting, retry) |
| `app/api/embr/webhook/route.ts` + cron + identity wiring | ~300 | ~0 | ~300 (signature verify, replay protection, rate-limit, GH App auth, audit log) |
| **Total** | **~700** | **~80** | **~620** |

**88% of the code we wrote was reusable infrastructure.** Every customer adopting this pattern will reinvent the same ~620 lines (often badly, given how easy it is to get retry / dedup / idempotency wrong).

That ratio is the EmbrAgent opportunity. Customers should bring the 12% — the prompt, the rubric, the threshold — and Embr should ship the 88%.

---

## Anti-goals (what EmbrAgent is not)

To stay sharp, EmbrAgent must explicitly resist scope creep:

1. **Not a model platform.** Foundry is the model platform. EmbrAgent calls Foundry (or any OpenAI-compatible endpoint) — it does not host models or compete with Foundry.
2. **Not an opinionated NLP product.** Embr does not ship "the triage agent" or "the monitor agent" with hard-coded prompts. The shape is universal; the content is per-customer.
3. **Not a low-code tool.** EmbrAgent is for engineers who already use `embr.yaml`. The interface is config + code (rubrics, classifiers in markdown, hook handlers in their app), not a no-code visual builder.
4. **Not a trap.** Every EmbrAgent instance must be replaceable by `type: custom` pointing at a customer-owned endpoint — so customers can outgrow EmbrAgent without a forklift migration.
5. **Not a workflow engine.** EmbrAgent runs single-turn agents (signal → classify → act). For multi-step orchestration, customers compose multiple instances or fall back to their own code. Don't reinvent Logic Apps / Step Functions / Temporal.

---

## Product surface

### The runtime

A platform-managed runtime per Embr project. Each instance:
- Runs on Embr-issued workload identity (federated, no static keys)
- Emits OpenTelemetry traces tagged `embragent.instance=<name>`, `embragent.type=<type>`, `embr.deploymentId=...`
- Logs structured events to the project's App Insights (incl. classification reasoning where applicable)
- Has built-in retry with exponential backoff
- Has built-in dedup keyed on a signal signature
- Has a per-instance kill switch (`embragent.disable <name>`)

### Agent types (initial)

| Type | Trigger | Customer provides | Built-in primitives |
|---|---|---|---|
| `monitor` | Schedule (cron) | Signal (KQL / OTel query), threshold, action | Cron, identity to query AI / Kusto, dedup, issue formatting, retry |
| `triage` | Event (`issue.opened`, `pr.opened`) | Rubric (markdown), label vocabulary, assignment policy | Foundry call, JSON-mode parsing, confidence gate, retry, audit log |
| `lifecycle` | Deploy event (`deploy.completed`, `deploy.failed`, `deploy.rolled_back`) | HTTP endpoint or label change | Signed delivery, retry, replay protection |
| `custom` | Any of the above | Pointer to customer endpoint | Identity injection, retry, audit, telemetry |

`custom` is the eject hatch — a customer can keep the EmbrAgent infrastructure (identity, observability, retry) while bringing arbitrary logic.

### What customers write

Per instance, customers write **at most**:
- Rubric (markdown, for `triage`)
- Signal definition (KQL or OTel query, for `monitor`)
- Hook handler (HTTP route in their app, for `lifecycle` or `custom`)

Per project, customers write **once**:
- The `embragent:` block in `embr.yaml`

That's the customer surface. Everything else is platform.

---

## Customer / platform boundary

| Concern | Customer | Platform |
|---|---|---|
| Prompt / rubric / classifier content | ✅ | — |
| Severity gates / thresholds | ✅ | — |
| Routing rules (which agent / team / SLA) | ✅ | — |
| Domain vocabulary (labels, severity ladders) | ✅ | — |
| Model invocation (Foundry / OpenAI-compatible) | — | ✅ |
| JSON-mode parsing + schema validation | — | ✅ |
| Confidence gates + structured retry | — | ✅ |
| Auth (workload identity, federated) | — | ✅ |
| Scheduling (cron primitive) | — | ✅ |
| Deduplication (signature-based, time-windowed) | — | ✅ |
| Observability (OTel, App Insights resource attrs) | — | ✅ |
| Audit log + reasoning trails | — | ✅ |
| Idempotency (deploy-safe rollouts) | — | ✅ |

The line is sharp: **content is customer, mechanism is platform.**

---

## How this composes with existing Embr concepts

EmbrAgent does not stand alone — it is the **demand-side** for several platform primitives that already need to exist for non-agent reasons. Building EmbrAgent forces these to be built well:

| Platform primitive | Tracking gap | Why EmbrAgent needs it |
|---|---|---|
| Workload identity for app workloads | [#726](https://github.com/coreai-microsoft/embr/issues/726) | Every `monitor` / `triage` / `custom` instance needs platform-issued identity to call Foundry, App Insights, GitHub, Kusto |
| Scheduled jobs in `embr.yaml` | [#682](https://github.com/coreai-microsoft/embr/issues/682) | `type: monitor` is just a templated cron job |
| Deployment-lifecycle webhooks | [#758](https://github.com/coreai-microsoft/embr/issues/758) | `type: lifecycle` listens to platform deploy events |
| App Insights auto-wiring | [#726](https://github.com/coreai-microsoft/embr/issues/726) | EmbrAgent instances are themselves observable workloads |
| `database.fallback` / managed-vs-external clarity | [#754](https://github.com/coreai-microsoft/embr/issues/754) [#755](https://github.com/coreai-microsoft/embr/issues/755) | EmbrAgent instances can write to project DB, need clean DB story |
| Deployment-event hooks (signed) | [#758](https://github.com/coreai-microsoft/embr/issues/758) | Foundation for `type: lifecycle` |

In other words: **the 15 platform-improvement gaps `embr-pulse` filed are not unrelated. They are the substrate EmbrAgent is built on.** Sequencing the gaps becomes simpler — every gap that unblocks an EmbrAgent type is `P0`.

---

## Why not "just make this a Foundry feature"?

Foundry is excellent at the model layer — prompts, evals, fine-tunes, model lifecycle. EmbrAgent is at the **app deployment layer** — running parameterized agents *next to* a deployed app, sharing its identity, its observability, and its lifecycle.

The boundary:
- **Foundry**: how do I get a model to do X?
- **EmbrAgent**: how do I run a small agent in production, attached to my app, with managed identity / scheduling / dedup / audit?

These compose. An EmbrAgent `type: triage` instance calls Foundry to run the classifier. Foundry doesn't know about Embr deployments; EmbrAgent doesn't know about model fine-tuning. Each does its job.

---

## Why not "just samples"?

The position taken in [`embed-in-embr.md`](./embed-in-embr.md) was that Embr should ship samples and stay out of the agent runtime business. **That position was too binary.** Reasons to revisit:

1. **Samples don't solve identity.** Static keys in env vars is a non-starter for customers in regulated industries. Without a managed runtime, every sample needs a 1-page footnote about MI setup that's left as an exercise.
2. **Samples don't solve dedup or retry.** These are easy to write wrong. Customers will reinvent them, badly. The blast radius of "monitor agent files duplicate incident issues every 5 minutes" or "triage agent retries forever and burns Foundry quota" is real.
3. **Samples don't unify the gaps.** The 15 platform gaps look like a punchlist without EmbrAgent. With EmbrAgent, they're a coherent roadmap.
4. **Samples don't ship a brand.** "Embr is the platform agentic apps run on" is much weaker without something to point at. EmbrAgent gives the platform a story for the agent era.

Samples are still valuable — `embr-pulse` itself stays as a sample of *composing* EmbrAgent instances with app-specific code (the GitHub routing in `lib/github.ts` is genuinely app-specific and stays in the customer's app). But samples alone are not the product.

---

## Open questions

1. **Pricing / quota model.** Per-instance? Per invocation? Bundled with Embr seat license? Whatever the model, it must be predictable for "always-on monitor running every 5 minutes."
2. **Multi-tenant isolation.** EmbrAgent instances run on behalf of a project. Confirm the workload identity / RBAC story keeps strict project-level isolation.
3. **Eval surface.** Should EmbrAgent ship a built-in "test this triage rubric against the last 100 issues" eval primitive? Strong customer pull, but blurs the Foundry boundary. Probably `not v1`.
4. **GitHub vs general issue tracker.** Initial design assumes GitHub. ADO and Linear are the obvious next stops. Worth deciding day-1 whether the action layer is pluggable.
5. **Naming.** `EmbrAgent` (one word) is the working name. Confirm with marketing / docs voice before any user-visible surface.

---

## Proposed roadmap

A possible phasing:

| Phase | Deliverable | Unblocked by |
|---|---|---|
| 0 | Spec the `embragent:` schema in `embr.yaml`; lock customer/platform boundary | (this doc) |
| 1 | Workload identity for app workloads | [#726](https://github.com/coreai-microsoft/embr/issues/726) |
| 2 | `type: lifecycle` (deploy webhook + handler) | [#758](https://github.com/coreai-microsoft/embr/issues/758), Phase 1 |
| 3 | `type: monitor` (cron + KQL + dedup + issue filing) | [#682](https://github.com/coreai-microsoft/embr/issues/682), Phase 1 |
| 4 | `type: triage` (Foundry call + JSON parse + label apply) | Phase 1 |
| 5 | `type: custom` (eject hatch with platform identity injection) | Phase 1 |
| 6 | Portal: per-project EmbrAgent dashboard (instances, runs, traces) | Phases 2–5 |

Phase 1 is the gate. Without managed workload identity, EmbrAgent ships with the same "static keys in env vars" footnote that makes every customer demo awkward. Land that, and the rest is incremental.

---

## What this doc is not

This is a **vision proposal**, not a spec. The schemas are illustrative; the agent types are an opening bid. The intent is to surface the framing — EmbrAgent as a managed runtime, not as a hard-coded NLP product — so the team can have an opinionated design conversation. Not asking for a build commit at this stage.

---

## Receipts

- `embr-pulse` source: [seligj95/embr-pulse](https://github.com/seligj95/embr-pulse) — the 700 LOC of plumbing this doc references
- Original issue: [coreai-microsoft/embr#374](https://github.com/coreai-microsoft/embr/issues/374)
- Platform-gap log: [`docs/platform-gaps.md`](./platform-gaps.md) (15 gaps, all filed upstream)
- Earlier (now-superseded) standalone-vs-embedded analysis: [`docs/embed-in-embr.md`](./embed-in-embr.md)
