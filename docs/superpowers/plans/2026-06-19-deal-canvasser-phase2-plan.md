# Deal Canvasser Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every code task is a strict TDD loop:** write the failing test → run it and confirm the *stated* failure → write the **minimal REAL** implementation (no stubs, no `TODO`, no placeholders) → run and confirm green → commit. S0 (Node/vitest, small) runs entirely in `~/kids/computers` and lands FIRST; S1 (Python/pytest, the bulk) runs entirely in `~/src`. The two repos commit independently on independent branches.

**Goal:** Generalize the v1 eBay-only canvasser data layer for shared cross-source Airtable dedup (S0), then add a local Python scrape agent under `~/src` (S1) that scrapes Facebook Marketplace, OfferUp, Craigslist, and retailer/refurb open-box into the SAME Airtable `Hardware` base.

**Architecture:** Two runtimes, one Airtable, no shared process state. **Cloud — GitHub Actions (Node ESM, always-on, free):** unchanged `scripts/canvass.mjs` keeps doing eBay Browse API only; S0 generalizes its shared data-layer modules in place (dedup/filter/schema become source-agnostic). **Local — WSL (Python 3.12, residential IP, best-effort):** ONE agent `~/src/scripts/marketplace_scraper.py` scrapes everything else via the existing `_util/_browse.session_for(..., backend="camoufox")` cookie-vault substrate and `_pattern._sites.execute(...)`. It does NOT import the Node libs; it re-implements the small pure parse/filter/map logic in Python (under a new `_kids/` package) and writes write-legal candidate rows to Airtable via `requests`, honoring the SAME schema + `listing_key` + write-legality conventions as v1. Tests never hit live networks.

**Tech Stack:**
- **S0:** Node ESM (`.mjs`), vitest (already wired), Airtable REST + Metadata API, pnpm. No new website runtime deps.
- **S1:** Python 3.12 (`/usr/bin/python3`, ambient `pip install --user` — no venv), pytest + `requests` (both already importable), `pyyaml`, `playwright`/`camoufox`/`browserforge`/`python-dotenv` (user installs per runbook). Reuses `~/src` organs `_util._browse.session.session_for`, `_pattern._sites.execute`, `_cour/_vault` cookie vault. systemd **user** timer for scheduling.

---

## Global Constraints (exact values — copy verbatim, do not paraphrase)

- **Airtable base:** `appLnCrA0kRqr9Di2`. **Hardware table:** `tblnJoBqI7G2FaBke` (primary field `name`; **price is the `z` currency field** — there is NO `price` or `title` schema field on Hardware). **Control table:** `tbljHjoeyh5jZGJLg`, singleton row id `recamgm14LSayOXKd`.
- **Search-window defaults (used when Control fields are blank):** `price_min=200`, `price_max=1000`, `zipcode="98052"`, `radius_mi=100`.
- **Shared cap:** `MAX_CANDIDATES=150`, enforced at insert by BOTH writers (low-volume; accept the benign race since cloud@3am and local-nightly rarely overlap). The cap counts ALL Hardware rows, not just keyed ones.
- **`listing_key` (the NEW shared dedup key):** `"{source}:{stable_id}"` where `stable_id` is the source's listing id (eBay `ebay_item_id`, CL posting id, FB item id, OfferUp id) or, if none, the **canonicalized** `listing_url`. v1's eBay path sets it to `"eBay:{ebay_item_id}"`. **Dedup keys on `listing_key` across ALL sources** (replaces eBay-only `ebay_item_id` dedup; `ebay_item_id` stays as a field). `airtable.listExistingKeys()` returns the `listing_key` set.
- **Distance filter rule (generalized):** keep a row iff `price ∈ [price_min, price_max]` **AND** `(distance_mi == null OR distance_mi <= radius_mi)`. `null` distance = "ships nationally / unknown" (retailers) — a valid in-budget deal, **kept** (v1 dropped it).
- **`source` singleSelect choices:** `eBay`, `Craigslist`, `FB Marketplace`, `OfferUp`, `Estate/Auction`, `Manual`, **and the NEW `Retailer`**. S1 writers emit exactly `FB Marketplace` / `OfferUp` / `Craigslist` / `Retailer`.
- **WRITE-LEGAL / NO-TYPECAST rows (both writers; Airtable 422s the whole batch otherwise):**
  - `owned` = checkbox → **boolean** `false` (never the string `"No"`).
  - `condition` = singleSelect, choices EXACTLY `{New, Refurbished, Used}` → map every raw condition through `mapCondition`/`map_condition`, returning one of the 3 or `null`/`None` (**omit** the field — never the raw string).
  - `type` = singleSelect → only `"Laptop"`/`"Desktop"` (existing choices).
  - `status` = `"candidate"`; `found_date` = Pacific date `YYYY-MM-DD`.
  - **Drop every `null`/`undefined`/empty-string field via the allowlist `pick`/`_pick`** before sending; send NO `typecast`. There is NO `title`/`price` field — never send them (use `name` and `z`).
- **Fail-soft per source (S1):** each source runs in its own try/except; a `login_wall` / `timeout` / block logs and **skips that source — never aborts the others**. On `login_wall`, additionally log `re-seed cookies for {site}`. Polite rate-limit + jitter between requests.
- **ToS posture (S1):** FB/Craigslist are ToS-gray → burner account, Camoufox stealth, polite rate-limits/jitter, residential IP. **Never republish scraped listing content publicly.** Only inserts (no deletes); dedup prevents dup rows; cap bounds growth.
- **WSL best-effort:** systemd user timer fires only while WSL is running; `loginctl enable-linger $(whoami)` so it survives logout. No always-on guarantee for scraped sources; eBay (API) stays the only always-on cloud path.
- **Secrets:** `AIRTABLE_CI_TOKEN` (read+write on the base) drives S1 via the systemd `EnvironmentFile=` (NOT committed). NEVER commit secrets/.env to either repo (both are public/shared).
- **Branch first** in each repo:
  - S0 (`~/kids/computers`, on `main`): `git checkout -b feat/canvasser-phase2-s0`
  - S1 (`~/src`, on `_arch-_ops`): `git checkout -b feat/marketplace-scraper-phase2`
- **Commit footer — append to EVERY commit message body (as a second `-m` block, exactly):**
  ```
  Co-Authored-By: claude-flow <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk
  ```

## Airtable Schema Operations (execution-time MCP, OUT of the TDD loop)

Two live-base metadata changes are required before EITHER writer sends Phase 2 rows. These are **not** code, **not** unit-tested, and **do not require a schema-write token in repo code** — perform them once via the Airtable MCP at execution time and verify by reading the schema back.

- Hardware field `listing_key`: `singleLineText` (MCP `create_field`; re-running is a no-op since the name collides).
- Hardware `source` singleSelect gains the `Retailer` choice (MCP `update_field`, append to the existing choices `eBay`/`Craigslist`/`FB Marketplace`/`OfferUp`/`Estate/Auction`/`Manual`).

Verify (token-based read-back; either MCP `get_table_schema` or the following, using the existing CI token):

```bash
node --env-file=.env.local -e '
const base = "appLnCrA0kRqr9Di2", table = "tblnJoBqI7G2FaBke";
const token = process.env.AIRTABLE_CI_TOKEN || process.env.AIRTABLE_TOKEN;
if (!token) throw new Error("AIRTABLE_CI_TOKEN or AIRTABLE_TOKEN required for schema verification");
const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
const hw = (await res.json()).tables.find((t) => t.id === table);
console.log(JSON.stringify({
  listing_key_type: hw.fields.find((f) => f.name === "listing_key")?.type,
  source_choices: hw.fields.find((f) => f.name === "source")?.options?.choices?.map((c) => c.name).sort(),
}, null, 2));
'
```

Expected output:

```json
{
  "listing_key_type": "singleLineText",
  "source_choices": ["Craigslist", "Estate/Auction", "FB Marketplace", "Manual", "OfferUp", "Retailer", "eBay"]
}
```

---

## File Structure

### S0 — Node `kidscomputer` repo (`~/kids/computers`) — MODIFY in place

```
computers/
├── scripts/
│   ├── canvass.mjs                 # MODIFY: emit listing_key="eBay:{id}"; dedup on listExistingKeys; cap via count()
│   └── lib/
│       ├── filter.mjs              # MODIFY: applyWindow keeps null distance; dedup on listing_key (eBay fallback)
│       └── airtable.mjs            # MODIFY: +listing_key in CANDIDATE_FIELDS; +listExistingKeys(); count() pages all rows
├── tests/
│   ├── lib/filter.test.mjs         # MODIFY: null-distance KEPT; cross-source listing_key dedup
│   ├── lib/airtable.test.mjs       # MODIFY: listing_key in allowlist; listExistingKeys pages; count counts all rows
│   └── canvass.test.mjs            # MODIFY: canvass sets listing_key + dedups on key set
└── (Airtable schema, via MCP — see "Airtable Schema Operations")   # ADD listing_key field + Retailer choice
```

### S1 — Python `~/src` agent (the bulk) — NEW under a `_kids/` bounded context

```
src/
├── scripts/
│   ├── capture_cookies.py                 # MODIFY: add facebook/offerup/craigslist to TARGETS
│   └── marketplace_scraper.py             # NEW: orchestrator (read Control → per-source scrape → write); fail-soft
├── _cour/_vault/allowlist.toml            # MODIFY (MANUAL, runbook): +[cookies] fb/offerup/cl; remove facebook.com from [deny]
├── _pattern/_sites/variants/
│   ├── facebook_marketplace_search_v1.yaml   # NEW playbook (camoufox, burner cookies)
│   ├── offerup_search_v1.yaml                # NEW playbook (camoufox, burner cookies)
│   ├── craigslist_search_v1.yaml             # NEW playbook (camoufox, residential IP)
│   └── bestbuy_openbox_search_v1.yaml        # NEW playbook (camoufox, friendliest retailer first)
├── _kids/                                 # NEW package: self-contained scrape-agent libs (DDD bounded context)
│   ├── __init__.py
│   ├── listing_parse.py                   # NEW pure: title→specs, condition map, clean_url, build_listing_key
│   ├── airtable_py.py                     # NEW: REST listExistingKeys + count-all-rows + batched create (allowlist, no typecast)
│   ├── filter_py.py                       # NEW pure: apply_window (null distance kept), dedup, cap_inserts
│   └── sources.py                         # NEW: per-source raw-card → write-legal candidate adapters + SOURCES registry
├── tests/_kids/                           # NEW pytest suite (mocked HTTP / saved fixtures — ZERO live calls)
│   ├── __init__.py
│   ├── conftest.py                        # sys.path shim so `import _kids...` resolves
│   ├── fixtures/{fb_cards.json,craigslist_cards.json}
│   ├── test_capture_targets.py
│   ├── test_listing_parse.py
│   ├── test_airtable_py.py
│   ├── test_filter_py.py
│   ├── test_playbooks.py
│   ├── test_sources.py
│   └── test_orchestrator.py
└── ~/command/systemd/                     # NEW (host config, outside the repo)
    ├── marketplace-scrape.service         # Type=oneshot; EnvironmentFile=; ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py
    └── marketplace-scrape.timer           # nightly OnCalendar; Persistent=true
```

