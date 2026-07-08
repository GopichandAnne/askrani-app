import { BrandLoader } from "@/components/app-shell/brand-loader";

/**
 * Shown in the content area (sidebar persists) while a feature page loads on
 * navigation — a branded overlay so switching sections never feels frozen.
 */
export default function Loading() {
  return <BrandLoader />;
}
