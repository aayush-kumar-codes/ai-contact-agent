/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  // Proxy /agent/* to the backend in dev so relative URLs work if env is misconfigured
  async rewrites() {
    const target = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:3001'
    if (!target || target.startsWith('/')) return []
    return [{ source: '/agent/:path*', destination: `${target.replace(/\/$/, '')}/agent/:path*` }]
  },
}

export default nextConfig
