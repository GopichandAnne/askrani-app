import { createAdminClient } from "@/lib/supabase/admin";
import { StoresView, type StoreRow } from "@/components/admin/stores-view";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const db = createAdminClient();

  const [{ data: stores }, { data: staff }, usersRes] = await Promise.all([
    db
      .from("stores")
      .select("id, slug, store_display_name, business_type, active, whatsapp_status, created_at")
      .order("created_at", { ascending: false }),
    db.from("staff").select("store_id, user_id, role, name").eq("role", "owner"),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

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
  }));

  return <StoresView initial={rows} />;
}
