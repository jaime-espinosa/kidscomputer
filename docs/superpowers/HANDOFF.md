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

## PHASE 2 — IN PROGRESS (designing; NOTHING built yet)
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

**Exact `~/src` substrate integration points to nail in the spec** (a recon Explore agent was
launched this session to gather these — re-run if not captured): `scripts/capture_cookies.py`
(one-time burner login → vault), `_util/_browse/session.py::session_for(...)` +
`vault_session.inject_vault_cookies(...)`, `_pattern/_sites` playbook YAML schema + the
`execute(site,intent,params,handle)` entrypoint, `_cour/_vault/allowlist.toml` (FB/OfferUp/CL
exception), systemd timers under `/home/jaime/command/systemd/`, and how a standalone `~/src`
script imports `_util._browse` + writes to Airtable (REST with a token).

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
