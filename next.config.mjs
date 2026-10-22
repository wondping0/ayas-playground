/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // The forge shells out to Docker; keep these external to the server bundle.
    serverComponentsExternalPackages: ['pg', 'yauzl'],
  },
}

export default nextConfig