---

## Constraint → Task traceability

| Constraint | Where honored |
|---|---|
| Shared `listing_key` dedup (NOT eBay-only) | S0-2 (filter dedup), S0-3 (allowlist + `listExistingKeys`), S0-4 (canvass emits it); S1-3 (`build_listing_key`), S1-4 (`airtable_py`), S1-5 (`filter_py.dedup`), S1-7 (adapters) |
| Distance filter keeps null/ships | S0-1 (`applyWindow`); S1-5 (`apply_window`) |
| `Retailer` source choice (schema add via MCP) | Schema Operations; S0-5 schema verify; S1-7 (Best Buy adapter emits `source="Retailer"`) |
| Shared cap at insert (counts ALL rows) | S0-3 (`count()` pages all rows), S0-4 (cap via `count()`); S1-4 (`count`), S1-8 (`cap_inserts` in `plan_run`) |
| Write-legal / no-typecast rows | S0-3 (allowlist `pick`, no typecast); S1-3 (`map_condition`), S1-4 (`_pick` + no typecast + `owned False`), S1-7 (`name`/`z`, no `title`/`price`) |
| Fail-soft per source | S1-8 (`process_source` per-source try/except + `error_kind`) |
| Cookie re-seed on login_wall | S1-8 (`reseed` flag → `re-seed cookies for {site}` log) |
| ToS posture (burner/stealth/jitter/no-republish) | S1-1 (cookie runbook), S1-6/7 (Camoufox playbooks), S1-8 (jitter; log-only, no content republish) |
| systemd user timer + enable-linger + EnvironmentFile | S1-9 (units + runbook) |

---

# Sub-project S0 — Shared data-layer generalizations (Node; do FIRST; small)

> Repo: `~/kids/computers`. Branch: `feat/canvasser-phase2-s0`. Runner: vitest via `pnpm`. Run all commands from `/home/jaime/kids/computers`. These edit the REAL shipped v1 modules; keep eBay's always-on path working.

## Task S0-0 — Branch + baseline

- [ ] **Step 1:** `git -C /home/jaime/kids/computers checkout -b feat/canvasser-phase2-s0`
- [ ] **Step 2 (sanity baseline):** `cd /home/jaime/kids/computers && pnpm test -- --run` → confirm the existing v1 suites pass before changing anything.

---

## Task S0-1 — `applyWindow` keeps null/unknown distance (ships)

The v1 `applyWindow` (`scripts/lib/filter.mjs:1-10`) drops any row whose `distance_mi` is not a number, and the v1 test (`tests/lib/filter.test.mjs:7-11`) asserts that. Retailers ship nationally → `distance_mi == null` is a valid in-budget deal. Reverse the rule.

**Files:** Modify `scripts/lib/filter.mjs`; Modify `tests/lib/filter.test.mjs`.

- [ ] **Step 1: Write the failing test** — replace the `describe("applyWindow", …)` block in `tests/lib/filter.test.mjs` with:

```js
describe("applyWindow", () => {
  it("keeps price∈[min,max] AND (distance null/ships OR distance<=radius)", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    const items = [
      mk("1", 150, 10),   // below price → drop
      mk("2", 500, 50),   // in window → keep
      mk("3", 500, 150),  // too far → drop
      mk("4", 800, null), // ships/unknown → KEEP (was dropped in v1)
    ]
    expect(applyWindow(items, win).map((i) => i.ebay_item_id)).toEqual(["2", "4"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/lib/filter.test.mjs`
Expected: FAIL — item `"4"` (null distance) is dropped (current code requires `typeof i.distance_mi === "number"`).

- [ ] **Step 3: Write minimal implementation** — replace the `applyWindow` body in `scripts/lib/filter.mjs`:

```js
export function applyWindow(items, win) {
  return items.filter(
    (i) =>
      typeof i.price === "number" &&
      i.price >= win.price_min &&
      i.price <= win.price_max &&
      // null/undefined distance = ships nationally / unknown → keep; numeric must be within radius
      (i.distance_mi == null || (typeof i.distance_mi === "number" && i.distance_mi <= win.radius_mi)),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/lib/filter.test.mjs`
Expected: PASS (existing eBay-shaped tests still pass; eBay rows always carry numeric distance).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat(canvass): applyWindow keeps null/ships distance (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-2 — `dedup` keys on `listing_key` (source-agnostic, eBay fallback)

v1 `dedup` keys on `ebay_item_id`. Generalize to `listing_key` so all sources interoperate. Keep it tolerant: if a row lacks `listing_key`, fall back to `eBay:{ebay_item_id}` so the eBay path keeps working before S0-4 lands.

**Files:** Modify `scripts/lib/filter.mjs`; Modify `tests/lib/filter.test.mjs`.

- [ ] **Step 1: Write the failing test** — replace the existing `describe("dedup", …)` block in `tests/lib/filter.test.mjs` with:

```js
describe("dedup", () => {
  it("removes items whose listing_key already exists, across sources", () => {
    const existing = new Set(["eBay:2", "Craigslist:abc"])
    const items = [
      { listing_key: "eBay:2", price: 1 },
      { listing_key: "Craigslist:abc", price: 1 },
      { listing_key: "FB Marketplace:99", price: 1 },
    ]
    expect(dedup(items, existing).map((i) => i.listing_key)).toEqual(["FB Marketplace:99"])
  })
  it("removes within-batch duplicates, keeping first occurrence", () => {
    const result = dedup(
      [{ listing_key: "OfferUp:7", price: 100 }, { listing_key: "OfferUp:7", price: 200 }, { listing_key: "Retailer:u", price: 300 }],
      new Set(),
    )
    expect(result).toHaveLength(2)
    expect(result.map((i) => i.listing_key)).toEqual(["OfferUp:7", "Retailer:u"])
    expect(result[0].price).toBe(100)
  })
  it("falls back to eBay:{ebay_item_id} when listing_key is absent", () => {
    expect(dedup([{ ebay_item_id: "5" }], new Set(["eBay:5"]))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/lib/filter.test.mjs`
Expected: FAIL — current `dedup` reads `item.ebay_item_id` only.

- [ ] **Step 3: Write minimal implementation** — replace the `dedup` function in `scripts/lib/filter.mjs` (keep `applyWindow` and `capInserts` as-is):

```js
export function keyOf(item) {
  if (item.listing_key) return String(item.listing_key)
  if (item.ebay_item_id != null) return `eBay:${item.ebay_item_id}` // back-compat fallback
  return ""
}

export function dedup(items, existingKeys) {
  const seen = new Set(existingKeys)
  const result = []
  for (const item of items) {
    const key = keyOf(item)
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/lib/filter.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat(canvass): dedup on shared listing_key with eBay fallback (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-3 — `airtable.mjs`: `listing_key` in allowlist, `listExistingKeys()`, `count()` pages all rows

Add `listing_key` to `CANDIDATE_FIELDS`; add `listExistingKeys()` (pages the `listing_key` column for cross-source dedup); and make `count()` page ALL Hardware rows (not just keyed ones) so the shared cap includes the ~51 legacy curated rows that have no `listing_key`. Keep `listExistingIds` for back-compat.

**Files:** Modify `scripts/lib/airtable.mjs`; Modify `tests/lib/airtable.test.mjs`.

- [ ] **Step 1: Write the failing test** — in `tests/lib/airtable.test.mjs`, update the `CANDIDATE_FIELDS` equality test and append two new `describe` blocks:

Change the existing `CANDIDATE_FIELDS` test body to:

```js
  it("CANDIDATE_FIELDS includes listing_key for cross-source dedup", () => {
    expect(CANDIDATE_FIELDS).toEqual([
      "name", "type", "condition", "owned", "source", "status", "found_date",
      "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
    ])
  })
```

Append:

```js
describe("airtable.listExistingKeys", () => {
  it("pages and returns the set of listing_key values", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ fields: { listing_key: "eBay:1" } }], offset: "o1" } },
      { body: { records: [{ fields: { listing_key: "Craigslist:x" } }, { fields: {} }] } },
    ])
    const keys = await at(fetch).listExistingKeys()
    expect([...keys].sort()).toEqual(["Craigslist:x", "eBay:1"])
    expect(fetch.calls[0].url).toContain("fields%5B%5D=listing_key")
  })
})

describe("airtable.count", () => {
  it("counts ALL Hardware rows even when a legacy curated row lacks listing_key", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ id: "rec1" }, { id: "rec2" }], offset: "o1" } },
      { body: { records: [{ id: "rec3" }] } },
    ])
    await expect(at(fetch).count()).resolves.toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/lib/airtable.test.mjs`
Expected: FAIL — `listExistingKeys is not a function`, `listing_key` missing from `CANDIDATE_FIELDS`, and `count()` proxies through the (keyed) ID set so the legacy row is undercounted.

- [ ] **Step 3: Write minimal implementation** — in `scripts/lib/airtable.mjs`:
  - Append `"listing_key"` to `CANDIDATE_FIELDS` positioned right after `"listing_url"` (so the array matches the test): `["name","type","condition","owned","source","status","found_date","distance_mi","listing_url","listing_key","ebay_item_id","gpu_model","vram","ram","z"]`.
  - Add this method inside `createAirtable` (mirror `listExistingIds` but project `listing_key`):

```js
  async function listExistingKeys() {
    const keys = new Set()
    let offset
    do {
      const url = new URL(base)
      url.searchParams.set("pageSize", "100")
      url.searchParams.set("fields[]", "listing_key")
      if (offset) url.searchParams.set("offset", offset)
      const res = await fetchImpl(url.toString(), { headers: auth })
      if (!res.ok) throw new Error(`Airtable list ${res.status}: ${await res.text()}`)
      const data = await res.json()
      for (const r of data.records ?? []) {
        const k = r.fields?.listing_key
        if (k) keys.add(String(k))
      }
      offset = data.offset
    } while (offset)
    return keys
  }
