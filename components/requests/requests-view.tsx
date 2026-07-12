"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  applyConfig,
  deleteRequestType,
  planConfig,
  saveRequestType,
  setRequestStatus,
  type CapturedRequest,
  type ConfigPlan,
  type RequestField,
  type RequestStatus,
  type RequestType,
} from "@/app/(app)/requests/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Inbox, Loader2, Mail, Pencil, Phone, Plus, Sparkles, Trash2 } from "lucide-react";

const STATUSES: RequestStatus[] = ["new", "reviewed", "contacted", "closed"];
const STATUS_STYLE: Record<RequestStatus, string> = {
  new: "bg-teal text-white",
  reviewed: "bg-amber-500 text-white",
  contacted: "bg-blue-500 text-white",
  closed: "bg-muted text-muted-foreground",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fieldsToInput(fields: RequestField[]): string {
  return (fields ?? []).map((f) => (f.required === false ? f.key : `${f.key}*`)).join(", ");
}

function parseFieldsInput(s: string): RequestField[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const required = t.endsWith("*");
      return { key: t.replace(/\*+$/, "").trim(), required };
    })
    .filter((f) => f.key);
}

function val(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => String(x)).join(", ") : String(v ?? "");
}

function describeAction(a: ConfigPlan["actions"][number]): string {
  const who = a.responder_email || a.responder_phone || a.responder_name || "someone";
  switch (a.kind) {
    case "upsert_type": {
      const flds = (a.fields ?? []).map((f) => (f.required === false ? f.key : `${f.key}*`)).join(", ");
      return `Add/update request type “${a.label ?? a.key}”${flds ? ` — collect ${flds}` : ""}`;
    }
    case "delete_type":
      return `Remove request type “${a.key}”`;
    case "subscribe":
      return `Notify ${who} about “${a.topic}”`;
    case "unsubscribe":
      return `Stop notifying ${who} about “${a.topic}”`;
    default:
      return a.kind;
  }
}

