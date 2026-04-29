// Minimal structured logger. Emits one JSON line per event to stdout (info)
// or stderr (warn/error). The Embr platform tails container stdout/stderr
// into `embr environments logs` and (when wired) the Kusto cluster, so JSON
// lines are easy to filter/grep there.
//
// Convention: `event` is a dot-namespaced verb-phrase ("triage.start"),
// fields are flat scalars where possible. Never log secrets — callers must
// pass already-redacted values.

type Level = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

function emit(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
