import { createAdminClient } from "@/lib/supabase/admin";
import { WaitlistView } from "@/components/admin/waitlist-view";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const db = createAdminClient();
  const { data } = await db
    .from("waitlist")
    .select("*")
    .order("created_at", { ascending: false });

  return <WaitlistView initial={data ?? []} />;
}
