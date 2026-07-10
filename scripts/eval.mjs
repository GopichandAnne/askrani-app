// Conversation eval harness — guards against silent behavior regressions.
//
// Runs a set of real conversations against the DEPLOYED web-chat and asserts the
// properties we care about: grounding (right KB facts), no hallucination on
// compound questions, language mirroring, request-mode price safety, and staying
// on-topic. Deterministic-ish checks only (tool usage + grounded keywords +
// script detection + price-absence), so passes/fails are meaningful.
//
//   Run:  node scripts/eval.mjs
//   CI:   exits non-zero if any case fails.
//
// Reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from the environment or ../.env.local
// (handles the UTF-16 .env.local this repo uses on Windows).

import { readFileSync } from "node:fs";

function loadEnv() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    try {
      const buf = readFileSync(new URL("../.env.local", import.meta.url));
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/);
        if (!m) continue;
        const k = m[1];
        const v = m[2].trim().replace(/^["']|["']$/g, "");
        if (k === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
        if (k === "NEXT_PUBLIC_SUPABASE_ANON_KEY") anon ||= v;
      }
    } catch { /* ignore */ }
  }
  return { url, anon };
}

// ── expectation helpers: each returns { label, test(reply, tools) } ───────────
const tool = (name) => ({ label: `calls ${name}`, test: (_r, tools) => tools.includes(name) });
const includes = (re) => ({ label: `matches ${re}`, test: (r) => re.test(r) });
const excludes = (re) => ({ label: `does NOT match ${re}`, test: (r) => !re.test(r) });
const noDevanagari = () => ({ label: "reply is not in Devanagari", test: (r) => !/[ऀ-ॿ]/.test(r) });

const G = { slug: "demo-grocery", token: "demogrocerylive" };
const R = { slug: "demo-rental", token: "demorentallive" };

const CASES = [
  {
    name: "grounding — rice aisle from KB",
    store: G,
    turns: [{ msg: "where is the rice?", expect: [tool("search_knowledge"), includes(/aisle\s*2/i)] }],
  },
  {
    name: "no hallucination — compound wifi + coffee",
    store: R,
    turns: [{
      msg: "hi! what's the wifi password and any good coffee nearby?",
      expect: [includes(/welcome2stay/i), includes(/morning bean/i)],
    }],
  },
  {
    name: "language — English reply after a Devanagari turn",
    store: G,
    turns: [
      { msg: "नमस्ते, आप कब तक खुले हैं?", expect: [] },
      { msg: "what time do you close today?", expect: [noDevanagari()] },
    ],
  },
  {
    name: "price safety — request mode never quotes a price",
    store: G,
    turns: [{
      msg: "how much is basmati rice?",
      expect: [excludes(/\$\s?\d|\b\d+\s?(rupees|rs|dollars|usd)\b/i)],
    }],
  },
  {
    name: "on-topic — declines general trivia",
    store: G,
    turns: [{ msg: "what is the capital of France?", expect: [excludes(/\bparis\b/i)] }],
  },
];

async function turn(env, store, sessionId, msg) {
  const res = await fetch(`${env.url}/functions/v1/web-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.anon, Authorization: `Bearer ${env.anon}` },
    body: JSON.stringify({ slug: store.slug, token: store.token, session_id: sessionId, message: msg }),
  });
  const data = await res.json();
  const replies = Array.isArray(data.replies) ? data.replies.map((b) => b.text) : [data.reply ?? ""];
  return { text: replies.join(" ⏎ "), tools: data.toolsUsed ?? [] };
}

async function main() {
  const env = loadEnv();
  if (!env.url || !env.anon) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (env or ../.env.local).");
    process.exit(2);
  }

  let failures = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const session = `web_eval_${i}_${Math.random().toString(36).slice(2, 8)}`;
    const problems = [];
    let lastText = "";
    try {
      for (const t of c.turns) {
        const { text, tools } = await turn(env, c.store, session, t.msg);
        lastText = text;
        for (const e of t.expect) {
          if (!e.test(text, tools)) problems.push(`${e.label}  (got: ${text.slice(0, 120)})`);
        }
      }
    } catch (e) {
      problems.push(`request error: ${e?.message ?? e}`);
    }
    if (problems.length === 0) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failures++;
      console.log(`  FAIL  ${c.name}`);
      for (const p of problems) console.log(`          - ${p}`);
    }
  }

  console.log(`\n${CASES.length - failures}/${CASES.length} passed.`);
  process.exit(failures ? 1 : 0);
}

main();
