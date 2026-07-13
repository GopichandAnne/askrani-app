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
import { Loader2, Plus, Trash2, Users } from "lucide-react";

type Topic = { key: string; label: string };

export function RespondersSection({
  initial,
  topics,
}: {
  initial: Responder[];
  topics: Topic[];
}) {
  const [rows, setRows] = useState<Responder[]>(initial);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [adding, startAdd] = useTransition();

  function add() {
    if (!phone.trim() && !email.trim()) return;
    startAdd(async () => {
      const res = await addResponder({ phone, email, name });
      if (res.ok) {
        setRows((prev) => {
          const i = prev.findIndex((r) => r.id === res.responder.id);
          if (i >= 0) { const c = prev.slice(); c[i] = res.responder; return c; }
          return [...prev, res.responder];
        });
        setPhone(""); setEmail(""); setName("");
        toast.success("Responder added");
      } else toast.error("Couldn't add", { description: res.error });
    });
  }

  async function toggleTopic(r: Responder, topicKey: string, on: boolean) {
    const current = r.topics ?? [];
    const next = on ? [...new Set([...current, topicKey])] : current.filter((t) => t !== topicKey);
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, topics: next } : x)));
    const res = await updateResponder(r.id, { topics: next });
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
        Owner/staff contacts — a WhatsApp number, an email, or both. Each person
        subscribes to the topics they care about; Rani notifies them on whichever
        channel they set. WhatsApp responders can reply right in WhatsApp and Rani
        relays the first answer to the customer. Topics beyond <b>Orders</b> and{" "}
        <b>Escalations</b> come from the request types you create on the{" "}
        <a href="/requests" className="text-teal-deep underline">Requests</a> page.
      </p>

      {rows.length > 0 && (
        <ul className="divide-border bg-card divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name || r.phone || r.email}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {[r.phone, r.email].filter(Boolean).join(" · ")}
                  {r.role === "owner" ? " · owner" : ""}
                  {!r.active ? " · inactive" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {topics.map((t) => (
                  <label key={t.key} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="accent-teal size-3.5"
                      checked={(r.topics ?? []).includes(t.key)}
                      onChange={(e) => toggleTopic(r, t.key, e.target.checked)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
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
          <Label htmlFor="resp-phone" className="text-xs">WhatsApp (country code)</Label>
          <Input id="resp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="15125551234" inputMode="tel" className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resp-email" className="text-xs">Email</Label>
          <Input id="resp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ravi@store.com" inputMode="email" className="w-48" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resp-name" className="text-xs">Name</Label>
          <Input id="resp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi" className="w-32" />
        </div>
        <Button onClick={add} disabled={adding || (!phone.trim() && !email.trim())} size="sm">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">Add a WhatsApp number, an email, or both.</p>
    </section>
  );
}
