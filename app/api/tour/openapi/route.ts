import { NextResponse } from "next/server";

// OpenAPI spec for the tour's PER-USER tools. Paste this URL into "Connect a custom
// API" and CHECK "This is my own app — answer as the signed-in customer", so the
// builder generates identity-forwarding tools (my_account / upgrade_plan).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    openapi: "3.0.0",
    info: { title: "Ask Rani Tour — Your account", version: "1.0.0" },
    servers: [{ url: "https://app.askrani.ai" }],
    paths: {
      "/api/tour/account": {
        get: {
          operationId: "my_account",
          summary: "Look up the signed-in user's own account",
          description:
            "Return the SIGNED-IN user's own account on the platform — their store, its type, how many knowledge documents and connected tools they have, and their conversation count. Call this whenever the signed-in user asks about their account, usage, plan, connected tools, or 'what do I have'.",
          responses: { "200": { description: "The user's account" } },
        },
      },
      "/api/tour/upgrade": {
        post: {
          operationId: "upgrade_plan",
          summary: "Upgrade the signed-in user's plan",
          description:
            "Request an upgrade of the signed-in user's plan. This is a high-impact action (a write) — it changes billing.",
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "object", properties: { plan: { type: "string" } } },
              },
            },
          },
          responses: { "200": { description: "Upgrade requested" } },
        },
      },
    },
  });
}
