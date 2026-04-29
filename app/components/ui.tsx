import type { CSSProperties } from "react";
import type { FeedbackStatus } from "@/lib/feedback";

export const colors = {
  bg: "#0b0d10",
  card: "#11141a",
  cardBorder: "#2a2f36",
  text: "#e6e8eb",
  muted: "#8a93a0",
  accent: "#7aa2ff",
  success: "#4ade80",
  warn: "#fbbf24",
  danger: "#f87171",
};

const statusColor: Record<FeedbackStatus, string> = {
  open: colors.muted,
  "in-triage": colors.accent,
  "needs-human-review": colors.warn,
  "in-progress": colors.warn,
  shipped: colors.success,
  declined: colors.muted,
  spam: colors.danger,
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
  const c = statusColor[status];
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
  const now = Date.now();
  const then = date.getTime();
  const seconds = Math.max(1, Math.floor((now - then) / 1000));
  let text: string;
  if (seconds < 60) text = `${seconds}s ago`;
  else if (seconds < 3600) text = `${Math.floor(seconds / 60)}m ago`;
  else if (seconds < 86_400) text = `${Math.floor(seconds / 3600)}h ago`;
  else text = `${Math.floor(seconds / 86_400)}d ago`;
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toISOString()}
      style={{ color: colors.muted, fontSize: "0.85rem" }}
    >
      {text}
    </time>
  );
}
