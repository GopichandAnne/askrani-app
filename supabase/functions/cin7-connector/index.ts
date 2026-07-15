// cin7-connector — reference inventory/ERP connector for the wholesale demo.
//
// Ludicrous Distro runs their B2B catalog on Cin7. The catalogue in Rani holds
// the products + list pricing; Cin7 holds the things that move: live on-hand
// stock, account-specific pricing, order fulfilment status and A/R.
//
// This function demonstrates that path WITHOUT any core change: the bot calls
// these tools, this returns mock results shaped like Cin7's. A real deploy swaps
// the internals for Cin7 Omni API calls (the store owner sets their own Cin7 API
// key as CIN7_API_KEY — we never handle their credentials) and everything above
// it — prompts, tools, routing — stays exactly as-is.
//
// HMAC-signed like every other connector; register per-store via bot-admin
// set_integration. CIN7_SECRET must match the store_integrations auth_secret.

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

/** Stable pseudo-random per key, so the same SKU reports the same stock all day. */
function hash(seed: string): number {
  let h = 7;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Fixed "today" arithmetic for ETAs — a real connector reads Cin7's PO dates. */
function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// SKUs the demo catalogue marks out of stock — Cin7 is the source of truth for
// what's actually on the shelf, and for what's on the way.
const BACKORDERED = new Set(["GRAV-OWP"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("CIN7_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown>; store_slug?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const a = parsed.args ?? {};

  switch (parsed.tool ?? "") {
    // Live on-hand stock for a SKU. The catalogue's in_stock flag is a static
    // owner setting; this is what the warehouse actually has right now.
    case "check_stock": {
      const sku = String(a.sku ?? "").trim().toUpperCase();
      if (!sku) {
        return json({ found: false, note: "Use search_products first to get the exact SKU." });
      }
      if (BACKORDERED.has(sku)) {
        const qty = 24 + (hash(sku) % 40);
        return json({
          found: true,
          sku,
          on_hand: 0,
          available: 0,
          warehouse: "Austin, TX",
          backordered: true,
          incoming_qty: qty,
          incoming_eta: inDays(7),
          // Don't imply the bot can reserve stock — there is no tool for that,
          // and it would promise something nothing downstream honours.
          note: `Out of stock in Austin. ${qty} units are on a PO landing ${inDays(7)}. A rep can hold units from that PO if they ask.`,
        });
      }
      const h = hash(sku);
      const onHand = 12 + (h % 240);
      const allocated = h % 9;
      return json({
        found: true,
        sku,
        on_hand: onHand,
        available: onHand - allocated,
        allocated,
        warehouse: "Austin, TX",
        backordered: false,
        note: allocated > 0
          ? `${onHand} on hand, ${allocated} already allocated to other orders.`
          : `${onHand} on hand and unallocated.`,
      });
    }

    // Where's my order — the single most common inbound call to a distributor.
    case "order_status": {
      const ref = String(a.order_ref ?? "").trim().toUpperCase();
      if (!ref) return json({ found: false, note: "Ask which order number they mean (e.g. LD-2026-0002)." });
      const stages = [
        { status: "Awaiting pick", note: "In the queue at the Austin warehouse.", tracking: null, eta: inDays(3) },
        { status: "Picking", note: "Being picked now.", tracking: null, eta: inDays(2) },
        { status: "Packed", note: "Packed and staged for the next run.", tracking: null, eta: inDays(1) },
        { status: "Shipped", note: "On the truck.", tracking: "1Z999AA1" + (hash(ref) % 10000000), eta: inDays(1) },
      ];
      const s = stages[hash(ref) % stages.length];
      return json({
        found: true,
        order_ref: ref,
        status: s.status,
        carrier: s.tracking ? "UPS Ground" : null,
        tracking: s.tracking,
        eta: s.eta,
        note: s.note,
      });
    }

    // Terms / balance / open invoices — a real B2B account question.
    case "account_summary": {
      const who = String(a.email ?? a.account_number ?? "").trim();
      if (!who) return json({ found: false, note: "Only available to a verified wholesale account." });
      const h = hash(who.toLowerCase());
      const balance = Number(((h % 480000) / 100).toFixed(2));
      const open = 1 + (h % 3);
      return json({
        found: true,
        account: who,
        terms: "Net 15",
        credit_limit: 10000,
        balance_due: balance,
        available_credit: Number((10000 - balance).toFixed(2)),
        open_invoices: open,
        oldest_invoice_due: inDays(-(h % 12)),
        note: `${open} open invoice(s), $${balance} due. A rep can email copies.`,
      });
    }

    default:
      return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
});
