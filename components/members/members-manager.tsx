"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  addMember,
  generateSsoSecret,
  getMemberSettings,
  importMembers,
  removeMember,
  setAccessMode,
  setMemberBlocked,
  type AccessMode,
  type Member,
} from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Copy, KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";

const MODES: { value: AccessMode; label: string; help: string }[] = [
  { value: "open", label: "Open", help: "Anyone can chat. Members are recognized if identified." },
  { value: "optional", label: "Members unlock", help: "Anyone chats; a verified member gets their role & context." },
  { value: "required", label: "Members only", help: "Only verified members may use the agent at all." },
];

export function MembersManager({ storeId }: { storeId: string }) {
  const [mode, setMode] = useState<AccessMode>("open");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [hasSso, setHasSso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("resident");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [csv, setCsv] = useState("");

  async function refresh() {
    const res = await getMemberSettings(storeId);
    if (res.ok) {
      setMode(res.mode);
      setMembers(res.members);
      setHasSso(res.hasSso);
    }
  }

  useEffect(() => {
    let alive = true;
    getMemberSettings(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setMode(res.mode);
        setMembers(res.members);
        setHasSso(res.hasSso);
      } else toast.error("Couldn't load members", { description: res.error });
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function changeMode(next: AccessMode) {
    const prev = mode;
    setMode(next);
    setBusy(true);
    const res = await setAccessMode(storeId, next);
    setBusy(false);
    if (!res.ok) {
      setMode(prev);
      toast.error("Couldn't update", { description: res.error });
    } else toast.success("Access updated");
  }

  async function add() {
    setBusy(true);
    const res = await addMember(storeId, { email, phone, role, name: name || undefined });
    setBusy(false);
    if (res.ok) {
      setMembers((m) => [res.member, ...(m ?? [])]);
      setEmail("");
      setPhone("");
      setName("");
      toast.success("Member added");
    } else toast.error("Couldn't add", { description: res.error });
  }

  async function toggleBlock(m: Member) {
    setBusy(true);
    const res = await setMemberBlocked(storeId, m.id, !m.blocked);
    setBusy(false);
    if (res.ok) {
      setMembers((list) => (list ?? []).map((x) => (x.id === m.id ? { ...x, blocked: !m.blocked } : x)));
      toast.success(m.blocked ? "Unblocked" : "Blocked");
    } else toast.error("Couldn't update", { description: res.error });
  }

  async function remove(m: Member) {
    setBusy(true);
    const res = await removeMember(storeId, m.id);
    setBusy(false);
    if (res.ok) {
      setMembers((list) => (list ?? []).filter((x) => x.id !== m.id));
      toast.success("Removed");
    } else toast.error("Couldn't remove", { description: res.error });
  }

  async function runImport() {
    setBusy(true);
    const res = await importMembers(storeId, csv);
    setBusy(false);
    if (res.ok) {
      toast.success(
        `Imported: ${res.added} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ""}`,
      );
      setCsv("");
      refresh();
    } else toast.error("Couldn't import", { description: res.error });
  }

  async function makeSecret() {
    setBusy(true);
    const res = await generateSsoSecret(storeId);
    setBusy(false);
    if (res.ok) {
      setSecret(res.secret);
      setHasSso(true);
      toast.success("SSO secret created — copy it now");
    } else toast.error("Couldn't create secret", { description: res.error });
  }

  return (
    <div className="space-y-6">
      {/* Access mode */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Who can use the agent</p>
        <Select value={mode} onValueChange={(v) => changeMode(v as AccessMode)} disabled={busy}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{MODES.find((m) => m.value === mode)?.help}</p>
      </div>

      {/* Add member */}
      <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Add a member</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email (web)" className="h-9 min-w-[160px] flex-1" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555… (WhatsApp)" className="h-9 w-[150px]" inputMode="tel" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-9 w-[120px]" />
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="role" className="h-9 w-[110px]" />
          <Button size="sm" onClick={add} disabled={busy || (!email.trim() && !phone.trim())}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Email identifies them on web chat; phone matches their WhatsApp. The <b>role</b> (e.g.
          resident, member, vip) is what the agent uses to distinguish them.
        </p>
      </div>

      {/* CSV import */}
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Import from CSV</p>
        <p className="text-muted-foreground text-xs">
          Export your resident/member list from your system and paste or upload it. Needs a header row
          with <code className="bg-muted rounded px-1">email</code> and/or{" "}
          <code className="bg-muted rounded px-1">phone</code>; optional{" "}
          <code className="bg-muted rounded px-1">role</code>,{" "}
          <code className="bg-muted rounded px-1">name</code>, and any extra columns (e.g. unit) are
          kept. Re-importing updates existing members.
        </p>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="text-muted-foreground block text-xs"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setCsv(await f.text());
            e.target.value = "";
          }}
        />
        <Textarea
          rows={4}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"email,phone,role,name,unit\nmaya@x.com,+15551234567,resident,Maya R.,214"}
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={runImport} disabled={busy || !csv.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Import members
        </Button>
      </div>

      {/* Member list */}
      {members == null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {m.displayName || m.email || m.phone}
                  <Badge variant="outline" className="text-[10px]">
                    {m.role}
                  </Badge>
                  {m.blocked && <Badge className="bg-coral text-[10px] text-white">Blocked</Badge>}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {[m.email, m.phone].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggleBlock(m)} className="text-xs">
                {m.blocked ? "Unblock" : "Block"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-8"
                disabled={busy}
                onClick={() => remove(m)}
                aria-label="Remove"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Embedded SSO */}
      <div className="space-y-2 border-t pt-4">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="text-teal-deep size-4" /> Embedded website login (SSO)
        </p>
        <p className="text-muted-foreground text-xs">
          Already have logins on your website? When the widget is embedded there, your site signs a
          short token with this secret and passes it to Rani — so your existing login recognizes the
          member automatically, with nothing to manage here. WhatsApp needs no setup: the phone number
          is matched on its own.
        </p>
        {secret ? (
          <div className="space-y-1">
            <code className="bg-muted block overflow-x-auto rounded px-2 py-1.5 text-xs">{secret}</code>
            <p className="text-muted-foreground text-xs">
              Copy this now — it won&apos;t be shown again. Keep it server-side only.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy secret"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={makeSecret} disabled={busy}>
            <KeyRound className="size-4" /> {hasSso ? "Rotate SSO secret" : "Set up embedded SSO"}
          </Button>
        )}
        <p className="text-muted-foreground text-xs">
          Your backend signs <code className="bg-muted rounded px-1">base64url(JSON)+&quot;.&quot;+HMAC-SHA256</code>{" "}
          of <code className="bg-muted rounded px-1">{"{email, exp}"}</code> and adds{" "}
          <code className="bg-muted rounded px-1">data-user-token</code> to the embed snippet. Full
          steps are in your integration docs.
        </p>
      </div>
    </div>
  );
}
