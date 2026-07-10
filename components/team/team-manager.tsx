"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  addTeamMember,
  changeTeamRole,
  listTeam,
  removeTeamMember,
  type TeamMember,
} from "@/app/(app)/team/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2, UserPlus } from "lucide-react";

type Role = "owner" | "staff";

export function TeamManager({ storeId }: { storeId: string; storeName?: string }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");

  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;

  async function refresh() {
    const res = await listTeam(storeId);
    if (res.ok) setMembers(res.members);
    else toast.error("Couldn't load the team", { description: res.error });
  }

  useEffect(() => {
    let alive = true;
    listTeam(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) setMembers(res.members);
      else toast.error("Couldn't load the team", { description: res.error });
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function add() {
    setBusy(true);
    const res = await addTeamMember({ storeId, email, role, name: name || undefined });
    setBusy(false);
    if (res.ok) {
      toast.success(res.invited ? "Invitation sent" : `${role === "owner" ? "Owner" : "Staff"} added`, {
        description: res.invited
          ? "We emailed them a sign-in link — they'll see this store the first time they log in."
          : undefined,
      });
      setEmail("");
      setName("");
      setRole("staff");
      refresh();
    } else {
      toast.error("Couldn't add", { description: res.error });
    }
  }

  async function setMemberRole(m: TeamMember, next: Role) {
    if (next === m.role) return;
    setBusy(true);
    const res = await changeTeamRole({ storeId, userId: m.userId, role: next });
    setBusy(false);
    if (res.ok) {
      toast.success(`${m.email || "Member"} is now ${next}`);
      refresh();
    } else {
      toast.error("Couldn't change role", { description: res.error });
    }
  }

  async function remove(m: TeamMember) {
    setBusy(true);
    const res = await removeTeamMember({ storeId, userId: m.userId });
    setBusy(false);
    if (res.ok) {
      toast.success("Removed from the store");
      refresh();
    } else {
      toast.error("Couldn't remove", { description: res.error });
    }
  }

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Add someone</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@email.com"
            className="h-9 min-w-[180px] flex-1"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="h-9 w-[150px]"
          />
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="h-9 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={add} disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Owners can manage the team, settings, and the agent. Staff can handle orders and
          conversations. No account yet? They&apos;ll get an email invite.
        </p>
      </div>

      {/* Members */}
      {members == null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No one has access yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const lastOwner = m.role === "owner" && ownerCount <= 1;
            return (
              <div key={m.userId} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name || m.email || m.userId.slice(0, 8)}
                    {m.isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </p>
                  {m.name && m.email && (
                    <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                  )}
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) => setMemberRole(m, v as Role)}
                  disabled={busy || lastOwner}
                >
                  <SelectTrigger className="h-8 w-[104px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                  </SelectContent>
                </Select>
                {lastOwner ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    Last owner
                  </Badge>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                    disabled={busy}
                    onClick={() => remove(m)}
                    aria-label="Remove"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