```

  - Replace `count()` so it pages ALL rows (no `fields[]` filter → every record is returned):

```js
  async function count() {
    let total = 0
    let offset
    do {
      const url = new URL(base)
      url.searchParams.set("pageSize", "100")
      if (offset) url.searchParams.set("offset", offset)
      const res = await fetchImpl(url.toString(), { headers: auth })
      if (!res.ok) throw new Error(`Airtable count ${res.status}: ${await res.text()}`)
      const data = await res.json()
      total += data.records?.length ?? 0
      offset = data.offset
    } while (offset)
    return total
  }
```

  - Export the new method: change the return to `return { listExistingIds, listExistingKeys, count, create }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/lib/airtable.test.mjs`
Expected: PASS (the existing create/allowlist/no-typecast tests still pass; `pick` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/airtable.mjs tests/lib/airtable.test.mjs
git commit -m "feat(canvass): listExistingKeys + listing_key allowlist + count-all-rows (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-4 — `canvass.mjs`: emit `listing_key`, dedup on key set, cap via `count()`

Wire the generalizations into the orchestrator: dedup against `listExistingKeys()`, count the cap against `count()` (all rows), and write `listing_key = "eBay:{ebay_item_id}"` on each row.

**Files:** Modify `scripts/canvass.mjs`; Modify `tests/canvass.test.mjs`.

- [ ] **Step 1: Write the failing test** — in `tests/canvass.test.mjs`:
  - In `deps()`, change the `airtable` mock to expose `listExistingKeys` and `count`:

```js
    airtable: { listExistingKeys: vi.fn(async () => new Set()), count: vi.fn(async () => 0), create: vi.fn(async () => 1) },
```

  - Update the first happy-path test to assert the new key. Replace its body with:

```js
  it("inserts filtered+deduped candidates with listing_key, stripped URL, and marks the run", async () => {
    const d = deps()
    const r = await runCanvass(d)
    expect(d.ebay.search).toHaveBeenCalledWith(expect.objectContaining(win))
    const inserted = d.airtable.create.mock.calls[0][0]
    expect(inserted.map((x) => x.listing_key)).toEqual(["eBay:1"]) // $100 row filtered out
    expect(inserted.map((x) => x.ebay_item_id)).toEqual(["1"])
    expect(inserted[0].listing_url).toBe("https://ebay.com/itm/1") // tracking stripped
    expect(inserted[0].status).toBe("candidate")
    expect(inserted[0].source).toBe("eBay")
    expect(inserted[0].z).toBe(500)
    expect(inserted[0].owned).toBe(false)
    expect(inserted[0].condition).toBe("Refurbished")
    expect(d.control.markRan).toHaveBeenCalled()
    expect(r.inserted).toBe(1)
  })
```

  - In the "NO-OPS when disabled" test, change `expect(d.airtable.listExistingIds).not.toHaveBeenCalled()` → `expect(d.airtable.listExistingKeys).not.toHaveBeenCalled()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/canvass.test.mjs`
Expected: FAIL — `runCanvass` still calls `airtable.listExistingIds()` and rows lack `listing_key`.

- [ ] **Step 3: Write minimal implementation** — in `scripts/canvass.mjs` `runCanvass`:
  - Replace `const existing = await airtable.listExistingIds()` with:

```js
    const existing = await airtable.listExistingKeys()
    const currentCount = await airtable.count()
```

  - Change the cap line `const { toInsert, capReached } = capInserts(fresh, { currentCount: existing.size, max })` to use `currentCount`:

```js
    const { toInsert, capReached } = capInserts(fresh, { currentCount, max })
```

  - In the `toInsert.map(...)` row object, add `listing_key` right after `listing_url` (keep `ebay_item_id` as-is):

```js
        listing_url: cleanUrl(i.url),
        listing_key: `eBay:${i.ebay_item_id}`,
        ebay_item_id: i.ebay_item_id,
```

- [ ] **Step 4: Run the full S0 suite**

Run: `pnpm test -- --run`
Expected: PASS (all v1 suites + the new S0 cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/canvass.mjs tests/canvass.test.mjs
git commit -m "feat(canvass): emit eBay listing_key, dedup on key set, cap via count() (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-5 — Airtable schema: add `listing_key` field + `Retailer` choice (MCP, out of TDD loop)

Schema changes are a one-time live-base operation via the Airtable MCP (no unit test — not deterministic/local). Idempotent. **Do this before any writer sends `listing_key` or `source=Retailer`, or no-typecast writes 422.**

- [ ] **Step 1:** Add a `listing_key` field (`singleLineText`) to Hardware `tblnJoBqI7G2FaBke` in base `appLnCrA0kRqr9Di2` via Airtable MCP `create_field` (skip if it already exists).
- [ ] **Step 2:** Add a `Retailer` choice to the existing `source` singleSelect via Airtable MCP `update_field` (append; the other six choices already exist).
- [ ] **Step 3 (verify):** Run the schema verification command from "Airtable Schema Operations" (or MCP `get_table_schema`); confirm `listing_key_type: singleLineText` and `source_choices` includes `Retailer`.
- [ ] **Step 4 (backfill, recommended):** For the ~51 existing curated rows that have an `ebay_item_id` but no `listing_key`, set `listing_key = "eBay:{ebay_item_id}"` via MCP `update_records_for_table` so historical eBay rows dedup correctly. Rows without an id are left blank (they won't collide).

> No repo commit (live-base change). Record completion in the S0 task ledger.

---

# Sub-project S1 — Local scrape agent (Python, `~/src`; the bulk)

> Repo: `~/src`. Branch: `feat/marketplace-scraper-phase2`. Runner: pytest. Run from the repo root: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q`. The agent is self-contained under `_kids/` + `scripts/marketplace_scraper.py`; it imports `~/src` substrate organs directly. **All tests use mocked HTTP / saved fixtures — ZERO live network.**

## Task S1-0 — Branch + package skeleton

**Files:** Create `_kids/__init__.py`, `tests/_kids/__init__.py`, `tests/_kids/conftest.py`.

- [ ] **Step 1:** `git -C /home/jaime/src checkout -b feat/marketplace-scraper-phase2`
- [ ] **Step 2:** Create the package markers and conftest path shim:

`/home/jaime/src/_kids/__init__.py`:
```python
"""Kids-computer deal scrape agent (Phase 2, local WSL).

Self-contained: re-implements v1's pure parse/filter/map logic in Python and
writes to the same Airtable Hardware base via REST, honoring the SAME schema +
listing_key + write-legality (no typecast, owned=False) conventions as the Node
v1. Does NOT import the Node libs.
"""
```

`/home/jaime/src/tests/_kids/__init__.py`: empty file.

`/home/jaime/src/tests/_kids/conftest.py`:
```python
import sys
from pathlib import Path

# Ensure `import _kids...` resolves when pytest runs from anywhere under ~/src.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
```

- [ ] **Step 3: Confirm pytest collects (harness sanity)**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q`
Expected: `no tests ran` (exit code 5 acceptable — proves collection + path shim work).

- [ ] **Step 4: Commit**

```bash
git -C /home/jaime/src add _kids/__init__.py tests/_kids/__init__.py tests/_kids/conftest.py
git -C /home/jaime/src commit -m "chore(_kids): Phase 2 scrape-agent package skeleton + pytest path shim" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-1 — Cookie-seed targets (`capture_cookies.py` TARGETS) + runbook note

The `TARGETS` dict edit is real, testable code (the seeding *run* is manual/user). The one-time manual seeding is documented as a runbook step.

**Files:** Modify `scripts/capture_cookies.py`; Test `tests/_kids/test_capture_targets.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_capture_targets.py`:

```python
from scripts.capture_cookies import TARGETS


def test_phase2_sites_are_seedable():
    for site in ("facebook", "offerup", "craigslist"):
        assert site in TARGETS, f"{site} missing from capture_cookies TARGETS"
        t = TARGETS[site]
        assert t["url"].startswith("https://")
        assert t["cookie_file"].endswith(f"{site}.json")
        assert isinstance(t["domains"], list) and t["domains"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_capture_targets.py -q`
Expected: `KeyError`/assertion — sites absent.

- [ ] **Step 3: Write minimal implementation** — add three entries to the `TARGETS` dict in `scripts/capture_cookies.py` (after the existing `"chatgpt"` entry):

```python
    "facebook": {
        "url": "https://www.facebook.com/marketplace/",
        "cookie_file": "_cour/_vault/cookies/facebook.json",
        "domains": [".facebook.com", "facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"],
        "logged_in_check": lambda page: page.locator("[aria-label='Your profile'], [aria-label*='Account']").count(),
    },
    "offerup": {
        "url": "https://offerup.com/login",
        "cookie_file": "_cour/_vault/cookies/offerup.json",
        "domains": [".offerup.com", "offerup.com", "www.offerup.com"],
        "logged_in_check": lambda page: page.locator("[data-testid='account-menu'], a[href*='/account']").count(),
    },
    "craigslist": {
        "url": "https://accounts.craigslist.org/login",
        "cookie_file": "_cour/_vault/cookies/craigslist.json",
        "domains": [".craigslist.org", "craigslist.org", "www.craigslist.org"],
        "logged_in_check": lambda page: page.locator("a[href*='logout'], #header_nav").count(),
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_capture_targets.py -q`
Expected: PASS.

- [ ] **Step 5: Runbook note (document — do NOT auto-run).** The user must, ONE TIME — (a) `pip install --user playwright camoufox browserforge requests python-dotenv && playwright install chromium`; (b) do the `allowlist.toml` edits per S1-2; (c) `python3 scripts/capture_cookies.py facebook|offerup|craigslist` (BURNER account for FB/OfferUp), re-running to re-seed when cookies expire (~30–90d).

- [ ] **Step 6: Commit**

