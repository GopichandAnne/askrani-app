import { redirect } from "next/navigation";
import { getActiveStore, getStoreCapabilities } from "@/lib/store/active-store";
import { StoreProvider } from "@/components/store/store-provider";
import { Sidebar } from "@/components/app-shell/sidebar";
import { StoreSwitcher } from "@/components/app-shell/store-switcher";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ConsoleAssistant } from "@/components/app-shell/console-assistant";
import { getTourStore, TOUR_STORE_KEY } from "@/lib/tour/store";
import { mintTourToken } from "@/lib/tour/token";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");

  // Authenticated but linked to no store → first-run self-serve store creation.
  if (!ctx.active || ctx.stores.length === 0) {
    redirect("/welcome");
  }

  const capabilities = await getStoreCapabilities(ctx.active.id);

  // Product-tour: on the tour store's own console, embed its customer-facing
  // assistant as a floating bubble that acts AS the signed-in owner — the identity
  // token is minted here, server-side, from the session we already have (no separate
  // chat login). Only for the tour store, and only when authenticated embed is set.
  let tourToken: string | null = null;
  try {
    const tour = await getTourStore();
    if (tour && tour.id === ctx.active.id && tour.identitySecret && ctx.user.email) {
      tourToken = mintTourToken(tour.identitySecret, { email: ctx.user.email, sub: ctx.user.id, ttlSec: 3600 });
    }
  } catch {
    /* never break the console for the preview bubble */
  }

  return (
    <StoreProvider
      value={{
        stores: ctx.stores,
        active: ctx.active,
        isPlatformAdmin: ctx.isPlatformAdmin,
        capabilities,
      }}
    >
      <div className="bg-background fixed inset-0 flex overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
            <StoreSwitcher />
            <div className="flex-1" />
            <ThemeToggle />
            <UserMenu email={ctx.user.email} />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      {tourToken ? <ConsoleAssistant token={tourToken} publishableKey={TOUR_STORE_KEY} /> : null}
    </StoreProvider>
  );
}
