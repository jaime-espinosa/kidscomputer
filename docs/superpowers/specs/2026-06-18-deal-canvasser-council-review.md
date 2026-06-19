# Council Review — Deal Canvasser Spec (2026-06-18)

Multi-LLM adversarial review of `2026-06-18-deal-canvasser-design.md`.
Reviewers: **Codex** (CLI, citation-backed) + **5-lens Claude council** (36 agents, 25/30
findings survived adversarial verification; agents inspected the live repo + Airtable base).
**Gemini** abstained — its CLI free tier ("Gemini Code Assist for individuals") was deprecated
to Antigravity and errored (`IneligibleTierError`).

**Both reviewers independently returned: REWORK** — sound concept and architecture, not
shippable as written.

## P0 — must fix
1. **Vercel AI free tier ≈ $5/30 days, not "$2/day"** (~12× off); auto-top-up can charge a card.
   Re-budget, disable top-up (fail closed), make AI optional, degrade to "no score" when spent.
2. **Dormancy ↔ GitHub 60-day disable deadlock.** Dormant ⇒ no commits ⇒ repo inactive ⇒ GitHub
   disables the cron ⇒ the only reader of `last_visit` dies ⇒ never auto-wakes (permanent silent
   death). Need an always-run keepalive commit *before* any dormancy/enabled gate.
3. **Public unauthenticated Airtable-write endpoints.** The existing `/api/hardware` POST writes
   arbitrary client JSON via the PAT (`typecast:true`, no auth/rate-limit) on a public repo;
   `/api/visit` would add another. Require auth/same-origin + field allowlist + drop typecast +
   rate-limit (or remove the unused POST entirely).
4. **One delete-capable PAT shared across site reads, public writes, and CI on a public repo.**
   Leak ⇒ whole base wiped. Split scoped tokens (read-only for site GET; create+delete CI-only),
   scope to the base, SHA-pin third-party actions, rotate.
5. **No schema bootstrap.** The 7 new fields + Control table don't exist in the live base ⇒ every
   insert 422s. Add idempotent `bootstrap.mjs` (metadata API) seeding Control `enabled=true`.
6. **eBay 100mi only via local pickup.** `itemLocationRegion` is continent-broad; radius needs
   `deliveryOptions=LOCAL_PICKUP` + `pickupPostalCode=98052&pickupRadius=100`. Define `distance_mi`
   per source (null = ships).
7. **Craigslist out of autonomous v1** — ToS prohibits scraping (they litigate), datacenter IPs
   get 403'd; never republish CL content publicly. Demote to human-loop deep-links.

## P1 — important
- **Reaper:** delete only on affirmative dead (ended/sold/404); transient 4xx/5xx = "unknown",
  require N consecutive + per-source circuit breaker (else outages mass-delete live rows).
- **Eviction:** unscored rows sort first ⇒ fresh finds evicted before old junk. Protect unscored
  until one enrich pass; enforce cap at insert.
- **Dedup:** canonical IDs (eBay numeric `itemId`, CL posting-id), strip tracking params, content
  fingerprint vs live + archive (relists get new IDs/URLs).
- **CSV commits:** trigger a full Vercel redeploy nightly (burns build minutes) + concurrent runs
  race/clobber. Use Vercel Ignored-Build-Step for `data/**` (or a `data` branch) + `concurrency:`
  groups + `pull --rebase` retry.
- **Silent failure:** per-source isolation exits "green" on a dead eBay token. Don't swallow the
  top-level error; open a "Canvasser health" issue on failure/empty runs.
- **Privacy/ToS:** prices/locations/seller links in public Issues + public CSV. Publish derived
  fields only (also satisfies eBay data-redistribution ToS); use an approved keyset.
- **Protect `/api/enrich`** with a shared secret + rate-limit (cost-DoS otherwise).

## P2 / strategic
- **Both councils flagged v1 as over-engineered** (~850 records of headroom). Recommendation:
  ship eBay-pickup ingestion + cap + dedup + manual digest first; defer archive, eviction, the
  3-state dormancy machine, `purge.mjs`, and AI to Phase 2.
- Airtable AI (`aiText`) is paid/limited — demote to Phase-2 opt-in.
- Digest cadence: track `last_digest_date` (elapsed Pacific days), not calendar parity (breaks at
  year/leap boundaries).
- eBay hygiene: `X-EBAY-C-MARKETPLACE-ID: EBAY_US`, cache the ~2h client-credentials token.

## Decision (user)
Adopt **lean v1 + Phase 2**; **fold the live `/api/hardware` POST fix into the rework**; save this
review. The spec has been rewritten accordingly (see `2026-06-18-deal-canvasser-design.md`).
