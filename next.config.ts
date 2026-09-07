import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    localPatterns: [
      {
        pathname: "/images/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/about/ceo",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/about/location",
        destination: "/about#location",
        permanent: true,
      },
      {
        source: "/projects/business-docs",
        destination: "/portfolio",
        permanent: true,
      },
      {
        source: "/projects/design",
        destination: "/portfolio/design",
        permanent: true,
      },
      {
        source: "/cases/consulting",
        destination: "/success/funding",
        permanent: true,
      },
      {
        source: "/cases/ppt",
        destination: "/success/bidding-entry",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
