"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import {
  generateChips,
  getStoreLink,
  getPublishableKey,
  rotatePublishableKey,
  removeStoreLogo,
  saveChips,
  setLinkActive,
  regenerateLink,
  setStoreLogo,
  setWebChatPaused,
  setWhatsappNumber,
  setWhatsappRedirect,
  setSessionMinutes,
  setWhiteLabel,
  setAnswersPublished,
} from "@/app/(app)/link/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Clock, Copy, Download, ImagePlus, Loader2, MessageCircle, QrCode, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { ProofPanel } from "@/components/store-link/proof-panel";
import { ListingQrs } from "@/components/store-link/listing-qrs";
import { TableQrs } from "@/components/store-link/table-qrs";
import { DIAL_CODES, combineDial, splitDial } from "@/lib/phone";

const TIMEOUTS: [number, string][] = [
  [15, "15 minutes"],
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
  [240, "4 hours"],
  [480, "8 hours"],
  [1440, "24 hours"],
];

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
  const [waDial, setWaDial] = useState("+1");
  const [sessionMinutes, setSessionMins] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [whiteLabel, setWhiteLabelState] = useState(false);
  const [answersPublished, setAnswersPublishedState] = useState(false);
  const [answersBusy, setAnswersBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [chips, setChips] = useState("");
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [genChips, setGenChips] = useState(false);
  const [savedChips, setSavedChips] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const url = token ? `${SITE}/s/${storeSlug}?t=${token}` : "";
  // One-value publishable key snippet (the developer-friendly form). Falls back to
  // the slug+token form only while the key is still loading.
  const embedSnippet = pubKey
    ? `<script src="${SITE}/embed.js" data-key="${pubKey}" async></script>`
    : token
      ? `<script src="${SITE}/embed.js" data-slug="${storeSlug}" data-token="${token}" async></script>`
      : "";

  useEffect(() => {
    let alive = true;
    getStoreLink(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setToken(res.token);
        setActive(res.active);
        setPaused(res.paused);
        setWaNumber(res.waNumber);
        { const { dial, local } = splitDial(res.waNumber); setWaDial(dial); setWaInput(local); }
        setWaRedirect(res.waRedirect);
        setSessionMins(res.sessionMinutes);
        setLogoUrl(res.logoUrl);
        setChips(res.chips);
        setBusinessType(res.businessType);
        setWhiteLabelState(res.whiteLabel);
        setAnswersPublishedState(res.answersPublished);
      } else {
        toast.error("Couldn't load link", { description: res.error });
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  useEffect(() => {
    let alive = true;
    getPublishableKey(storeId).then((res) => {
      if (alive && res.ok) setPubKey(res.key);
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function rotateKey() {
    if (
      !confirm(
        "Rotate the publishable key? The old key stops working immediately and any site using it must be updated.",
      )
    )
      return;
    setRotatingKey(true);
    const res = await rotatePublishableKey(storeId);
    setRotatingKey(false);
    if (res.ok) {
      setPubKey(res.key);
      toast.success("New publishable key issued");
    } else {
      toast.error("Couldn't rotate key", { description: res.error });
    }
  }

  async function toggleAnswers(next: boolean) {
    setAnswersBusy(true);
    setAnswersPublishedState(next); // optimistic
    const res = await setAnswersPublished(storeId, next);
    setAnswersBusy(false);
    if (!res.ok) {
      setAnswersPublishedState(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "Answers page published — submitting to search & AI" : "Answers page unpublished");
    }
  }

  async function toggleWhiteLabel(next: boolean) {
    setWhiteLabelState(next); // optimistic
    const res = await setWhiteLabel(storeId, next);
    if (!res.ok) {
      setWhiteLabelState(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "Attribution removed" : "Attribution restored");
    }
  }

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
    const res = await setWhatsappNumber(storeId, combineDial(waDial, waInput));
    setBusy(false);
    if (res.ok) {
      setWaNumber(res.waNumber);
      { const { dial, local } = splitDial(res.waNumber); setWaDial(dial); setWaInput(local); }
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

  async function changeTimeout(next: number) {
    const prev = sessionMinutes;
    setSessionMins(next); // optimistic
    setBusy(true);
    const res = await setSessionMinutes(storeId, next);
    setBusy(false);
    if (!res.ok) {
      setSessionMins(prev);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success("Session timeout updated");
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

  function copyEmbed() {
    navigator.clipboard.writeText(embedSnippet);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 1500);
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.set("logo", file);
    const res = await setStoreLogo(storeId, fd);
    setBusy(false);
    if (res.ok) {
      setLogoUrl(res.logoUrl);
      toast.success("Chat logo updated");
    } else {
      toast.error("Couldn't upload logo", { description: res.error });
    }
  }

  async function clearLogo() {
    setBusy(true);
    const res = await removeStoreLogo(storeId);
    setBusy(false);
    if (res.ok) {
      setLogoUrl(null);
      toast.success("Logo removed — back to the default Rani avatar");
    } else {
      toast.error("Couldn't remove logo", { description: res.error });
    }
  }

  async function suggestChips() {
    setGenChips(true);
    const res = await generateChips(storeId);
    setGenChips(false);
    if (res.ok && res.chips.length) {
      setChips(res.chips.join("\n"));
      toast.success("Drafted from your store — review and Save");
    } else if (res.ok) {
      toast.error("Couldn't compose questions — add more store info first.");
    } else {
      toast.error("Couldn't generate", { description: res.error });
    }
  }

  async function commitChips() {
    setBusy(true);
    const res = await saveChips(storeId, chips);
    setBusy(false);
    if (res.ok) {
      setSavedChips(true);
      setTimeout(() => setSavedChips(false), 1500);
      toast.success("Starter questions saved");
    } else {
      toast.error("Couldn't save", { description: res.error });
    }
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

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Clock className="text-muted-foreground size-3.5" /> Session timeout
          </p>
          <p className="text-muted-foreground text-xs">
            How long a visitor&apos;s chat stays active before a fresh scan starts a new one.
          </p>
        </div>
        <Select
          value={String(sessionMinutes)}
          onValueChange={(v) => changeTimeout(Number(v))}
          disabled={busy}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEOUTS.map(([m, label]) => (
              <SelectItem key={m} value={String(m)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-teal-deep size-4" />
          <p className="text-sm font-medium">WhatsApp</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Country code"
            value={waDial}
            onChange={(e) => setWaDial(e.target.value)}
            className="border-input bg-transparent focus-visible:ring-ring h-9 shrink-0 rounded-md border px-2 text-sm shadow-sm outline-none focus-visible:ring-1"
          >
            {DIAL_CODES.map((c) => (
              <option key={c.name} value={c.dial}>
                {c.flag} {c.dial}
              </option>
            ))}
          </select>
          <Input
            value={waInput}
            onChange={(e) => setWaInput(e.target.value)}
            placeholder="555 123 4567"
            inputMode="tel"
            className="h-9 max-w-[160px]"
          />
          <Button size="sm" variant="outline" onClick={saveWaNumber} disabled={busy || combineDial(waDial, waInput) === (waNumber ?? "")}>
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

      {/* Chat logo — shown in the chat header instead of the default Rani avatar. */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">Chat logo</p>
        <p className="text-muted-foreground text-xs">
          Shown on the chat welcome screen (the top-left Ask Rani logo stays). A square image works
          best (PNG, SVG, or JPG, up to 2 MB).
        </p>
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Store logo" className="size-full object-cover" />
            ) : (
              <ImagePlus className="text-muted-foreground size-5" />
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadLogo(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => logoInputRef.current?.click()}>
            <ImagePlus className="size-4" /> {logoUrl ? "Replace" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={clearLogo}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>

      {/* Starter questions — the tappable hint tiles shown when a chat opens. */}
      <div className={active ? "space-y-2 border-t pt-4" : "pointer-events-none space-y-2 border-t pt-4 opacity-50"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Starter questions</p>
          <Button size="sm" variant="outline" disabled={genChips || busy} onClick={suggestChips}>
            {genChips ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Suggest with AI
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          The tappable questions shown when a chat opens (the first 3 appear). One per line. “Suggest
          with AI” drafts them from your store’s info and knowledge base — leave blank to use smart
          defaults.
        </p>
        <Textarea
          rows={4}
          value={chips}
          onChange={(e) => setChips(e.target.value)}
          placeholder={"Where can I find rice?\nDo you deliver?\nWhat are your hours?"}
        />
        <Button size="sm" onClick={commitChips} disabled={busy}>
          {savedChips ? <Check className="size-4" /> : <Save className="size-4" />}
          {savedChips ? "Saved" : "Save questions"}
        </Button>
      </div>

      {/* Embed on a website — a floating chat widget powered by the same web chat.
          Uses the publishable key, which is independent of the QR link toggle. */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">Embed on your website</p>
        <p className="text-muted-foreground text-xs">
          Paste this before <code className="bg-muted rounded px-1">&lt;/body&gt;</code> on any page.
          A chat bubble appears in the corner — same Rani, no coding.
        </p>
        <code className="bg-muted block overflow-x-auto whitespace-pre rounded px-2 py-1.5 text-xs">
          {embedSnippet || "…"}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copyEmbed} disabled={!embedSnippet}>
            {copiedEmbed ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiedEmbed ? "Copied" : "Copy embed code"}
          </Button>
          {pubKey && (
            <Button size="sm" variant="ghost" onClick={rotateKey} disabled={rotatingKey}>
              {rotatingKey ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Rotate key
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-[11px]">
          <code className="bg-muted rounded px-1">data-key</code> is a publishable key — safe to include in
          your page source. Rotate it if it ever leaks.
        </p>
        <label className="flex items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted-foreground text-xs">
            White-label — remove <span className="font-medium">&ldquo;Powered by Ask Rani&rdquo;</span> from the chat header
          </span>
          <Switch checked={whiteLabel} onCheckedChange={toggleWhiteLabel} />
        </label>
        <div className="border-t pt-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">Public Answers page</span> — a crawlable page of your Q&amp;A so Google &amp; AI (ChatGPT, Perplexity) can answer about you
            </span>
            <Switch checked={answersPublished} onCheckedChange={toggleAnswers} disabled={answersBusy} />
          </label>
          {answersPublished && (
            <a
              href={`${SITE}/a/${storeSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              style={{ color: "#0d9488" }}
            >
              View your Answers page → {SITE.replace(/^https?:\/\//, "")}/a/{storeSlug}
            </a>
          )}
        </div>
        {answersPublished && <ProofPanel storeId={storeId} />}
      </div>

      {businessType === "realtor" && <ListingQrs storeId={storeId} storeSlug={storeSlug} />}

      {businessType === "restaurant" && token && (
        <TableQrs storeSlug={storeSlug} storeName={storeName} token={token} />
      )}

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
