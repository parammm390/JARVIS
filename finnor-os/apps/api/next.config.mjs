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
  experimental: { serverComponentsExternalPackages: ["pg", "ioredis", "groq-sdk"] },
};
export default nextConfig;
