# Custom domains — point all Supabase URLs via askrani.ai

Goal: serve every Supabase surface (REST · Auth · Storage · Realtime · Functions)
from **askrani.ai subdomains** instead of the default `*.supabase.co`, for both
projects. The default `*.supabase.co` keeps working after activation, so this is
**non-breaking** — you flip clients over at your own pace.

## Projects & chosen subdomains

| Project | Ref | Default host | Custom domain |
|---|---|---|---|
| **Rani** (askrani-prod) | `ctdczunzetcftcadbrot` | `ctdczunzetcftcadbrot.supabase.co` | **`api.askrani.ai`** |
| **Insights** | `lmyyomktjlearynqmthu` | `lmyyomktjlearynqmthu.supabase.co` | **`insights-api.askrani.ai`** |

One subdomain serves ALL of a project's surfaces (e.g. `https://api.askrani.ai/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`).

## Prerequisites (your infra)

1. **Supabase Pro plan** on each project + the **Custom Domain add-on** (~$10/mo per project ⇒ ~$20/mo total). Enable per project in Dashboard → Settings → Add-ons.
2. **DNS access for askrani.ai** (Cloudflare / registrar). You'll add the CNAME + TXT records the CLI prints.
3. Supabase CLI logged in (already is — `npx supabase`).

---

## Step 1 — create the custom hostname (per project)

```bash
# Rani
npx supabase domains create --project-ref ctdczunzetcftcadbrot --custom-hostname api.askrani.ai
# Insights
npx supabase domains create --project-ref lmyyomktjlearynqmthu --custom-hostname insights-api.askrani.ai
```

Each prints the **DNS records to add** (a CNAME for the subdomain + one or more TXT
records for ownership/SSL validation).

## Step 2 — add the DNS records

In the askrani.ai DNS zone, add exactly what the CLI printed:
- `CNAME  api.askrani.ai            → <target the CLI gives, e.g. ...supabase.co>`
- `TXT    _cf-custom-hostname...    → <validation value>`  (and any others shown)
- Same for `insights-api.askrani.ai`.

> If askrani.ai is on **Cloudflare, set the CNAME to "DNS only" (grey cloud)** during
> validation — proxying (orange cloud) breaks Supabase's own TLS challenge.

## Step 3 — verify & activate

```bash
npx supabase domains reverify  --project-ref ctdczunzetcftcadbrot
npx supabase domains activate  --project-ref ctdczunzetcftcadbrot
npx supabase domains reverify  --project-ref lmyyomktjlearynqmthu
npx supabase domains activate  --project-ref lmyyomktjlearynqmthu
```

`activate` issues the cert and flips the project's API/Auth over to the custom host.

---

## Step 4 — point the apps at the custom domains (env)

The code is already env-driven, so this is only env changes + redeploys.

**askrani-web** (Vercel) — Rani customer app:
```
NEXT_PUBLIC_SUPABASE_URL = https://api.askrani.ai
```

**local-intel / Insights** (Vercel):
```
NEXT_PUBLIC_SUPABASE_URL = https://insights-api.askrani.ai
SUPABASE_URL             = https://insights-api.askrani.ai
RANI_OPS_URL             = https://api.askrani.ai/functions/v1/ops-slice   # umbrella pull
```

**askrani-app** (Supabase function secrets) — so public asset URLs use the custom host:
```bash
npx supabase secrets set PUBLIC_ASSET_BASE=https://api.askrani.ai --project-ref ctdczunzetcftcadbrot
```
> Do NOT change the `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` injected into edge
> functions — those are internal and managed by Supabase. `PUBLIC_ASSET_BASE` only
> affects outward-facing asset URLs (mock-realty demo, and any future public links).

Redeploy both Vercel apps after changing env (env changes need a fresh deploy).

## Step 5 — Auth settings (per project, Dashboard → Authentication → URL config)

- Add the custom domain to **Site URL** / **Redirect URLs** allow-list.
- Note: the JWT **issuer (`iss`) changes** to the custom domain after activation.
  Existing sessions keep working via the old host; new sign-ins issue against the
  new host. No code change needed (clients read the URL from env).

## Step 6 — repoint external webhooks (Rani only)

These are registered on third-party dashboards pointing at `*.supabase.co` today.
Update them to the custom domain (old URL still works, so do it when convenient):

- **WhatsApp (Meta)** webhook → `https://api.askrani.ai/functions/v1/whatsapp-webhook`
  (re-verify with the same `WHATSAPP` verify token in the Meta app).
- **Stripe** webhook → `https://api.askrani.ai/functions/v1/stripe-webhook`
  (keep the same endpoint's signing secret).
- Any monitor/cron hitting `health`, `followup`, etc. → swap the host.

## Step 7 — verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.askrani.ai/auth/v1/health           # 200
curl -s -o /dev/null -w "%{http_code}\n" https://insights-api.askrani.ai/auth/v1/health  # 200
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://api.askrani.ai/functions/v1/ops-slice?store=man-pasand-lakeline" \
  -H "Authorization: Bearer $INSIGHTS_OPS_SECRET"                                          # 200 + JSON
```
Then load each app, sign in, and check the browser network tab shows `askrani.ai`
hosts (not `supabase.co`).

## Notes on already-stored URLs (data, not code)

Public image URLs already saved in the DB (store logos, catalog images, flyer
scans) may contain `*.supabase.co`. They keep resolving (both hosts serve the same
bucket), so no rush. If you want them uniform, a one-time SQL `replace()` on the
relevant columns migrates them — optional, cosmetic.

## Rollback

Both hosts resolve simultaneously, so rollback is just reverting the env vars to the
`*.supabase.co` URLs and redeploying. Deactivate with
`npx supabase domains delete --project-ref <ref>` if you want to drop the add-on.

---

**Status:** code is prepped (nothing hardcoded to `*.supabase.co` anymore). Enable
the add-on + DNS when ready, then ping me — I'll run Steps 1 & 3 (CLI), give you the
exact DNS records, and flip all the env in Steps 4–6.
