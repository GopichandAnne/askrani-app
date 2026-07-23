// Shared (non-server) constants for Post & Earn config, importable by both the
// server actions and client components. The "use server" actions file can't
// export plain values, so platform/format tables live here.

export const POST_PLATFORMS = ["instagram", "youtube", "facebook", "tiktok"] as const;

// Formats that make sense per platform. Kept in sync with _shared/social.ts.
export const PLATFORM_FORMATS: Record<string, string[]> = {
  instagram: ["reel", "post", "story"],
  facebook: ["reel", "post", "story"],
  youtube: ["video", "short"],
  tiktok: ["video", "photo"],
};
