// Generic "requests" capability — the store-agnostic replacement for any
// bespoke lead/intake flow. A store defines REQUEST TYPES (request_types); the
// bot exposes one built-in `file_request` tool whose available types + fields
// come from that config, so nothing here is use-case-specific. A filed request
// lands in `requests` and notifies whoever subscribed to that type's topic.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { FunctionDeclaration } from "./tools.ts";
import { notifyResponders } from "./responders.ts";

const PANEL_URL = "https://app.askrani.ai";

export interface RequestField {
  key: string;
  label?: string;
  required?: boolean;
}

export interface RequestType {
  id: string;
  key: string; // machine key = notification topic
  label: string;
  description: string | null;
  fields: RequestField[];
  enabled: boolean;
}

/** Enabled request types a store has defined (empty → the tool isn't offered). */
export async function loadRequestTypes(
  db: SupabaseClient,
  storeId: string,
): Promise<RequestType[]> {
  const { data } = await db
    .from("request_types")
    .select("id, key, label, description, fields, enabled")
    .eq("store_id", storeId)
    .eq("enabled", true)
    .order("label");
  return (data ?? []) as RequestType[];
}

/** Build the file_request declaration dynamically from the store's request types. */
export function fileRequestDeclaration(types: RequestType[]): FunctionDeclaration {
  const list = types
    .map((rt) => {
      const flds = (rt.fields ?? [])
        .map((f) => (f.required === false ? f.key : `${f.key}*`))
        .join(", ");
      return `• "${rt.key}" (${rt.label})${rt.description ? " — " + rt.description : ""}${
        flds ? `. Collect: ${flds}` : ""
      }`;
    })
    .join("\n");
  return {
    name: "file_request",
    description:
      "File a structured request for the store team to follow up on (a lead, an " +
      "enquiry, a booking, a callback…). Only call this AFTER you have collected " +
      "the required details (marked *) and the visitor has confirmed. Put the " +
      'collected values in `fields` as a compact JSON object (e.g. {"positions":' +
      '"Backend Engineer","skills":"Java, AWS"}) and include their email if the ' +
      "request needs a reply.\nAvailable request types for this store:\n" + list,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: types.map((rt) => rt.key),
          description: "which request type to file",
        },
        fields: {
          type: "string",
          description: "the collected values as a compact JSON object, keys as listed for the type",
        },
        email: { type: "string", description: "contact email so the team can reach back" },
        phone: { type: "string", description: "contact phone, if the visitor gave one" },
      },
      required: ["type", "fields"],
    },
  };
}

function parseFields(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") return o as Record<string, unknown>;
    } catch {
      return { details: raw.trim() };
    }
  }
  return {};
}

function fieldLine(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(", ") : String(v ?? "").trim();
}

/** Execute file_request: validate the type, store the request, notify subscribers. */
export async function executeFileRequest(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  types: RequestType[],
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = String(args.type ?? "").trim();
  const rt = types.find((t) => t.key === key && t.enabled);
  if (!rt) return { filed: false, reason: `unknown request type: ${key || "(none)"}` };

  const fields = parseFields(args.fields);
  const email = args.email ? String(args.email).trim() : null;
  const phone = args.phone ? String(args.phone).trim() : null;

  const orgName = store.store_display_name ?? store.slug;

  // Idempotency: the model sometimes calls file_request on the info turn AND
  // again on the confirm turn. Collapse repeats of the same type within the same
  // session to one row (and skip the duplicate notification).
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: existing } = await db
      .from("requests")
      .select("id")
      .eq("store_id", store.id)
      .eq("type", rt.key)
      .eq("session_id", sessionId)
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        filed: true,
        reference: existing.id,
        message: `Your ${rt.label.toLowerCase()} is already with the team — they'll follow up.`,
      };
    }
  } catch { /* best-effort dedup — fall through to insert */ }

  const { data: inserted, error } = await db
    .from("requests")
    .insert({
      store_id: store.id,
      type: rt.key,
      fields,
      contact_email: email,
      contact_phone: phone,
      session_id: sessionId,
    })
    .select("id")
    .single();
  if (error) {
    console.error(`[requests] insert: ${error.message}`);
    return { filed: false, reason: "could not file the request" };
  }

  // Notify whoever subscribed to this request type's topic (WhatsApp + email).
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${fieldLine(v)}`);
  const contact = [email && `email: ${email}`, phone && `phone: ${phone}`].filter(Boolean).join("   ");
  const summary = [`New ${rt.label} — ${orgName}`, "", ...lines, contact].filter(Boolean).join("\n");
  try {
    await notifyResponders(db, store, rt.key, summary, {
      subject: `New ${rt.label} — ${orgName}`,
      emailBody: `${summary}\n\nReview and reach back: ${PANEL_URL}/requests`,
    });
  } catch (e) {
    console.error(`[requests] notify: ${e instanceof Error ? e.message : e}`);
  }

  return {
    filed: true,
    reference: inserted.id,
    message: `Your ${rt.label.toLowerCase()} has been shared with the team — they'll follow up.`,
  };
}
