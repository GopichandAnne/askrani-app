"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteCharge, saveCharge, type Charge } from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";

const APPLIES = [
  { v: "all", label: "All orders" },
  { v: "pickup", label: "Pickup only" },
  { v: "delivery", label: "Delivery only" },
] as const;

const BLANK: Charge = { label: "", kind: "percent", value: 0, applies_to: "all", enabled: true };

export function ChargesSection({ initial }: { initial: Charge[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Charge[]>(initial);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Charge>({ ...BLANK });
  const [busy, startBusy] = useTransition();

  function refresh() {
    router.refresh();
  }

  function save(charge: Charge, after?: () => void) {
    startBusy(async () => {
      const res = await saveCharge(charge);
      if (res.ok) {
        after?.();
        refresh();
      } else toast.error("Couldn't save", { description: res.error });
    });
  }

  function patchRow(i: number, patch: Partial<Charge>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function commitRow(i: number) {
    save(rows[i]);
  }

  function remove(i: number) {
    const c = rows[i];
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    startBusy(async () => {
      if (c.id) {
        const res = await deleteCharge(c.id);
        if (!res.ok) toast.error("Couldn't remove", { description: res.error });
      }
      refresh();
    });
  }

  function addNew() {
    if (!form.label.trim()) return;
    save(form, () => {
      setForm({ ...BLANK });
      setAdding(false);
      toast.success("Charge added");
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Receipt className="text-muted-foreground size-4" />
        <h2 className="text-sm font-medium">Charges &amp; fees</h2>
      </div>
      <p className="text-muted-foreground text-xs">
        Added to each order&apos;s subtotal. A charge is either a <b>percent of the subtotal</b> or a{" "}
        <b>flat amount</b>, and can apply to all orders or only pickup/delivery. Tax is just one charge —
        no tax? Don&apos;t add one.
      </p>

      {rows.length > 0 && (
        <ul className="divide-border bg-card divide-y rounded-lg border">
          {rows.map((c, i) => (
            <li key={c.id ?? i} className="flex flex-wrap items-center gap-2 p-3">
              <Input
                value={c.label}
                onChange={(e) => patchRow(i, { label: e.target.value })}
                onBlur={() => commitRow(i)}
                className="h-8 min-w-[120px] flex-1"
                placeholder="Sales tax"
              />
              <div className="flex overflow-hidden rounded-md border">
                <button
                  className={`px-2 py-1 text-xs ${c.kind === "percent" ? "bg-teal text-white" : "text-muted-foreground"}`}
                  onClick={() => save({ ...c, kind: "percent" }, () => patchRow(i, { kind: "percent" }))}
                >
                  %
                </button>
                <button
                  className={`px-2 py-1 text-xs ${c.kind === "flat" ? "bg-teal text-white" : "text-muted-foreground"}`}
                  onClick={() => save({ ...c, kind: "flat" }, () => patchRow(i, { kind: "flat" }))}
                >
                  $
                </button>
              </div>
              <Input
                value={String(c.value)}
                onChange={(e) => patchRow(i, { value: Number(e.target.value) })}
                onBlur={() => commitRow(i)}
                className="h-8 w-20"
                inputMode="decimal"
                placeholder={c.kind === "percent" ? "8.25" : "5.00"}
              />
              <select
                value={c.applies_to}
                onChange={(e) => save({ ...c, applies_to: e.target.value as Charge["applies_to"] }, () => patchRow(i, { applies_to: e.target.value as Charge["applies_to"] }))}
                className="border-input bg-background h-8 rounded-md border px-1.5 text-xs"
              >
                {APPLIES.map((a) => (
                  <option key={a.v} value={a.v}>{a.label}</option>
                ))}
              </select>
              <Switch
                checked={c.enabled}
                onCheckedChange={(v) => save({ ...c, enabled: v }, () => patchRow(i, { enabled: v }))}
                aria-label="Enabled"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                aria-label="Remove charge"
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <Input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            className="h-8 min-w-[120px] flex-1"
            placeholder="e.g. Delivery fee"
            autoFocus
          />
          <div className="flex overflow-hidden rounded-md border">
            <button
              className={`px-2 py-1 text-xs ${form.kind === "percent" ? "bg-teal text-white" : "text-muted-foreground"}`}
              onClick={() => setForm((f) => ({ ...f, kind: "percent" }))}
            >
              %
            </button>
            <button
              className={`px-2 py-1 text-xs ${form.kind === "flat" ? "bg-teal text-white" : "text-muted-foreground"}`}
              onClick={() => setForm((f) => ({ ...f, kind: "flat" }))}
            >
              $
            </button>
          </div>
          <Input
            value={String(form.value || "")}
            onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))}
            className="h-8 w-20"
            inputMode="decimal"
            placeholder={form.kind === "percent" ? "8.25" : "5.00"}
          />
          <select
            value={form.applies_to}
            onChange={(e) => setForm((f) => ({ ...f, applies_to: e.target.value as Charge["applies_to"] }))}
            className="border-input bg-background h-8 rounded-md border px-1.5 text-xs"
          >
            {APPLIES.map((a) => (
              <option key={a.v} value={a.v}>{a.label}</option>
            ))}
          </select>
          <Button size="sm" onClick={addNew} disabled={busy || !form.label.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({ ...BLANK }); }}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add a charge
        </Button>
      )}
    </section>
  );
}
