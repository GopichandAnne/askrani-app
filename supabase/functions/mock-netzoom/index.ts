// mock-netzoom — a stand-in for NetZoom's DCIM back-end, to demo the Phase 6
// connector pattern for a data-center-infrastructure-management (DCIM) vendor.
// In production this lives OUTSIDE the platform (NetZoom's own service, wrapping
// their device-library database and their CRM / Service Desk API). Here it proves
// the end-to-end flow with NO core change: the bot POSTs a signed tool call, this
// verifies the HMAC and answers — natural-language device-library search, plus a
// qualified-lead push and a demo request.
//
// One endpoint serves multiple tools (routed by `tool`); each is registered as a
// separate store_integrations row so the model sees them as distinct tools.
// verify_jwt=false — auth is the X-Rani-Signature HMAC.

type Device = {
  vendor: string;
  model: string;
  type: string; // switch | router | server | storage | rack | ups | pdu | firewall
  u: number; // rack units (0 = zero-U / vertical)
  note?: string;
};

// A representative slice of NetZoom's device-shape / stencil library. The real
// library has thousands of models across every major manufacturer; this handful
// is enough to show natural-language lookup working end to end.
const LIBRARY: Device[] = [
  { vendor: "Cisco", model: "Nexus 9336C-FX2", type: "switch", u: 1, note: "36x 100G QSFP28" },
  { vendor: "Cisco", model: "Nexus 93180YC-EX", type: "switch", u: 1, note: "48x 25G + 6x 100G" },
  { vendor: "Cisco", model: "Catalyst 9300-48P", type: "switch", u: 1, note: "48-port PoE+" },
  { vendor: "Cisco", model: "UCS C240 M5", type: "server", u: 2 },
  { vendor: "Dell", model: "PowerEdge R740", type: "server", u: 2 },
  { vendor: "Dell", model: "PowerEdge R640", type: "server", u: 1 },
  { vendor: "Dell EMC", model: "PowerStore 1000T", type: "storage", u: 2 },
  { vendor: "HPE", model: "ProLiant DL380 Gen10", type: "server", u: 2 },
  { vendor: "HPE", model: "ProLiant DL360 Gen10", type: "server", u: 1 },
  { vendor: "HPE Aruba", model: "6300M", type: "switch", u: 1, note: "48-port stackable" },
  { vendor: "Juniper", model: "QFX5120-48Y", type: "switch", u: 1, note: "48x 25G" },
  { vendor: "Juniper", model: "MX204", type: "router", u: 1 },
  { vendor: "Juniper", model: "SRX1500", type: "firewall", u: 1 },
  { vendor: "Arista", model: "7050SX3-48YC8", type: "switch", u: 1 },
  { vendor: "NetApp", model: "FAS8300", type: "storage", u: 4 },
  { vendor: "NetApp", model: "AFF A400", type: "storage", u: 4 },
  { vendor: "Lenovo", model: "ThinkSystem SR650", type: "server", u: 2 },
  { vendor: "Supermicro", model: "SuperServer 6029U-TR4", type: "server", u: 2 },
  { vendor: "APC", model: "NetShelter SX 42U", type: "rack", u: 42, note: "AR3100 enclosure" },
  { vendor: "APC", model: "Smart-UPS SRT 5000VA", type: "ups", u: 3 },
  { vendor: "APC", model: "AP8853 Rack PDU", type: "pdu", u: 0, note: "zero-U metered, vertical" },
  { vendor: "Vertiv", model: "Liebert GXT5 6kVA", type: "ups", u: 5 },
];

const TYPE_WORDS: Record<string, string> = {
  switch: "switch", switches: "switch", router: "router", routers: "router",
  server: "server", servers: "server", storage: "storage", array: "storage",
  rack: "rack", racks: "rack", enclosure: "rack", cabinet: "rack",
  ups: "ups", pdu: "pdu", firewall: "firewall",
};

// Natural-language search over the library. Tolerant: matches vendor, model,
// type, U-height ("2U"), and free keywords — so "cisco nexus", "42U rack",
// "2u dell server", "apc pdu", "storage array" all resolve.
// deno-lint-ignore no-explicit-any
function deviceSearch(a: any) {
  const q = String(a.query ?? "").toLowerCase().trim();
  const vendorHint = String(a.vendor ?? "").toLowerCase().trim();
  const typeHint = String(a.type ?? "").toLowerCase().trim();
  const words = (q + " " + vendorHint + " " + typeHint).split(/[^a-z0-9]+/).filter(Boolean);

  const wantType = words.map((w) => TYPE_WORDS[w]).find(Boolean);
  const uMatch = (q + " " + typeHint).match(/(\d+)\s*u\b/);
  const wantU = uMatch ? Number(uMatch[1]) : null;

  const scored = LIBRARY.map((d) => {
    const hay = `${d.vendor} ${d.model} ${d.type} ${d.note ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (w.length < 2 || TYPE_WORDS[w] || /^\d+u$/.test(w)) continue;
      if (hay.includes(w)) score += w.length >= 4 ? 3 : 2;
    }
    if (wantType && d.type === wantType) score += 3;
    if (wantU != null && d.u === wantU) score += 3;
    return { d, score };
  })
    .filter((x) => x.score > 0 || (wantType && x.d.type === wantType) || (wantU != null && x.d.u === wantU))
    .sort((x, y) => y.score - x.score)
    .slice(0, 6)
    .map((x) => ({
      vendor: x.d.vendor,
      model: x.d.model,
      type: x.d.type,
      rack_units: x.d.u,
      note: x.d.note ?? null,
      in_library: true,
      // Which product tiers include the shape library (all do; SaaS + on-prem).
      available_in: "Enterprise, Professional, and SaaS",
    }));

  return {
    found: scored.length,
    devices: scored,
    note: scored.length
      ? "Matching shapes in the NetZoom device library. The full library covers tens of thousands of models across every major manufacturer and is updated continuously."
      : "No exact match in this demo slice — the full NetZoom library covers tens of thousands of models; the team can add any missing device shape on request.",
  };
}

function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_NETZOOM_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const tool = parsed.tool ?? "";
  const a = parsed.args ?? {};

  switch (tool) {
    case "device_library_search":
      return json(deviceSearch(a));
    case "capture_lead":
      return json({
        ok: true,
        lead_id: id("LEAD"),
        note: "Qualified lead saved to the CRM and routed to a NetZoom solutions engineer, who will follow up.",
      });
    case "book_demo":
      return json({
        ok: true,
        demo_id: id("DEMO"),
        note: `Demo request logged for ${a.preferred_time ?? "the requested time"} — a solutions engineer will confirm a slot by email.`,
      });
    default:
      return json({ error: `unknown tool: ${tool}` }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
