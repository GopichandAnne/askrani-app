"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, Volume2 } from "lucide-react";
import { getVoiceSettings, saveAgentConfig } from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Female voices Rani can speak in (owner-facing names → set server-side).
const VOICES = [
  { key: "aria", name: "Aria", desc: "Warm & friendly" },
  { key: "sable", name: "Sable", desc: "Soft & gentle" },
  { key: "coral", name: "Coral", desc: "Bright & upbeat" },
  { key: "sage", name: "Sage", desc: "Calm & measured" },
];
const SAMPLE = "Hi, welcome in — I'm Rani. Let me help you find something you'll love tonight.";

export function VoiceCard() {
  const [loading, setLoading] = useState(true);
  const [voice, setVoice] = useState("aria");
  const [enabled, setEnabled] = useState(true);
  const [slug, setSlug] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getVoiceSettings().then((s) => {
      setVoice(s.voice);
      setEnabled(s.enabled);
      setSlug(s.slug);
      setToken(s.token);
      setLoading(false);
    });
  }, []);

  async function preview(voiceKey: string) {
    if (!token) {
      toast.error("Generate your diner link first, then preview the voice.");
      return;
    }
    setPreviewing(voiceKey);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
        },
        body: JSON.stringify({ slug, token, session_id: "web_preview", text: SAMPLE, voice: voiceKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (!blob.size) throw new Error("empty");
      const url = URL.createObjectURL(blob);
      let a = audioRef.current;
      if (!a) { a = new Audio(); audioRef.current = a; }
      a.onended = () => URL.revokeObjectURL(url);
      a.src = url;
      await a.play();
    } catch {
      toast.error("Couldn't play a preview — is the OpenAI key configured?");
    } finally {
      setPreviewing(null);
    }
  }

  async function save() {
    setSaving(true);
    const res = await saveAgentConfig({ tts_voice: voice, tts_enabled: enabled ? "true" : "false" });
    setSaving(false);
    if (res.ok) toast.success("Rani's voice saved");
    else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <div className="bg-card space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="flex items-center gap-1.5 text-sm font-medium">
            <Volume2 className="text-muted-foreground size-4" /> Rani&apos;s voice (premium)
          </Label>
          <p className="text-muted-foreground text-sm">
            When a diner turns on sound at the table, Rani speaks her picks and answers in a natural
            voice. Off falls back to the device&apos;s built-in voice (free).
          </p>
        </div>
        <Switch id="tts-toggle" checked={enabled} disabled={loading} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {VOICES.map((v) => {
            const on = voice === v.key;
            return (
              <div
                key={v.key}
                className={`flex items-center justify-between gap-2 rounded-md border p-2.5 ${on ? "border-[var(--teal-deep)] ring-1 ring-[var(--teal)]" : ""}`}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setVoice(v.key)} disabled={loading}>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {v.name}
                    {on && <span className="text-teal-deep text-[11px]">✓ selected</span>}
                  </span>
                  <span className="text-muted-foreground block text-xs">{v.desc}</span>
                </button>
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={previewing !== null || loading} onClick={() => preview(v.key)}>
                  {previewing === v.key ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  Preview
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button size="sm" onClick={save} disabled={saving || loading}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save voice
      </Button>
    </div>
  );
}
