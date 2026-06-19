# Design: Nightly Computer-Deal Canvasser

## Context
The `kidscomputer` dashboard (`kidscomputer.vercel.app`) reads an Airtable `Hardware`
base (`appLnCrA0kRqr9Di2`, table `tblnJoBqI7G2FaBke`) of computers with derived value
metrics. The user wants to continuously discover **good real-world deals** on computers
priced **$200–$1000** within **100 miles of Redmond, WA (98052)**, across many
marketplaces, and have the best finds land in the dashboard.

Constraints (from the user):
- Must run **every night ~3am Pacific** (deal timing matters).
- Must **NOT run from the user's computer** (always-on, off-machine).
- Where an **LLM is needed in the loop**, that's acceptable on a **reminder cadence**
  (~10am every other day; adjustable) rather than fully autonomous.
- Finds go **into the existing Hardware table** (distinguished by status fields).
- Gated/auth-walled sources handled via a **human/LLM reminder**, not risky automation.

### Environment findings (from `~/src` recon)
- `~/src` is a bespoke "organ" ecosystem (Python 3.11, Playwright, cookie-vault auth,
  `_pattern/_sites` playbooks). Powerful for auth-walled scraping but **machine/vault-bound**
  and not cloud-runnable; **n8n is documented-but-not-live**.
- The only genuinely **always-on, off-machine** scheduler available is **GitHub Actions cron**
  (prior art: `~/src/.github/workflows/gemini-scheduled-triage.yml`).
- `kidscomputer` is a **public** repo (free unlimited Actions) already wired to Airtable +
  deployed on Vercel; Airtable + Vercel are reachable by the assistant via MCP.

## Goals
- Nightly, off-machine discovery of $200–1000 computer listings within 100mi of 98052.
- New finds written into the Hardware table as reviewable **candidates**, deduped.
- Automated enrichment (specs + value scoring) via Airtable AI and/or Vercel AI.
- A **GitHub-issue digest** every other day at ~10am PT summarizing new candidates and
  providing ready-made **gated-site search links** for manual review.

## Non-Goals (v1)
- No scraping of auth-walled sites (Facebook Marketplace, OfferUp, auction/estate apps)
  in automation — these are human-loop via the digest links.
- No changes to the dashboard's curated rows; candidates are isolated by a `status` field.
- No use of the `~/src` Playwright/cookie-vault substrate in v1 (reserved for Phase 2).

## Architecture (two tracks + AI enrichment)

