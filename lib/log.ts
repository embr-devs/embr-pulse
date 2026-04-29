// Minimal structured logger. Emits one JSON line per event to stdout (info)
// or stderr (warn/error) AND emits an OpenTelemetry LogRecord. The OTel
// records are picked up by @azure/monitor-opentelemetry (initialized in
// instrumentation.ts) and shipped to App Insights as traces, so the same
// events you see in `embr logs` show up in App Insights / Foundry Traces
// where they can be KQL-queried alongside the auto-captured request and
// dependency telemetry.
//
// Convention: `event` is a dot-namespaced verb-phrase ("triage.start"),
// fields are flat scalars where possible. Never log secrets — callers must
// pass already-redacted values.

import { logs, SeverityNumber, type Logger } from "@opentelemetry/api-logs";

type Level = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

const SEVERITY: Record<Level, { num: SeverityNumber; text: string }> = {
  info: { num: SeverityNumber.INFO, text: "INFO" },
  warn: { num: SeverityNumber.WARN, text: "WARN" },
  error: { num: SeverityNumber.ERROR, text: "ERROR" },
};

// Lazy + cached. If useAzureMonitor hasn't been called (e.g. local dev with
// no connection string), the global logger provider is a no-op — emit() is
// safe and silent.
let _otel: Logger | null = null;
function otelLogger(): Logger {
  if (!_otel) _otel = logs.getLogger("embr-pulse", "1.0.0");
  return _otel;
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

  // OpenTelemetry log record. Strip undefined values — OTel attribute
  // serializers reject them.
  const attributes: Record<string, string | number | boolean> = { event };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    attributes[k] = v;
  }
  try {
    const sev = SEVERITY[level];
    otelLogger().emit({
      severityNumber: sev.num,
      severityText: sev.text,
      body: event,
      attributes,
    });
  } catch {
    // Never let telemetry break the request path.
  }
}

export const log = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
