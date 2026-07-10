"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
import type { Integration, JsonSchema } from "@/lib/integrations/types";

export type Result = { ok: true } | { ok: false; error: string };

async function requireOwner(): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage integrations." };
  return { ok: true, slug: ctx.active.slug };
}

export async function listIntegrations(): Promise<Integration[]> {
  const gate = await requireOwner();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_integrations", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.integrations as Integration[]) ?? [];
}

export type SaveInput = {
  name: string;
  description: string;
  endpoint_url: string;
  params_schema: JsonSchema;
  auth_secret?: string; // blank on edit = keep existing
  side_effect: boolean;
  enabled: boolean;
  timeout_ms: number;
};

export async function saveIntegration(input: SaveInput): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const name = input.name.trim();
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(name)) {
    return {
      ok: false,
      error: "Name must be lowercase letters/numbers/underscores (e.g. pos_price_lookup).",
    };
  }
  if (!input.description.trim()) return { ok: false, error: "A description is required — it's how Rani knows when to use it." };
  try {
    new URL(input.endpoint_url);
  } catch {
    return { ok: false, error: "Enter a valid https:// endpoint URL." };
  }

  const res = await callBotAdmin({
    action: "set_integration",
    store_slug: gate.slug,
    name,
    description: input.description.trim(),
    endpoint_url: input.endpoint_url.trim(),
    params_schema: input.params_schema,
    auth_secret: input.auth_secret?.trim() || undefined, // undefined = keep existing
    side_effect: input.side_effect,
    enabled: input.enabled,
    timeout_ms: input.timeout_ms,
  });
  if (!res.ok) return res;
  revalidatePath("/integrations");
  return { ok: true };
}

export async function deleteIntegration(name: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "delete_integration", store_slug: gate.slug, name });
  if (!res.ok) return res;
  revalidatePath("/integrations");
  return { ok: true };
}

export type TestResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export async function testIntegration(
  name: string,
  args: Record<string, unknown>,
): Promise<TestResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "test_integration", store_slug: gate.slug, name, args });
  if (!res.ok) return res;
  return { ok: true, result: res.data.result };
}
