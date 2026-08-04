# Granting a store access to Ask Rani Insights

**Ask Rani Insights** is our local market-intelligence product (competitor
pricing, reviews, social, and a weekly action plan). It runs at
`insights.askrani.ai` and can be opened directly from a store's operator panel —
the owner clicks one button and lands in Insights already signed in (no separate
account or password).

Access is **off by default** and granted per store by a **platform admin**.

---

## Who can grant it

Only **platform admins** (accounts in the `platform_admins` table — the same
people who see the **Stores** and **Waitlist** items under the sidebar's *Admin*
section). Owners and staff cannot grant it to themselves.

## How to grant access to a store

1. Sign in to **app.askrani.ai** as a platform admin.
2. Sidebar → **Stores** (under *Admin*).
3. Find the store in the list. Each store card has an **Insights** toggle on the
   right (with a small telescope icon).
4. Flip it **on**. You'll see a "Insights access granted" confirmation.

That's it — the change is instant.

## What the store's owner sees

Once granted, any **owner** of that store gets a new **Insights** item in their
sidebar (below *Dashboard*). Clicking it opens a short launch page with an
**"Open Insights ↗"** button. That button opens Insights in a **new tab**, signed
in automatically for that store.

> The owner must have an email on their account (they do if they log in) — that's
> the identity Insights signs them in with. Staff (non-owner) roles don't see the
> Insights item.

## How to revoke access

Same place: **Stores** → the store's **Insights** toggle → switch it **off**.
The sidebar item disappears for that store and the "Open Insights" handoff stops
working immediately. (Any Insights browser tab already open stays until closed.)

---

## Troubleshooting

If an owner clicks **Open Insights** and the new tab shows an error instead of
their workspace, the URL tells you what's wrong:

| Where it lands | Meaning | Fix |
| --- | --- | --- |
| `app.askrani.ai/insights?error=not_enabled` | The store isn't granted (or the toggle didn't save). | Re-flip the **Insights** toggle for that store in **Stores**. |
| `app.askrani.ai/insights?error=no_email` | That account has no email on file. | The owner needs an email on their login. |
| `insights.askrani.ai/login?sso=bad_signature` | Platform config issue, not a store issue. | Escalate to engineering (the shared SSO secret is mismatched or an app wasn't redeployed). |

Anything starting with `?sso=` on the `insights.askrani.ai` side is a
platform-level configuration problem — escalate rather than re-toggling the store.

---

## For engineering (one-time platform setup — already done)

This is recorded for completeness; it doesn't need repeating per store.

- `INSIGHTS_SSO_SECRET` — the same random value set in **both** the `askrani-app`
  and `askrani-insights` Vercel projects (Production). It signs the short-lived
  handoff token; the two apps must share the identical value.
- Migration `0065_insights_entitlement.sql` — adds `stores.insights_enabled`.
- Grant/mint/gate code: `app/(app)/admin/actions.ts` (`setInsightsAccess`),
  `lib/insights/sso.ts` (`mintInsightsToken`), `app/api/insights/sso/route.ts`
  (the handoff), and the verifier on the Insights side (`src/lib/sso.ts` +
  `src/app/api/sso/route.ts`).
- `EMBED_ORIGIN` is **not** used — Insights opens in a new tab (first-party), not
  an iframe. It's only needed if the product is ever reverted to embedding.
