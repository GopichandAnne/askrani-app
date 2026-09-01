import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { ShieldCheck, UserCheck, Store as StoreIcon } from "lucide-react";

export const metadata: Metadata = { title: "Activity · Ask Rani" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  ts: string;
  tool: string;
  kind: string;
  acted_as: string | null;
  side_effect: boolean;
  status: string;
};

/**
 * The trust surface for agentic tool-use: exactly what Rani did through a
 * connected tool, and WHO it acted as. This is the answer to "what did the agent
 * do as this user?" — the make-or-break question for delegated-identity actions.
 */
export default async function ActivityPage() {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");
  if (!ctx.active) redirect("/welcome");
  const store = ctx.active;
  const isOwner = ctx.isPlatformAdmin || store.role === "owner";
  if (!isOwner) redirect(homeHrefFor(profileFor(store.businessType)));

  const db = createAdminClient();
  const { data } = await db
    .from("agent_action_log")
    .select("id, ts, tool, kind, acted_as, side_effect, status")
    .eq("store_id", store.id)
    .order("ts", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  const total = rows.length;
  const asCustomer = rows.filter((r) => r.acted_as).length;
  const writes = rows.filter((r) => r.side_effect).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Activity</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — every action Rani took through a connected tool.
        </p>
      </header>

      <div className="bg-card flex items-start gap-3 rounded-lg border p-4">
        <ShieldCheck className="text-teal-deep mt-0.5 size-5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">You can see exactly what the agent did — and who it acted as.</p>
          <p className="text-muted-foreground mt-1">
            When a tool acts as a signed-in customer, it forwards only that customer&apos;s verified identity —
            Rani (and the model) never see your credentials or their token. Reads and writes are labeled; writes
            require the customer&apos;s confirmation first.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Actions logged" value={total} />
        <Stat label="As a signed-in customer" value={asCustomer} />
        <Stat label="Writes (actions taken)" value={writes} />
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No tool actions yet. Once Rani calls a connected API or MCP tool in a chat, every call shows here.
        </p>
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-[11px] font-mono uppercase tracking-wide">
                <th className="p-3 font-semibold">When</th>
                <th className="p-3 font-semibold">Tool</th>
                <th className="p-3 font-semibold">Acted as</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="text-muted-foreground whitespace-nowrap p-3 tabular-nums">{fmt(r.ts)}</td>
                  <td className="p-3"><span className="font-mono text-[13px]">{r.tool}</span> <span className="text-muted-foreground text-xs">· {r.kind}</span></td>
                  <td className="p-3">
                    {r.acted_as ? (
                      <span className="text-teal-deep inline-flex items-center gap-1"><UserCheck className="size-3.5" /> {r.acted_as}</span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1"><StoreIcon className="size-3.5" /> the store</span>
                    )}
                  </td>
                  <td className="p-3">
                    {r.side_effect
                      ? <span className="text-amber-600 text-xs font-medium">action (write)</span>
                      : <span className="text-muted-foreground text-xs">read</span>}
                  </td>
                  <td className="p-3">
                    {r.status === "ok"
                      ? <span className="text-teal-deep text-xs font-medium">ok</span>
                      : <span className="text-destructive text-xs font-medium">failed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="font-display text-teal-deep dark:text-teal-light mt-1 text-3xl italic tabular-nums">{value}</p>
    </div>
  );
}

function fmt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
