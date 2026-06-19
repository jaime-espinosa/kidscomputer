# Design: Deal Canvasser Phase 2 — multi-source automation

> Builds on v1 (eBay-only, merged PR #2). See `HANDOFF.md` for full state and the
> `~/src` substrate recon this design relies on.

## Context
v1 automatically canvasses only **eBay** (clean API, cloud cron). The gated/other sources are
human-loop digest links today. Phase 2 **automates them**: retailer/refurb open-box + Facebook
Marketplace + OfferUp + Craigslist — all landing in the same Airtable `Hardware` base.

### Decisions (locked with the user)
- **Sources:** ALL — retailer/refurb + Facebook Marketplace + OfferUp + Craigslist.
- **Browser host:** **this WSL box** (best-effort — runs while awake).
- **Budget:** strictly free (no paid proxy / cloud-browser).
- **FB/OfferUp:** **burner account**.
- **Build:** both sub-projects as one combined Phase 2.

### Key architectural finding (drives the whole design)
The `~/src` browser substrate is **Python** (Playwright/Camoufox + cookie vault); v1 is **Node**.
And every non-eBay source needs either a login (FB/OfferUp) or a residential IP to dodge
datacenter-IP blocking (Craigslist + most retailer anti-bot). Therefore:
- **Cloud (GitHub Actions, Node, always-on):** stays **eBay API only** — the one reliable, always-on path.
- **Local (WSL, Python, residential IP, best-effort):** ONE agent scrapes **everything else**
  (retailers + FB + OfferUp + Craigslist) via the `~/src` substrate, writing to the same Airtable.

**Tradeoff (confirm at review):** retailers become best-effort (only when WSL is awake) instead of
always-on. Rationale: routing them through the residential, stealth, login-capable local agent is
the only *free* way they work reliably (cloud IPs get blocked). eBay (API) stays always-on for
timing-critical deals.

## Architecture
```
┌ Cloud — GitHub Actions (Node, always-on, free) ┐     ┌ Local — WSL (Python, residential, best-effort) ┐
│  scripts/canvass.mjs  → eBay Browse API          │     │  ~/src/scripts/marketplace_scraper.py            │
│  → Airtable Hardware (source=eBay)               │     │  uses _util/_browse cookie-vault + Camoufox      │
└────────────────────────────────────────────────┘     │  per-site playbooks: FB, OfferUp, Craigslist,    │
                                                         │  + retailers (Best Buy/Woot/… best-effort)       │
                                                         │  → Airtable Hardware (source=FB Marketplace/…)   │
                 └──────── same Hardware table · shared `listing_key` dedup · shared cap · status=candidate ───────┘
```

## Sub-project S0 — Shared data-layer generalizations (do FIRST; small)
v1's dedup/filter are eBay-shaped. Generalize so multiple sources interoperate cleanly:
1. **Generalized dedup key.** Add Hardware field **`listing_key`** (singleLineText) =
   `"{source}:{stable_id}"` where stable_id is the source's listing id (eBay `itemId`, CL posting id,
   FB item id, OfferUp id) or, if none, the canonicalized `listing_url`. v1's eBay path sets it to
   `"eBay:{ebay_item_id}"`. **Dedup keys on `listing_key`** across all sources (replaces eBay-only
   `ebay_item_id` dedup; keep `ebay_item_id` as a field). `airtable.listExistingIds` → returns the
   `listing_key` set.
2. **Distance filter allows ships/unknown.** v1 `applyWindow` drops rows with non-numeric
   `distance_mi`. Change to: keep if `price∈window AND (distance_mi == null OR distance_mi ≤ radius)`.
   `null` = "ships nationally / unknown" (retailers) — still a valid in-budget deal.
3. **`source` choices.** Add **`Retailer`** to the Hardware `source` singleSelect (FB Marketplace,
   OfferUp, Craigslist already exist). (Via Airtable MCP/metadata.)
4. **Shared cap.** `MAX_CANDIDATES` now spans all sources; both writers enforce it at insert
   (low-volume; accept a benign race since cloud@3am and local rarely overlap).
- **Repo:** these touch the Node `kidscomputer` repo (`scripts/lib/{filter,airtable}.mjs`, `canvass.mjs`)
  + one Airtable schema add. Unit-tested with vitest (extend v1 tests).

## Sub-project S1 — Local scrape agent (Python, `~/src`)
A self-contained Python agent (the substrate is Python, so it does NOT import the Node libs; it
re-implements the small parse/filter/map logic in Python and writes to Airtable via REST, honoring
the SAME schema + `listing_key` + write-legality conventions as v1).

