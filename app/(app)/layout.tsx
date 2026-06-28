import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { StoreProvider } from "@/components/store/store-provider";
import { Sidebar } from "@/components/app-shell/sidebar";
import { StoreSwitcher } from "@/components/app-shell/store-switcher";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NoAccess } from "@/components/app-shell/no-access";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");

  // Authenticated but linked to no store.
  if (!ctx.active || ctx.stores.length === 0) {
    return <NoAccess email={ctx.user.email} />;
  }

  return (
    <StoreProvider
      value={{
        stores: ctx.stores,
        active: ctx.active,
        isPlatformAdmin: ctx.isPlatformAdmin,
      }}
    >
      <div className="bg-background flex h-dvh overflow-hidden">
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
    </StoreProvider>
  );
}
