# Implementation-Plan Brief — Deal Canvasser Phase 2

Read these in the `kidscomputer` repo (cwd = /home/jaime/kids/computers):
- docs/superpowers/specs/2026-06-19-deal-canvasser-phase2-design.md  (SPEC — source of truth)
- docs/superpowers/HANDOFF.md  (esp. the "Phase 2 — ~/src substrate integration (recon, concrete)"
  section: exact capture_cookies/session_for/allowlist.toml/_pattern._sites.execute/systemd APIs)
Also inspect the EXISTING v1 Node libs you'll generalize: scripts/lib/{filter,airtable,parse,condition,control}.mjs,
scripts/canvass.mjs, and the live Airtable schema (Hardware tblnJoBqI7G2FaBke, Control tbljHjoeyh5jZGJLg).

Produce a COMPLETE, build-ready, TDD implementation plan. It is CROSS-LANGUAGE and splits into two
sub-projects — keep them as clearly separated task groups:

## S0 — Shared data-layer generalizations (Node, `kidscomputer` repo, vitest) — do FIRST, small
- Add a Hardware field **`listing_key`** (singleLineText) — note: created via Airtable metadata
  (assistant can do via MCP at execution; the plan should include a verification step, NOT a
  schema-write-token requirement).
- Generalize dedup: key on **`listing_key`** (`"{source}:{stable_id}"`) across all sources instead of
  eBay-only `ebay_item_id`. eBay path sets `listing_key = "eBay:" + ebay_item_id`. `airtable.listExistingIds`
  → returns the `listing_key` set. `CANDIDATE_FIELDS` gains `listing_key`.
- `applyWindow`: keep if `price∈window AND (distance_mi == null OR distance_mi <= radius)` (null = ships).
- Add `Retailer` to the `source` singleSelect (Airtable; verification step in plan).
- Extend vitest tests for all the above (cross-source dedup, null-distance kept, listing_key shape).

## S1 — Local scrape agent (Python 3.12, `~/src`, pytest) — the bulk
Self-contained Python (the ~/src substrate is Python; do NOT import the Node libs — re-implement the
small parse/map logic in Python). Tasks:
- **One-time setup runbook task** (documented, not auto): allowlist.toml edits (add facebook/offerup/
  craigslist to [cookies]; remove facebook.com from [deny]); add the 3 sites to capture_cookies.py TARGETS;
  run capture_cookies for each (burner FB/OfferUp); pip install playwright camoufox browserforge requests python-dotenv.
- `~/src/scripts/lib/listing_parse.py` — pure: title→specs (port parse.mjs regex), condition→{New,Refurbished,Used}|None
  (port condition.mjs), type∈{Laptop,Desktop}, build listing_key, clean_url. pytest with fixtures.
- `~/src/scripts/lib/airtable_py.py` — REST: list existing listing_keys + count; batched create (allowlist,
  NO typecast, owned=False). pytest with mocked HTTP.
- `~/src/_pattern/_sites/variants/{facebook_marketplace,offerup,craigslist}_search_v1.yaml` + retailer
  playbooks (bestbuy_openbox, woot, microcenter first; newegg/backmarket/amazon_renewed best-effort follow-on).
  Tested against SAVED HTML fixtures (no live).
- `~/src/scripts/marketplace_scraper.py` — orchestrator: read Control window+enabled from Airtable →
  for each enabled source: session_for(site, backend="camoufox") → execute(site,intent,params,handle=session.engine)
  → parse → filter (price/distance) → dedup vs existing listing_keys → insert up to shared cap. FAIL-SOFT per
  source (login_wall/timeout/block → log+skip, others continue); polite rate-limit + jitter. pytest the
  orchestration with injected fake session/execute/airtable.
- `~/command/systemd/marketplace-scrape.{service,timer}` + `loginctl enable-linger` (nightly; AIRTABLE_* via
  EnvironmentFile, NOT committed). WSL best-effort caveat documented.

## Global constraints (copy verbatim)
- Airtable base appLnCrA0kRqr9Di2; Hardware tblnJoBqI7G2FaBke; Control tbljHjoeyh5jZGJLg; defaults price 200/1000, zip 98052, radius 100.
- Write-legal rows, NO typecast: owned=false, condition∈{New,Refurbished,Used}|omit, type∈{Laptop,Desktop}, source∈{eBay,Retailer,FB Marketplace,OfferUp,Craigslist}, null/undefined omitted.
- ToS posture: burner account, Camoufox stealth, polite rate-limits/jitter, residential IP; NEVER republish scraped content publicly.
- Commit footer on EVERY commit:
  Co-Authored-By: claude-flow <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk
- Test runners: vitest (Node/S0), pytest (Python/S1). No live network in tests.

Output: writing-plans format — header (Goal/Architecture/Tech Stack), Global Constraints, File Structure map
(both repos), then numbered bite-sized TDD tasks (failing test → run → real code → pass → commit) with exact
paths/commands and REAL code, no placeholders. S0 tasks first, then S1. Flag residual risks at the end.
