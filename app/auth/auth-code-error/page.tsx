import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/app-shell/wordmark";

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
        <Button asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
