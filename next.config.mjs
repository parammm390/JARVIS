/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/resources/admissions-ai-glossary",
        destination: "/resources/dispatch-ai-glossary",
        permanent: true,
      },
    ]
  },
}

export default nextConfig
