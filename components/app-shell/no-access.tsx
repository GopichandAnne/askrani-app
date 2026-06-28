import { Wordmark } from "@/components/app-shell/wordmark";
import { Button } from "@/components/ui/button";

/** Shown to an authenticated user who has no staff record on any store. */
export function NoAccess({ email }: { email: string | null }) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <Wordmark className="justify-center" />
        <h1 className="text-lg font-semibold">No store access yet</h1>
        <p className="text-muted-foreground text-sm">
          You&apos;re signed in as{" "}
          <span className="text-foreground font-medium">{email ?? "unknown"}</span>
          , but this account isn&apos;t linked to any store. Ask an owner to add
          you, then sign in again.
        </p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
