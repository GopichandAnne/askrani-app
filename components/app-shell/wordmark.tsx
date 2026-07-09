import { cn } from "@/lib/utils";
import { RaniMark } from "@/components/app-shell/rani-mark";

/** Rani robot + "Ask Rani" (Playfair italic) — matches the marketing site. */
export function Wordmark({
  className,
  withIcon = true,
}: {
  className?: string;
  withIcon?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-display text-teal-deep dark:text-teal-light inline-flex items-center gap-2 text-xl italic leading-none",
        className,
      )}
    >
      {withIcon && <RaniMark animated={false} className="h-[1.15em] w-auto shrink-0" />}
      Ask Rani
    </span>
  );
}
