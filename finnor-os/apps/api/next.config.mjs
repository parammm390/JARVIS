/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@finnor/shared-types",
    "@finnor/policy-schema",
    "@finnor/db",
    "@finnor/memory",
    "@finnor/tools",
    "@finnor/orchestration",
  ],
  // pdf-parse starts its own Node worker during verified corpus ingestion, and Pino's
  // transport starts a thread-stream worker for structured logs. Bundling either
  // rewrites its worker path into `.next/server/chunks/lib/worker.js`, which does not
  // exist at static-generation time. Keep the Node-only stacks external.
  experimental: {
    serverComponentsExternalPackages: ["pg", "ioredis", "groq-sdk", "pdf-parse", "pino", "thread-stream", "pino-pretty", "@axiomhq/pino"],
  },
};
export default nextConfig;
