import { NextResponse } from "next/server";

// Per-user tour WRITE tool: "upgrade my plan." In the console this tool is set to
// HOLD, so the assistant flags it for a human instead of calling it — demonstrating
// governance for a signed-in action. Harmless if ever called directly (changes
// nothing); the point is that Hold stops it before it runs.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body */
  }
  return NextResponse.json({
    ok: true,
    message: "Upgrade request recorded — an account manager will confirm.",
    requested_plan: body.plan ?? "Business",
    reference: "UP-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
  });
}