```bash
git -C /home/jaime/src add scripts/capture_cookies.py tests/_kids/test_capture_targets.py
git -C /home/jaime/src commit -m "feat(capture_cookies): add facebook/offerup/craigslist seed targets (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-2 — Vault allowlist exception (MANUAL, runbook — not a code task)

`_cour/_vault/allowlist.toml` is policy-gated config; the loader rejects duplicate domains across cookie sites and `version != 1`, and deny beats allow. This is a **manual user edit** documented in the runbook — NOT auto-edited by an agent, NOT unit-tested (it gates real cookie reads).

- [ ] **Step 1 (runbook instruction):** Under `[cookies]` add:
```toml
facebook   = ["facebook.com", "m.facebook.com", "web.facebook.com"]
offerup    = ["offerup.com", "www.offerup.com"]
craigslist = ["craigslist.org", "www.craigslist.org"]
```
- [ ] **Step 2:** In `[deny].domains`, **remove the `"facebook.com"` line** (OfferUp/Craigslist are not in deny). Keep `version = 1`. Ensure no domain duplicates across cookie sites.
- [ ] **Step 3 (verify):** `cd /home/jaime/src && /usr/bin/python3 -c "from _util._browse.session import session_for; print('allowlist loads')"` → confirm it imports without a duplicate-domain / deny-rejection error. (Live `session_for("facebook.com")` will still need seeded cookies — that is the runbook seeding step, not this verify.)

> No agent repo-commit for the TOML (manual policy edit). If committed at all, the user does it deliberately.

---

## Task S1-3 — `_kids/listing_parse.py`: pure parse/map/key (port of v1 parse + condition + url)

Pure functions, no I/O. Ports `parse.mjs` (title→specs), `condition.mjs` (`mapCondition`), `url.mjs` (`cleanUrl`), and adds `build_listing_key`. Regexes copied verbatim from the v1 sources.

**Files:** Create `_kids/listing_parse.py`; Test `tests/_kids/test_listing_parse.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_listing_parse.py`:

```python
from _kids.listing_parse import (
    parse_title, map_condition, ALLOWED_CONDITIONS, clean_url, build_listing_key,
)


def test_parse_title_extracts_specs():
    out = parse_title("Lenovo Legion laptop RTX 4060 Ti 8GB GDDR6 video 32GB DDR5 RAM")
    assert out["type"] == "Laptop"
    assert out["gpu_model"] == "RTX 4060 Ti"
    assert out["vram"] == 8
    assert out["ram"] == 32


def test_parse_title_desktop_and_none():
    assert parse_title("Dell Optiplex tower desktop")["type"] == "Desktop"
    out = parse_title("Old computer for parts")
    assert out["gpu_model"] is None and out["vram"] is None and out["ram"] is None


def test_map_condition_write_legal():
    assert ALLOWED_CONDITIONS == ["New", "Refurbished", "Used"]
    assert map_condition("new") == "New"
    assert map_condition("Certified Refurbished") == "Refurbished"
    assert map_condition("Open box") == "Used"
    assert map_condition("Like New") == "Used"
    assert map_condition("For parts or not working") == "Used"
    assert map_condition("New with defects") == "New"
    assert map_condition("seller says works") is None
    assert map_condition("") is None
    assert map_condition(None) is None


def test_clean_url_strips_tracking_and_canonicalizes():
    assert clean_url("https://www.facebook.com/marketplace/item/123/?ref=share&utm_source=x&mibextid=abc") \
        == "https://www.facebook.com/marketplace/item/123/"
    assert clean_url("https://offerup.com/item/9?keep=1&utm_medium=x") == "https://offerup.com/item/9?keep=1"
    assert clean_url("not a url") == "not a url"


def test_build_listing_key():
    assert build_listing_key("FB Marketplace", stable_id="123") == "FB Marketplace:123"
    assert build_listing_key("Craigslist", listing_url="https://seattle.craigslist.org/x/d/abc/777.html?utm=1") \
        == "Craigslist:https://seattle.craigslist.org/x/d/abc/777.html"
    assert build_listing_key("OfferUp", stable_id="", listing_url="") == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_listing_parse.py -q`
Expected: `ModuleNotFoundError: No module named '_kids.listing_parse'`.

- [ ] **Step 3: Write minimal implementation** — `/home/jaime/src/_kids/listing_parse.py`:

```python
"""Pure parse/map/key helpers — Python port of v1's parse.mjs/condition.mjs/url.mjs.

No I/O. Mirrors the Node logic so candidate rows are write-legal against the same
Airtable Hardware schema (no typecast).
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

# title → specs (port of parse.mjs)
_GPU_RE = re.compile(r"\b(RTX|GTX|RX|Arc)\s?-?\s?(\d{3,4}\s?(?:Ti|XT|Super)?)\b", re.I)
_VRAM_RE = re.compile(r"(\d{1,2})\s?GB\s?(?:GDDR\d?|VRAM|video)", re.I)
_RAM_RE = re.compile(r"(\d{1,3})\s?GB\s?(?:DDR\d\s?)?RAM\b", re.I)
_LAPTOP_RE = re.compile(r"\b(laptop|notebook|thinkpad|macbook|ideapad|legion(?!\s*tower))\b", re.I)


def parse_title(title: str = "") -> dict:
    t = str(title or "")
    gpu = _GPU_RE.search(t)
    vram = _VRAM_RE.search(t)
    ram = _RAM_RE.search(t)
    return {
        "type": "Laptop" if _LAPTOP_RE.search(t) else "Desktop",
        "gpu_model": f"{gpu.group(1).upper()} {re.sub(r'\s+', ' ', gpu.group(2)).strip()}" if gpu else None,
        "vram": int(vram.group(1)) if vram else None,
        "ram": int(ram.group(1)) if ram else None,
    }


# condition map (port of condition.mjs)
ALLOWED_CONDITIONS = ["New", "Refurbished", "Used"]


def map_condition(raw):
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    if s == "new":
        return "New"
    if s == "refurbished":
        return "Refurbished"
    if s == "used":
        return "Used"
    if s.startswith("new"):           # "new other", "new with defects"
        return "New"
    if "refurb" in s:                 # seller/manufacturer/certified refurbished
        return "Refurbished"
    if any(k in s for k in ("open box", "like new", "pre-owned", "preowned",
                            "used", "parts", "not working", "for parts")):
        return "Used"
    return None                       # unknown → omit the field (no 422)


# url canonicalization (port + extension of url.mjs)
_STRIP_PREFIXES = ("utm_",)
_STRIP_EXACT = {"campid", "mkcid", "mkrid", "mkevt", "_trkparms", "_trksid",
                "ref", "referrer", "mibextid", "fbclid", "gclid", "hash"}


def clean_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        if not parts.scheme or not parts.netloc:
            return value
    except (ValueError, AttributeError):
        return value
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not (k.lower() in _STRIP_EXACT or any(k.lower().startswith(p) for p in _STRIP_PREFIXES))]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), ""))


# shared dedup key
def build_listing_key(source: str, *, stable_id: str = "", listing_url: str = "") -> str:
    """'{source}:{stable_id}' or '{source}:{canonical_url}' or '' if neither."""
    sid = str(stable_id or "").strip()
    if sid:
        return f"{source}:{sid}"
    url = clean_url(str(listing_url or "").strip())
    if url:
        return f"{source}:{url}"
    return ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_listing_parse.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add _kids/listing_parse.py tests/_kids/test_listing_parse.py
git -C /home/jaime/src commit -m "feat(_kids): pure listing_parse (specs/condition/url/listing_key) port of v1" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-4 — `_kids/airtable_py.py`: REST list keys + count-all-rows + batched create

Python equivalent of `airtable.mjs`: page existing `listing_key`s (dedup), count ALL rows (shared cap), and batched (10/req) create with the strict field allowlist, NO typecast, preserving `owned: False`. Token passed in by the caller — never hardcoded.

**Files:** Create `_kids/airtable_py.py`; Test `tests/_kids/test_airtable_py.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_airtable_py.py` (fake `requests`-like session; no live HTTP):

```python
import json
import pytest
from _kids.airtable_py import AirtableClient, CANDIDATE_FIELDS


class FakeResp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)
    def json(self):
        return self._body


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
    def get(self, url, headers=None, params=None, timeout=None):
        self.calls.append(("GET", url, params, None))
        return self.responses.pop(0)
    def post(self, url, headers=None, data=None, timeout=None):
        self.calls.append(("POST", url, None, json.loads(data)))
        return self.responses.pop(0)


def client(http):
    return AirtableClient(token="t", base_id="appLnCrA0kRqr9Di2", table="Hardware", http=http)


def test_candidate_fields_match_schema_contract():
    assert CANDIDATE_FIELDS == [
        "name", "type", "condition", "owned", "source", "status", "found_date",
        "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
    ]
    assert "title" not in CANDIDATE_FIELDS and "price" not in CANDIDATE_FIELDS  # z is the price field


def test_list_existing_keys_pages():
    http = FakeHttp([
        FakeResp(200, {"records": [{"fields": {"listing_key": "eBay:1"}}], "offset": "o1"}),
        FakeResp(200, {"records": [{"fields": {"listing_key": "Craigslist:x"}}, {"fields": {}}]}),
    ])
    keys = client(http).list_existing_keys()
    assert keys == {"eBay:1", "Craigslist:x"}
    assert http.calls[0][2]["fields[]"] == "listing_key"


def test_count_counts_all_rows_even_without_listing_key():
    http = FakeHttp([
        FakeResp(200, {"records": [{"id": "1"}, {"id": "2"}], "offset": "o1"}),
        FakeResp(200, {"records": [{"id": "3"}]}),
    ])
    assert client(http).count() == 3


def test_create_strips_nonallowlisted_keeps_owned_false_no_typecast():
    http = FakeHttp([FakeResp(200, {"records": [{"id": "rec1"}]})])
    n = client(http).create([{
        "name": "X", "source": "FB Marketplace", "listing_key": "FB Marketplace:9",
        "owned": False, "condition": None, "z": 500, "evil": "DROP", "title": "X", "price": 500, "vram": None,
    }])
    assert n == 1
    _, _, _, sent = http.calls[0]
    assert "typecast" not in sent
    fields = sent["records"][0]["fields"]
    assert fields["owned"] is False        # falsy-but-legal preserved
    assert fields["source"] == "FB Marketplace"
    assert fields["z"] == 500
    assert "condition" not in fields       # None omitted (no 422)
    assert "vram" not in fields            # None omitted
    assert "evil" not in fields and "title" not in fields and "price" not in fields  # not allow-listed


def test_create_batches_in_tens():
    http = FakeHttp([FakeResp(200, {"records": []}), FakeResp(200, {"records": []})])
    rows = [{"name": f"r{i}", "source": "OfferUp", "listing_key": f"OfferUp:{i}", "owned": False} for i in range(15)]
    client(http).create(rows)
    assert len(http.calls) == 2
    assert len(http.calls[0][3]["records"]) == 10
    assert len(http.calls[1][3]["records"]) == 5


def test_create_raises_loud_on_non_ok():
    http = FakeHttp([FakeResp(422, {"error": "INVALID_VALUE_FOR_COLUMN"})])
    with pytest.raises(RuntimeError, match="Airtable create 422"):
        client(http).create([{"name": "x", "source": "Retailer", "listing_key": "Retailer:1", "owned": False}])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_airtable_py.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation** — `/home/jaime/src/_kids/airtable_py.py`:

```python
"""Airtable REST client (Python port of airtable.mjs).

