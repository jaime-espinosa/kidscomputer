# Design: Nightly Computer-Deal Canvasser (v2 — post-council rework)

> Reworked after a multi-LLM council review (Codex + 5-lens Claude council) — see
> `2026-06-18-deal-canvasser-council-review.md`. Scope is now **lean v1 + Phase 2**.

## Context
The `kidscomputer` dashboard (`kidscomputer.vercel.app`) reads an Airtable `Hardware`
base (`appLnCrA0kRqr9Di2`, table `tblnJoBqI7G2FaBke`). The user wants nightly, free,
off-machine discovery of **used computers $200–$1000 within 100mi of Redmond WA (98052)**,
landing as reviewable candidates in that table, with gated sources handled by a human-loop
digest. Runtime: **GitHub Actions cron** (public repo = free). Assistant has Airtable + Vercel
access via MCP.

## Guiding correction (why v2)
The councils found v1 was priced on a non-existent free tier, had a dormancy/60-day deadlock,
shipped unauthenticated write endpoints, and lacked schema bootstrap. v2 **cuts scope to what's
provably free and safe**, hardens the security model, and defers lifecycle automation.

## Goals (v1)
- Nightly, off-machine ingestion of **eBay local-pickup** listings $200–1000 within 100mi of 98052.
- New finds written into Hardware as `status=candidate`, **deduped by stable id**, **capped** so the
  base never approaches free limits.
- A **GitHub-issue digest** (every ~2 days) listing new candidates + **human-loop deep-links** for
  gated/ToS-restricted sources (Craigslist, FB Marketplace, OfferUp, estate/auction).
- **Stays provably free**; **cannot be silently disabled**; **no unauthenticated writes**.

## Non-goals (v1 — deferred to Phase 2)
- No Craigslist/FB/auction *scraping* (ToS + datacenter-IP blocks) — human-loop links only.
- No AI enrichment/scoring (Vercel AI / Airtable AI) — candidates carry raw + parsed fields only.
- No automated reaper, eviction-leaderboard, CSV archive, visit-beacon dormancy, or `purge.mjs`.
- No shipped-eBay listings (only local-pickup, where distance is real).

## Architecture (v1)

```
GitHub Actions (cron 3am PT, DST-safe)               GitHub Actions (cron ~10am PT, every ~2d)
  scripts/canvass.mjs                                  scripts/digest.mjs
   eBay Browse API (LOCAL_PICKUP, 98052, 100mi)         read candidate rows (CI read token)
   → parse → filter $200–1000 → dedup by ebay itemId    → render GitHub Issue: new finds +
   → insert candidates (CI create token, allowlist)       gated-site deep-links (human loop)
   → enforce MAX_CANDIDATES at insert
        │                                            Always-run keepalive step (both workflows):
        ▼                                              touch .github/last-run + commit [skip ci]
   Airtable Hardware (status=candidate, owned=No)      → repo never hits 60-day inactivity disable
```

### Components (all in `kidscomputer`)
1. `scripts/bootstrap.mjs` — **idempotent** schema setup (Airtable metadata API; PAT needs
   `schema.bases:write` once). Creates the new fields + `Control` table, seeds Control row
   `enabled=true`. Safe to re-run. Run once before first canvass.
2. `scripts/lib/ebay.mjs` — eBay Browse client: client-credentials OAuth (cache ~2h token),
   `X-EBAY-C-MARKETPLACE-ID: EBAY_US`, filter `price:[200..1000]`,
   `deliveryOptions=SELLER_ARRANGED_LOCAL_PICKUP`, `pickupPostalCode=98052&pickupRadius=100`,
   paginate, 429 backoff. Returns `{ ebay_item_id, title, price, url, distance_mi, condition, image }`.
3. `scripts/lib/airtable.mjs` — REST helper: list (for dedup + count), batched create (10/req).
   Uses the **CI create-token**. Strict field allowlist; never `typecast` on untrusted input.
4. `scripts/canvass.mjs` — orchestrates: read Control (`enabled`?) → fetch eBay → parse specs from
   title (regex; no AI) → filter price/distance → dedup vs existing `ebay_item_id` → insert up to
   `MAX_CANDIDATES`. **Top-level errors are NOT swallowed** (failed run ⇒ GitHub emails). Opens/updates
   a "Canvasser health" issue on uncaught error or N consecutive zero-insert runs.
5. `scripts/digest.mjs` — every ~2 days (gated on `last_digest_date` elapsed Pacific days): builds a
   GitHub Issue with new candidates (id/title/price/distance/link) + **prebuilt deep-link searches**
   for Craigslist, FB Marketplace, OfferUp, EstateSales/HiBid (Redmond + $200–1000) to review by hand.
6. `.github/workflows/canvass.yml` — cron 3am PT. `permissions: contents: read, issues: write`.
   `concurrency: { group: canvasser, cancel-in-progress: false }`. Steps: keepalive → canvass.
   Third-party actions **pinned to commit SHAs**.
7. `.github/workflows/digest.yml` — cron ~10am PT. Same permissions/concurrency. Steps: keepalive → digest.
8. **`app/api/hardware` POST removed** (security fix, see below). The route keeps only GET.

