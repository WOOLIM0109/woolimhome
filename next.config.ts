import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./scripts/render-production-approved-mockup.mjs",
      "./lib/portfolio/approved-16x9-renderer.ts",
      "./lib/portfolio/approved-16x9-templates.ts",
      "./lib/portfolio/approved-a4-landscape-templates.ts",
      "./lib/portfolio/approved-a4-portrait-templates.ts",
      "./lib/portfolio/approved-mockup-suites.ts",
      "./lib/portfolio/approved-mockup-runtime.ts",
      "./lib/portfolio/approved-mockup-title.ts",
      "./public/fonts/Paperlogy-7Bold.ttf",
      "./public/images/mockup-templates/a4-portrait-dark-wood.png",
      "./public/images/woolim-logo-cropped.png",
    ],
    "/api/admin/content/*/thumbnail-title": [
      "./scripts/render-production-thumbnail.mjs",
      "./lib/portfolio/thumbnail-title-overlay.ts",
      "./public/fonts/Paperlogy-7Bold.ttf",
      "./public/fonts/Paperlogy-8ExtraBold.ttf",
    ],
  },
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
