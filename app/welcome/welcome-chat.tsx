"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createMyStore } from "./actions";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, Send } from "lucide-react";

type Msg = { role: "owner" | "rani"; text: string };
interface Config {
  businessName?: string;
  businessType?: string;
  website?: string;
  address?: string;
  ownerName?: string;
  email?: string;
  personality?: string;
  storePrompt?: string;
  greeting?: string;
  suggestionChips?: string[];
  captureTypes?: string[];
}
type Detect = { kind: "local" | "online"; query: string; name?: string };
type Detected = Record<string, unknown> | null;

/**
 * The Setup Copilot — conversational store setup. Rani interviews the owner one
 * plain question at a time (their language, tap-able chips, or voice); when it has
 * enough it writes the whole config and provisions the store. No forms, no prompts.
 */
export function WelcomeChat({ email }: { email: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const supabase = createClient();

  // Look the business up from the one identifier the owner gave (address → Google
  // Place + hours, or website → homepage read). Fail-soft: a miss just returns null
  // and the interview carries on asking normally.
  async function runDetect(detect: Detect): Promise<Detected> {
    try {
      const { data } = await supabase.functions.invoke("detect-business", { body: detect });
      return (data as { detected?: Detected } | null)?.detected ?? null;
    } catch {
      return null;
    }
  }

  async function turn(next: Msg[], detected?: Detected, afterDetect = false) {
    setBusy(true);
    setChips([]);
    const { data, error } = await supabase.functions.invoke("setup-interview", { body: { messages: next, email, detected } });
    if (error || !data?.reply) {
      setBusy(false);
      setDetecting(false);
      toast.error("Rani had trouble responding", { description: "Please try again." });
      return;
    }
    const withReply: Msg[] = [...next, { role: "rani", text: data.reply as string }];
    setMessages(withReply);

    // Detect handshake: Rani asked us to look the business up. Run it, then feed the
    // result back into the very next turn so Rani confirms instead of interrogates.
    // `afterDetect` guards against ever looping on a second detect signal.
    const detect = data.detect as Detect | null;
    if (detect?.query && !afterDetect) {
      setDetecting(true);
      const found = await runDetect(detect);
      setDetecting(false);
      await turn(withReply, found ?? { found: false }, true);
      return;
    }

    if (data.done && data.config) {
      await provision(data.config as Config);
    } else {
      setChips(Array.isArray(data.chips) ? data.chips : []);
      setBusy(false);
    }
  }

  async function provision(config: Config) {
    setProvisioning(true);
    const res = await createMyStore({
      businessName: String(config.businessName ?? "My business"),
      businessType: config.businessType || undefined,
      ownerName: config.ownerName || undefined,
      email: config.email || email || undefined,
      agent: {
        personality: config.personality || undefined,
        storePrompt: config.storePrompt || undefined,
        greeting: config.greeting || undefined,
        suggestionChips: Array.isArray(config.suggestionChips) ? config.suggestionChips : undefined,
      },
      captureTypes: Array.isArray(config.captureTypes) ? config.captureTypes : undefined,
    });
    if (!res.ok) {
      setProvisioning(false);
      setBusy(false);
      toast.error("Couldn't finish setup", { description: res.error });
      return;
    }
    window.location.assign("/"); // full nav so the new active-store cookie + staff link are read
  }

  // Kick off the interview (first question) once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void turn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chips, busy]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    void turn([...messages, { role: "owner", text: t }]);
  }

  // Voice input: on-device Web Speech API where available, else record + Whisper
  // (the transcribe edge function) so voice works on every device.
  const { listening, busy: transcribing, toggle: startVoice } = useVoiceInput(
    async (blob) => {
      const fd = new FormData();
      fd.append("file", blob, (blob as File).name || "speech.webm");
      const { data } = await supabase.functions.invoke("transcribe", { body: fd });
      return (data as { text?: string } | null)?.text ?? "";
    },
    (t) => setInput((prev) => (prev ? `${prev} ${t}` : t)),
  );

  return (
    <div className="flex h-[460px] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "owner" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "owner"
                  ? "bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm"
                  : "bg-muted text-foreground max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm"
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {(busy || provisioning) && (
          <div className="flex justify-start">
            <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              {provisioning ? "Setting up your store…" : detecting ? "Looking up your business…" : "Rani is typing…"}
            </div>
          </div>
        )}
      </div>

      {chips.length > 0 && !busy && (
        <div className="flex flex-wrap gap-2 px-1 pb-2">
          {chips.map((c, i) => (
            <button
              key={i}
              onClick={() => send(c)}
              className="border-input hover:bg-accent rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 border-t pt-3"
      >
        <Button
          type="button"
          size="icon"
          variant={listening ? "default" : "outline"}
          onClick={startVoice}
          disabled={busy || provisioning || transcribing}
          title={listening ? "Tap to stop" : "Speak your answer"}
        >
          {transcribing ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening… tap the mic to stop" : transcribing ? "Transcribing…" : "Type or tap the mic to speak…"}
          disabled={busy || provisioning}
        />
        <Button type="submit" size="icon" disabled={busy || provisioning || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