```
            ┌────────────────────── Track A: nightly gather (GitHub Actions, 3am PT) ──────────────────────┐
 eBay Browse API ─┐                                                                                          │
 Craigslist (RSS) ─┼─► scripts/canvass.mjs ─► parse+filter (price/dist) ─► dedup vs Hardware ─► Airtable     │
                   │     (Node, no browser)                                   (status=candidate, owned=No)   │
            └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                                          │
                         ┌────────────── AI enrichment (on candidate rows) ──────────────┐
                         │  Airtable AI fields (if credited):  hardware_summary,          │
                         │     ai_suitability_rating                                      │
                         │  Vercel AI endpoint /api/enrich ($2/day gateway):              │
                         │     parse specs, estimate g3d/agents/fps/mem_per_dollar, score │
                         └───────────────────────────────────────────────────────────────┘
                                                          │
        ┌──────────── Track B: review loop (GitHub Actions, 10am PT, every other day) ────────────┐
        │  scripts/digest.mjs ─► read new candidates ─► (Vercel AI writes summary prose) ─►        │
        │  open/update a GitHub Issue: ranked new finds + deep-link searches for gated sites       │
        └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components (all in the `kidscomputer` repo)
0. `scripts/reap.mjs` — **runs first each night**. Re-validates every `candidate`/`reviewing`
   row's listing: eBay item status via API (ended/sold → prune), Craigslist GET (404 or
   "posting has been deleted/expired" → prune), generic HTTP non-200 → prune. Sets
   `last_checked`; **deletes** rows confirmed dead/sold (reclaims free-tier record quota).
   Never touches `status=kept` rows. See "Listing lifecycle" below.
1. `scripts/canvass.mjs` — Node script (no browser). Fetches eBay + Craigslist, normalizes,
   filters by price ($200–1000) and distance (≤100mi of 98052), dedups against existing
   Hardware rows (by source listing id/url, and fuzzy name), inserts new rows via Airtable
   REST using the existing PAT. New rows: `status="candidate"`, `owned=No`, `source`,
   `found_date`, `distance_mi`, listing URL in `purchases`, plus any parsed `gpu_model`/`type`/`condition`.
   **Enforces growth caps** (see "Free-tier budgets") — bounded inserts + eviction of the
   weakest candidates so the base never approaches Airtable's free record limit.
2. `scripts/lib/ebay.mjs` — eBay Browse API client (OAuth client-credentials; filters
   `price:[200..1000]`, `deliveryCountry`, `itemLocationRegion`/distance via buyer postal 98052).
3. `scripts/lib/craigslist.mjs` — Craigslist `seattle` search/RSS client (computers category,
   min/max price), best-effort parser; resilient to layout changes (skip on parse failure).
4. `scripts/lib/airtable.mjs` — thin Airtable REST helper (list for dedup, batch create).
5. `app/api/enrich/route.ts` — Vercel AI endpoint: given raw candidate fields, returns parsed
   specs + estimated metrics + a 0–100 deal score; called by `canvass.mjs` after insert (or by
   a follow-up pass). Uses Vercel AI Gateway ($2/day).
6. `scripts/digest.mjs` — builds the every-other-day GitHub Issue digest; uses `/api/enrich`
   or the AI gateway to write ranked prose; embeds gated-site deep links.
7. `.github/workflows/canvass.yml` — cron 3am PT (DST-safe). Steps: **reap → canvass → enrich →
   enforce cap**.
8. `.github/workflows/digest.yml` — cron 10am PT every other day (DST-safe + parity guard).
9. `app/api/visit/route.ts` — tiny beacon endpoint. The dashboard calls it on load; it stamps
   `last_visit` (and a visit counter) on a single Airtable **Control** record. Only real browser
   loads hit it (automation talks to Airtable/`/api/enrich` directly), so it's a clean "human was
   here" signal.
10. `public/index.html` — one line added: `navigator.sendBeacon('/api/visit')` on load.

### Data model (new Hardware fields)
Add to table `tblnJoBqI7G2FaBke`:
- `source` (singleSelect: eBay, Craigslist, FB Marketplace, OfferUp, Estate/Auction, Manual)
- `status` (singleSelect: candidate, reviewing, kept, dismissed) — default `candidate` for finds.
  Dead/sold candidates are **deleted** (not a status) to reclaim free-tier quota.
- `found_date` (date)
- `last_checked` (date) — set by the reaper; drives staleness sweeps.
- `distance_mi` (number)
- `deal_score` (number 0–100) — from enrichment; drives eviction ranking under the cap.
- `listing_url` (url)  — canonical link (also mirrored into `purchases`)
The dashboard can later filter `status != dismissed`; curated rows get `status=kept`/blank.

### Listing lifecycle (staleness / dead-link / sold handling)
Listings are ephemeral, so candidates must self-expire:
- **Re-validation:** the nightly reaper checks each non-`kept` candidate's URL.
  - eBay: `getItem`/Browse lookup → if ended/sold/not-found, prune.
  - Craigslist: GET URL → 404 or deletion/expiry text, prune.
  - Generic: any non-200 (or redirect to a search/home page) after one retry → prune.
- **Action = delete** (not soft-mark): keeps the base small and free-tier-safe. Rationale:
  a sold/dead listing has no future value and soft-marking would consume record quota.
- **Time cap:** any `candidate` older than `CANDIDATE_TTL_DAYS` (default 21) with no promotion
  is pruned even if the link still resolves (avoids slow accumulation of stale-but-live posts).
- **Protected:** `status=kept` rows are never auto-pruned (these are deals you care about).

### Sources (v1)
- **eBay** — Browse API, authoritative, price + buyer-postal distance filter. (needs dev key)
- **Craigslist** — seattle classifieds, computers, price range; best-effort.
- Gated (digest links only, manual): FB Marketplace, OfferUp, EstateSales.net, HiBid.

### Scheduling (DST-safe, GitHub Actions cron is UTC)
- `canvass.yml`: `cron: "0 10,11 * * *"` (covers 3am PDT=10:00 UTC and 3am PST=11:00 UTC);
  script no-ops unless local Pacific hour == 3 AND it hasn't already run today (date guard).
- `digest.yml`: `cron: "0 17,18 * * *"` (10am PT); runs only if Pacific hour == 10 AND
  day-of-year is even ("every other day"; interval configurable via a repo variable).

### Secrets / config (GitHub repo secrets)
- `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2`
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`
- `GITHUB_TOKEN` (built-in, for issue digest)
- Vercel AI: via the deployed app's gateway (no key in CI if `/api/enrich` is called over HTTPS).
Note: pushing workflow files needs git over **SSH** (current gh token lacks `workflow` scope) — fine, repo uses SSH.

### Error handling & resilience
- Each source isolated; a source that errors/parses-empty is skipped, run continues.
- Idempotent: dedup by `(source, listing id/url)` prevents duplicate rows on re-runs.
- Candidates never overwrite curated rows (separate `status`); only inserts, no destructive ops.
- Craigslist/eBay rate-limited politely; failures logged to the Actions run + the digest notes gaps.

## Dormancy & auto-shutdown on inactivity
The canvasser should only work while the user cares. It sleeps when ignored and wakes when the
user returns — no manual toggling required.

- **Visit signal:** the dashboard fires `navigator.sendBeacon('/api/visit')` on load, which stamps
  `last_visit` on an Airtable **Control** record (a tiny 1-row `Control` table: `last_visit`,
  `dormant`, `dormant_notified`, `enabled`).
