"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createMyStore } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, Send } from "lucide-react";

type Msg = { role: "owner" | "rani"; text: string };
interface Config {
  businessName?: string;
  businessType?: string;
  ownerName?: string;
  email?: string;
  personality?: string;
  storePrompt?: string;
  greeting?: string;
  suggestionChips?: string[];
}
type SpeechRec = {
  lang: string; interimResults: boolean; maxAlternatives?: number;
  onresult: (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void;
  onerror: () => void; onend: () => void; start: () => void;
};
type SpeechWindow = Window & { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec };

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
  const [provisioning, setProvisioning] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const supabase = createClient();

  async function turn(next: Msg[]) {
    setBusy(true);
    setChips([]);
    const { data, error } = await supabase.functions.invoke("setup-interview", { body: { messages: next, email } });
    if (error || !data?.reply) {
      setBusy(false);
      toast.error("Rani had trouble responding", { description: "Please try again." });
      return;
    }
    setMessages([...next, { role: "rani", text: data.reply as string }]);
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

  // Voice input via the browser's built-in Web Speech API (no key, no cost).
  function startVoice() {
    const w = window as SpeechWindow;
    const SR = w.webkitSpeechRecognition || w.SpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser", { description: "Try Chrome, or type your answer." });
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    rec.onresult = (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      setInput((prev) => (prev ? `${prev} ${said}` : said));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

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
              {provisioning ? "Setting up your store…" : "Rani is typing…"}
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
          disabled={busy || provisioning}
          title="Speak your answer"
        >
          <Mic className="size-4" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Type or tap the mic to speak…"}
          disabled={busy || provisioning}
        />
        <Button type="submit" size="icon" disabled={busy || provisioning || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
