import { cn } from "@/lib/utils";

/** Playfair Display (italic 800) "Ask Rani" wordmark. Use with restraint. */
export function Wordmark({
  className,
  withDot = true,
}: {
  className?: string;
  withDot?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-display text-teal-deep dark:text-teal-light inline-flex items-baseline gap-1 text-xl italic",
        className,
      )}
    >
      Ask Rani
      {withDot && (
        <span className="bg-gradient-primary inline-block size-1.5 translate-y-[-2px] rounded-full" />
      )}
    </span>
  );
}
