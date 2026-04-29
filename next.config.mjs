/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Azure Monitor OTel SDK uses dynamic require() for instrumentation modules.
  // Mark it external so webpack doesn't statically bundle it (silences a wall
  // of "Critical dependency" warnings).
  serverExternalPackages: [
    "@azure/monitor-opentelemetry",
    "@opentelemetry/instrumentation",
  ],
};

export default nextConfig;
