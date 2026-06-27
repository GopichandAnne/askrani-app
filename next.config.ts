import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Realtime + Supabase SSR run fine on the default Node runtime.
  // Add image domains / experimental flags here as the app grows.
};

export default nextConfig;
