/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_API_URL is injected at build time by the Azure DevOps pipeline
  // (set as a pipeline variable). For local development, add it to web/.env.local
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  },
};

module.exports = nextConfig;
