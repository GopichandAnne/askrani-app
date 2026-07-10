"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type LinkResult =
  | {
      ok: true;
      token: string;
      active: boolean;
      paused: boolean;
      waNumber: string | null;
      waRedirect: boolean;
      sessionMinutes: number;
      logoUrl: string | null;
      chips: string;
      businessType: string | null;
    }
  | { ok: false; error: string };

export type TokenResult =
  | { ok: true; token: string; active: boolean }
  | { ok: false; error: string };

/** Owner of the store OR a platform admin may manage its link. */
async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
}

function newToken(): string {
  return "tok_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Current link token for a store (latest); creates one if none exists yet. */
export async function getStoreLink(storeId: string): Promise<LinkResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  const [{ data: existing }, { data: store }, { data: chipsRow }] = await Promise.all([
    db
      .from("store_tokens")
      .select("token, active")
      .eq("store_id", storeId)
      .is("listing_ref", null) // the primary web QR — listing tokens are managed separately
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("stores")
      .select("web_chat_paused, whatsapp_display_number, whatsapp_redirect_enabled, session_minutes, logo_url, business_type")
      .eq("id", storeId)
      .single(),
    db
      .from("agent_config")
      .select("value")
      .eq("store_id", storeId)
      .eq("key", "suggestion_chips")
      .maybeSingle(),
  ]);
  const paused = !!store?.web_chat_paused;
  const waNumber = store?.whatsapp_display_number ?? null;
  const waRedirect = !!store?.whatsapp_redirect_enabled;
  const sessionMinutes = store?.session_minutes ?? 30;
  const logoUrl = store?.logo_url ?? null;
  const chips = chipsRow?.value ?? "";
  const businessType = store?.business_type ?? null;

  if (existing && existing.length > 0) {
    return {
      ok: true,
      token: existing[0].token,
      active: existing[0].active,
      paused,
      waNumber,
      waRedirect,
      sessionMinutes,
      logoUrl,
      chips,
      businessType,
    };
  }

  const token = newToken();
  const { error } = await db
    .from("store_tokens")
    .insert({ store_id: storeId, token, label: "primary QR", active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, active: true, paused, waNumber, waRedirect, sessionMinutes, logoUrl, chips, businessType };
}

/** AI-compose starter question tiles from the store's own prompts + KB. */
export async function generateChips(
  storeId: string,
): Promise<{ ok: true; chips: string[] } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { data: s } = await db.from("stores").select("slug").eq("id", storeId).single();
  if (!s) return { ok: false, error: "Store not found." };
  const res = await callBotAdmin({ action: "suggest_chips", store_slug: s.slug });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, chips: (res.data.chips as string[]) ?? [] };
}

/** Save the store's starter questions (newline-separated; first 3 show in chat). */
export async function saveChips(
  storeId: string,
  chips: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const value = chips
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("\n");
  const { error } = await db
    .from("agent_config")
    .upsert({ store_id: storeId, key: "suggestion_chips", value }, { onConflict: "store_id,key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Upload (or replace) the store's chat logo — owners/admin only. */
export async function setStoreLogo(
  storeId: string,
  formData: FormData,
): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pick an image to upload." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Please upload an image (PNG, JPG, SVG, or WebP)." };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "Image too large (max 2 MB)." };

  const db = createAdminClient();
  const { data: s } = await db.from("stores").select("slug").eq("id", storeId).single();
  const slug = s?.slug ?? storeId;
  const path = `${slug}/logo`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await db.storage
    .from("branding")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { data: pub } = db.storage.from("branding").getPublicUrl(path);
  const logoUrl = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust so re-uploads show
  const { error } = await db.from("stores").update({ logo_url: logoUrl }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, logoUrl };
}

/** Remove the store's chat logo (revert to the default Rani avatar). */
export async function removeStoreLogo(
  storeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ logo_url: null }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  const { data: s } = await db.from("stores").select("slug").eq("id", storeId).single();
  if (s?.slug) await db.storage.from("branding").remove([`${s.slug}/logo`]); // best-effort
  return { ok: true };
}

/** Set how long a web chat visitor session lasts (minutes). */
export async function setSessionMinutes(
  storeId: string,
  minutes: number,
): Promise<{ ok: true; sessionMinutes: number } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 5 || m > 1440) {
    return { ok: false, error: "Choose a timeout between 5 minutes and 24 hours." };
  }
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ session_minutes: m }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessionMinutes: m };
}

