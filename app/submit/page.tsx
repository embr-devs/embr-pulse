import Link from "next/link";
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-dynamic";

export default function SubmitPage() {
  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <Link href="/" style={{ color: "#7aa2ff", fontSize: "0.9rem" }}>
          ← Back to feed
        </Link>
        <h1
          style={{
            margin: "0.6rem 0 0.3rem",
            fontSize: "1.7rem",
            letterSpacing: "-0.02em",
          }}
        >
          Share feedback
        </h1>
        <p style={{ opacity: 0.7, marginTop: 0, fontSize: "0.95rem", lineHeight: 1.5 }}>
          Bugs, feature requests, questions — anything is fair game. Submissions
          become GitHub issues and are picked up by an agent for triage.
        </p>
      </header>

      <FeedbackForm />
    </div>
  );
}
