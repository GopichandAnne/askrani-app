"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, getPosCreds, savePosCreds, patchPosCreds, disconnectPos } from "@/lib/pos/credentials";
import { getAdapter, isPosProvider } from "@/lib/pos/registry";
import { syncCatalog } from "@/lib/pos/mapping";
import type { PosLocation, PosProviderId } from "@/lib/pos/types";

type Result = { ok: true } | { ok: false; error: string };

/** Owner guard for the active store. */
async function requireOwner(): Promise<{ storeId: string } | { error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { error: "Only owners can manage POS connections." };
  return { storeId: ctx.active.id };
}

/** List a connected POS provider's locations so the owner can pick where orders route. */
export async function listPosLocations(provider: string): Promise<PosLocation[]> {
  if (!isPosProvider(provider)) return [];
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const adapter = getAdapter(provider);
  if (!adapter) return [];
  try {
    const { accessToken, creds } = await getValidAccessToken(provider as PosProviderId, gate.storeId);
    return await adapter.listLocations(accessToken, creds);
  } catch {
    return [];
  }
}

export async function setPosLocation(
  provider: string,
  locationId: string,
  locationName: string,
): Promise<Result> {
  if (!isPosProvider(provider)) return { ok: false, error: "Unknown POS provider." };
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  await patchPosCreds(provider as PosProviderId, gate.storeId, {
    location_id: locationId,
    location_name: locationName,
  });
  revalidatePath("/diner");
  return { ok: true };
}

/** Connect a "manual" provider (e.g. Toast) from the owner's entered fields. */
export async function connectPosManual(provider: string, input: Record<string, string>): Promise<Result> {
  if (!isPosProvider(provider)) return { ok: false, error: "Unknown POS provider." };
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  const adapter = getAdapter(provider);
  if (!adapter?.connectManual) return { ok: false, error: "This provider isn't connected manually." };
  const res = adapter.connectManual(input);
  if ("error" in res) return { ok: false, error: res.error };
  await savePosCreds(provider as PosProviderId, gate.storeId, res.creds);
  revalidatePath("/diner");
  return { ok: true };
}

/** Save provider-specific config (creds.extra) after connecting — e.g.
 *  Lightspeed's business-location / webhook / open-item ids. */
export async function setPosConfig(provider: string, input: Record<string, string>): Promise<Result> {
  if (!isPosProvider(provider)) return { ok: false, error: "Unknown POS provider." };
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  const cur = await getPosCreds(provider as PosProviderId, gate.storeId);
  if (!cur) return { ok: false, error: "Connect the provider first." };
  const extra = { ...(cur.extra ?? {}) };
  for (const [k, v] of Object.entries(input)) {
    const t = (v ?? "").trim();
    if (t) extra[k] = t;
    else delete extra[k];
  }
  await patchPosCreds(provider as PosProviderId, gate.storeId, { extra });
  revalidatePath("/diner");
  return { ok: true };
}

/** Auto-map our menu to the POS catalog by name. Returns a summary for a toast. */
export async function syncPosCatalog(
  provider: string,
): Promise<{ ok: true; mapped: number; products: number } | { ok: false; error: string }> {
  if (!isPosProvider(provider)) return { ok: false, error: "Unknown POS provider." };
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  const res = await syncCatalog(provider as PosProviderId, gate.storeId);
  if (!res.ok) return res;
  revalidatePath("/diner");
  return { ok: true, mapped: res.mapped, products: res.products };
}

export async function disconnectPosAction(provider: string): Promise<Result> {
  if (!isPosProvider(provider)) return { ok: false, error: "Unknown POS provider." };
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  await disconnectPos(provider as PosProviderId, gate.storeId);
  revalidatePath("/diner");
  return { ok: true };
}

/** Whether a provider is currently connected for the active store (used by the page). */
export async function isPosConnected(provider: PosProviderId, storeId: string): Promise<boolean> {
  return !!(await getPosCreds(provider, storeId));
}
