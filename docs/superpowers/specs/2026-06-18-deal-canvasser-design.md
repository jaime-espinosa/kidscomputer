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
1. `scripts/canvass.mjs` — Node script (no browser). Fetches eBay + Craigslist, normalizes,
   filters by price ($200–1000) and distance (≤100mi of 98052), dedups against existing
   Hardware rows (by source listing id/url, and fuzzy name), inserts new rows via Airtable
   REST using the existing PAT. New rows: `status="candidate"`, `owned=No`, `source`,
   `found_date`, `distance_mi`, listing URL in `purchases`, plus any parsed `gpu_model`/`type`/`condition`.
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
7. `.github/workflows/canvass.yml` — cron 3am PT (DST-safe, see Scheduling).
8. `.github/workflows/digest.yml` — cron 10am PT every other day (DST-safe + parity guard).

### Data model (new Hardware fields)
Add to table `tblnJoBqI7G2FaBke`:
- `source` (singleSelect: eBay, Craigslist, FB Marketplace, OfferUp, Estate/Auction, Manual)
- `status` (singleSelect: candidate, reviewing, kept, dismissed) — default `candidate` for finds.
- `found_date` (date)
- `distance_mi` (number)
- `listing_url` (url)  — canonical link (also mirrored into `purchases`)
The dashboard can later filter `status != dismissed`; curated rows get `status=kept`/blank.

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

## Open prerequisites (user-provided)
1. eBay developer key → `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (user creating).
2. Confirm Airtable plan has AI credits for `aiText` enrichment (assistant will verify).
3. Confirm Vercel AI Gateway is enabled on the project (assistant will verify; $2/day).
