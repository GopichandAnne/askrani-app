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

  // Latest Insights access change per store (best-effort — audit table is
  // migration 0066; tolerate it not existing yet).
  type AuditRow = { store_id: string; enabled: boolean; actor_email: string | null; created_at: string };
  const lastChangeByStore = new Map<string, { email: string | null; at: string; enabled: boolean }>();
  const auditRes = await (
    db as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => PromiseLike<{ data: AuditRow[] | null }>;
          };
        };
      };
    }
  )
    .from("insights_access_audit")
    .select("store_id, enabled, actor_email, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  for (const a of (auditRes as { data: AuditRow[] | null }).data ?? []) {
    if (!lastChangeByStore.has(a.store_id)) {
      lastChangeByStore.set(a.store_id, { email: a.actor_email, at: a.created_at, enabled: a.enabled });
    }
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
    lastAccessChange: lastChangeByStore.get(s.id) ?? null,
  }));

  return <StoresView initial={rows} />;
}
