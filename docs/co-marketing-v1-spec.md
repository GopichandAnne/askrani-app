# Ask Rani — Co-Marketing Module (v1) — Implementation Spec

**Status:** design, not yet built · **Verification model:** manual (no Meta API in v1) · **Reward instrument:** store credit (no cash in v1)

The one-line frame: **a second catalogue — of ways to earn.** The owner curates promotional *opportunities*; Rani surfaces them on every channel (web quick-action, WhatsApp link, in-store QR); customers act; a human verifies; store credit is issued and redeemed in-store. Built by reusing the platform's existing catalogue-overlay, signed-link, requests, and staff-role machinery — the only net-new spine is a **credit + redemption engine.**

---

## 0. Scope & principles

**In v1**
- A **credit + redemption engine** (the net-new spine — no promotions engine exists today).
- The **opportunities board** (reuses the catalogue overlay + browse-link pattern).
- Three earning paths: **give-and-get referral cards** (no review), **post-for-credit** (manual review, IG/YouTube), **influencer concierge** (manual, owner-approved custom deals).
- **Manual verification** — owner-resourced or a Rani-managed verification service. Users paste the post URL.
- Store credit only; redeemed via an in-store **pass** (QR / 4-digit / phone lookup); the owner applies the discount on their own POS.
- Honest reporting: clicks + attributed orders. **Never fabricated reach/impressions.**

**Explicitly deferred (not v1)**
- Automated/API verification (Meta Graph, collaborator-media insights, tag/mention webhooks).
- **Cash** payouts + W-9 / $600-1099 tax layer.
- **Supplier settlement** (co-funding is *tagged* in v1 data but not settled — see §3, §12).
- Wallet passes, TikTok (behind a flag), review-growth module, POS connector auto-apply.

