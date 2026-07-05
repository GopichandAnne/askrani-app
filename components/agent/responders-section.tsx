"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addResponder,
  removeResponder,
  updateResponder,
  type Responder,
} from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Users } from "lucide-react";

export function RespondersSection({ initial }: { initial: Responder[] }) {
  const [rows, setRows] = useState<Responder[]>(initial);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [adding, startAdd] = useTransition();

  function add() {
    if (!phone.trim()) return;
    startAdd(async () => {
      const res = await addResponder({ phone, name });
      if (res.ok) {
        setRows((prev) => {
          const i = prev.findIndex((r) => r.id === res.responder.id);
          if (i >= 0) { const c = prev.slice(); c[i] = res.responder; return c; }
          return [...prev, res.responder];
        });
        setPhone(""); setName("");
        toast.success("Responder added");
      } else toast.error("Couldn't add", { description: res.error });
    });
  }

  async function toggle(r: Responder, field: "notify_escalations" | "notify_orders" | "active", value: boolean) {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, [field]: value } : x)));
    const res = await updateResponder(r.id, { [field]: value });
    if (!res.ok) toast.error("Couldn't update", { description: res.error });
  }

  async function remove(r: Responder) {
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    const res = await removeResponder(r.id);
    if (!res.ok) toast.error("Couldn't remove", { description: res.error });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="text-muted-foreground size-4" />
        <h2 className="text-sm font-medium">Escalation responders</h2>
      </div>
      <p className="text-muted-foreground text-xs">
        Owner/staff WhatsApp numbers. Rani messages them when she needs a human
        (escalations) or when an order is placed. Whoever replies first, Rani
        relays their answer to the customer. Numbers need no login here.
      </p>

      {rows.length > 0 && (
        <ul className="divide-border bg-card divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name || r.phone}</p>
                <p className="text-muted-foreground text-xs">
                  {r.phone}
                  {r.role === "owner" ? " · owner" : ""}
                  {!r.active ? " · inactive" : ""}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <Switch checked={r.notify_escalations} onCheckedChange={(v) => toggle(r, "notify_escalations", v)} />
                Escalations
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Switch checked={r.notify_orders} onCheckedChange={(v) => toggle(r, "notify_orders", v)} />
                Orders
              </label>
              <Button
                variant="ghost" size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                aria-label="Remove responder"
                onClick={() => remove(r)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="resp-phone" className="text-xs">Phone (with country code)</Label>
          <Input id="resp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="15125551234" inputMode="tel" className="w-48" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resp-name" className="text-xs">Name</Label>
          <Input id="resp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi" className="w-40" />
        </div>
        <Button onClick={add} disabled={adding || !phone.trim()} size="sm">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>
    </section>
  );
}
