import { cn } from "@/lib/utils";

/**
 * The Rani robot mark. viewBox is tightened to hug the robot so it sizes cleanly
 * next to text. `animated` glows the antennae (on for the loader, off for logos).
 */
export function RaniMark({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg viewBox="20 3 60 98" className={cn("block", className)} aria-hidden="true">
      <line x1="38" y1="22" x2="33" y2="12" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="10" r="4.5" fill="#14B8A6">
        {animated && <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" />}
      </circle>
      <line x1="62" y1="22" x2="67" y2="12" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="68" cy="10" r="4.5" fill="#FB923C">
        {animated && <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" begin="0.5s" repeatCount="indefinite" />}
      </circle>
      <rect x="25" y="20" width="50" height="40" rx="18" fill="#f0fdfa" stroke="#99f6e4" strokeWidth="1.5" />
      <circle cx="42" cy="38" r="6" fill="white" stroke="#ccfbf1" />
      <circle cx="58" cy="38" r="6" fill="white" stroke="#ccfbf1" />
      <circle cx="42.5" cy="38.5" r="3.5" fill="#14B8A6" />
      <circle cx="58.5" cy="38.5" r="3.5" fill="#14B8A6" />
      <circle cx="41" cy="36.5" r="1.5" fill="white" opacity="0.85" />
      <circle cx="57" cy="36.5" r="1.5" fill="white" opacity="0.85" />
      <path d="M44 52 Q50 57 56 52" stroke="#14B8A6" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="35" y="65" width="30" height="32" rx="12" fill="#14B8A6" />
      <circle cx="45" cy="78" r="1.6" fill="white" opacity="0.35" />
      <circle cx="50" cy="78" r="1.6" fill="white" opacity="0.35" />
      <circle cx="55" cy="78" r="1.6" fill="white" opacity="0.35" />
    </svg>
  );
}