**Five locked decisions**
1. Manual verification (a human reads the post; reach bands applied from public reel view counts or an insights screenshot).
2. Reward on **real net purchase value**, captured at the redemption pass or a Rani-placed order.
3. Store credit is **contingent + self-liquidating**; owner absorbs cost only at redemption, at cost, bounded by a **budget cap**.
4. Two-sided **give-and-get** is the primary loop (recipient coupon + initiator credit) — it needs no manual review, so it ships first.
5. Every reward event tags `product_sku` + `funding_source` now, so supplier co-funding is a later *reporting/settlement* layer with no engine rework.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| **Opportunity** | A card on the board: what to do, on which channel/format, what you earn, rules, expiry. |
| **Campaign** | A container grouping opportunities with shared budget, dates, guardrails. |
| **Initiator** | The customer who shares/refers (earns on the recipient's real purchase). |
| **Reward event** | An accrual candidate: source (referral order / post / influencer deal), computed amount, status. |
| **Ledger entry** | A credit balance record with a lifecycle status (pending→…→redeemed). |
| **Redemption pass** | A time-boxed code+QR that lets staff confirm an in-store credit redemption. |
| **Brief** | An owner-written influencer offering (NL, KB-scoped, expiring). |
| **Binding** | A 1:1 map of a social handle ↔ a phone/contact identity. |

---

## 2. Architecture fit — reuse vs net-new

**Reuse (already in the codebase):**
- **Signed links** — `_shared/catalog.ts` `signBrowseIdentity`/`verifyBrowseIdentity`/`browseLink` (HMAC over `{store,member,cart,exp}`). Referral links and the opportunities browse link reuse this exact scheme.
- **Catalogue overlay** — the store-chat overlay + `browse_products` faceted view → the **opportunities board** is the same overlay pointed at opportunity cards.
- **Identity** — `store_members` + `member_sessions` (there is **no `contacts` table**; extend `store_members`). Tolerant phone match via `resolveMember`.
- **Requests** — `request_types` + `requests` + file uploads + `store_responders` → influencer custom deals (and W-9 later).
- **Staff roles** — `staff` + `staff_role` enum (currently `owner`/`staff`) → add a `redemption` role.
- **WhatsApp** — `whatsapp-webhook` + `_shared/wa.ts` + templates → notifications.
- **Connectors** — `store_integrations` + `_shared/signature.ts` HMAC → POS auto-apply (deferred).
- **Gemini tools** — `_shared/tools.ts` `buildToolset` → the new agent tools (§8).

**Net-new (must build):**
- The **credit + redemption engine** (§4, §5) — no discount/credit/loyalty logic exists today; `store_charges` only *adds* fees.
- **Server-side card image composition** — edge functions are **Deno; `sharp` will not load.** Use **Satori + resvg-wasm** (SVG→PNG in-function) or a small render worker. (A local Puppeteer pipeline exists but is not serverless.)
- The **manual verification queue** UI + the Rani-managed service workflow.

---

## 3. Data model (new tables, all RLS-scoped per business; service-role + bot-admin managed)

```
reward_campaigns(
  id, store_id, name, preset,               -- 'fill_slow_days'|'launch_buzz'|'build_regulars'
  status,                                    -- draft|active|paused|ended
  channel_flags jsonb,                       -- {share_card, ig_post, youtube, influencer}
  budget_cap_cents, per_poster_cap_cents,
  hold_hours default 72, credit_expiry_days default 90,
  attribution_window_days default 30,
  starts_at, ends_at, created_at)

reward_rules(
  id, campaign_id, trigger,                  -- 'referral_first_order'|'referral_order'|'ugc_post'|'influencer'
  platform,                                  -- 'whatsapp'|'instagram'|'youtube'
  format,                                    -- 'card'|'post'|'reel'|'story'|'video'|null
  product_sku,                               -- null = default; else per-item weight  [FORWARD-COMPAT]
  reward_kind default 'store_credit',        -- 'store_credit'|'free_item'
  amount_model,                              -- 'flat'|'percent'|'tier'
  amount_cents,                              -- flat
  percent_bps,                               -- percent of net order (basis points)
  tiers jsonb,                               -- [{min_reach, max_reach, amount_cents}]  reach bands
  min_order_cents, conditions jsonb)

opportunities(                               -- the board cards (owner-curated)
  id, campaign_id, rule_id, title, blurb, image_ref,
  cta, sort, enabled, effective_from, effective_to)

referral_links(
  id, campaign_id, initiator_contact_id, code unique,
  destination_type,                          -- 'wa_deeplink'|'web_chat'
  created_at)

attribution_events(
  id, campaign_id, referral_link_id, contact_id null,
  type,                                      -- 'link_click'|'chat_started'|'first_order'|'repeat_order'
  dedupe_hash, geo_city, occurred_at)        -- dedupe_hash = device+IP (24h); city-level geo only

social_submissions(                          -- manual-review post claims (replaces API 'social_posts')
  id, campaign_id, contact_id, platform, format,
  post_url, screenshot_ref, claimed_reach,
  is_collaboration bool, disclosure_confirmed bool,
  status,                                    -- 'submitted'|'approved'|'rejected'|'flagged'
  reviewed_by, reviewed_at, review_note)

reward_events(
  id, campaign_id, contact_id, source_type, source_id,
  product_sku, funding_source default 'store',  -- 'store'|'supplier:<id>'  [FORWARD-COMPAT]
  tier, computed_amount_cents, status, flags jsonb, created_at)

reward_ledger(
  id, store_id, contact_id, campaign_id, reward_event_id,
  amount_cents, kind,                        -- 'credit'|'item'
  status,                                    -- pending|held|released|redeemed|expired|reversed
  hold_until, expires_at, created_at, updated_at)

redemption_passes(
  id, store_id, contact_id, code4, qr_token, amount_cents,
  first_name, status,                        -- 'active'|'confirmed'|'expired'
  surface, staff_id, expires_at, confirmed_at)  -- surface: 'qr'|'panel_code'|'phone_lookup'

reward_redemptions(
  id, ledger_id, pass_id, order_ref, amount_cents, remainder_cents, redeemed_at)

social_identity_bindings(
  id, store_id, contact_id, platform, handle, phone_e164,
  status,                                    -- 'claimed'|'confirmed'
  provisional_class, provisional_expires_at, consent_at, bound_at,
  unique(store_id, platform, handle), unique(store_id, platform, contact_id))

offering_briefs(
  id, store_id, content, class_scope,
  effective_from, effective_to, status)      -- KB-scoped influencer offers, expiring

-- extend store_members: referred_by, ig_handle, social_optin_at
```

**Ledger correctness (non-negotiable):** the ledger is **append-only + status transitions**, never a mutable balance. Balance = `sum(released) - sum(redeemed)` for a contact. Redemption must **row-lock** the pass + ledger rows to prevent double-spend (we already hit concurrency issues with cart sweeps — take it seriously here). Every event→ledger write is **idempotent** on `reward_event_id`.

---

## 4. The credit engine (the spine)

**Ledger lifecycle:**
```
                 (auto-release if low-risk)
 pending ──────────────► released ──► redeemed
    │                       ▲            
    │ (needs review/hold)   │            
    └──► held ──────────────┘            
             │                           
             ├──► reversed  (refund/return within hold, or fraud)
             └──► expired   (credit_expiry_days, unredeemed)
```

- **pending** — accrued, not yet spendable (e.g. awaiting manual review or the hold window).
- **held** — passed review, inside the hold window (default 72h; **never below 24h**). Reversible on a refund/return of the underlying order.
- **released** — spendable; triggers the "credit ready" WhatsApp ping.
- **redeemed / expired / reversed** — terminal.

**Auto-release vs review:** low-risk events (small amount, bound handle, not flagged, give-and-get order-backed) auto-release after the hold. Flagged/high-value/first-time route to the owner. This is what makes "credit ready, usually within the hour" honest for the common case.

**Budget cap (hard rule):** when a campaign's `budget_cap_cents` is reached, new events accrue as `pending` and the owner is notified — **nothing auto-pays past the cap.**

**Reversal:** if a Rani-placed order is refunded (or a POS order flagged) within the hold, reverse the linked event → `reversed`. Reward is on **net realized** value.

---

## 5. Redemption (in-store)

**Pass issuance:** customer asks Rani (web/WhatsApp) to use credit → Rani issues a **redemption_pass**: 4-digit code + QR + amount + first name + **15-min expiry**. Unscanned passes expire harmlessly — **credit is never lost on pass expiry** (failure favors the customer).

**Three confirmation surfaces** (per-location toggle; all write the same `reward_redemptions` row):
1. **QR scan → mobile staff confirm page** ("Name · $amount · Confirm"). Default for restaurant floor.
2. **Code box in the panel** → shows the matching pass → one-tap confirm. Default for grocery/counter.
3. **Phone lookup (last 4)** → matching customer + balance → staff enters amount + confirms. Fallback when no pass; requires verbal verification; always logged with `staff_id`.

**Rules:** partial redemption (bill < credit → redeem bill amount, remainder stays; **never cash back**); owner-configurable exclusions (alcohol/tips) shown on the pass; the owner applies the equivalent **discount line on their own POS** — Rani never processes payment. Post-redemption WhatsApp confirms remaining balance + a re-engage prompt.

**New staff role:** `redemption` — can confirm redemptions; **cannot** see campaigns, budgets, or the member directory. Extend the `staff_role` enum + RLS.

**Value capture for referral rewards** (see §6a): the pass confirmation is where **real net purchase value** enters the system for in-store buys — staff enters the bill amount (POS connector auto-reads it later). Rani-placed orders capture it automatically from `orders.subtotal`.

---

## 6. Earning paths (triggers)

### 6a. Give-and-get referral cards — **no manual review**, ships first

- **Card generation:** branded image (product/sale + store + **tracked short link in the caption**) composed server-side (Satori+resvg). The link must be tappable text so it survives a WhatsApp forward — not baked into pixels.
- **Handover:** Rani sends the card image + link in chat → customer long-press → Forward. Web chat gets a "Share on WhatsApp" `wa.me` deep-link button + download.
- **Tracking (never the forward):** each initiator's card carries a unique `referral_links.code`; the code survives every forward → **first-referrer attribution.** Monitoring = link **clicks** + downstream `chat_started`/`first_order`, never the invisible forward.
- **Reward = initiator earns on the recipient's real net order:** `amount_model` = percent (of net order) / tier / flat, with `min_order_cents`, and `referral_first_order` vs `referral_order` (repeat) rules. Reward-on-redemption (held through the return window), released as store credit, WhatsApp ping.
- **Double-sided:** recipient gets a limited-time coupon (the urgency + the reason-to-forward); initiator gets credit when it converts. This is what makes it *spread*.
- **Guards:** self-referral block, click dedup (device+IP 24h), per-referrer velocity cap.

### 6b. Post-for-credit — **manual review**, IG / YouTube

- **Opportunity** specifies participating products/menu items + per-format credit (the **format × product matrix**) + optional **reach bands** (default credit + tiers).
- **Submission:** customer posts, adds the **disclosure hashtag (#ad/#gifted — confirmed + stored)**, then **pastes the post URL** (optional insights screenshot for reach). Creates a `social_submissions` row (`submitted`).
- **Collaboration option** (best for reach credit): customer adds the store as a collaborator → post lands on the store's own grid → verifier reads **public reel view count** directly (unfakeable). Owner sets **auto-accept vs manual-accept** collab invites per store (risk-based middle: auto for bound/trusted handles, manual for new). Auto-accept ≠ auto-pay; content is still reviewed and is removable.
- **Manual verification queue** (owner or Rani-managed): open the URL → confirm tag + disclosure + author = bound handle → read reach → apply the band → approve/reject. Rule-based bands keep it fast and dispute-proof.
- **Platform verifiability note:** YouTube/TikTok show **public view counts** (easy, semi-automatable later); Instagram hides reach (needs insights screenshot — fakeable → sanity-check vs public follower/engagement; collab reels remove the problem). **Stories are ephemeral** → require a live-window screenshot.

### 6c. Influencer concierge — **manual, owner-approved**, credit/perks only

- **Owner writes briefs** (`offering_briefs`, NL, KB-scoped, expiring): *"5k+ local reach → free tasting for two + $40/verified reel, weekdays, feature X, book 3 days ahead."*
- **Rani = the collab desk:** an influencer DMs → Rani explains **active** briefs, captures handle + insights screenshot → assigns a **provisional class** (sanity-checked vs public signals; anomalies → owner queue) → quotes the matching brief **or** files a custom **request** for one-tap owner approve/decline. Rani never improvises terms.
- **Custom deals** = a `requests` row → owner approves → terms **written back** to the influencer's record so Rani honors them next time. Reward events carry the class/brief and require **explicit owner sign-off before release.**
- **v1 rewards are credit / free items / comped engagements only.** Custom **cash** re-triggers the deferred W-9/1099 layer.

---

## 7. The opportunities board ("second catalogue")

- **Same overlay as the product catalogue**, pointed at `opportunities`. Owner curates cards (title, blurb, image, what-you-earn, rules, expiry).
- **Surfaces:** web-chat **quick-action chip** ("💰 Earn credit"); WhatsApp **"promotional credits" browse link** (reuses `browseLink`); in-store **"Earn with us" QR**; **conversational** — Rani offers the relevant opportunity in context ("loved that thali? post a reel, earn $8").
- A customer opens it, sees the options, picks one, and Rani guides the chosen flow (§6).

---

## 8. Rani agent tools (Gemini function-calling; active only when a campaign is live)

| Tool | Purpose | Side-effect |
|---|---|---|
| `show_opportunities` | render the board (UiDirectives side-channel) | no |
| `start_share_earn` | generate + hand over the give-and-get card | no |
| `submit_post_url` | record a post-for-credit submission | yes (queue) |
| `start_influencer` | run the concierge flow (briefs, class, custom request) | yes (request) |
| `my_credit` | show balance + history | no |
| `redeem_credit` | issue a redemption pass | yes (pass) |

**Guardrails:** per-contact outreach frequency cap (default 1 invite / 14 days); any **custom/cash/off-rate** offer is *proposed* to the owner, never auto-committed; disclosure step is mandatory before any post-earn submission.

---

## 9. Owner control panel

- **Campaigns** section: three presets (Fill slow days / Launch buzz / Build regulars) pre-filling all knobs; per-preset config (reward kind + amounts per tier, budget ceiling, per-poster cap, attribution window, hold, credit expiry, active channels). One active campaign per channel per location by default. States: draft / active / paused / ended.
- **Margin guardrail:** owner enters avg ticket + food-cost % once; the builder computes the **real cost** of each reward and **blocks saving** a campaign whose worst-case monthly real cost exceeds the budget ceiling.
- **Verification queue:** the manual-review inbox (or the Rani-managed service view) — submissions with the post link, claimed reach, bound-handle check, approve/reject/flag.
- **Redemption surfaces:** the QR confirm page, code box, phone lookup (§5).
- **Dashboard / ROI card — honest metrics only:** shares created, **clicks** (not impressions), chats started, new contacts, attributed orders + revenue, credit issued (nominal **and** real cost via food-cost %), redeemed, breakage. Any "ad-equivalent" uses **clicks × CPC (default $1.50)** — **never impressions × CPM**, which for the WhatsApp path would be fabricated. CSV export.

---

## 10. Fraud, compliance, guardrails

- **Fraud:** click dedup (device-fingerprint hash + IP, 24h); per-referrer velocity cap; clicks-to-chats anomaly flag; **self-referral block**; **72h hold** (never < 24h) before release; manual review queue for flagged events.
- **Disclosure (enforced in code, not copy):** every public-post flow inserts + confirms the disclosure hashtag; stored on the submission. Cash-rewarded posts (deferred) require **#ad** specifically.
- **Vertical gating (explanatory notice, not silent hide):** blocked for **vape, smoke, tobacco, kratom, hemp/CBD, liquor, lending**. Allowed at launch: **restaurants, grocery, general retail.** Everything else defaults blocked until enabled.
- **Budget cap** hard-stop (§4). **Reward on net** value (reversal on refund).
- **Review-growth wall (if/when built):** no reward ledger entry may ever have a review event as its source; the public review ask is never conditioned on sentiment. (Module itself is deferred.)

---

## 11. Scheduled jobs (pg_cron, service-role)

- **Hold release:** `held` → `released` after `hold_until` if unflagged → WhatsApp "credit ready."
- **Credit expiry sweep** + expiring-credit reminders (WhatsApp "$X expires in 14 days").
- **Attribution cleanup** (stale unconverted link clicks).
- **Weekly owner digest** (campaign performance via WhatsApp/email).

---

## 12. WhatsApp templates (Meta approval required — create at setup)

`earned` ("your post/share earned $X, confirming") · `ready` ("your $X credit is ready") · `expiring` ("$X expiring in 14 days") · `redeemed` ("redeemed $X, $Y left — share again"). All reward messaging flows through the store's existing WhatsApp channel to drive return visits. **No money ever moves through WhatsApp** — it's notify/remind/trigger only.

---

## 13. Build sequencing

**Increment 1 — spine + no-review loop (pilotable with zero verification labor):**
credit+redemption engine (§4) · redemption pass + `redemption` role (§5) · give-and-get referral cards + tracked links + attribution (§6a) · WhatsApp `earned`/`ready` templates · minimal campaign config.

**Increment 2 — opportunities board + manual verification:**
board overlay + browse link + QR (§7) · post-for-credit URL submission (§6b) · manual verification queue (§9) · format×product matrix + reach bands · disclosure (§10) · vertical gating.

**Increment 3 — influencer + reporting + hardening:**
influencer concierge (§6c) · campaign-builder presets + margin guardrail (§9) · dashboard + ROI card + CSV · fraud guards + budget caps · forward-compat tags live.

**Deferred:** API/auto verification · cash + W-9/1099 · supplier settlement · wallet passes · TikTok · review-growth · POS connector auto-apply.

---

## 14. Open decisions before build

1. **Verification staffing:** owner-resourced vs Rani-managed service for the launch pilot (Man Pasand)? Determines whether §9's queue is owner-facing or an internal ops tool first.
2. **Give-and-get default economics** for Man Pasand: percent vs tier, the % / band amounts, min-order, and expiry — needs the margin guardrail inputs (avg ticket + cost %).
3. **Identity layer:** extend `store_members` in place, or introduce a thin `contacts` layer now (the spec assumes extend-in-place).
4. **Card rendering:** Satori+resvg in-function vs a small render worker — confirm the in-function path holds for the image sizes we need.

---

## 15. The honest frame (carried from the design thread)

This is a **retention/expansion feature and a supplier-revenue seed**, not the platform's customer-acquisition wedge (that remains bilingual WhatsApp reorder + gated pricing + after-hours capture for supply/trades/regulated retail). The strongest *acquisition* angle here is a narrower one — **authenticated, POS-integrated influencer-spend optimization for social-forward independent restaurants** — worth a dedicated pilot to prove willingness-to-pay. Build consciously, validate with real stores, keep metrics honest.
