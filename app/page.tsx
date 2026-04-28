import Link from "next/link";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.02em" }}>
          embr-pulse
        </h1>
        <p style={{ opacity: 0.7, marginTop: "0.5rem" }}>
          Team feedback, managed by agents on Embr.
        </p>
      </header>

      <section
        style={{
          padding: "1.25rem",
          border: "1px solid #2a2f36",
          borderRadius: 12,
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Phase 1 placeholder</h2>
        <p style={{ opacity: 0.8, lineHeight: 1.55 }}>
          The app shell is up. Submit-feedback form, feed, and admin pages land in Phase 1
          (UI + Postgres) and Phase 3 (triage agent, GitHub issue creation, Copilot
          assignment). See <code>docs/design.md</code> for the plan.
        </p>
        <ul style={{ opacity: 0.8, lineHeight: 1.7 }}>
          <li>
            <Link href="/api/health">/api/health</Link> — liveness probe (Embr health
            check)
          </li>
        </ul>
      </section>

      <footer style={{ opacity: 0.5, fontSize: "0.85rem" }}>
        Built for{" "}
        <a
          href="https://github.com/coreai-microsoft/embr/issues/374"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#7aa2ff" }}
        >
          coreai-microsoft/embr#374
        </a>
      </footer>
    </div>
  );
}