**One-time manual setup (user, documented in a runbook):**
- Add `facebook`/`offerup`/`craigslist` to `_cour/_vault/allowlist.toml` `[cookies]`; remove
  `facebook.com` from `[deny].domains`.
- Add the three sites to `TARGETS` in `~/src/scripts/capture_cookies.py`, then run
  `python3 scripts/capture_cookies.py facebook|offerup|craigslist` (burner account for FB/OfferUp) to seed cookies.
- `pip install --user playwright camoufox browserforge requests python-dotenv && playwright install chromium`.

**Components (under `~/src`):**
- `_pattern/_sites/variants/{facebook_marketplace,offerup,craigslist}_search_v1.yaml` — playbooks
  (goto search URL with zip+price params → adaptive_fill/scroll → extract listing cards). Retailer
  playbooks (`bestbuy_openbox`, `woot`, …) added incrementally.
- `scripts/lib/listing_parse.py` — pure: title→specs (CPU/GPU/RAM regex, port of v1 `parse.mjs`),
  condition→{New,Refurbished,Used}|None (port of `condition.mjs`), `type`∈{Laptop,Desktop}, build
  `listing_key`, clean URL. Unit-tested with fixtures.
- `scripts/lib/airtable_py.py` — REST list (existing `listing_key`s for dedup + count) + batched
  create (allowlist, NO typecast, owned=False). Token from env (`AIRTABLE_CI_TOKEN`).
- `scripts/marketplace_scraper.py` — orchestrator: read the Control window from Airtable (zip/price/
  radius/enabled) → for each enabled source: `session_for(site, backend="camoufox")` →
  `execute(site, intent, params, handle=session.engine)` → parse → filter (price/distance) → dedup
  vs existing `listing_key`s → insert up to cap. **Fail-soft per source** (a `login_wall`/`timeout`/
  block skips that source and logs; never aborts the others); polite rate-limit + jitter between requests.
- Schedule: `~/command/systemd/marketplace-scrape.{service,timer}` (nightly), `loginctl enable-linger`.
  `AIRTABLE_*` via the service `EnvironmentFile=` (NOT committed).

## Data flow (per scraped listing)
scrape (logged-in/stealth) → parse specs + map condition/type → build candidate row
`{name, type, condition, owned:false, source, status:"candidate", found_date, distance_mi(null=ships),
listing_url, listing_key, gpu_model, vram, ram, z}` → drop null/undefined (allowlist, no typecast) →
dedup vs Airtable `listing_key` → insert if under cap.

## Error handling / safety
- **Fail-soft:** per-source try/catch; a dead source → log + skip, others continue; if ALL sources
  fail or 0 inserts for N runs, write a health note (mirrors v1).
- **ToS posture:** FB/Craigslist are ToS-gray (burner account, Camoufox stealth, polite
  rate-limits/jitter, residential IP). **Never republish scraped listing content publicly.**
- **Cookie expiry:** scrape detects `login_wall` → logs "re-seed cookies for {site}" (manual re-run).
- **Idempotent / safe:** only inserts (no deletes); dedup prevents dup rows; cap bounds growth.

## Free-tier / limits
- $0: GitHub Actions (eBay) free; local agent on your hardware; no proxy/cloud-browser.
- Airtable: shared `MAX_CANDIDATES` keeps records ≪ 1,000; batched writes keep API calls low.

## Testing
- **S0 (Node):** extend vitest — `listing_key` dedup across sources, null-distance kept, Retailer source.
- **S1 (Python):** `pytest`/`unittest` for `listing_parse.py` + `airtable_py.py` (fixtures, mocked
  HTTP — no live calls). Playbooks tested against SAVED HTML fixtures. Live scrape verified manually
  on first run (one source at a time).

## Non-goals (Phase 2)
- No always-on guarantee for scraped sources (WSL best-effort).
- No paid proxies/cloud browser. No change to v1 eBay/digest beyond the S0 generalizations.
- Retailer coverage is incremental: ship FB/OfferUp/Craigslist + 1–2 friendliest retailers
  (e.g. Best Buy open-box, Woot) first; add more retailers as playbooks are written.

## Open items for review
1. Confirm the **retailers-go-local (best-effort)** routing vs trying some retailers in the cloud cron.
2. Confirm **which retailers** to implement first (default: Best Buy open-box + Woot).
3. Confirm the cross-language split (Node cloud + Python local) is acceptable (vs porting everything
   to one language — not recommended; reuse the existing substrate).
