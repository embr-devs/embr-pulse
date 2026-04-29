import type { CSSProperties } from "react";
import type { FeedbackStatus } from "@/lib/feedback";
import { formatRelativeTime } from "@/lib/time";

export const colors = {
  bg: "var(--color-bg)",
  card: "var(--color-card)",
  cardBorder: "var(--color-card-border)",
  text: "var(--color-text)",
  muted: "var(--color-muted)",
  accent: "var(--color-accent)",
  success: "#4ade80",
  warn: "#fbbf24",
  danger: "#f87171",
};

// Hardcoded hex values for use in hex-alpha composites (e.g. `${hex}1a`)
const statusHex: Record<FeedbackStatus, string> = {
  open: "#8a93a0",
  "in-triage": "#7aa2ff",
  "needs-human-review": "#fbbf24",
  "in-progress": "#fbbf24",
  shipped: "#4ade80",
  declined: "#8a93a0",
  spam: "#f87171",
};

const statusLabel: Record<FeedbackStatus, string> = {
  open: "Open",
  "in-triage": "In triage",
  "needs-human-review": "Needs review",
  "in-progress": "In progress",
  shipped: "Shipped",
  declined: "Declined",
  spam: "Spam",
};

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const c = statusHex[status];
  const style: CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 600,
    color: c,
    background: `${c}1a`,
    border: `1px solid ${c}55`,
    letterSpacing: "0.02em",
  };
  return <span style={style}>{statusLabel[status]}</span>;
}

export function TimeAgo({ date }: { date: Date }) {
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toISOString()}
      style={{ color: colors.muted, fontSize: "0.85rem" }}
    >
      {formatRelativeTime(date)}
    </time>
  );
}
