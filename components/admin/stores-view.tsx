"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { onboardStore } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StoreLinkPanel } from "@/components/store-link/store-link-panel";
import { TeamManager } from "@/components/team/team-manager";
import { BUSINESS_PRESETS, presetFor } from "@/lib/business-presets";
import { Building2, Plus, QrCode, Users } from "lucide-react";

export type StoreRow = {
  id: string;
  slug: string;
  displayName: string | null;
  businessType: string | null;
  active: boolean;
  whatsappStatus: string | null;
  createdAt: string | null;
  owners: string[];
};

export function StoresView({ initial }: { initial: StoreRow[] }) {
  const router = useRouter();
  const [assignFor, setAssignFor] = useState<StoreRow | null>(null);
  const [linkFor, setLinkFor] = useState<StoreRow | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl italic">Stores</h1>
          <p className="text-muted-foreground text-sm">
            Every store on the platform · {initial.length}
          </p>
        </div>
        <OnboardDialog onDone={() => router.refresh()} />
      </header>

      {initial.length === 0 ? (
        <div className="bg-card text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Building2 className="size-6" />
          <p className="text-sm font-medium">No stores yet</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {initial.map((s) => (
            <li key={s.id} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{s.displayName ?? s.slug}</p>
                    <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                      {s.slug}
                    </code>
                    {s.businessType && (
                      <Badge variant="secondary" className="capitalize">
                        {s.businessType}
                      </Badge>
                    )}
                    {!s.active && <Badge variant="outline">inactive</Badge>}
                    <Badge
                      variant="outline"
                      className={
                        s.whatsappStatus === "active"
                          ? "border-teal text-teal-deep"
                          : "text-muted-foreground"
                      }
                    >
                      WhatsApp: {s.whatsappStatus ?? "inactive"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {s.owners.length > 0 ? (
                      <>Owner: {s.owners.join(", ")}</>
                    ) : (
                      <span className="text-destructive">No owner assigned yet</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLinkFor(s)}>
                    <QrCode className="size-4" /> Link &amp; QR
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAssignFor(s)}>
                    <Users className="size-4" /> Team
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Web chat link</DialogTitle>
            <DialogDescription>
              {linkFor ? `${linkFor.displayName ?? linkFor.slug} — in-store QR + shareable link` : ""}
            </DialogDescription>
          </DialogHeader>
          {linkFor && (
            <StoreLinkPanel
              storeId={linkFor.id}
              storeSlug={linkFor.slug}
              storeName={linkFor.displayName ?? linkFor.slug}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!assignFor}
        onOpenChange={(o) => {
          if (!o) {
            setAssignFor(null);
            router.refresh();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Team</DialogTitle>
            <DialogDescription>
              {assignFor ? `Owners and staff for ${assignFor.displayName ?? assignFor.slug}` : ""}
            </DialogDescription>
          </DialogHeader>
          {assignFor && (
            <TeamManager storeId={assignFor.id} storeName={assignFor.displayName ?? assignFor.slug} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OnboardDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [ordersEnabled, setOrdersEnabled] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [pending, setPending] = useState(false);

  function reset() {
    setDisplayName("");
    setSlug("");
    setBusinessType("");
    setOrdersEnabled(false);
    setCatalogEnabled(false);
  }

  async function submit() {
    if (!displayName.trim()) {
      toast.error("Business name is required");
      return;
    }
    setPending(true);
    const res = await onboardStore({
      displayName,
      slug: slug || undefined,
      businessType: businessType || undefined,
      ordersEnabled,
      catalogEnabled,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Store created", { description: `Slug: ${res.slug}` });
      reset();
      setOpen(false);
      onDone();
    } else {
      toast.error("Couldn't create store", { description: res.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Onboard store
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Onboard a new store</DialogTitle>
          <DialogDescription>
            Creates the store. Assign an owner and connect WhatsApp afterward.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Business name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Downtown Grocery"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (optional)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-generated from the name"
            />
          </div>
          <div className="space-y-2">
            <Label>Business type</Label>
            <Select
              value={businessType}
              onValueChange={(v) => {
                setBusinessType(v);
                const p = presetFor(v);
                if (p) {
                  setOrdersEnabled(p.ordersDefault);
                  setCatalogEnabled(p.catalogDefault);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Presets the assistant&apos;s behaviour for this type — you can fine-tune it later in
              Agent Setup.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="orders">Enable ordering</Label>
              <p className="text-muted-foreground text-xs">Customers can build carts / requests.</p>
            </div>
            <Switch id="orders" checked={ordersEnabled} onCheckedChange={setOrdersEnabled} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="catalog">Structured catalogue (show prices)</Label>
              <p className="text-muted-foreground text-xs">
                Off = request mode; the bot never quotes prices.
              </p>
            </div>
            <Switch id="catalog" checked={catalogEnabled} onCheckedChange={setCatalogEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create store"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

