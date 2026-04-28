# Copilot coding agent instructions — embr-pulse

You are working in `embr-pulse`, an internal team feedback aggregator hosted on
[Embr](https://github.com/coreai-microsoft/embr). Full architecture is in
[`docs/design.md`](../docs/design.md). Demo path is in
[`docs/demo-script.md`](../docs/demo-script.md). Platform friction is logged in
[`docs/platform-gaps.md`](../docs/platform-gaps.md).

## Tech stack

- **Next.js 15 (App Router) + TypeScript** — server actions for mutations, route
  handlers under `app/api/`.
- **Postgres** via the `pg` driver. Schema in `db/schema.sql`. Migrations are
  idempotent. Apply with `npm run db:migrate`.
- **NextAuth (Auth.js) + Microsoft Entra ID** — tenant-restricted, allowlist-gated.
- **Microsoft Foundry** — triage and monitor agents, called over HTTPS from
  Next.js API routes.
- **GitHub App `embr-pulse-bot`** — issue creation, Copilot assignment, webhooks.

## Hard rules

1. **Never propagate raw user feedback (`feedback.body`) into prompts, GitHub
   issue bodies, or agent calls.** Only `triage_summary` (sanitized output of
   the triage agent) is safe to forward. See "Trust Boundary" in `docs/design.md`.
2. **Never log secrets or webhook payloads with credentials.**
3. **All webhooks must verify HMAC + check `github_deliveries` for replay.**
4. **All "shipped" transitions must be backed by a successful production
   deployment in the `deployments` table — not just a PR merge.**
5. **All mutations must write to `feedback_events` for audit.**
6. **Every agent invocation must record an `agent_runs` row.**

## Conventions

- API routes return `NextResponse.json(...)` with explicit status codes.
- Database access goes through `lib/db.ts` (`pool` export) — don't create new pools.
- Use `zod` for input validation at every API boundary.
- Use `force-dynamic` segment config on routes that hit the DB.
- Prefer server components and server actions; avoid client components unless
  interactivity demands it.

## When you don't know what to do

- Read `docs/design.md` first.
- If still unclear, open the PR with `[needs-review]` in the title and describe
  the ambiguity in the PR body. Do not guess on architectural questions.
