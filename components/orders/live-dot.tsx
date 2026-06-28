import { cn } from "@/lib/utils";

/**
 * The subtle teal "live" pulse — the signature of the realtime order feed.
 * `connected=false` shows a muted, non-pulsing dot.
 */
export function LiveDot({
  connected = true,
  label = "live",
  className,
}: {
  connected?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1.5 text-xs",
        className,
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          connected
            ? "bg-teal-light animate-live-pulse"
            : "bg-muted-foreground/40",
        )}
      />
      {connected ? label : "offline"}
    </span>
  );
}
