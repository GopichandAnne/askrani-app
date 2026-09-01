"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plug, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { MCP_CATALOG, type McpCatalogEntry } from "./mcp-catalog";

export type McpServerRow = { id: string; name: string; url: string; auth: { type?: string; provider?: string } | null; enabled: boolean };
export type McpToolRow = { id: string; server_id: string; name: string; remote_name: string; description: string; side_effect: boolean; enabled: boolean; action_policy?: string };

export function McpServers({
  storeSlug,
  isOwner,
  initialServers,
  initialTools,
  connectedProviders,
}: {
  storeSlug: string;
  isOwner: boolean;
  initialServers: McpServerRow[];
  initialTools: McpToolRow[];
  connectedProviders: string[];
}) {
  const supabase = createClient();
  const [servers, setServers] = useState<McpServerRow[]>(initialServers);
  const [tools, setTools] = useState<McpToolRow[]>(initialTools);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState(connectedProviders[0] ?? "");
  const [identityClaim, setIdentityClaim] = useState("token");
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  if (!isOwner) return null;

  const connectedUrls = new Set(servers.map((s) => s.url));

  async function connectFromCatalog(entry: McpCatalogEntry) {
    // No-auth servers connect in one click; auth ones pre-fill the manual form.
    if (entry.authType !== "none") {
      setName(entry.name);
      setUrl(entry.url);
      setAuthType(entry.authType);
      toast.info(`Finish connecting ${entry.name}`, { description: "Add the auth below, then Connect." });
      return;
    }
    setAddingId(entry.id);
    const { data, error } = await supabase.functions.invoke("mcp", { body: { action: "connect", storeSlug, name: entry.name, url: entry.url, authType: "none" } });
    setAddingId(null);
    if (error || data?.error) { toast.error(`Couldn't connect ${entry.name}`, { description: data?.error ?? error?.message }); return; }
    toast.success(`Connected ${entry.name}`, { description: `${data.tools?.length ?? 0} tool(s) — Rani can use them now.` });
    void refresh();
  }

  async function refresh() {
    const { data } = await supabase.functions.invoke("mcp", { body: { action: "list", storeSlug } });
    if (Array.isArray(data?.servers)) setServers(data.servers);
    if (Array.isArray(data?.tools)) setTools(data.tools);
  }

  async function addServer(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    const body: Record<string, unknown> = { action: "connect", storeSlug, name, url, authType };
    if (authType === "apikey") body.apiKey = apiKey;
    if (authType === "oauth") body.authProvider = provider;
    if (authType === "identity") body.identityClaim = identityClaim;
    const { data, error } = await supabase.functions.invoke("mcp", { body });
    setBusy(false);
    if (error || data?.error) {
      toast.error("Couldn't connect", { description: data?.error ?? error?.message });
      return;
    }
    toast.success(`Connected ${data.name}`, { description: `${data.tools?.length ?? 0} tool(s) discovered — Rani can use them now.` });
    setName(""); setUrl(""); setApiKey("");
    void refresh();
  }

  async function toggleTool(id: string, enabled: boolean) {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
    await supabase.functions.invoke("mcp", { body: { action: "toggle_tool", storeSlug, toolId: id, enabled } });
  }

  async function setToolPolicy(id: string, hold: boolean) {
    const next = hold ? "hold" : "auto";
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, action_policy: next } : t)));
    const { error } = await supabase.functions.invoke("mcp", { body: { action: "set_tool_policy", storeSlug, toolId: id, policy: next } });
    if (error) { toast.error("Couldn't update"); return; }
    toast.success(hold ? "Held for a person" : "Auto — Rani can run this");
  }

  async function toggleServer(id: string, enabled: boolean) {
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    await supabase.functions.invoke("mcp", { body: { action: "toggle_server", storeSlug, serverId: id, enabled } });
  }

  async function removeServer(id: string) {
    setServers((prev) => prev.filter((s) => s.id !== id));
    setTools((prev) => prev.filter((t) => t.server_id !== id));
    await supabase.functions.invoke("mcp", { body: { action: "remove", storeSlug, serverId: id } });
    toast.success("Server removed");
  }

  async function refreshServer(id: string) {
    const { data } = await supabase.functions.invoke("mcp", { body: { action: "refresh", storeSlug, serverId: id } });
    if (data?.error) { toast.error("Couldn't refresh", { description: data.error }); return; }
    await refresh();
    toast.success("Tools refreshed");
  }

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <Zap className="text-teal-deep size-4" />
        <h2 className="text-base font-semibold">MCP servers</h2>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Connect a remote MCP server and Rani discovers its tools automatically — no spec, no mapping. She calls
        them by context in chat. Store-level auth only; the model never sees your key.
      </p>

      {MCP_CATALOG.some((e) => !connectedUrls.has(e.url)) && (
        <div className="mb-4">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Popular servers — one click</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_CATALOG.filter((e) => !connectedUrls.has(e.url)).map((e) => (
              <div key={e.id} className="bg-card flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {e.name}
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px] font-normal">{e.category}</span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{e.description}</p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" disabled={addingId === e.id} onClick={() => connectFromCatalog(e)}>
                  {addingId === e.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {addingId === e.id ? "Adding…" : "Connect"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Or add any server</p>
      <form onSubmit={addServer} className="bg-card space-y-3 rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Name (e.g. Linear, GitHub)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="https://server.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={authType} onValueChange={setAuthType}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No auth</SelectItem>
              <SelectItem value="apikey">API key</SelectItem>
              <SelectItem value="oauth" disabled={connectedProviders.length === 0}>Connected app (OAuth)</SelectItem>
              <SelectItem value="identity">Signed-in customer</SelectItem>
            </SelectContent>
          </Select>
          {authType === "apikey" && (
            <Input className="flex-1" type="password" placeholder="API key (stored encrypted)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          )}
          {authType === "oauth" && (
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
              <SelectContent>
                {connectedProviders.map((p) => <SelectItem key={p} value={p}>{cap(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {authType === "identity" && (
            <Select value={identityClaim} onValueChange={setIdentityClaim}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Forward sign-in token (Bearer)</SelectItem>
                <SelectItem value="email">Forward verified email</SelectItem>
                <SelectItem value="phone">Forward verified phone</SelectItem>
                <SelectItem value="sub">Forward verified user id</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button type="submit" disabled={busy || !name.trim() || !url.trim()} className="ml-auto">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? "Connecting…" : "Connect server"}
          </Button>
        </div>
        {authType === "identity" && (
          <p className="text-muted-foreground text-xs">
            These tools run <span className="font-medium">as the signed-in customer</span> — turn on sign-in in Members &amp; access.
            Tool discovery runs without sign-in, so the server must let you list its tools unauthenticated.
          </p>
        )}
      </form>

      {servers.length > 0 && (
        <div className="mt-4 space-y-4">
          {servers.map((s) => {
            const stools = tools.filter((t) => t.server_id === s.id);
            return (
              <div key={s.id} className="bg-card rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <Plug className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-muted-foreground truncate text-xs">{s.url}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={s.enabled} onCheckedChange={(c) => toggleServer(s.id, c)} aria-label="Enable server" />
                    <Button variant="ghost" size="icon" className="text-muted-foreground size-8" aria-label="Refresh tools" onClick={() => refreshServer(s.id)}>
                      <RefreshCw className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground size-8" aria-label="Remove server" onClick={() => removeServer(s.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {stools.length > 0 && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    {stools.map((t) => (
                      <div key={t.id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {t.remote_name}
                            {t.side_effect && <span className="text-amber-600 ml-2 text-[11px]">performs an action</span>}
                          </p>
                          {t.description && <p className="text-muted-foreground truncate text-xs">{t.description}</p>}
                        </div>
                        {t.side_effect && (
                          <Button
                            variant={t.action_policy === "hold" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setToolPolicy(t.id, t.action_policy !== "hold")}
                            title={t.action_policy === "hold" ? "Held — Rani flags this for a person. Click to allow." : "Auto — Rani can run this. Click to require a person."}
                          >
                            {t.action_policy === "hold" ? "🔒 Hold" : "Auto"}
                          </Button>
                        )}
                        <Switch checked={t.enabled} onCheckedChange={(c) => toggleTool(t.id, c)} aria-label={`Enable ${t.remote_name}`} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
