import Link from "next/link";
import { Wordmark } from "@/components/app-shell/wordmark";

// Force dynamic so this page is NOT statically prerendered at build time — the
// static collection of this route was failing the whole build ("e.createContext
// is not a function"), which blocked every Rani web deploy. An error page has no
// reason to be static. We also render a plain styled link instead of the Radix
// <Button asChild> to keep this page free of client-component context at build.
export const dynamic = "force-dynamic";

export default function AuthCodeErrorPage() {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <Wordmark className="justify-center" />
        <h1 className="text-lg font-semibold">That sign-in link didn&apos;t work</h1>
        <p className="text-muted-foreground text-sm">
          The link may have expired or already been used. Request a fresh one and
          open it on this device.
        </p>
        <Link
          href="/login"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
