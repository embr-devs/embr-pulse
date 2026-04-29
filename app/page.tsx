import Link from "next/link";
import { listRecentFeedback } from "@/lib/feedback";
import { StatusBadge, TimeAgo, colors } from "./components/ui";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ submitted?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const { submitted } = await searchParams;
  let items: Awaited<ReturnType<typeof listRecentFeedback>> = [];
  let loadError: string | null = null;
  try {
    items = await listRecentFeedback(50);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <header
        style={{
          marginBottom: "2rem",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.02em" }}>
            embr-pulse
          </h1>
          <p style={{ opacity: 0.7, marginTop: "0.5rem", marginBottom: 0 }}>
            Team feedback, managed by agents on Embr.
          </p>
        </div>
        <Link
          href="/submit"
          style={{
            padding: "0.6rem 1rem",
            background: colors.accent,
            color: colors.bg,
            fontWeight: 600,
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.9rem",
          }}
        >
          + Share feedback
        </Link>
      </header>

      {submitted && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            background: `${colors.success}1a`,
            border: `1px solid ${colors.success}55`,
            borderRadius: 8,
            color: colors.success,
            fontSize: "0.9rem",
          }}
        >
          ✓ Thanks — your feedback was submitted.
        </div>
      )}

      {loadError && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            background: `${colors.danger}1a`,
            border: `1px solid ${colors.danger}55`,
            borderRadius: 8,
            color: colors.danger,
            fontSize: "0.85rem",
          }}
        >
          Could not load feedback: {loadError}
        </div>
      )}

      {items.length === 0 && !loadError ? (
        <EmptyState />
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "0.75rem",
          }}
        >
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                padding: "1rem 1.1rem",
                background: colors.card,
                border: `1px solid ${colors.cardBorder}`,
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "1rem",
                  marginBottom: "0.4rem",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  {item.title}
                </h3>
                <StatusBadge status={item.status} />
              </div>
              {item.triageSummary && (
                <p
                  style={{
                    margin: "0.4rem 0 0.6rem",
                    color: colors.muted,
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                  }}
                >
                  {item.triageSummary}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "0.8rem",
                  flexWrap: "wrap",
                  color: colors.muted,
                  fontSize: "0.82rem",
                }}
              >
                <span>{item.submitterName}</span>
                <span>·</span>
                <TimeAgo date={item.createdAt} />
                {item.category && (
                  <>
                    <span>·</span>
                    <span>{item.category}</span>
                  </>
                )}
                {item.githubIssueNumber && (
                  <>
                    <span>·</span>
                    <a
                      href={`https://github.com/seligj95/embr-pulse/issues/${item.githubIssueNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: colors.accent }}
                    >
                      #{item.githubIssueNumber}
                    </a>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer style={{ opacity: 0.5, fontSize: "0.85rem", marginTop: "3rem" }}>
        Built for{" "}
        <a
          href="https://github.com/coreai-microsoft/embr/issues/374"
          target="_blank"
          rel="noreferrer"
          style={{ color: colors.accent }}
        >
          coreai-microsoft/embr#374
        </a>
        {" · "}
        <Link href="/api/health" style={{ color: colors.accent }}>
          health
        </Link>
        {" · "}
        <Link href="/api/ready" style={{ color: colors.accent }}>
          ready
        </Link>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "2.5rem 1.5rem",
        textAlign: "center",
        border: `1px dashed ${colors.cardBorder}`,
        borderRadius: 12,
        color: colors.muted,
      }}
    >
      <p style={{ margin: 0, fontSize: "1rem" }}>No feedback yet.</p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.9rem" }}>
        <Link href="/submit" style={{ color: colors.accent }}>
          Be the first to share something →
        </Link>
      </p>
    </div>
  );
}
