# Customer Story: We Built `embr-pulse`, and the Agents Built Most of It

> The pitch we'll use when evangelizing `embr-pulse` and Embr to customers and Microsoft leadership.
>
> Companion to [`reference-architecture.md`](./reference-architecture.md) and [`design.md`](./design.md).

---

## The one-liner

> *"This app's entire lifecycle — from a teammate's idea to a shipped change in production — is driven by agents running on Embr."*

## The receipt (you can verify this)

On 2026-04-29 at 8:25 PM ET, a teammate submitted feedback through the `embr-pulse` form:

> *"Add a dark mode toggle to the feedback feed. The white background is hard on the eyes when triaging late at night. Would love a sun/moon icon in the header that persists via localStorage."*

What happened next, **with no human writing code**:

| t+ | Event | Where |
|---|---|---|
| 0s | `POST /api/feedback` accepted | embr-pulse on Embr |
| ~3s | Foundry triage agent returned `confidence=0.95`, sharpened title, suggested labels `pulse-feedback / ui / theme` | Foundry, called from Embr |
| ~5s | GitHub issue [#8](https://github.com/seligj95/embr-pulse/issues/8) opened, labels applied | repo `seligj95/embr-pulse` |
| ~6s | "🤖 Triage analysis" comment posted | issue #8 |
| ~7s | GitHub Copilot coding agent assigned (gated on confidence ≥ 0.7 + non-duplicate) | issue #8 |
| ~3 min | Copilot opened PR [#9](https://github.com/seligj95/embr-pulse/pull/9) | repo |
| ~21 min | Human reviewed and merged the PR | repo |
| ~23 min | Embr auto-deployed the new SHA | production env |

Roughly **25 minutes from "I have an idea" to "it's in production"**, with the human's only contributions being the original sentence and a code review.

## Why this matters

There are two stories about agentic software, and they're often confused:

1. **"Agents help me write code faster."** This is real and valuable but it's the assistant model — Copilot in your IDE, ChatGPT in another tab. The human is still the loop.
2. **"Agents *are* the loop, and the platform is built so they can close it."** This is the much bigger claim, and it's the one Embr is making.

`embr-pulse` is a working answer to claim #2. It's not a research demo or a sandbox. It's a real internal app the Embr team uses. Every feedback submission really runs through this loop. Every shipped feature in `embr-pulse` is itself a receipt.

## What Embr provided that made this possible

- **GitHub-native deployment.** Push to `main` → build → deploy, no CI/CD authoring. Copilot's PR-then-merge is indistinguishable from a human's, and the deploy works the same way.
- **Per-PR preview environments.** When Copilot opens a PR, Embr stands up a preview env on the PR's branch automatically. Reviewers click a link, see the change live, click merge.
- **Managed Postgres + env vars + secrets.** Zero infra YAML for the boring stuff. Postgres is provisioned by name in `embr.yaml`; secrets land in env vars via the portal or CLI.
- **Logs and traces in one place.** `embr logs` for raw stream + App Insights for queryable history; both work without authoring observability code.
- **Time-to-first-deploy: 1 command.** `embr quickstart deploy seligj95/embr-pulse -i <id>` was the literal first deployment.

## What we learned Embr needs to make this first-class

Building this surfaced concrete platform gaps. We filed them as issues against `coreai-microsoft/embr` and we'll quantify the cost of fixing each one in [`embed-in-embr.md`](./embed-in-embr.md). The headlines:

- **Workload identity** (G-002, G-005): every customer building an "agent-managed" app will need their app's runtime to authenticate to Azure (Foundry, Kusto, Key Vault, App Insights) without long-lived keys. We had to fall back to static keys; rotation is manual.
- **Scheduled jobs** (G-001): Loop 3 (self-heal) needs a periodic trigger. Today we'll use GitHub Actions cron as a shim; the experience would be much cleaner if `embr.yaml` had a `jobs:` field.
- **Deployment lifecycle webhook** (G-003): to mark a feedback item "shipped" we need to know when an SHA is actually live in production. Polling works; a webhook would be obvious.
- **The PR-preview discoverability + variable-scope tradeoff** (G-009, G-011): preview envs are great but undocumented; their variable scoping doesn't match the "preview = clone of prod" mental model.
- **A handful of operational rough edges** (G-006, G-008, G-010, G-012, G-013) that bit us during build and would bite any customer.

These aren't blockers. We worked around all of them. But each one is a place where the first agent-managed customer app of the next quarter will hit the same wall — and the workarounds will leak into customer code, weakening the "Embr is the platform for agentic apps" story.

## The ask for Embr leadership

If we want to land "agent-managed PaaS" as a category Microsoft owns, three investments unlock it from "demo-able with workarounds" to "first-class":

1. **Workload identity for app code** (closes G-002 + G-005). Single biggest unlock.
2. **`jobs:` in `embr.yaml`** (closes G-001). Removes the "but the agent doesn't actually run on Embr" footnote.
3. **Reference samples in the Embr repo** (closes G-004). Make `embr-pulse` (or a stripped-down version of it) the official "agent-managed app on Embr" template.

With these three, the demo *is* the customer experience.

## What this story is not

- It is **not** a claim that Copilot writes all the code. We wrote the orchestration plumbing — the form, the database, the triage call, the GitHub integration — by hand (with Copilot as an assistant in the IDE, not as the loop). What Copilot writes is the user-facing features and bug fixes that show up as *issues* once the loop is closed.
- It is **not** a claim that the agents are unsupervised. Every PR is human-reviewed before merge. Every triaged issue with confidence < 0.7 gets a `needs-human-review` label and is *not* routed to Copilot. The merge button is non-negotiable, and that's a feature, not a limitation.
- It is **not** a claim that this works for any app at any scale. It works for a self-contained internal app where the issues Copilot picks up are scoped, in-codebase changes. Bigger systems need bigger guardrails.

## Demo flow (90 seconds, live)

1. Open the `embr-pulse` form. Submit a real-feeling feature request out loud.
2. Tab to GitHub. Show issue appearing, comment appearing, Copilot label appearing, PR appearing in 2–4 minutes (talk track during wait).
3. Open the PR's preview environment from the Embr-posted comment. Show the change live.
4. Merge. Tab to Embr portal. Show the build → deploy run start.
5. Tab back to the app. New deploy is live. The original feedback item is now visible in the feed with a "shipped" indicator (Phase 4 deliverable).

Backup: if Copilot is slow, cut to a pre-recorded clip and finish the narrative on the talk track.
