import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/prediction-data.json',
        destination: 'https://0luulmjdaimldet9.public.blob.vercel-storage.com/prediction-matrix-data.json',
      },
    ];
  },
};

export default nextConfig;
