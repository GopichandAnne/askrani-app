/**
 * Phase 1 placeholder. No product UI is built yet — the app shell, auth gate,
 * and feature screens land in Phase 2+ (see kickoff brief, "UI scope").
 * This page only confirms the scaffold compiles and tokens/fonts are wired.
 */
export default function Home() {
  return (
    <main style={{ padding: "3rem", maxWidth: 640 }}>
      <p style={{ fontFamily: "var(--font-playfair)", fontStyle: "italic", fontSize: 32, color: "var(--teal-deep)" }}>
        Ask Rani
      </p>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>
        Control panel scaffold (Phase 1). Schema, RLS, and design tokens are in
        place. Product UI begins in Phase 2.
      </p>
    </main>
  );
}
