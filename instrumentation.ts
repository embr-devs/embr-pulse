// Next.js 15 instrumentation hook — runs once on server startup, before any
// route handlers fire. We use it to bootstrap Azure Monitor / App Insights
// telemetry. See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Connection string comes from APPLICATIONINSIGHTS_CONNECTION_STRING (set as
// a secret env var on the Embr environment). If unset, we no-op so local dev
// without App Insights still works.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    console.log("[telemetry] APPLICATIONINSIGHTS_CONNECTION_STRING not set — skipping App Insights init");
    return;
  }

  try {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
      },
      samplingRatio: 1.0,
      enableLiveMetrics: true,
    });
    console.log("[telemetry] App Insights initialized");
  } catch (err) {
    // Don't crash the app if telemetry init fails — just log loudly.
    console.error("[telemetry] failed to init App Insights:", err);
  }
}
