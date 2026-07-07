import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";

/**
 * Server-side guard for the platform-admin (super admin) area. Defense in depth
 * beyond hiding the nav items: any non-admin hitting /admin/* is bounced.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isPlatformAdmin) redirect("/orders");
  return <>{children}</>;
}
