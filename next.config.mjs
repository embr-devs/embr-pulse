/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Azure Monitor OTel SDK uses dynamic require() for instrumentation modules.
  // Mark it (and its transitive gRPC deps) external so webpack doesn't try to
  // statically bundle Node-only modules like 'stream'/'fs' for the edge runtime.
  serverExternalPackages: [
    "@azure/monitor-opentelemetry",
    "@opentelemetry/instrumentation",
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-logs-otlp-grpc",
    "@opentelemetry/exporter-metrics-otlp-grpc",
    "@opentelemetry/otlp-grpc-exporter-base",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
  ],
  webpack(config) {
    // Externalize all @opentelemetry/* and @grpc/* packages in every webpack
    // compilation context (including the edge-runtime worker) so Node-only
    // built-ins like 'stream' and 'fs' are never attempted for the browser
    // bundle.
    const prev = config.externals ?? [];
    config.externals = [
      ...(Array.isArray(prev) ? prev : [prev]),
      ({ request }, callback) => {
        if (
          /^(@opentelemetry\/|@grpc\/|@azure\/monitor-opentelemetry)/.test(
            request
          )
        ) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      },
    ];
    return config;
  },
};

export default nextConfig;