Strict field allowlist; NEVER sends typecast; preserves owned=False; omits
None/empty values so singleSelect/number fields don't 422. Batches 10/req.
count() pages ALL rows (shared cap includes legacy curated rows without listing_key).
Token from env (AIRTABLE_CI_TOKEN) — passed in by the caller, never hardcoded.
"""
from __future__ import annotations

import json
from urllib.parse import quote

# Mirrors the Node CANDIDATE_FIELDS + listing_key. Price lives in `z`; there is
# NO `title`/`price` schema field on Hardware.
CANDIDATE_FIELDS = [
    "name", "type", "condition", "owned", "source", "status", "found_date",
    "distance_mi", "listing_url", "listing_key", "ebay_item_id",
    "gpu_model", "vram", "ram", "z",
]

_API = "https://api.airtable.com/v0"


def _pick(row: dict) -> dict:
    """Allow-listed keys whose value is present. Keep falsy-but-legal owned=False;
    drop None/empty-string (Airtable 422s null on singleSelect/number without typecast)."""
    out = {}
    for k in CANDIDATE_FIELDS:
        if k not in row:
            continue
        v = row[k]
        if v is None:
            continue
        if isinstance(v, str) and v == "":
            continue
        out[k] = v
    return out


class AirtableClient:
    def __init__(self, token: str, base_id: str, table: str = "Hardware", http=None, timeout: int = 30):
        if http is None:
            import requests
            http = requests.Session()
        self._http = http
        self._timeout = timeout
        self._base = f"{_API}/{base_id}/{quote(table)}"
        self._headers = {"Authorization": f"Bearer {token}"}

    def list_existing_keys(self) -> set[str]:
        keys: set[str] = set()
        offset = None
        while True:
            params = {"pageSize": "100", "fields[]": "listing_key"}
            if offset:
                params["offset"] = offset
            res = self._http.get(self._base, headers=self._headers, params=params, timeout=self._timeout)
            if res.status_code != 200:
                raise RuntimeError(f"Airtable list {res.status_code}: {res.text}")
            data = res.json()
            for rec in data.get("records", []):
                k = (rec.get("fields") or {}).get("listing_key")
                if k:
                    keys.add(str(k))
            offset = data.get("offset")
            if not offset:
                return keys

    def count(self) -> int:
        """Total Hardware rows (no field filter → every record counts toward the cap)."""
        total = 0
        offset = None
        while True:
            params = {"pageSize": "100"}
            if offset:
                params["offset"] = offset
            res = self._http.get(self._base, headers=self._headers, params=params, timeout=self._timeout)
            if res.status_code != 200:
                raise RuntimeError(f"Airtable count {res.status_code}: {res.text}")
            data = res.json()
            total += len(data.get("records", []))
            offset = data.get("offset")
            if not offset:
                return total

    def create(self, rows: list[dict]) -> int:
        created = 0
        post_headers = {**self._headers, "Content-Type": "application/json"}
        for i in range(0, len(rows), 10):
            chunk = [{"fields": _pick(r)} for r in rows[i:i + 10]]
            body = json.dumps({"records": chunk})  # NO typecast
            res = self._http.post(self._base, headers=post_headers, data=body, timeout=self._timeout)
            if res.status_code != 200:
                raise RuntimeError(f"Airtable create {res.status_code}: {res.text}")
            created += len(res.json().get("records", []))
        return created
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_airtable_py.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add _kids/airtable_py.py tests/_kids/test_airtable_py.py
git -C /home/jaime/src commit -m "feat(_kids): airtable_py REST client (allowlist, no typecast, owned=False, listing_key, count-all)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-5 — `_kids/filter_py.py`: apply_window (null distance kept) + dedup + cap

Python port of the generalized S0 filter: `price ∈ window AND (distance null OR ≤ radius)`; dedup on `listing_key`; cap at insert. The candidate row carries price in `z` (not `price`), so `apply_window` reads `z`.

**Files:** Create `_kids/filter_py.py`; Test `tests/_kids/test_filter_py.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_filter_py.py`:

```python
from _kids.filter_py import apply_window, dedup, cap_inserts


def mk(key, price, dist):
    return {"listing_key": key, "z": price, "distance_mi": dist}


def test_apply_window_keeps_null_distance_enforces_price():
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    items = [mk("a", 500, None), mk("b", 150, None), mk("c", 500, 150), mk("d", 800, 40)]
    assert [i["listing_key"] for i in apply_window(items, win)] == ["a", "d"]


def test_dedup_on_listing_key_across_sources_and_within_batch():
    out = dedup([mk("FB Marketplace:1", 1, 1), mk("eBay:2", 1, 1), mk("FB Marketplace:1", 1, 1)], {"eBay:2"})
    assert [i["listing_key"] for i in out] == ["FB Marketplace:1"]


def test_dedup_drops_rows_with_empty_key():
    assert dedup([{"listing_key": "", "z": 1, "distance_mi": 1}], set()) == []


def test_cap_inserts():
    r = cap_inserts([mk("a", 1, 1), mk("b", 1, 1), mk("c", 1, 1)], current_count=148, max_candidates=150)
    assert len(r["to_insert"]) == 2 and r["cap_reached"] is True
    r2 = cap_inserts([mk("a", 1, 1)], current_count=0, max_candidates=150)
    assert len(r2["to_insert"]) == 1 and r2["cap_reached"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_filter_py.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation** — `/home/jaime/src/_kids/filter_py.py`:

```python
"""Filter/dedup/cap — Python port of the generalized S0 filter.mjs.