/** Set (or clear) the store's public WhatsApp number for the wa.me redirect. */
export async function setWhatsappNumber(
  storeId: string,
  numberRaw: string,
): Promise<{ ok: true; waNumber: string | null } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const trimmed = numberRaw.trim();
  // Keep a leading + and digits only; empty clears it.
  const cleaned = trimmed ? "+" + trimmed.replace(/[^0-9]/g, "") : null;
  if (cleaned && cleaned.replace(/[^0-9]/g, "").length < 8) {
    return { ok: false, error: "Enter a full number with country code, e.g. +15551234567." };
  }
  const db = createAdminClient();
  const patch: { whatsapp_display_number: string | null; whatsapp_redirect_enabled?: boolean } = {
    whatsapp_display_number: cleaned,
  };
  if (!cleaned) patch.whatsapp_redirect_enabled = false; // no number -> redirect off
  const { error } = await db.from("stores").update(patch).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, waNumber: cleaned };
}

/** Turn the public "QR redirects to WhatsApp" switch on or off. */
export async function setWhatsappRedirect(
  storeId: string,
  enabled: boolean,
): Promise<{ ok: true; waRedirect: boolean } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  if (enabled) {
    const { data: s } = await db
      .from("stores")
      .select("whatsapp_display_number")
      .eq("id", storeId)
      .single();
    if (!s?.whatsapp_display_number) {
      return { ok: false, error: "Add a WhatsApp number first, then enable the redirect." };
    }
  }
  const { error } = await db.from("stores").update({ whatsapp_redirect_enabled: enabled }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, waRedirect: enabled };
}

/** Put the store's web chat into (or out of) "Rani is taking a break" mode. */
export async function setWebChatPaused(
  storeId: string,
  paused: boolean,
): Promise<{ ok: true; paused: boolean } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ web_chat_paused: paused }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, paused };
}

/** Enable / disable the store's current link token. */
export async function setLinkActive(storeId: string, active: boolean): Promise<TokenResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  const { data: existing } = await db
    .from("store_tokens")
    .select("id, token")
    .eq("store_id", storeId)
    .is("listing_ref", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!existing || existing.length === 0) return { ok: false, error: "No link to update." };

  const { error } = await db.from("store_tokens").update({ active }).eq("id", existing[0].id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, token: existing[0].token, active };
}

/** Issue a fresh link and retire all previous tokens (use if a QR leaks). */
export async function regenerateLink(storeId: string): Promise<TokenResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  // Retire only the primary web QR(s) — listing "yard sign" tokens are untouched.
  await db
    .from("store_tokens")
    .update({ active: false })
    .eq("store_id", storeId)
    .eq("active", true)
    .is("listing_ref", null);
  const token = newToken();
  const { error } = await db
    .from("store_tokens")
    .insert({ store_id: storeId, token, label: "primary QR", active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, active: true };
}

// ── Listing-scoped tokens ("smart yard signs") ──────────────────────────────
// One store mints many listing QRs; each launches the chat primed on that home
// but stays open to other listings. Managed separately from the primary QR.

export type ListingToken = { token: string; listingRef: string; active: boolean };

/** All listing-scoped tokens for a store, newest first. */
export async function listListingTokens(
  storeId: string,
): Promise<{ ok: true; tokens: ListingToken[] } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { data, error } = await db
    .from("store_tokens")
    .select("token, listing_ref, active")
    .eq("store_id", storeId)
    .not("listing_ref", "is", null)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    tokens: (data ?? []).map((r) => ({
      token: r.token,
      listingRef: (r.listing_ref as string) ?? "",
      active: r.active,
    })),
  };
}

/** Create a listing-scoped QR. Chips default from the listing if none given. */
export async function createListingToken(
  storeId: string,
  input: { listingRef: string; listingContext: string; listingChips?: string },
): Promise<{ ok: true; token: ListingToken } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const listingRef = input.listingRef.trim();
  const listingContext = input.listingContext.trim();
  if (!listingRef) return { ok: false, error: "Enter the listing address or MLS number." };
  if (listingContext.length < 20) {
    return { ok: false, error: "Add a short description of the listing (a sentence or two)." };
  }
  const chipLines = (input.listingChips ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  const listingChips = (chipLines.length
    ? chipLines
    : [`Is ${listingRef} still available?`, `Book a tour of ${listingRef}`, "Show me other homes"]
  ).join("\n");

  const db = createAdminClient();
  const token = "lst_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const { error } = await db.from("store_tokens").insert({
    store_id: storeId,
    token,
    label: `Listing: ${listingRef}`.slice(0, 120),
    active: true,
    listing_ref: listingRef,
    listing_context: listingContext,
    listing_chips: listingChips,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token: { token, listingRef, active: true } };
}

/** Enable/disable one listing token (e.g. turn it off when the home sells). */
export async function setListingTokenActive(
  storeId: string,
  token: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { error } = await db
    .from("store_tokens")
    .update({ active })
    .eq("store_id", storeId)
    .eq("token", token)
    .not("listing_ref", "is", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
