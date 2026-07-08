"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import {
  getStoreLink,
  setLinkActive,
  regenerateLink,
  setWebChatPaused,
  setWhatsappNumber,
  setWhatsappRedirect,
} from "@/app/(app)/link/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Download, Loader2, MessageCircle, QrCode, RefreshCw } from "lucide-react";

const SITE = "https://askrani.ai";

export function StoreLinkPanel({
  storeId,
  storeSlug,
  storeName,
}: {
  storeId: string;
  storeSlug: string;
  storeName: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [paused, setPaused] = useState(false);
  const [waNumber, setWaNumber] = useState<string | null>(null);
  const [waRedirect, setWaRedirect] = useState(false);
  const [waInput, setWaInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const url = token ? `${SITE}/s/${storeSlug}?t=${token}` : "";

  useEffect(() => {
    let alive = true;
    getStoreLink(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setToken(res.token);
        setActive(res.active);
        setPaused(res.paused);
        setWaNumber(res.waNumber);
        setWaInput(res.waNumber ?? "");
        setWaRedirect(res.waRedirect);
      } else {
        toast.error("Couldn't load link", { description: res.error });
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function toggle(next: boolean) {
    setBusy(true);
    setActive(next); // optimistic
    const res = await setLinkActive(storeId, next);
    setBusy(false);
    if (!res.ok) {
      setActive(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "Link enabled" : "Link disabled");
    }
  }

  async function toggleBreak(next: boolean) {
    setBusy(true);
    setPaused(next); // optimistic
    const res = await setWebChatPaused(storeId, next);
    setBusy(false);
    if (!res.ok) {
      setPaused(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "Break mode on — chat is paused" : "Break mode off — chat is live");
    }
  }

  async function saveWaNumber() {
    setBusy(true);
    const res = await setWhatsappNumber(storeId, waInput);
    setBusy(false);
    if (res.ok) {
      setWaNumber(res.waNumber);
      setWaInput(res.waNumber ?? "");
      if (!res.waNumber) setWaRedirect(false);
      toast.success(res.waNumber ? "WhatsApp number saved" : "WhatsApp number cleared");
    } else {
      toast.error("Couldn't save", { description: res.error });
    }
  }

  async function toggleWaRedirect(next: boolean) {
    setBusy(true);
    setWaRedirect(next); // optimistic
    const res = await setWhatsappRedirect(storeId, next);
    setBusy(false);
    if (!res.ok) {
      setWaRedirect(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "QR now opens WhatsApp for everyone" : "QR now opens web chat");
    }
  }

  async function regenerate() {
    setBusy(true);
    const res = await regenerateLink(storeId);
    setBusy(false);
    if (res.ok) {
      setToken(res.token);
      setActive(true);
      toast.success("New link generated", { description: "The old QR no longer works." });
    } else {
      toast.error("Couldn't regenerate", { description: res.error });
    }
  }

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
    a.download = `askrani-${storeSlug}-qr.png`;
    a.click();
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading link…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Web chat link</p>
          <p className="text-muted-foreground text-xs">
            {active ? "Live — customers can scan and chat." : "Off — the link won't open."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={active ? "border-teal text-teal-deep" : "text-muted-foreground"}>
            {active ? "Enabled" : "Disabled"}
          </Badge>
          <Switch checked={active} onCheckedChange={toggle} disabled={busy} aria-label="Enable link" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Break mode</p>
          <p className="text-muted-foreground text-xs">
            {paused
              ? "On — visitors see “Rani is taking a break”; no chatting."
              : "Off — pause the web chat without changing the QR."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {paused && <Badge className="bg-coral text-white">On break</Badge>}
          <Switch checked={paused} onCheckedChange={toggleBreak} disabled={busy} aria-label="Break mode" />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-teal-deep size-4" />
          <p className="text-sm font-medium">WhatsApp</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={waInput}
            onChange={(e) => setWaInput(e.target.value)}
            placeholder="+1 555 123 4567"
            inputMode="tel"
            className="h-9 max-w-[200px]"
          />
          <Button size="sm" variant="outline" onClick={saveWaNumber} disabled={busy || waInput.trim() === (waNumber ?? "")}>
            Save number
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">Redirect QR to WhatsApp</p>
            <p className="text-muted-foreground text-xs">
              {waRedirect
                ? "On — every scan of the in-store QR opens WhatsApp."
                : "Off — the QR opens web chat. Test WhatsApp privately first, then flip this on to go live."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {waRedirect && <Badge className="bg-[#25D366] text-white">Live on WhatsApp</Badge>}
            <Switch
              checked={waRedirect}
              onCheckedChange={toggleWaRedirect}
              disabled={busy || !waNumber}
              aria-label="Redirect to WhatsApp"
            />
          </div>
        </div>
        {!waNumber && (
          <p className="text-muted-foreground text-xs">Add a number above to enable the redirect.</p>
        )}
      </div>

      <div className={active ? "" : "pointer-events-none opacity-50"}>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div ref={qrRef} className="bg-card rounded-xl border p-3">
            <QRCodeCanvas value={url || SITE} size={168} level="M" includeMargin fgColor="#0f766e" />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-muted-foreground mb-1 text-xs">Scan or share this link</p>
              <code className="bg-muted block truncate rounded px-2 py-1.5 text-xs">{url}</code>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button size="sm" variant="outline" onClick={downloadQr}>
                <Download className="size-4" /> Download QR
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Print the QR for {storeName} and place it in-store. Customers scan it to chat with Rani —
              no app, no login.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-muted-foreground text-xs">
          <QrCode className="mr-1 inline size-3.5" />
          Regenerate if a QR is lost or leaked — the old one stops working.
        </p>
        <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy}>
          <RefreshCw className="size-4" /> Regenerate
        </Button>
      </div>
    </div>
  );
}