Candidate rows carry price in `z` (the Hardware currency field), so apply_window
reads `z`. Distance None = ships nationally / unknown → kept.
"""
from __future__ import annotations


def apply_window(items: list[dict], win: dict) -> list[dict]:
    out = []
    for i in items:
        price = i.get("z")
        if not isinstance(price, (int, float)) or isinstance(price, bool):
            continue
        if price < win["price_min"] or price > win["price_max"]:
            continue
        dist = i.get("distance_mi")
        # None distance = ships nationally / unknown → keep; numeric must be within radius
        if dist is None or (isinstance(dist, (int, float)) and not isinstance(dist, bool) and dist <= win["radius_mi"]):
            out.append(i)
    return out


def dedup(items: list[dict], existing_keys) -> list[dict]:
    seen = set(existing_keys)
    out = []
    for i in items:
        key = str(i.get("listing_key") or "")
        if key and key not in seen:
            seen.add(key)
            out.append(i)
    return out


def cap_inserts(items: list[dict], *, current_count: int, max_candidates: int) -> dict:
    room = max(0, max_candidates - current_count)
    return {"to_insert": items[:room], "cap_reached": len(items) > room}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_filter_py.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add _kids/filter_py.py tests/_kids/test_filter_py.py
git -C /home/jaime/src commit -m "feat(_kids): filter_py apply_window (null distance kept)/dedup/cap" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-6 — Marketplace playbooks: FB / OfferUp / Craigslist YAML variants

YAML playbooks for the substrate's `_pattern/_sites` factory (same schema as the existing `brave_search_v1.yaml`). FB/OfferUp use Camoufox + cookies (logged-in); Craigslist is no-login but residential-IP + stealth. We assert the YAML shape in a test (parseable, has required keys + `headless: true` + camoufox) — selector content is iterated live later. Retailers beyond Best Buy (Newegg, Back Market, Amazon Renewed, Woot, Micro Center) are incremental best-effort follow-ons, added after Best Buy proves out (per the spec).

**Files:** Create `_pattern/_sites/variants/{facebook_marketplace,offerup,craigslist}_search_v1.yaml`; Test `tests/_kids/test_playbooks.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_playbooks.py`:

```python
from pathlib import Path
import yaml

VARIANTS = Path(__file__).resolve().parents[2] / "_pattern" / "_sites" / "variants"
PLAYBOOKS = {
    "facebook_marketplace_search_v1.yaml": {"camoufox": True},
    "offerup_search_v1.yaml": {"camoufox": True},
    "craigslist_search_v1.yaml": {"camoufox": True},
}


def test_playbooks_parse_and_have_required_shape():
    for name, expect in PLAYBOOKS.items():
        doc = yaml.safe_load((VARIANTS / name).read_text())
        assert doc["site"] and doc["goal"] == "marketplace_search" and doc["variant_id"]
        assert doc["headless"] is True
        kinds = [s["kind"] for s in doc["steps"]]
        assert "goto" in kinds
        assert doc["extraction"]["result_selectors"]
        assert isinstance(doc["extraction"]["completion_timeout_s"], int)
        assert doc["fitness"]["required_gate_policy"] == "soft"  # fail-soft per source
        if expect["camoufox"]:
            assert doc["browser"]["engine"] == "camoufox"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_playbooks.py -q`
Expected: `FileNotFoundError`.

- [ ] **Step 3: Write minimal implementation** — create the three YAML files.

`/home/jaime/src/_pattern/_sites/variants/facebook_marketplace_search_v1.yaml`:
```yaml
site: facebook.com
goal: marketplace_search
variant_id: facebook.marketplace.search.v1
status: experimental
browser:
  engine: camoufox      # ToS-gray => stealth + burner account + residential IP
  channel: chrome
headless: true
inputs:
  files: []
instruction_template: |
  Search Facebook Marketplace for: {query} (zip {zip}, ${price_min}-${price_max})
steps:
  - id: navigate
    kind: goto
    url: "https://www.facebook.com/marketplace/{zip}/search/?query={query}&minPrice={price_min}&maxPrice={price_max}&sortBy=creation_time_descend"
  - id: settle
    kind: wait
    timeout_s: 6
  - id: scroll
    kind: keyboard
    key: End
extraction:
  primary: extract_results_text
  result_selectors:
    - "a[href*='/marketplace/item/']"
    - "[aria-label='Collection of Marketplace items']"
  completion_timeout_s: 20
  report_name_template: "{directive}_facebook_marketplace.md"
evidence:
  save_failure_screenshots: true
fitness:
  goal: marketplace_search
  required_gate_policy: soft
variant_notes:
  - Requires seeded burner-account cookies (capture_cookies.py facebook).
  - login_wall error_kind => re-seed cookies. Never republish scraped content.
```

`/home/jaime/src/_pattern/_sites/variants/offerup_search_v1.yaml`:
```yaml
site: offerup.com
goal: marketplace_search
variant_id: offerup.marketplace.search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  files: []
instruction_template: |
  Search OfferUp for: {query} near {zip} (${price_min}-${price_max})
steps:
  - id: navigate
    kind: goto
    url: "https://offerup.com/search/?q={query}&price_min={price_min}&price_max={price_max}&zip={zip}&radius={radius_mi}"
  - id: settle
    kind: wait
    timeout_s: 6
  - id: scroll
    kind: keyboard
    key: End
extraction:
  primary: extract_results_text
  result_selectors:
    - "a[href*='/item/detail/']"
    - "[data-testid='SearchResults']"
  completion_timeout_s: 20
  report_name_template: "{directive}_offerup.md"
evidence:
  save_failure_screenshots: true
fitness:
  goal: marketplace_search
  required_gate_policy: soft
variant_notes:
  - Requires seeded burner-account cookies (capture_cookies.py offerup).
```

`/home/jaime/src/_pattern/_sites/variants/craigslist_search_v1.yaml`:
```yaml
site: craigslist.org
goal: marketplace_search
variant_id: craigslist.marketplace.search.v1
status: experimental
browser:
  engine: camoufox       # no login needed, but residential IP + stealth dodges CL anti-bot
  channel: chrome
headless: true
inputs:
  files: []
instruction_template: |
  Search Craigslist (seattle) for: {query} (${price_min}-${price_max}, zip {zip}, {radius_mi}mi)
steps:
  - id: navigate
    kind: goto
    url: "https://seattle.craigslist.org/search/sss?query={query}&min_price={price_min}&max_price={price_max}&postal={zip}&search_distance={radius_mi}&sort=date"
  - id: settle
    kind: wait
    timeout_s: 5
extraction:
  primary: extract_results_text
  result_selectors:
    - "li.cl-static-search-result"
    - "a.cl-app-anchor"
    - ".result-row"
  completion_timeout_s: 20
  report_name_template: "{directive}_craigslist.md"
evidence:
  save_failure_screenshots: true
fitness:
  goal: marketplace_search
  required_gate_policy: soft
variant_notes:
  - CL litigates scrapers => residential IP, polite rate-limit/jitter, never republish content.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_playbooks.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add _pattern/_sites/variants/facebook_marketplace_search_v1.yaml _pattern/_sites/variants/offerup_search_v1.yaml _pattern/_sites/variants/craigslist_search_v1.yaml tests/_kids/test_playbooks.py
git -C /home/jaime/src commit -m "feat(_sites): FB/OfferUp/Craigslist marketplace search playbooks (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-7 — `_kids/sources.py`: per-source card → write-legal candidate adapters (+ Best Buy retailer playbook)

Pure adapters: take a source's extracted raw card dicts (from `execute(...).data`) and map each to a write-legal candidate row matching the v1 shape (no typecast: `owned=False`, condition mapped or omitted, `type ∈ {Laptop,Desktop}`, price→`z`, NO `title`/`price`, `listing_key` set). Cards with no stable identity (no id and no url) are dropped. `SOURCES` registry holds `(site, intent, source_label, adapter, backend)`. Best Buy open-box is the first `Retailer` (`distance_mi=None` → ships). Add its playbook too. Adapters are pure → fully unit-tested against fixtures.

**Files:** Create `_kids/sources.py`, `_pattern/_sites/variants/bestbuy_openbox_search_v1.yaml`, `tests/_kids/fixtures/{fb_cards.json,craigslist_cards.json}`; Test `tests/_kids/test_sources.py`.

- [ ] **Step 1: Write the fixtures + failing test.**

`/home/jaime/src/tests/_kids/fixtures/fb_cards.json`:
```json
[
  {"id": "100200300", "title": "Dell OptiPlex Desktop RTX 3060 12GB VRAM 32GB RAM", "price": "500", "url": "https://www.facebook.com/marketplace/item/100200300/?ref=share", "condition": "Used", "location": "Redmond, WA", "distance_mi": "12"},
  {"id": "", "title": "PC parts lot", "price": "", "url": "", "condition": "", "location": ""}
]
```

`/home/jaime/src/tests/_kids/fixtures/craigslist_cards.json`:
```json
[
  {"id": "7700001", "title": "Lenovo ThinkPad laptop 16GB RAM", "price": "$350", "url": "https://seattle.craigslist.org/est/sys/d/redmond/7700001.html?utm=1", "condition": "", "distance_mi": null}
]
```

`/home/jaime/src/tests/_kids/test_sources.py`:
```python
import json
from pathlib import Path
from _kids.sources import SOURCES, to_candidates

FIX = Path(__file__).resolve().parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_registry_has_all_phase2_sources():
    labels = {s["source_label"] for s in SOURCES}
    assert {"FB Marketplace", "OfferUp", "Craigslist", "Retailer"} <= labels
    for s in SOURCES:
        assert s["site"] and s["intent"] and callable(s["adapter"]) and s["backend"]


def test_fb_cards_to_candidates_are_write_legal():
    rows = to_candidates("FB Marketplace", load("fb_cards.json"))
    assert len(rows) == 1  # second card has no id/url → dropped
    r = rows[0]
    assert r["source"] == "FB Marketplace"
    assert r["status"] == "candidate"
    assert r["owned"] is False
    assert r["type"] == "Desktop"
    assert r["condition"] == "Used"
    assert r["z"] == 500
    assert r["distance_mi"] == 12
    assert r["listing_key"] == "FB Marketplace:100200300"
    assert r["listing_url"] == "https://www.facebook.com/marketplace/item/100200300/"
    assert r["vram"] == 12 and r["ram"] == 32
    assert "title" not in r and "price" not in r and "location" not in r


def test_craigslist_card_uses_id_key_and_null_distance():
    r = to_candidates("Craigslist", load("craigslist_cards.json"))[0]
    assert r["source"] == "Craigslist"
    assert r["type"] == "Laptop"
    assert r["z"] == 350
    assert r["distance_mi"] is None
    assert r["listing_key"] == "Craigslist:7700001"
    assert "condition" not in r  # blank condition omitted


def test_retailer_adapter_emits_null_distance_and_retailer_source():
    cards = [{"id": "sku-abc", "title": "HP Desktop 16GB RAM", "price": "399.99",
              "url": "https://www.bestbuy.com/site/x/sku-abc.p", "condition": "Open box"}]
    r = to_candidates("Retailer", cards)[0]
    assert r["source"] == "Retailer"
    assert r["distance_mi"] is None
    assert r["condition"] == "Used"
    assert r["listing_key"] == "Retailer:sku-abc"
    assert r["z"] == 399.99
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_sources.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation.**

`/home/jaime/src/_kids/sources.py`:
```python
"""Per-source raw-card → write-legal candidate adapters.

