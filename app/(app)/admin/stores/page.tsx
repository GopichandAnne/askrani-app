import { createAdminClient } from "@/lib/supabase/admin";
import { StoresView, type StoreRow } from "@/components/admin/stores-view";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const db = createAdminClient();

  const [storesRes, { data: staff }, usersRes] = await Promise.all([
    db
      .from("stores")
      .select("id, slug, store_display_name, business_type, active, whatsapp_status, created_at, insights_enabled")
      .order("created_at", { ascending: false }),
    db.from("staff").select("store_id, user_id, role, name").eq("role", "owner"),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  // Tolerate migration 0065 not being applied yet (insights_enabled column).
  type StoreDbRow = {
    id: string; slug: string; store_display_name: string | null;
    business_type: string | null; active: boolean;
    whatsapp_status: string | null; created_at: string; insights_enabled?: boolean;
  };
  let stores = (storesRes.data as StoreDbRow[] | null) ?? null;
  if (storesRes.error) {
    const fb = await db
      .from("stores")
      .select("id, slug, store_display_name, business_type, active, whatsapp_status, created_at")
      .order("created_at", { ascending: false });
    stores = (fb.data as StoreDbRow[] | null) ?? null;
  }

  const emailById = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const ownersByStore = new Map<string, string[]>();
  for (const s of staff ?? []) {
    const label = emailById.get(s.user_id) || s.name || s.user_id.slice(0, 8);
    const list = ownersByStore.get(s.store_id) ?? [];
    list.push(label);
    ownersByStore.set(s.store_id, list);
  }

  const rows: StoreRow[] = (stores ?? []).map((s) => ({
    id: s.id,
    slug: s.slug,
    displayName: s.store_display_name,
    businessType: s.business_type,
    active: s.active,
    whatsappStatus: s.whatsapp_status,
    createdAt: s.created_at,
    owners: ownersByStore.get(s.id) ?? [],
    insightsEnabled: s.insights_enabled ?? false,
  }));

  return <StoresView initial={rows} />;
}
