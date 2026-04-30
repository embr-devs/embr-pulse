# Embed in Embr — What Would It Take to Make This First-Class?

> Question 3 from [`design.md`](./design.md): *Where should the management agent live? Standalone (e.g. inside GitHub Actions) or first-class inside Embr (ADC)? What would each cost us to build?*
>
> This doc grades each piece of `embr-pulse` against "could (and should) Embr ship this as a built-in feature?"

---

## TL;DR

| Piece | Today (in `embr-pulse`) | Could be first-class in Embr? | Recommended verdict |
|---|---|---|---|
| Triage agent invocation | App-level Foundry call | **Maybe** — as a sample/template, not a built-in | Ship as sample |
| GitHub issue → Copilot routing | App-level GraphQL | **No** — too app-specific | Stay in app |
| Workload identity | Static keys | **Yes** | **Build in Embr** |
| Scheduled jobs (Loop 3 trigger) | GitHub Actions cron shim | **Yes** | **Build in Embr** |
| Deployment lifecycle webhook | n/a (would have to poll) | **Yes** | **Build in Embr** |
| App Insights / OTel auto-wiring | Hand-wired in `instrumentation.ts` | **Yes (small)** | Sample + minor platform work |
| Per-PR preview environments | Already in Embr | — | Already in Embr; document better |
| Postgres provisioning | Already in Embr | — | Already in Embr; fix gaps G-006/007/008 |
| Self-heal monitor | Phase 4, not built yet | **No (built-in)** — but the *scaffolding* yes | Sample |

The pattern: **platform primitives belong in Embr; the agent application logic belongs in the customer's app.** Resist the temptation to make Embr "an agent platform"; make it the platform that agentic apps run on.

---

## Detailed analysis

### 1. Triage agent invocation — sample, not built-in

The triage call (`lib/triage.ts`) is ~250 lines. It does: build prompt → call Foundry OpenAI endpoint → parse JSON → log → return.

**Why not built-in:** every customer's triage prompt, fields, and confidence thresholds are different. Embr building a triage primitive would be Embr building an opinionated NLP service.

**Why a sample:** the *shape* is universal — JSON-mode call, confidence gate, retry, structured logging, OTel emit. Customers will reinvent this. Ship the file as part of an Embr sample template.

**Cost to ship as sample:** 1 engineer-day to clean up `lib/triage.ts` into a generic version with a configurable prompt. Adds it to `coreai-microsoft/embr/samples/agent-triage-pattern/`.

**Cost to build into Embr:** large and probably wrong. Skip.

---

### 2. GitHub issue → Copilot routing — keep in app

`lib/github.ts` is ~280 lines and very specific: the GraphQL `suggestedActors` lookup, the `replaceActorsForAssignable` mutation, the audit-event payloads, the comment formatting.

**Why not built-in:** this is application logic. A different customer might route to a different agent (Devin, internal tools), or assign by team rotation, or attach an SLA. Bundling this into Embr would over-fit.

**Why a sample:** see #1.

---

### 3. Workload identity — **build into Embr**

This is the single biggest unlock. Today every Embr-hosted app that needs to talk to Azure (Foundry, Kusto, Key Vault, App Insights, Storage) does it with static keys in env vars. We did the same; we now have an API key for Foundry sitting in our app config that nobody is auto-rotating.

**What we want:** each Embr app gets a managed identity (or federated workload identity for cross-tenant). RBAC role assignments in `embr.yaml` or via a CLI command:

```yaml
# embr.yaml (proposed)
identity:
  workload: managed
  roleAssignments:
    - resource: /subscriptions/.../foundryAccounts/jordan-embr
      role: Cognitive Services User
    - resource: /subscriptions/.../databases/embr
      role: Database Reader
```

**Cost to build:** medium — Embr already manages Azure resources for the tenant; extending that to issue and bind a workload identity per app is well-trodden ground in App Service / Container Apps. The hard part is the customer-tenant boundary for federated identity.

**Why this is critical:** without it, every "agent-managed app on Embr" customer demo has the same uncomfortable footnote: *"In production you'd use managed identity, but in this demo we use static keys."* That footnote is fatal in CISO conversations.

Files: G-002, G-005.

---

### 4. Scheduled jobs — **build into Embr**

Loop 3's monitor agent has to run every 5 minutes. Today the design pushes that to a GitHub Actions cron job that calls an Embr-hosted endpoint. It works. It also weakens the "agents run on Embr" pitch.

**What we want:** a job primitive in `embr.yaml`.

```yaml
jobs:
  - name: monitor
    schedule: "*/5 * * * *"
    endpoint: /api/agents/monitor/run
    timeoutSeconds: 60
```

