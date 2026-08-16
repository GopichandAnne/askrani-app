"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, Send } from "lucide-react";

type Msg = { role: "owner" | "rani"; text: string };

const STARTERS = [
  "Make my greeting friendlier",
  "We're closed on Sundays now",
  "We do delivery too",
  "What are credits?",
  "Help me go live on WhatsApp",
];

/** The in-panel copilot chat. Answers help questions AND changes store settings by
 *  natural language (the owner-copilot function executes the edits, metered). */
export function AssistantChat({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "rani", text: `Hi! I'm Rani for ${storeName}. Ask me anything, or tell me what to change.` },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "owner", text: t }];
    setMessages(next);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("owner-copilot", {
      body: { storeSlug, messages: next.map((m) => ({ role: m.role, text: m.text })) },
    });
    setBusy(false);
    if (error || !data?.reply) {
      toast.error("Rani had trouble responding", { description: "Please try again." });
      return;
    }
    setMessages([...next, { role: "rani", text: data.reply as string }]);
    // If Rani changed settings, refresh server data (nav counts, vocab, etc.).
    if (Array.isArray(data.changed) && data.changed.length > 0) router.refresh();
  }

  // Voice: on-device Web Speech API where available, else record + Whisper (the
  // transcribe edge function) so voice works on every device.
  const { listening, busy: transcribing, toggle: startVoice } = useVoiceInput(
    async (blob) => {
      const fd = new FormData();
      fd.append("file", blob, (blob as File).name || "speech.webm");
      const { data } = await supabase.functions.invoke("transcribe", { body: fd });
      return (data as { text?: string } | null)?.text ?? "";
    },
    (t) => setInput((p) => (p ? `${p} ${t}` : t)),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "owner" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "owner"
                  ? "bg-primary text-primary-foreground max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2 text-sm"
                  : "bg-muted text-foreground max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm"
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" /> Rani is thinking…
            </div>
          </div>
        )}
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 py-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="border-input hover:bg-accent rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t pt-3">
        <Button type="button" size="icon" variant={listening ? "default" : "outline"} onClick={startVoice} disabled={busy || transcribing} title={listening ? "Tap to stop" : "Speak"}>
          {transcribing ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening… tap the mic to stop" : transcribing ? "Transcribing…" : "Ask, or tell me what to change…"}
          disabled={busy}
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