- **Dormancy check (first step of every cron, before any work):** read `last_visit`.
  If `now − last_visit > DORMANCY_DAYS` (default **20**), the run goes **dormant**:
  - Skips reap + canvass + enrich + digest (stops updating → ~zero resource use; only the
    sub-second date check runs).
  - If `dormant_notified` is false, opens a **GitHub Issue reminder** (see below) and sets it true.
- **Auto-wake:** any site visit refreshes `last_visit`; the next nightly run sees recent activity,
  clears `dormant`/`dormant_notified`, and resumes automatically.
- **Hard kill-switch:** repo variable `CANVASSER_ENABLED` (default `true`). If `false`, every cron
  no-ops immediately regardless of visits — for fully pausing without deleting anything.

**Dormancy reminder (GitHub Issue) — "liberate the resources":** a checklist telling the user
the canvasser paused after `DORMANCY_DAYS` of no visits, and how to:
1. **Resume** — just visit `kidscomputer.vercel.app` (auto-wakes that night).
2. **Fully liberate** — set `CANVASSER_ENABLED=false` (stops crons); optionally run
   `scripts/purge.mjs` to delete all `candidate`/`reviewing` rows (frees Airtable quota);
   optionally remove `EBAY_*` secrets. `kept` rows and the dashboard are left intact.

## Free-tier budgets & growth caps (stay free, always)
Every moving part has a free ceiling; the system is designed to stay strictly under each.

| Resource | Free limit | How we stay under it |
|----------|-----------|----------------------|
| **Airtable records / base** | ~1,000 on Free plan | Hard cap `MAX_CANDIDATES` (default **150**) on open candidates. Curated `kept` rows (~tens) + 150 candidates ≪ 1,000. Reaper deletes dead/sold/expired each night. |
| **Airtable API** | 5 req/sec | Batch reads (100/page) + batched writes (10/req), small nightly volume. |
| **Vercel AI Gateway** | **$2/day** credit | Enrich **only new** candidates once (never re-enrich); per-run insert cap `MAX_NEW_PER_RUN` (default **30**) bounds calls to ≤30 small completions/day. Digest prose is one more small call. |
| **GitHub Actions** | Unlimited for public repos | `kidscomputer` is public → free. Two short cron jobs/day. |
| **Airtable AI fields** | **Not on Free plan** | Do **not** depend on `aiText` enrichment; default to the Vercel `/api/enrich` endpoint. Use Airtable AI only if the user later confirms a credited plan. |

**Eviction policy (the growth cap):** after each night's inserts, if open candidates exceed
`MAX_CANDIDATES`, delete the lowest-ranked rows by `(deal_score asc, found_date asc)` until at
the cap. Net effect: the table is a bounded, self-refreshing **leaderboard of the best current
deals**, not an ever-growing log. All caps are repo variables so they can be tuned without code
changes.

## Phasing
- **Phase 1 (build now):** Track A (eBay + Craigslist → Airtable candidates) + new fields +
  Track B GitHub-issue digest with gated-site links. Airtable-AI enrichment if enabled,
  else `/api/enrich` Vercel endpoint.
- **Phase 2 (later):** retailer/refurb sources (Best Buy open-box, Micro Center, Newegg, Woot,
  Back Market); richer scoring; optional FB Marketplace automation via `~/src` cookie-vault
  substrate (requires allowlist exception — `facebook.com` is currently deny-listed).

## Verification
- Manually trigger `canvass.yml` (workflow_dispatch); confirm new `candidate` rows appear in
  Airtable with price∈[200,1000], distance≤100, dedup correct on a second run.
- Confirm `/api/enrich` returns parsed specs + score for a sample listing within Vercel's $2/day.
- Manually trigger `digest.yml`; confirm a GitHub Issue is created with ranked finds + working
  gated-site search links.
- Confirm Pacific-hour/parity guards (unit-test the date logic).
- **Staleness:** seed a candidate with a dead/expired URL; run `reap.mjs`; confirm the row is
  deleted and `kept` rows are untouched.
- **Growth cap:** with `MAX_CANDIDATES` set low (e.g. 5), insert >5 finds; confirm the table
  settles at 5, evicting lowest `deal_score`/oldest, and never exceeds the cap across runs.
- **Dormancy:** set `DORMANCY_DAYS=0` (or back-date `last_visit`); run the cron → confirm it
  goes dormant, does no work, and opens exactly one reminder issue. Then hit `/api/visit` (or
  load the site) and re-run → confirm it wakes and resumes, clearing `dormant_notified`.
- **Kill-switch:** set `CANVASSER_ENABLED=false`; run both crons → confirm immediate no-op.

## Open prerequisites (user-provided)
1. eBay developer key → `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (user creating).
2. Confirm Airtable plan has AI credits for `aiText` enrichment (assistant will verify).
3. Confirm Vercel AI Gateway is enabled on the project (assistant will verify; $2/day).
