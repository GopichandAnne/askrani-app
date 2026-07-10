"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import {
  createListingToken,
  listListingTokens,
  setListingTokenActive,
  type ListingToken,
} from "@/app/(app)/link/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Download, Home, Loader2, Plus } from "lucide-react";

const SITE = "https://askrani.ai";

/**
 * Listing-scoped "smart yard sign" QRs. One realtor store mints a QR per
 * listing; scanning it opens the chat primed on that home but still able to
 * search other listings. Managed separately from the store's primary QR.
 */
export function ListingQrs({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const [tokens, setTokens] = useState<ListingToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [details, setDetails] = useState("");
  const [chips, setChips] = useState("");

  useEffect(() => {
    let alive = true;
    listListingTokens(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) setTokens(res.tokens);
      else toast.error("Couldn't load listing QRs", { description: res.error });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function create() {
    setBusy(true);
    const res = await createListingToken(storeId, {
      listingRef: ref,
      listingContext: details,
      listingChips: chips,
    });
    setBusy(false);
    if (res.ok) {
      setTokens((t) => [res.token, ...t]);
      setRef("");
      setDetails("");
      setChips("");
      toast.success("Listing QR created", { description: `Ready to print for ${res.token.listingRef}.` });
    } else {
      toast.error("Couldn't create", { description: res.error });
    }
  }

  async function toggle(token: string, active: boolean) {
    setBusy(true);
    setTokens((t) => t.map((x) => (x.token === token ? { ...x, active } : x))); // optimistic
    const res = await setListingTokenActive(storeId, token, active);
    setBusy(false);
    if (!res.ok) {
      setTokens((t) => t.map((x) => (x.token === token ? { ...x, active: !active } : x)));
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(
        active ? "Marked available — the QR leads with this home again" : "Marked sold — the QR now shows similar homes",
      );
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Home className="text-teal-deep size-4" />
        <p className="text-sm font-medium">Listing QRs</p>
      </div>
      <p className="text-muted-foreground text-xs">
        Make a QR for a specific listing — a yard sign or flyer. Scanning it opens Rani already
        talking about that home, and the visitor can still ask about your other listings. One agent,
        the same Rani underneath. When the home sells, flip it to <b>Sold</b> — the QR keeps working
        and shows similar homes instead.
      </p>

      {/* Create form */}
      <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Listing — e.g. 214 Maple Street or MLS1003"
          className="h-9"
        />
        <Textarea
          rows={3}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="A sentence or two about this home — beds/baths, size, price, standout features. Rani leads with this."
        />
        <Textarea
          rows={2}
          value={chips}
          onChange={(e) => setChips(e.target.value)}
          placeholder={"Optional starter questions, one per line (leave blank for smart defaults)"}
        />
        <Button size="sm" onClick={create} disabled={busy || !ref.trim() || details.trim().length < 20}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create listing QR
        </Button>
      </div>

      {/* Existing listing QRs */}
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : tokens.length === 0 ? (
        <p className="text-muted-foreground text-xs">No listing QRs yet.</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <ListingRow key={t.token} storeSlug={storeSlug} token={t} busy={busy} onToggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingRow({
  storeSlug,
  token,
  busy,
  onToggle,
}: {
  storeSlug: string;
  token: ListingToken;
  busy: boolean;
  onToggle: (token: string, active: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const url = `${SITE}/s/${storeSlug}?t=${token.token}`;

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function downloadQr() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `askrani-${storeSlug}-${token.token}.png`;
    a.click();
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5">
      <div ref={qrRef} className="bg-card shrink-0 rounded-md border p-1">
        <QRCodeCanvas value={url} size={56} level="M" fgColor="#0f766e" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{token.listingRef}</p>
          {!token.active && <Badge className="bg-coral shrink-0 text-white">Sold</Badge>}
        </div>
        <code className="text-muted-foreground block truncate text-xs">{url}</code>
        {!token.active && (
          <p className="text-muted-foreground text-xs">Shows similar homes when scanned.</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="icon" variant="ghost" className="size-8" onClick={copy} aria-label="Copy link">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={downloadQr} aria-label="Download QR">
          <Download className="size-4" />
        </Button>
        <Switch
          checked={token.active}
          onCheckedChange={(v) => onToggle(token.token, v)}
          disabled={busy}
          aria-label="Enable listing QR"
        />
      </div>
    </div>
  );
}
