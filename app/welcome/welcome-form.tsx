"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createMyStore } from "./actions";
import { BUSINESS_PRESETS } from "@/lib/business-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export function WelcomeForm({ email }: { email: string | null }) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [emailVal, setEmailVal] = useState(email ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim() || busy) return;
    setBusy(true);
    const res = await createMyStore({
      businessName,
      businessType: businessType || undefined,
      ownerName: ownerName || undefined,
      email: emailVal || undefined,
    });
    if (!res.ok) {
      setBusy(false);
      toast.error("Couldn't set up your store", { description: res.error });
      return;
    }
    // Full navigation so the server re-reads the new active-store cookie + staff link.
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="biz">Business / organization name</Label>
        <Input id="biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Man Pasand" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="type">Business type</Label>
        <select
          id="type"
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="">Choose one…</option>
          {BUSINESS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your name" />
      </div>
      {!email && (
        <div className="space-y-2">
          <Label htmlFor="email">Email (optional)</Label>
          <Input id="email" type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)} placeholder="you@business.com" />
          <p className="text-muted-foreground text-xs">Lets you also sign in by email and unifies your Ask Rani account.</p>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Create my store
      </Button>
      <p className="text-muted-foreground text-center text-xs">Comes with 150 free credits to start.</p>
    </form>
  );
}
