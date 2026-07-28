"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, patchSquareCreds, disconnectSquare } from "@/lib/square/credentials";
import { listLocations, type SquareLocation } from "@/lib/square/oauth";

type Result = { ok: true } | { ok: false; error: string };

/** Owner guard for the active store. */
async function requireOwner(): Promise<{ storeId: string } | { error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { error: "Only owners can manage the Square connection." };
  return { storeId: ctx.active.id };
}

/** List the connected merchant's Square locations, so the owner can choose which
 *  one orders route to. */
export async function listSquareLocations(): Promise<SquareLocation[]> {
  const gate = await requireOwner();
  if ("error" in gate) return [];
  try {
    const { accessToken } = await getValidAccessToken(gate.storeId);
    return await listLocations(accessToken);
  } catch {
    return [];
  }
}

export async function setSquareLocation(locationId: string, locationName: string): Promise<Result> {
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  await patchSquareCreds(gate.storeId, { location_id: locationId, location_name: locationName });
  revalidatePath("/diner");
  return { ok: true };
}

export async function disconnectSquareAction(): Promise<Result> {
  const gate = await requireOwner();
  if ("error" in gate) return { ok: false, error: gate.error };
  await disconnectSquare(gate.storeId);
  revalidatePath("/diner");
  return { ok: true };
}