export function RequestsView({
  requests,
  types,
  storeName,
}: {
  requests: CapturedRequest[];
  types: RequestType[];
  storeName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [filter, setFilter] = useState<string>("all");

  // Request-type editor state.
  const [showForm, setShowForm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fFields, setFFields] = useState("");

  // Natural-language config (LLM proposes → owner confirms → apply).
  const [nl, setNl] = useState("");
  const [plan, setPlan] = useState<ConfigPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);

  const labelOf = (k: string) => types.find((t) => t.key === k)?.label ?? k;
  const shown = filter === "all" ? requests : requests.filter((r) => r.type === filter);
  const newCount = requests.filter((r) => r.status === "new").length;

  async function preview() {
    setPlanning(true);
    const res = await planConfig(nl.trim());
    setPlanning(false);
    if (res.ok) setPlan(res.plan);
    else toast.error("Couldn't read that", { description: res.error });
  }
  async function applyPlan() {
    if (!plan) return;
    setApplying(true);
    const res = await applyConfig(plan.actions);
    setApplying(false);
    if (res.ok) {
      setPlan(null);
      setNl("");
      toast.success(res.applied.length ? res.applied.join(" · ") : "Nothing to change", {
        description: res.skipped.length ? `Skipped: ${res.skipped.join("; ")}` : undefined,
      });
      router.refresh();
    } else toast.error("Couldn't apply", { description: res.error });
  }

  function changeStatus(id: string, status: RequestStatus) {
    setBusy(id);
    start(async () => {
      const res = await setRequestStatus(id, status);
      setBusy(null);
      if (res.ok) router.refresh();
      else toast.error("Couldn't update", { description: res.error });
    });
  }

  function openNew() {
    setEditingKey(null);
    setFKey("");
    setFLabel("");
    setFDesc("");
    setFFields("");
    setShowForm(true);
  }
  function openEdit(t: RequestType) {
    setEditingKey(t.key);
    setFKey(t.key);
    setFLabel(t.label);
    setFDesc(t.description ?? "");
    setFFields(fieldsToInput(t.fields));
    setShowForm(true);
  }
  function saveType() {
    start(async () => {
      const res = await saveRequestType({
        key: fKey,
        label: fLabel,
        description: fDesc,
        fields: parseFieldsInput(fFields),
      });
      if (res.ok) {
        setShowForm(false);
        toast.success("Request type saved");
        router.refresh();
      } else toast.error("Couldn't save", { description: res.error });
    });
  }
  function removeType(key: string) {
    start(async () => {
      const res = await deleteRequestType(key);
      if (res.ok) {
        toast.success("Removed");
        router.refresh();
      } else toast.error("Couldn't remove", { description: res.error });
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="text-muted-foreground size-5" />
          <div>
            <h1 className="font-display text-2xl italic">Requests</h1>
            <p className="text-muted-foreground text-sm">{storeName}</p>
          </div>
        </div>
        {newCount > 0 && <Badge className="bg-teal text-white">{newCount} new</Badge>}
      </header>

      {/* ── Natural-language config ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="text-teal-deep size-4" />
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Configure with a sentence
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nl.trim() && !planning) preview();
            }}
            placeholder='e.g. Capture callback requests with phone and reason, and notify priya@store.com'
            className="min-w-[260px] flex-1"
          />
          <Button onClick={preview} disabled={planning || !nl.trim()}>
            {planning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Preview
          </Button>
        </div>
        {plan && (
          <div className="bg-card space-y-3 rounded-lg border p-4">
            <p className="text-sm">{plan.summary}</p>
            {plan.actions.length > 0 && (
              <ul className="space-y-1">
                {plan.actions.map((a, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-2 text-sm">
                    <span className="text-teal-deep">•</span>
                    {describeAction(a)}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={applyPlan} disabled={applying || plan.actions.length === 0}>
                {applying ? <Loader2 className="size-4 animate-spin" /> : null} Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Request types the assistant can capture ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            What the assistant captures
          </span>
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus className="size-4" /> New request type
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Define the kinds of requests Rani can collect (e.g. a job enquiry, a callback, a quote).
          Each becomes a notification topic your team can subscribe to on the Agent page.
        </p>

        {showForm && (
          <div className="bg-card space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Label</label>
                <Input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Career interest" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Key (topic)</label>
                <Input
                  value={fKey}
                  onChange={(e) => setFKey(e.target.value)}
                  placeholder="career_interest"
                  disabled={!!editingKey}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                When to file it + how to ask (the bot reads this)
              </label>
              <Input
                value={fDesc}
                onChange={(e) => setFDesc(e.target.value)}
                placeholder="When a visitor is looking for a job or wants to submit a resume."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Fields to collect — comma separated, add * for required
              </label>
              <Input
                value={fFields}
                onChange={(e) => setFFields(e.target.value)}
                placeholder="positions*, skills*, portfolio"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveType} disabled={!fKey.trim() || !fLabel.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {types.length === 0 && !showForm ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
            No request types yet. Add one so the assistant can capture leads for you.
          </p>
        ) : (
          <ul className="grid gap-2">
            {types.map((t) => (
              <li key={t.id} className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{t.label}</p>
                    <code className="text-muted-foreground text-xs">{t.key}</code>
                    {!t.enabled && <Badge variant="outline">off</Badge>}
                  </div>
                  {t.fields?.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      Collects: {t.fields.map((f) => (f.required === false ? f.key : `${f.key}*`)).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)} aria-label="Edit">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => removeType(t.key)} aria-label="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The inbox ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Inbox</span>
          <span className="bg-border h-px flex-1" />
        </div>

        {types.length > 1 || filter !== "all" ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-full border px-3 py-1 text-xs ${filter === "all" ? "bg-teal border-teal text-white" : "text-muted-foreground"}`}
            >
              All
            </button>
            {types.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`rounded-full border px-3 py-1 text-xs ${filter === t.key ? "bg-teal border-teal text-white" : "text-muted-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

        {shown.length === 0 ? (
          <div className="bg-card text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <Inbox className="size-6" />
            <p className="text-sm font-medium">No requests yet</p>
            <p className="max-w-sm text-sm">
              When Rani captures a request from a visitor, it shows up here for your team to review.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {shown.map((r) => (
              <li key={r.id} className="bg-card rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{labelOf(r.type)}</Badge>
                      {r.contact_email && (
                        <a
                          href={`mailto:${r.contact_email}`}
                          className="text-teal-deep inline-flex items-center gap-1 text-sm hover:underline"
                        >
                          <Mail className="size-3.5" /> {r.contact_email}
                        </a>
                      )}
                      {r.contact_phone && (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                          <Phone className="size-3.5" /> {r.contact_phone}
                        </span>
                      )}
                    </div>
                    {Object.entries(r.fields ?? {}).map(([k, v]) => (
                      <p key={k} className="text-sm">
                        <span className="text-muted-foreground">{k}: </span>
                        {val(v)}
                      </p>
                    ))}
                    <p className="text-muted-foreground text-xs">{fmtDate(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                    <select
                      value={r.status}
                      disabled={busy === r.id}
                      onChange={(e) => changeStatus(r.id, e.target.value as RequestStatus)}
                      className="border-input bg-background h-8 rounded-md border px-2 text-sm disabled:opacity-50"
                      aria-label="Update status"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
