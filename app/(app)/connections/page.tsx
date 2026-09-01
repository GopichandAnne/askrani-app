import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConnectionsClient, type ConnStatus } from "./connections-client";
import { ApiBuilder, type ApiTool } from "./api-builder";
import { McpServers, type McpServerRow, type McpToolRow } from "./mcp-servers";

export const metadata: Metadata = { title: "Connections · Ask Rani" };
export const dynamic = "force-dynamic";

/**
 * Connections — the OAuth broker's front door. The owner clicks "Connect" on a
 * provider, authorizes on the provider's own site, and Rani gets the tokens (the
 * model never sees them). Read the current status from the vault (service role;
 * the table has no client policies).
 */
export default async function ConnectionsPage() {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");
  if (!ctx.active) redirect("/welcome");

  const db = createAdminClient();
  const { data } = await db
    .from("oauth_connection")
    .select("provider, account_label, status")
    .eq("store_id", ctx.active.id)
    .eq("status", "connected");

  const connected: Record<string, ConnStatus> = {};
  for (const r of (data ?? []) as { provider: string; account_label: string | null; status: string }[]) {
    connected[r.provider] = { label: r.account_label };
  }

  const { data: toolRows } = await db
    .from("http_tool")
    .select("id, name, description, method, side_effect, auth")
    .eq("store_id", ctx.active.id)
    .order("created_at", { ascending: false });
  const customTools = (toolRows ?? []) as ApiTool[];

  const [{ data: mcpServerRows }, { data: mcpToolRows }] = await Promise.all([
    db.from("mcp_server").select("id, name, url, auth, enabled").eq("store_id", ctx.active.id).order("created_at", { ascending: false }),
    db.from("mcp_tool").select("id, server_id, name, remote_name, description, side_effect, enabled").eq("store_id", ctx.active.id).order("remote_name"),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Connections</h1>
        <p className="text-muted-foreground text-sm">
          Connect the tools you already use. One click, sign in on their site — Rani gets access, and never sees your password.
        </p>
      </div>
      <ConnectionsClient
        storeSlug={ctx.active.slug}
        isOwner={ctx.active.role === "owner"}
        connected={connected}
      />
      <ApiBuilder storeSlug={ctx.active.slug} isOwner={ctx.active.role === "owner"} tools={customTools} connectedProviders={Object.keys(connected)} />
      <McpServers
        storeSlug={ctx.active.slug}
        isOwner={ctx.active.role === "owner"}
        initialServers={(mcpServerRows ?? []) as McpServerRow[]}
        initialTools={(mcpToolRows ?? []) as McpToolRow[]}
        connectedProviders={Object.keys(connected)}
      />
    </div>
  );
}
