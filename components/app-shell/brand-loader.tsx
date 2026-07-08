import { RaniMark } from "@/components/app-shell/rani-mark";
import { cn } from "@/lib/utils";

/**
 * Branded loading state — a spinning teal ring around a bobbing Rani. Used as the
 * route-transition overlay (app/(app)/loading.tsx) and anywhere a page waits.
 */
export function BrandLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[70dvh] w-full flex-col items-center justify-center gap-5",
        className,
      )}
    >
      <div className="relative grid size-20 place-items-center">
        {/* spinning gradient ring */}
        <span className="border-teal-mist border-t-teal absolute inset-0 animate-spin rounded-full border-4" />
        {/* soft glow */}
        <span className="bg-teal/10 absolute inset-1 rounded-full blur-md" />
        <RaniMark className="animate-bob w-9" />
      </div>
      <p className="text-muted-foreground animate-pulse text-sm">{label}</p>
    </div>
  );
}