A 'card' is one extracted listing dict from a playbook's execute(...).data.
Adapters are pure (no network): map → parse → build a candidate row matching the
v1 Airtable Hardware shape (no typecast: owned=False, condition mapped or omitted,
type Laptop/Desktop, price→z, NO title/price, listing_key set). Cards without a
usable listing_key (no id and no url) are dropped.
"""
from __future__ import annotations

import re
from _kids.listing_parse import parse_title, map_condition, clean_url, build_listing_key

_NUM_RE = re.compile(r"(\d[\d,]*\.?\d*)")


def _to_price(raw):
    if raw is None:
        return None
    m = _NUM_RE.search(str(raw).replace(",", ""))
    if not m:
        return None
    try:
        v = float(m.group(1))
    except ValueError:
        return None
    return int(v) if v.is_integer() else v


def _to_distance(raw):
    if raw is None or raw == "":
        return None
    m = _NUM_RE.search(str(raw))
    return float(m.group(1)) if m else None


def _base_card_to_row(source: str, card: dict, *, force_null_distance: bool):
    listing_key = build_listing_key(source, stable_id=str(card.get("id") or ""),
                                    listing_url=str(card.get("url") or ""))
    if not listing_key:
        return None  # no stable identity → cannot dedup, not a usable deal
    title = str(card.get("title") or "")
    specs = parse_title(title)
    row = {
        "name": (title[:120] or listing_key),
        "type": specs["type"],
        "owned": False,
        "source": source,
        "status": "candidate",
        "z": _to_price(card.get("price")),
        "distance_mi": None if force_null_distance else _to_distance(card.get("distance_mi")),
        "listing_url": clean_url(str(card.get("url") or "")),
        "listing_key": listing_key,
    }
    cond = map_condition(card.get("condition"))
    if cond is not None:
        row["condition"] = cond
    if specs["gpu_model"] is not None:
        row["gpu_model"] = specs["gpu_model"]
    if specs["vram"] is not None:
        row["vram"] = specs["vram"]
    if specs["ram"] is not None:
        row["ram"] = specs["ram"]
    return row


def _marketplace_adapter(source):
    def adapt(cards):
        rows = [_base_card_to_row(source, c, force_null_distance=False) for c in (cards or [])]
        return [r for r in rows if r is not None]
    return adapt


def _retailer_adapter(source):
    def adapt(cards):
        rows = [_base_card_to_row(source, c, force_null_distance=True) for c in (cards or [])]
        return [r for r in rows if r is not None]
    return adapt


# Registry: substrate site id, factory intent, Airtable source label, adapter, backend.
SOURCES = [
    {"site": "facebook.com",   "intent": "marketplace_search", "source_label": "FB Marketplace", "adapter": _marketplace_adapter("FB Marketplace"), "backend": "camoufox"},
    {"site": "offerup.com",    "intent": "marketplace_search", "source_label": "OfferUp",        "adapter": _marketplace_adapter("OfferUp"),        "backend": "camoufox"},
    {"site": "craigslist.org", "intent": "marketplace_search", "source_label": "Craigslist",     "adapter": _marketplace_adapter("Craigslist"),     "backend": "camoufox"},
    {"site": "bestbuy.com",    "intent": "marketplace_search", "source_label": "Retailer",       "adapter": _retailer_adapter("Retailer"),          "backend": "camoufox"},
]

_ADAPTERS = {s["source_label"]: s["adapter"] for s in SOURCES}


def to_candidates(source_label: str, cards: list[dict]) -> list[dict]:
    return _ADAPTERS[source_label](cards)
```

`/home/jaime/src/_pattern/_sites/variants/bestbuy_openbox_search_v1.yaml`:
```yaml
site: bestbuy.com
goal: marketplace_search
variant_id: bestbuy.openbox.search.v1
status: experimental
browser:
  engine: camoufox       # retailer anti-bot => stealth; best-effort
  channel: chrome
headless: true
inputs:
  files: []
instruction_template: |
  Browse Best Buy open-box computers ${price_min}-${price_max}
steps:
  - id: navigate
    kind: goto
    url: "https://www.bestbuy.com/site/searchpage.jsp?st=open+box+desktop+computer&sp=-currentprice+skuidsaas"
  - id: settle
    kind: wait
    timeout_s: 6
extraction:
  primary: extract_results_text
  result_selectors:
    - ".sku-item"
    - "a.image-link[href*='/site/']"
    - ".priceView-customer-price"
  completion_timeout_s: 20
  report_name_template: "{directive}_bestbuy_openbox.md"
evidence:
  save_failure_screenshots: true
fitness:
  goal: marketplace_search
  required_gate_policy: soft
variant_notes:
  - Retailer => distance_mi null (ships). Best-effort, friendliest retailer first.
  - Newegg/Back Market/Amazon Renewed/Woot/Micro Center playbooks added/iterated after this proves out.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_sources.py tests/_kids/test_playbooks.py -q`
Expected: PASS (the new Best Buy playbook does not break `test_playbooks` — that test only checks the three marketplace files).

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add _kids/sources.py _pattern/_sites/variants/bestbuy_openbox_search_v1.yaml tests/_kids/fixtures/fb_cards.json tests/_kids/fixtures/craigslist_cards.json tests/_kids/test_sources.py
git -C /home/jaime/src commit -m "feat(_kids): per-source candidate adapters + Best Buy open-box playbook (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-8 — `scripts/marketplace_scraper.py`: orchestrator (fail-soft, shared cap, cookie re-seed)

Wire it together: read the Control window from Airtable → for each enabled source, open `session_for(site, backend="camoufox")`, run `execute(...)`, adapt cards → candidates, filter (price/distance), dedup vs existing `listing_key`s, insert up to the shared cap — fail-soft per source (a `login_wall`/`timeout`/block logs and skips; on `login_wall` logs `re-seed cookies for {site}`), with polite jitter between sources. The pure decision core (`process_source`, `plan_run`, `resolve_window`) is unit-tested; the network/session shell (`run`, `main`) is thin and verified live (one source at a time).

**Files:** Create `scripts/marketplace_scraper.py`; Test `tests/_kids/test_orchestrator.py`.

- [ ] **Step 1: Write the failing test** — `/home/jaime/src/tests/_kids/test_orchestrator.py`:

```python
import importlib.util
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "marketplace_scraper",
    Path(__file__).resolve().parents[2] / "scripts" / "marketplace_scraper.py",
)
ms = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ms)

WIN = {"price_min": 200, "price_max": 1000, "radius_mi": 100}


def test_process_source_success_adapts_and_filters():
    exec_result = {"success": True, "error_kind": None, "data": [
        {"id": "1", "title": "Desktop RTX 3060 16GB RAM", "price": "500", "url": "https://www.facebook.com/marketplace/item/1/", "condition": "Used", "distance_mi": "20"},
        {"id": "2", "title": "Cheapo", "price": "50", "url": "https://www.facebook.com/marketplace/item/2/", "condition": "Used", "distance_mi": "5"},
    ]}
    out = ms.process_source("FB Marketplace", exec_result, WIN, existing_keys=set())
    assert out["skipped"] is None and out["reseed"] is False
    assert [r["listing_key"] for r in out["candidates"]] == ["FB Marketplace:1"]  # $50 filtered out


def test_process_source_login_wall_is_failsoft_and_flags_reseed():
    out = ms.process_source("OfferUp", {"success": False, "error_kind": "login_wall", "data": None, "error": "wall"},
                            WIN, existing_keys=set())
    assert out["candidates"] == [] and out["skipped"] == "login_wall" and out["reseed"] is True


def test_process_source_timeout_is_failsoft_no_reseed():
    out = ms.process_source("Craigslist", {"success": False, "error_kind": "timeout", "data": None, "error": "t"},
                            WIN, existing_keys=set())
    assert out["candidates"] == [] and out["skipped"] == "timeout" and out["reseed"] is False


def test_plan_run_dedups_across_sources_and_caps():
    per_source = {
        "FB Marketplace": [{"listing_key": "FB Marketplace:1", "z": 500, "distance_mi": 10}],
        "Craigslist":     [{"listing_key": "Craigslist:9", "z": 300, "distance_mi": None},
                           {"listing_key": "FB Marketplace:1", "z": 400, "distance_mi": 10}],  # cross-source dup
    }
    plan = ms.plan_run(per_source, existing_keys=set(), current_count=149, max_candidates=150)
    assert len(plan["to_insert"]) == 1 and plan["cap_reached"] is True


def test_resolve_window_falls_back_to_defaults():
    w = ms.resolve_window({"price_min": 300})
    assert w == {"price_min": 300, "price_max": 1000, "zipcode": "98052", "radius_mi": 100}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_orchestrator.py -q`
Expected: `FileNotFoundError` / import error — module doesn't exist.

- [ ] **Step 3: Write minimal implementation** — `/home/jaime/src/scripts/marketplace_scraper.py`:

```python
#!/usr/bin/env python3
"""Local marketplace scrape agent (Phase 2, WSL best-effort).

Reads the Control search window from Airtable, then for each enabled source opens
a vault-backed stealth session, runs the site's search playbook via the ~/src
factory, adapts extracted cards into write-legal candidate rows, filters
(price/distance), dedups vs existing listing_keys, and inserts up to the shared
MAX_CANDIDATES cap. FAIL-SOFT per source: a login_wall/timeout/block logs and
skips that source; the others continue. Polite jitter between sources.

ToS posture: FB/Craigslist are ToS-gray => burner account, Camoufox stealth,
polite rate-limits/jitter, residential IP. NEVER republish scraped content.

ONE-TIME SETUP (manual, user):
  1. pip install --user playwright camoufox browserforge requests python-dotenv
     && playwright install chromium
  2. Edit _cour/_vault/allowlist.toml: add facebook/offerup/craigslist to
     [cookies]; remove "facebook.com" from [deny].domains.
  3. python3 scripts/capture_cookies.py facebook|offerup|craigslist
     (use the BURNER account for facebook/offerup). Re-run to re-seed (~30-90d).
Schedule via ~/command/systemd/marketplace-scrape.{service,timer} (see runbook).
AIRTABLE_CI_TOKEN comes from the systemd EnvironmentFile (NEVER committed).
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from _kids.airtable_py import AirtableClient
from _kids.filter_py import apply_window, dedup, cap_inserts
from _kids.sources import SOURCES, to_candidates

log = logging.getLogger("kids.marketplace_scraper")

DEFAULT_WINDOW = {"price_min": 200, "price_max": 1000, "zipcode": "98052", "radius_mi": 100}
_RESEED_KINDS = {"login_wall"}


def _num_or(v, d):
    try:
        n = float(v)
        return int(n) if n.is_integer() else n
    except (TypeError, ValueError):
        return d


def resolve_window(fields: dict) -> dict:
    f = fields or {}
    return {
        "price_min": _num_or(f.get("price_min"), DEFAULT_WINDOW["price_min"]),
        "price_max": _num_or(f.get("price_max"), DEFAULT_WINDOW["price_max"]),
        "zipcode": str(f.get("zipcode") or DEFAULT_WINDOW["zipcode"]),
        "radius_mi": _num_or(f.get("radius_mi"), DEFAULT_WINDOW["radius_mi"]),
    }


def process_source(source_label: str, exec_result: dict, win: dict, *, existing_keys: set) -> dict:
    """Pure: one source's execute(...) result → filtered candidates, fail-soft.

    Returns {candidates, skipped(None|error_kind), reseed(bool)}.
    """
    if not exec_result.get("success"):
        kind = exec_result.get("error_kind") or "error"
        return {"candidates": [], "skipped": kind, "reseed": kind in _RESEED_KINDS}
    cards = exec_result.get("data") or []
    rows = to_candidates(source_label, cards)
    windowed = apply_window(rows, win)
    fresh = dedup(windowed, existing_keys)  # source-local dedup vs Airtable
    return {"candidates": fresh, "skipped": None, "reseed": False}


def plan_run(per_source: dict, *, existing_keys: set, current_count: int, max_candidates: int) -> dict:
    """Pure: merge all sources' candidates, dedup globally (incl. cross-source), cap at insert."""
    merged = []
    for rows in per_source.values():
        merged.extend(rows)
    deduped = dedup(merged, existing_keys)
    capped = cap_inserts(deduped, current_count=current_count, max_candidates=max_candidates)
    return {"to_insert": capped["to_insert"], "cap_reached": capped["cap_reached"]}


# network/session shell (thin; verified live, not unit-tested)
async def _scrape_source(src: dict, win: dict) -> dict:
    from _util._browse.session import session_for
    from _pattern._sites import execute
    params = {
        "query": "computer",
        "zip": win["zipcode"],
        "price_min": win["price_min"],
        "price_max": win["price_max"],
        "radius_mi": win["radius_mi"],
    }
    async with session_for(src["site"], backend=src["backend"]) as session:
        return await execute(src["site"], src["intent"], params=params, handle=session.engine)


