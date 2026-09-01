// Runs the real MCP client (mcp.ts) against a mock Streamable-HTTP MCP server:
//   deno test --allow-net supabase/functions/_shared/mcp.test.ts
// Exercises the handshake (initialize + session header + initialized), tools/list
// over a JSON reply, and tools/call over an SSE reply.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { mcpListTools, executeMcpTool, type McpServer } from "./mcp.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

function mockServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    let seenInitialized = false;
    const ac = new AbortController();
    const server = Deno.serve({ port: 0, signal: ac.signal, onListen: ({ port }) => {
      resolve({ url: `http://localhost:${port}/mcp`, stop: async () => { ac.abort(); await server.finished; } });
    } }, async (req) => {
      const body = await req.json();
      const { method, id, params } = body;
      const J = (obj: Any) => new Response(JSON.stringify({ jsonrpc: "2.0", id, ...obj }), { headers: { "content-type": "application/json" } });
      if (method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "1" } } }),
          { headers: { "content-type": "application/json", "mcp-session-id": "sess-123" } });
      }
      if (method === "notifications/initialized") {
        // must carry the session id the server handed back
        assertEquals(req.headers.get("mcp-session-id"), "sess-123");
        seenInitialized = true;
        return new Response(null, { status: 202 });
      }
      if (method === "tools/list") {
        assert(seenInitialized, "tools/list arrived before initialized notification");
        return J({ result: { tools: [
          { name: "echo", description: "Echo a message", inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } },
          { name: "create_thing", description: "Create a thing", inputSchema: { type: "object", properties: { n: { type: "string" } } } },
        ] } });
      }
      if (method === "tools/call") {
        const text = params.name === "echo" ? `echo: ${params.arguments.msg}` : "created";
        // Reply as SSE to exercise the event-stream parser.
        const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } })}\n\n`;
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      }
      return J({ error: { code: -32601, message: "method not found" } });
    });
  });
}

const DB: Any = {}; // never touched for auth.type="none"
const STORE: Any = { id: "store-1" };

Deno.test("mcp client: discover tools over JSON handshake", async () => {
  const { url, stop } = await mockServer();
  try {
    const server: McpServer = { id: "s1", store_id: "store-1", name: "Mock", url, auth: { type: "none" }, api_key: null, enabled: true };
    const res = await mcpListTools(DB, "store-1", server);
    assert(res.ok, "listTools should succeed");
    if (res.ok) {
      assertEquals(res.tools.map((t) => t.name).sort(), ["create_thing", "echo"]);
      assertEquals(res.tools.find((t) => t.name === "echo")?.inputSchema.required, ["msg"]);
    }
  } finally { await stop(); }
});

Deno.test("mcp client: call a tool over an SSE reply", async () => {
  const { url, stop } = await mockServer();
  try {
    const server: McpServer = { id: "s1", store_id: "store-1", name: "Mock", url, auth: { type: "none" }, api_key: null, enabled: true };
    const tool = { id: "t1", name: "mcp_mock_echo", remote_name: "echo", description: "Echo", input_schema: {}, side_effect: false, server };
    const out = await executeMcpTool(DB, STORE, tool, { msg: "hi there" });
    assertEquals(out, { result: "echo: hi there" });
  } finally { await stop(); }
});

Deno.test("mcp client: a server that returns an error surfaces a soft note", async () => {
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } }), { headers: { "content-type": "application/json" } }));
  const addr = server.addr as Deno.NetAddr;
  try {
    const srv: McpServer = { id: "s1", store_id: "store-1", name: "Bad", url: `http://localhost:${addr.port}/mcp`, auth: { type: "none" }, api_key: null, enabled: true };
    const res = await mcpListTools(DB, "store-1", srv);
    assertEquals(res.ok, false);
  } finally { ac.abort(); await server.finished; }
});