### Security model (P0 fixes)
- **Remove the unauthenticated POST** on `/api/hardware` — the dashboard is read-only and the
  canvasser writes to Airtable directly from CI, so the POST is unused and is a live write hole.
  (If a write endpoint is ever needed, it must require a shared-secret header + field allowlist,
  no `typecast`, and rate-limiting.)
- **Scoped Airtable tokens (rotate current PAT now):**
  - `AIRTABLE_TOKEN` on **Vercel** → scope to **`data.records:read` on this base only**.
  - `AIRTABLE_CI_TOKEN` as a **GitHub Actions secret** → `data.records:read+write` on this base only;
    used by `canvass.mjs`/`bootstrap.mjs`. `schema.bases:write` only while bootstrapping, then dropped.
- **Least-privilege workflows**; **SHA-pin** all third-party actions; secrets never echoed.
- **No public data leak:** Issues/links use only derived/needed fields; no raw-data CSV in v1.

### Data model (new Hardware fields)
- `source` (singleSelect: eBay, Craigslist, FB Marketplace, OfferUp, Estate/Auction, Manual)
- `status` (singleSelect: candidate, reviewing, kept, dismissed) — finds default `candidate`.
- `found_date` (date)
- `distance_mi` (number) — real for eBay pickup; null = "ships / unknown".
- `listing_url` (url)
- `ebay_item_id` (singleLineText) — **canonical dedup key** (numeric eBay itemId).
`Control` table (1 row): `enabled` (checkbox kill-switch), `last_canvass_pacific_date`,
`last_digest_date`. (No `last_visit`/dormancy in v1.)

### Liveness, scheduling, free-tier (P0/P1)
- **Keepalive (anti-deadlock):** every workflow run first touches `.github/last-run` and commits
  with `[skip ci]` + path guard, *unconditionally* (before the `enabled` gate). Guarantees the repo
  is never inactive ⇒ GitHub never disables the crons. (Replaces the deferred dormancy machine.)
- **Kill-switch:** Control `enabled=false` (or repo var `CANVASSER_ENABLED=false`) ⇒ canvass/digest
  no-op *after* keepalive. For pausing without teardown.
- **DST-safe cron:** `0 10,11 * * *` (canvass) / `0 17,18 * * *` (digest); each run no-ops unless
  Pacific hour matches AND `last_canvass_pacific_date`/`last_digest_date` shows it hasn't run today.
  No-op branch makes **zero outbound API calls**.
- **Free-tier accounting (all $0):**
  - Airtable: Free = 1,000 records/base **and** ~1,000 API calls/month (workspace-wide). v1 ≈ a few
    paged reads + batched writes/night ≈ ~300 calls/month; `MAX_CANDIDATES`=150 ≪ 1,000 records;
    **insert stops at the cap** (no deletion eviction in v1).
  - Vercel: **no AI in v1** ⇒ $0; archive-commit redeploy storm avoided (no CSV commits in v1).
  - GitHub Actions: free for public repo; keepalive keeps crons alive.

### Dedup & cap (P1)
- Dedup on `ebay_item_id` (numeric, stable) against existing rows before insert; strip URL tracking
  params for the stored `listing_url`. (Fuzzy-name/fingerprint dedup → Phase 2.)
- Cap: if candidate count ≥ `MAX_CANDIDATES`, stop inserting and note "cap reached — review
  candidates" in the next digest. (Automated eviction → Phase 2.)

## Phase 2 (after v1 proves out)
- **Lifecycle:** reaper (delete only on *affirmative* dead: ended/sold/404; transient = "unknown",
  N-consecutive + circuit breaker), eviction (protect unscored rows), JSONL archive on a **`data`
  branch** (Vercel ignores; derived fields only).
- **Dormancy via visit-beacon** — re-add `/api/visit` (signed same-origin nonce, bot filtering,
  rate-limited, once/day) *layered on top of the keepalive* so it can never deadlock; auto-sleep
  after 20d, "liberate" reminder.
- **AI enrichment/scoring:** Vercel AI ($5/30d, model on free list, **auto-top-up OFF**, fail-closed)
  behind an auth'd, rate-limited `/api/enrich`; or Airtable AI (paid opt-in).
- **More sources:** retailers/refurb; Craigslist via residential proxy; FB Marketplace via the
  `~/src` cookie-vault substrate (needs allowlist exception).

## Prerequisites (user)
1. **eBay production keyset** → `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (GitHub secrets).
2. **Rotate + scope Airtable tokens** (read-only for Vercel; CI read/write secret).
3. Assistant verifies the eBay LOCAL_PICKUP query returns in-radius results before wiring the cron.

## Verification
- `bootstrap.mjs` run → confirm fields + Control table exist; re-run is a no-op.
- `canvass.yml` manual dispatch → candidates appear, all `price∈[200,1000]`, `distance_mi≤100`,
  dedup holds on a second run, insert stops at `MAX_CANDIDATES`.
- Kill `EBAY_CLIENT_SECRET` → confirm the run **fails loudly** (email + health issue), not green.
- `digest.yml` dispatch → Issue created with candidates + working gated-site links; cadence honors
  `last_digest_date`.
- Keepalive: confirm a `[skip ci]` commit lands each run and does **not** trigger a Vercel deploy.
- Security: confirm `/api/hardware` POST is gone (405) and the Vercel token is read-only.
- DST no-op branch makes zero API calls (assert in a unit test of the date guard).