Embr would invoke the endpoint with a signed identity (workload identity, see #3) so the app can verify the call is authentic.

**Cost to build:** small-to-medium. Embr already has the deploy/run loop; adding a cron driver and a "trigger HTTP endpoint with signed identity" pathway is incremental. AKS-native solutions (CronJob CRD) exist; the plumbing is mostly UX (config schema + portal surfacing).

**Why this is important:** any agentic app with periodic responsibilities (anomaly detection, batch eval, drift checks) will hit this. Without it, every customer reaches for a parallel scheduler — Logic Apps, Azure Functions, GitHub Actions — and now their "platform" is two platforms.

Files: G-001.

---

### 5. Deployment lifecycle webhook — **build into Embr**

To mark a feedback item "shipped" honestly, the app needs to know when an Embr deployment for a given commit SHA actually became active in production. Today the only options are: (a) poll the Embr API, or (b) ship a startup-log boot signal and pipe it back.

**What we want:** a configurable webhook target in Embr that fires on lifecycle events.

```yaml
deploymentWebhooks:
  - url: https://${HOST}/api/embr/deployment-events
    secret: ${DEPLOYMENT_WEBHOOK_SECRET}
    events: [building, deployed, failed, rolled_back]
```

Payload: commit SHA, environment, deployment id, status, timestamps.

**Cost to build:** small. Embr already emits these events internally (we see them via the platform Kusto). Surfacing them via webhook is a delivery layer, not a logic layer.

**Why this is important:** any app that closes a UX loop on "is my change live yet?" needs this. Today every customer will write the same polling code. Worse, polling is wrong: when Embr rolls back, polling doesn't tell you about the rollback unless you keep polling forever.

Files: G-003.

---

### 6. App Insights / OTel auto-wiring — small platform investment

Every Embr-hosted app should be a good citizen of Azure observability. Today we did it ourselves in `instrumentation.ts`:

```ts
import { useAzureMonitor } from "@azure/monitor-opentelemetry";
useAzureMonitor({
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  samplingRatio: 1.0,
});
```

Plus we had to set up `lib/log.ts` to bridge `console.log` to OTel `LogRecord`s, because `useAzureMonitor` doesn't auto-instrument console (a rough edge for anyone who doesn't read the source).

**What we want:**

1. Embr provisions an App Insights resource per project automatically (opt-out, not opt-in). Connection string flows in via env vars.
2. A first-party Embr SDK package (per-language) that wires OTel + adds the `embr.deploymentId`, `embr.commitSha`, `embr.environmentId` resource attributes by default.
3. Optionally, a portal "logs" tab that's a thin wrapper over App Insights for the app's resource.

**Cost to build:** small (App Insights provisioning) to medium (SDK packages, with one per language).

**Why this is important:** observability is table stakes for production agents. If "I just shipped an agent to Embr" doesn't get me usable logs and traces by default, customers will be frustrated.

---

### 7. Self-heal monitor (Phase 4, not yet built) — sample, not built-in

The monitor agent's logic — schedule a Kusto/App Insights query, classify the result, file an issue with hypothesis — is universal in shape and specific in detail. Same logic as #1: ship as a sample template, not a built-in.

The platform's job is to provide the **substrate** the monitor needs:

- Workload identity (#3) → so the monitor can read App Insights / Kusto without keys.
- Scheduled jobs (#4) → so the monitor doesn't need an external cron.
- Deployment webhook (#5) → so the monitor can correlate "5xx rate spiked at 14:32" with "deployment dpl_xyz went active at 14:31".

Once those three exist, the monitor agent becomes ~150 lines of customer code.

---

## A possible Embr roadmap

If the goal is "the platform agentic apps run on", here's a possible ordering driven by what `embr-pulse` taught us:

1. **Workload identity** (#3). Highest leverage; unblocks every customer scenario.
2. **Deployment lifecycle webhook** (#5). Cheap; obvious.
3. **App Insights provisioning + SDK** (#6). Medium effort; raises the floor on observability.
4. **`jobs:` in `embr.yaml`** (#4). Medium effort; closes the "agents run on Embr" footnote.
5. **`coreai-microsoft/embr/samples/embr-pulse-pattern/`** — productize the triage + Copilot routing pattern as a customer-copy-pasteable sample.

After those five, "agent-managed app on Embr" is no longer a demo with footnotes. It's a turnkey customer experience.

## What we **don't** want Embr to do

- Don't ship a "triage agent" or "monitor agent" as built-in services. The shape is universal but the content is per-customer; making it built-in turns Embr into an opinionated NLP product.
- Don't ship a "Copilot integration" as a separate Embr feature. The integration *is* the GitHub App that's already there — Copilot opens a PR like any other contributor and Embr deploys it. Don't add a layer.
- Don't ship "agent management" as a separate concept in `embr.yaml`. Agents are just code that runs in the app, calls APIs, and emits telemetry. Treat them as such.

The mental model: **Embr is the platform for apps. Some of those apps happen to be driven by agents. The platform's job is to be a great platform — identity, scheduling, observability, deployment — not to be opinionated about the agents.**
