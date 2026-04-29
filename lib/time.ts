/**
 * Formats a Date as a human-readable relative time string (e.g. "2h ago").
 *
 * @param date - The date to format.
 * @param now  - Current epoch ms; defaults to Date.now(). Pass an explicit
 *               value in tests to avoid depending on wall-clock time.
 */
export function formatRelativeTime(date: Date, now = Date.now()): string {
  const seconds = Math.max(1, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
