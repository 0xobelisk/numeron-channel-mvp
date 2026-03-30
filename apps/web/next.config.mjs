/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workspace/ui'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    domains: ['igstatic.igxe.cn'],
  },
};

export default nextConfig;
