# Deal Canvasser — Session Handoff (2026-06-19)

Pick-up doc for a new session. **Public repo — never commit secrets here.**

## What this project is
A nightly, free, off-machine system that finds cheap used computers and lands them in an
Airtable base that a Vercel dashboard reads. The dashboard ("Hardware Fleet Matrix") visualizes
the fleet; the canvasser auto-discovers new deals.

## Key locations / IDs
- **Local repo:** `/home/jaime/kids/computers` (branch `main`; feature branches merge via PR)
- **GitHub:** `jaime-espinosa/kidscomputer` (PUBLIC). `gh` is authed as `jaime-espinosa`
  (scopes: repo, gist, read:org, admin:public_key — NO `workflow` scope, but SSH push of
  workflow files works since the remote is SSH).
- **Vercel:** project `kidscomputer` → live at `https://kidscomputer.vercel.app` (team
  `team_0gCoHiVmUJgNdl1Uqm1y1Rl8`). Deployment Protection is OFF on the prod domain (public).
- **Airtable:** base `appLnCrA0kRqr9Di2`
  - `Hardware` table = `tblnJoBqI7G2FaBke` (primary `name`; price is `z`/currency; ~51 curated rows)
  - `Control` table = `tbljHjoeyh5jZGJLg`, singleton row id `recamgm14LSayOXKd`