async def run(client: AirtableClient, control_fields: dict, *, max_candidates: int,
              enabled_sources=None) -> dict:
    win = resolve_window(control_fields)
    existing = client.list_existing_keys()
    current_count = client.count()  # ALL rows → shared cap includes legacy curated rows
    per_source: dict = {}
    failures: dict = {}
    for src in SOURCES:
        label = src["source_label"]
        if enabled_sources is not None and label not in enabled_sources:
            continue
        try:
            exec_result = await _scrape_source(src, win)
            out = process_source(label, exec_result, win, existing_keys=existing)
            if out["skipped"]:
                failures[label] = out["skipped"]
                log.warning("source %s skipped (%s)", label, out["skipped"])
                if out["reseed"]:
                    log.warning("re-seed cookies for %s", src["site"])
            else:
                per_source[label] = out["candidates"]
                for r in out["candidates"]:
                    existing.add(r["listing_key"])  # keep running dedup set fresh across sources
                log.info("source %s → %d candidate(s)", label, len(out["candidates"]))
        except Exception as exc:  # fail-soft: never abort the others
            failures[label] = "error"
            log.warning("source %s failed: %s", label, exc)
        await asyncio.sleep(random.uniform(3.0, 8.0))  # polite jitter between sources
    plan = plan_run(per_source, existing_keys=set(), current_count=current_count,
                    max_candidates=max_candidates)
    inserted = client.create(plan["to_insert"]) if plan["to_insert"] else 0
    if plan["cap_reached"]:
        log.warning("MAX_CANDIDATES cap reached — review candidates")
    return {"inserted": inserted, "cap_reached": plan["cap_reached"],
            "sources": list(per_source), "failures": failures}


def _read_control(token: str, base_id: str) -> dict:
    import requests
    url = f"https://api.airtable.com/v0/{base_id}/Control?maxRecords=1"
    res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Control read {res.status_code}: {res.text}")
    recs = res.json().get("records", [])
    return recs[0]["fields"] if recs else {"enabled": False}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ModuleNotFoundError:
        pass
    token = os.environ.get("AIRTABLE_CI_TOKEN")
    base_id = os.environ.get("AIRTABLE_BASE_ID", "appLnCrA0kRqr9Di2")
    if not token:
        log.error("AIRTABLE_CI_TOKEN not set (provide via systemd EnvironmentFile)")
        return 1
    control = _read_control(token, base_id)
    if not control.get("enabled"):
        log.info("Control.enabled is false — no-op")
        return 0
    client = AirtableClient(token=token, base_id=base_id, table=os.environ.get("AIRTABLE_TABLE", "Hardware"))
    result = asyncio.run(run(client, control, max_candidates=int(os.environ.get("MAX_CANDIDATES", "150"))))
    log.info("marketplace_scrape: %s", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the orchestrator tests, then the whole S1 suite**

Run:
```bash
cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_orchestrator.py -q && /usr/bin/python3 -m pytest tests/_kids -q
```
Expected: PASS (whole S1 suite green, zero live calls).

- [ ] **Step 5: Commit**

```bash
git -C /home/jaime/src add scripts/marketplace_scraper.py tests/_kids/test_orchestrator.py
git -C /home/jaime/src commit -m "feat(_kids): marketplace_scraper orchestrator (fail-soft per source, shared cap, cookie re-seed log)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-9 — systemd user units + runbook (schedule, best-effort, EnvironmentFile, enable-linger)

The schedule. systemd **user** units (mirroring `master-venue-guard.{service,timer}`). `loginctl enable-linger` so they survive logout; still WSL-best-effort. Secrets via `EnvironmentFile=` (NOT committed). No unit test (host config) — a smoke check validates the unit files parse.

**Files:** Create `~/command/systemd/marketplace-scrape.service`, `~/command/systemd/marketplace-scrape.timer`.

- [ ] **Step 1:** Create `/home/jaime/command/systemd/marketplace-scrape.service`:
```ini
[Unit]
Description=Kids-computer marketplace scrape (FB/OfferUp/Craigslist/retailers -> Airtable)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=%h/src
# Secrets (AIRTABLE_CI_TOKEN, optional AIRTABLE_BASE_ID/TABLE/MAX_CANDIDATES) live here — NOT committed:
EnvironmentFile=%h/command/env/marketplace-scrape.env
ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py
Nice=10
StandardOutput=journal
StandardError=journal
```

- [ ] **Step 2:** Create `/home/jaime/command/systemd/marketplace-scrape.timer`:
```ini
[Unit]
Description=Nightly kids-computer marketplace scrape (WSL best-effort)

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=20m
Persistent=true
Unit=marketplace-scrape.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3 (smoke verify, best-effort):**
```bash
systemd-analyze --user verify /home/jaime/command/systemd/marketplace-scrape.service /home/jaime/command/systemd/marketplace-scrape.timer 2>&1 | head || \
  grep -q "ExecStart=/usr/bin/python3" /home/jaime/command/systemd/marketplace-scrape.service && echo "unit OK"
```
Expected: no fatal parse errors (a warning about a missing `EnvironmentFile` is fine until the user creates it).

- [ ] **Step 4 (runbook — the user does these ONCE; document, do not auto-run):**
```bash
# 1. Secrets (NOT committed) in the EnvironmentFile:
mkdir -p ~/command/env && chmod 700 ~/command/env
printf 'AIRTABLE_CI_TOKEN=pat...\nAIRTABLE_BASE_ID=appLnCrA0kRqr9Di2\nMAX_CANDIDATES=150\n' > ~/command/env/marketplace-scrape.env
chmod 600 ~/command/env/marketplace-scrape.env

# 2. Link units into the user systemd dir, enable, survive logout:
mkdir -p ~/.config/systemd/user
ln -sf ~/command/systemd/marketplace-scrape.service ~/.config/systemd/user/
ln -sf ~/command/systemd/marketplace-scrape.timer   ~/.config/systemd/user/
loginctl enable-linger "$(whoami)"          # timers fire while WSL is running (best-effort)
systemctl --user daemon-reload
systemctl --user enable --now marketplace-scrape.timer
systemctl --user list-timers | grep marketplace   # confirm scheduled

# 3. First live verification — ONE source at a time, manually, to confirm cookies/playbooks:
cd ~/src && AIRTABLE_CI_TOKEN=pat... /usr/bin/python3 scripts/marketplace_scraper.py   # tail journal / stdout
```

- [ ] **Step 5: Commit reference copies** — `~/command` is host config (likely not the `~/src` repo). Commit reference copies into `~/src/_kids/systemd/` so the units are version-controlled with the agent:
```bash
mkdir -p /home/jaime/src/_kids/systemd
cp /home/jaime/command/systemd/marketplace-scrape.service /home/jaime/command/systemd/marketplace-scrape.timer /home/jaime/src/_kids/systemd/
git -C /home/jaime/src add _kids/systemd/marketplace-scrape.service _kids/systemd/marketplace-scrape.timer
git -C /home/jaime/src commit -m "chore(_kids): reference systemd user units for nightly marketplace scrape (WSL best-effort)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-10 — Final verification gate (both sub-projects)

- [ ] **Step 1: S0 verification** — `cd /home/jaime/kids/computers && pnpm test -- --run && pnpm build` → all vitest suites pass (v1 + new S0 cases), Next build clean.
- [ ] **Step 2: S1 verification** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q` → all green, zero live calls.
- [ ] **Step 3: Airtable schema verify** — run the schema verification command from "Airtable Schema Operations"; confirm `listing_key` is `singleLineText` and `source` choices include `Retailer`.
- [ ] **Step 4: Secret scan** — `git -C /home/jaime/kids/computers log -p -1 | grep -iE "AIRTABLE_CI_TOKEN=|Bearer [A-Za-z0-9]" || echo clean` and the same for `~/src`; confirm no real tokens were committed (only `pat...` placeholders) and that `allowlist.toml`/`EnvironmentFile` edits are manual/uncommitted.
- [ ] **Step 5: Live smoke (after manual cookie + env setup)** — `cd /home/jaime/src && /usr/bin/python3 scripts/marketplace_scraper.py` with `Control.enabled=true`; confirm candidates land in Airtable with `source ∈ {FB Marketplace, OfferUp, Craigslist, Retailer}`, `owned=false`, `condition` legal-or-omitted, `listing_key` set + deduped, `distance_mi` numeric for marketplace / null for retailers, and the run stops at `MAX_CANDIDATES`. Confirm a `login_wall` on one source logs `re-seed cookies for {site}` and the others still complete (fail-soft).
- [ ] **Step 6: Open PRs** — `gh pr create` on `feat/canvasser-phase2-s0` (`~/kids/computers`) and on `feat/marketplace-scraper-phase2` (`~/src`); final whole-branch review per `superpowers:finishing-a-development-branch`.

---

## Residual Risks

- **Schema-first ordering:** `listing_key` + `Retailer` MUST exist on the live base (Schema Operations / S0-5) before any writer sends them, or no-typecast writes 422. Verify before the live smoke run.
- **Substrate extraction shape unknown until first live `execute()`:** the adapters assume `execute(...).data` is a list of card dicts (id/title/price/url/condition/distance). The factory is text-oriented today; the adapter's card-key mapping in `_kids/sources.py` may need one revision after observing the first real payload per site. The pure adapter design isolates that change to one file.
- **Cookie expiry / login walls (FB/OfferUp):** the agent fails soft and logs `re-seed cookies for {site}`; re-seeding is manual (`capture_cookies.py`).
- **Retailer/CL anti-bot varies by IP/session:** the free local Camoufox + residential-IP path is pragmatic, not guaranteed; Best Buy first, the other five retailers are incremental best-effort follow-ons (not in this plan's task list).
- **WSL best-effort:** systemd user timers fire only while WSL is awake; eBay (API) remains the only always-on cloud path. `enable-linger` survives logout but not a stopped WSL.
- **Cross-stack count race:** both writers enforce the shared cap independently against `count()`-all-rows; a simultaneous cloud@3am + local-nightly run could briefly exceed 150 by a few rows (benign; well under the Airtable 1,000-record headroom).
- **Digest not generalized:** v1 digest formatting still keys on `ebay_item_id`; Phase 2 local candidates land in Hardware but the digest projection generalization is out of scope for this plan.