- **MCP available to the assistant:** Airtable (read/write/**schema** create_field/create_table),
  Vercel (read/deploy/fetch — **no env-var-set tool**). Codex CLI works; **Gemini CLI is dead**
  (`IneligibleTierError` — free tier retired → Antigravity). The `ghzt-llms` MCP is NOT loaded in
  the `~/kids` session (only in `~/src`).

## STATUS: v1 is BUILT, MERGED, and ACTIVATED EXCEPT eBay

### v1 (eBay-only canvasser) — DONE, merged to `main` via PR #2
- 19 TDD tasks, multi-LLM design review (Codex + Claude council) → reworked spec → subagent-driven
  build → final whole-branch review. **79 vitest tests pass; `pnpm build` clean.**
- Components (all in repo): `scripts/lib/{url,parse,filter,pacific,control,condition,ebay,airtable,health}.mjs`,
  `scripts/{bootstrap,canvass,digest}.mjs`, `app/api/settings/route.ts` (+ `lib/settings/{window,validate,ratelimit}.ts`),
  `public/index.html` settings panel, `.github/workflows/{canvass,digest}.yml`, `.github/last-run` keepalive.
- Security: the old unauthenticated `/api/hardware` POST was REMOVED. `/api/settings` is the only
  writer (PIN-gated, fail-closed, allowlist {price_min,price_max,zipcode,radius_mi}, rate-limited, no typecast).
- Final review found+fixed 3 same-class schema/API-shape bugs (non-schema `title`/`price` on the
  canvass write + digest projection; eBay `distance` → real field `distanceFromPickupLocation`).

### Activation state (what's live right now)
- ✅ **Airtable schema bootstrapped** (done via MCP, not `pnpm bootstrap`): 6 new Hardware fields
  (`source`,`status`,`found_date`,`distance_mi`,`listing_url`,`ebay_item_id`) + `Control` table,
  seeded with defaults price 200/1000, zip 98052, radius 100.
- ✅ **`SETTINGS_SECRET`** set in Vercel (the user's PIN; **recommend rotating** — it was typed in chat).
- ✅ **`AIRTABLE_CI_TOKEN`** set as a GitHub Actions secret (read+write on the base).
- ✅ **Settings panel verified live end-to-end**: GET returns Control window; PUT with the PIN writes
  to Control (200), wrong/no PIN → 401, invalid body → 400, persistence confirmed via Airtable read.
- ⏸️ **Canvass is HELD OFF**: `Control.enabled = FALSE` (record `recamgm14LSayOXKd`, field
  `fldbgKYCMfdHiXasJ`) so the nightly cron no-ops cleanly instead of fail-emailing while eBay is pending.
- ⏳ **eBay**: developer account UNDER REVIEW. `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` NOT set yet.

### TO TURN ON eBay (when the keyset arrives)
1. Create a **Production** eBay keyset → App ID (=Client ID), Cert ID (=Client Secret).
2. `gh secret set EBAY_CLIENT_ID --repo jaime-espinosa/kidscomputer`
   `gh secret set EBAY_CLIENT_SECRET --repo jaime-espinosa/kidscomputer`
3. Flip `Control.enabled = true` (Airtable MCP: update record `recamgm14LSayOXKd`, field
   `fldbgKYCMfdHiXasJ` = true).
4. `gh workflow run canvass.yml --repo jaime-espinosa/kidscomputer` (workflow_dispatch enabled).
5. Verify candidates appear (price∈window, distance≤radius, deduped) and especially that
   **`distance_mi` populates** — confirm the eBay `distanceFromPickupLocation` field shape against the
   real API (docs timed out during review; code reads it with a `distance` fallback + km→mi convert).

## Known caveats / open minors (non-blocking)
- Full minor/gap list is in the local SDD ledger `.git/sdd/progress.md` (NOT committed). Highlights:
  health-issue on "N consecutive zero-insert runs" is specced but NOT implemented (only the
  uncaught-error path); eBay 429-backoff branch untested; keepalive `git push` is bare; unset
  SETTINGS_SECRET returns 503 (403 cleaner).
- Pre-existing (NOT from this work): `next.config` has `ignoreBuildErrors: true` (from the original
  v0 merge); `storage_capacity_gb` Airtable formula errors on every row (needs a formula fix).

## PHASE 2 — PLANNING IN PROGRESS (resume here)
**Planning status (2026-06-19):**
- ✅ **Spec written + reviewed + committed:** `docs/superpowers/specs/2026-06-19-deal-canvasser-phase2-design.md`
  (its "Decisions (resolved at review)" section is authoritative: all sources local, all 6 retailers
  friendliest-first, cross-language split accepted).
- ✅ **Two plan candidates authored & preserved** (durable, in-repo) at
  `docs/superpowers/plans/_phase2-author-candidates/` → `codex-candidate.md`, `opus-candidate.md`,
  `plan-brief.md`. (Both are full ~75–82KB TDD plans; Opus's is grounded in the real v1 libs.)
- ✅ **Consensus plan SYNTHESIZED + verified + committed:**
  `docs/superpowers/plans/2026-06-19-deal-canvasser-phase2-plan.md` (17 TDD tasks: **S0-0..S0-5**
  Node/vitest generalizations in `~/kids/computers` FIRST, then **S1-0..S1-10** Python/pytest scrape
  agent in `~/src`). Verified schema-correct (explicit asserts that `title`/`price` are NOT
  Hardware fields; `z` is price; `listing_key` dedup consistent across the Node/Python split).
- **RESUME (next step) = BUILD IT:** run `superpowers:subagent-driven-development` against that plan.
  S0 is in `~/kids/computers` (branch `feat/canvasser-phase2-s0`); S1 is in `~/src` (branch
  `feat/marketplace-scraper-phase2`) and is **Python** using the `~/src` cookie-vault substrate.
  S1 also needs the one-time MANUAL setup (Task S1-2 allowlist + S1-1 cookie capture with a BURNER
  FB/OfferUp account) before its live run. The Airtable schema adds (`listing_key` field + `Retailer`
  source choice, Tasks S0-5) are done by the assistant via Airtable MCP at execution time.

## PHASE 2 — design summary (NOTHING built yet)
**Goal:** automate MORE sources than eBay. Decisions locked with the user:
- **Sources: ALL of** retailer/refurb open-box + Facebook Marketplace + OfferUp + Craigslist.
- **Browser host: THIS WSL box** (best-effort — scrapes only while awake; cloud cron still covers
  eBay+retailers always-on).
- **Budget: strictly free** (no paid proxy/cloud-browser).
- **FB/OfferUp: burner account** (protect the main account).
- **Build order: both sub-projects as ONE combined Phase 2.**

**Architecture (two runtimes, one Airtable):**
- **Cloud (GitHub Actions, free, always-on):** eBay (existing) + **retailer/refurb** (no-auth
  HTTP/search: Best Buy open-box, Micro Center, Newegg, Woot, Dell Outlet, Back Market, Amazon
  Renewed) → write candidates to Airtable. Add a `Retailer` choice to the `source` singleSelect.
- **Local (WSL, free, residential IP, when awake):** the `~/src` `_util/_browse` Playwright +
  **cookie-vault** substrate scrapes **FB Marketplace + OfferUp** (burner login) + **Craigslist**
  (residential IP) → write candidates to the SAME Airtable. Scheduled via systemd user timer.

**Design notes / things to resolve in the Phase 2 spec:**
- **Dedup is currently eBay-specific** (keyed on `ebay_item_id`). Phase 2 needs a GENERAL dedup key
  (e.g. `source` + canonical listing id/URL) across all sources — generalize before adding sources.
- `MAX_CANDIDATES` cap now spans all sources; confirm Airtable free record headroom.
- FB/Craigslist are **ToS-gray** (FB ToS prohibits automation; CL litigates scrapers) — burner
  account, polite rate-limits, stealth backend (Camoufox), do NOT republish scraped content publicly.
- `facebook.com` is in the `~/src` vault **deny list** → needs an allowlist exception.
- WSL caveat: systemd user timers fire only when WSL is running; FB/CL coverage is best-effort.

**Exact `~/src` substrate integration points** — captured concretely below (recon completed
2026-06-19), so the Phase 2 spec can be written without re-exploring.

## Phase 2 — `~/src` substrate integration (recon, concrete)
Python **3.12**, system `/usr/bin/python3`. No venv/pipenv — deps are ambient (`pip install --user`).
A standalone script under `~/src` imports organs directly (`from _util._browse.session import session_for`);
add `sys.path.insert(0, <src>)` if run from elsewhere. **No Airtable client in the tree** — use REST
via `requests` with a token (same base `appLnCrA0kRqr9Di2`, table `tblnJoBqI7G2FaBke`/Hardware).
Install: `pip install playwright camoufox browserforge requests python-dotenv && playwright install chromium`.

1. **Cookie seed (one-time per site):** `python3 scripts/capture_cookies.py facebook|offerup|craigslist`
   — opens a headed 3-min login window, saves cookies to `_cour/_vault/cookies/{site}.json`. First add
   each site to the `TARGETS` dict in `scripts/capture_cookies.py` (url, cookie_file, domains,
   logged_in_check). Re-run to re-seed when cookies expire (~30–90d).
2. **Logged-in session in code:** `_util/_browse/session.py` →
   `async with session_for(site, account="default", headless=True, backend="playwright"|"camoufox", config=BrowseConfig|None) as session:`
   yields a `Session` with `.page` / `.context` / `.engine` (cookies auto-injected). Stealth:
   `session_for(site, backend="camoufox")` or `BrowseConfig(backend="camoufox", stealth=True)`.
   Low-level: `vault_session.inject_vault_cookies(context, site, account="default", missing_ok=False)`.
3. **Vault allowlist (`_cour/_vault/allowlist.toml`):** add to `[cookies]`:
   `facebook = ["facebook.com","m.facebook.com","web.facebook.com"]`, `offerup = ["offerup.com","www.offerup.com"]`,
   `craigslist = ["craigslist.org","www.craigslist.org"]`; and **remove `"facebook.com"` from `[deny].domains`**
   (OfferUp/CL aren't denied). `version` must stay 1; duplicate domains across sites are rejected at load.
4. **Site playbooks:** YAML variants in `_pattern/_sites/variants/*.yaml` (fields: site, goal, variant_id,
   status, browser, headless, inputs, steps[{id,kind:goto|adaptive_fill|keyboard|wait|extract_text,...}],
   extraction{primary,result_selectors,completion_timeout_s}, fitness). Run from code via
   `from _pattern._sites import execute` →
   `await execute(site, intent, params=dict, handle=session.engine, ...) -> {success, data, error_kind, error, steps_completed, ...}`
   (`factory.py:360`). `error_kind` includes `login_wall`, `timeout`, `selector_miss` — use for health/retry.
5. **Schedule on WSL:** systemd **user** timers under `~/command/systemd/` (pattern:
   `master-venue-guard.timer` + a `.service` `Type=oneshot ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py`).
   Enable: `systemctl --user enable --now marketplace-scrape.timer`. **Run `loginctl enable-linger $(whoami)`**
   so timers survive logout; still WSL-best-effort (only fires while WSL is running). Put `AIRTABLE_*` in the
   service `EnvironmentFile=` (NOT committed).

**Phase-2 build sketch:** `~/src/scripts/marketplace_scraper.py` → for each of FB/OfferUp/Craigslist:
`session_for(site)` → `execute(site, "marketplace_search", params={query, zip, price window}, handle=session.engine)`
→ parse listings → map to the SAME candidate shape (generalized dedup key `source`+canonical-id, since v1
dedup is eBay-`ebay_item_id`-specific) → Airtable REST create with the field allowlist (no typecast, owned:false,
condition mapped, type∈{Laptop,Desktop}, source∈{FB Marketplace,OfferUp,Craigslist}). Retailers (2a) stay in
the cloud canvass cron as no-auth fetch+parse modules. Add a `Retailer` choice to the `source` singleSelect.

## How to resume (process)
Phase 2 was mid-**brainstorming** (decisions above locked). Next steps:
1. (Optional) re-run the `~/src` substrate recon (see integration points above).
2. Finish the Phase 2 **spec** → `docs/superpowers/specs/2026-06-19-deal-canvasser-phase2-design.md`,
   commit, user-review.
3. **llms-plan** (Codex + Claude council) → implementation plan in `docs/superpowers/plans/`.
4. **subagent-driven-development** to build (fresh implementer + reviewer per task), then final
   whole-branch review + finishing-a-development-branch (PR).

## Reference docs (committed)
- `docs/superpowers/specs/2026-06-18-deal-canvasser-design.md` — v1 spec
- `docs/superpowers/specs/2026-06-18-deal-canvasser-council-review.md` — multi-LLM review findings
- `docs/superpowers/plans/2026-06-18-deal-canvasser-plan.md` — v1 implementation plan (19 tasks)
- `docs/superpowers/2026-06-18-deal-canvasser-e2e-checklist.md` — live activation checklist
- `.git/sdd/progress.md` — per-task build ledger + minor-findings list (LOCAL, not committed)
