I have the complete, concrete contract. I now have everything needed to author the full build-ready Phase 2 plan: the v1 plan format/footer, the REAL shipped v1 libs (with the actual `CANDIDATE_FIELDS` that excludes `title`/`price`), the design spec, the substrate integration points, and the verified `session_for` / `execute` signatures and return shapes. Let me write the deliverable.

The plan is my final response (markdown), per the brief. Here it is.

---

# Implementation Plan — Deal Canvasser Phase 2 (multi-source automation, cross-language TDD)

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. **Every task is a strict TDD loop:** write the failing test → run it and confirm the *stated* failure → write the **minimal REAL** implementation (no stubs, no `TODO`, no placeholders) → run and confirm green → commit. S0 runs entirely in the Node `kidscomputer` repo (`~/kids/computers`); S1 runs entirely in the Python `~/src` agent. The two repos commit independently.

**Goal:** Generalize the v1 eBay-only canvasser into a multi-source system landing in the SAME Airtable `Hardware` base. **S0 (small, do first):** make v1's dedup/filter/schema source-agnostic — a shared `listing_key` dedup key, a distance filter that keeps `null` (ships/unknown) rows, a `Retailer` source choice, and a cap that spans all sources. **S1 (the bulk):** a self-contained Python scrape agent under `~/src` that, when WSL is awake, logs into a burner FB/OfferUp account + scrapes Craigslist (residential IP) + retailers via the existing `_util/_browse` Camoufox cookie-vault substrate, parses listings, and writes write-legal candidate rows to the same Airtable via REST — fail-soft per source, ToS-aware, never republishing scraped content.

**Architecture:** Two runtimes, one Airtable, no shared process state.
1. **Cloud — GitHub Actions (Node ESM, always-on, free):** unchanged `scripts/canvass.mjs` keeps doing **eBay Browse API only** (the one reliable always-on path). S0 generalizes its shared data-layer modules in place.
2. **Local — WSL (Python 3.12, residential IP, best-effort):** ONE agent `~/src/scripts/marketplace_scraper.py` scrapes everything else (FB Marketplace, OfferUp, Craigslist + retailers). It does **not** import the Node libs; it re-implements the small pure parse/filter/map logic in Python and writes to Airtable via `requests`, honoring the SAME schema + `listing_key` + write-legality (no-typecast, `owned: false`) conventions as v1. It reuses the `~/src` substrate (`session_for`, `_pattern._sites.execute`, cookie vault).

```
┌ Cloud — GitHub Actions (Node, always-on, free) ┐   ┌ Local — WSL (Python, residential, best-effort) ┐
│ scripts/canvass.mjs → eBay Browse API           │   │ ~/src/scripts/marketplace_scraper.py            │
│ → Airtable Hardware (source=eBay)               │   │ session_for(site, backend="camoufox") +         │
└─────────────────────────────────────────────────┘   │ _pattern._sites.execute(...) per playbook       │
                                                        │ → parse → filter → dedup → Airtable REST insert │
        └─── same Hardware table · shared listing_key dedup · shared cap · status=candidate ────────────┘
```

**Tech Stack:**
- **S0:** Node ESM (`.mjs`), **vitest 2.1.8** (already installed), Airtable REST + Metadata API, pnpm. No new website runtime deps.
- **S1:** Python 3.12 (`/usr/bin/python3`, ambient `pip install --user` — no venv), **pytest 9.0.2** (already installed), `requests` (2.32.5, present), `playwright`/`camoufox`/`browserforge`/`python-dotenv` (user installs per runbook). Reuses `~/src` organs: `_util._browse.session.session_for`, `_pattern._sites.execute`, `_cour/_vault` cookie vault. systemd **user** timer for scheduling.

---

## Global Constraints (copy these exact values — do not paraphrase)

- **Airtable base:** `appLnCrA0kRqr9Di2`. **Hardware table:** `tblnJoBqI7G2FaBke` (primary field `name`; **price is the `z` currency field** — there is NO `price` or `title` schema field). **Control table:** `Control` (table id `tbljHjoeyh5jZGJLg`, singleton row `recamgm14LSayOXKd`).
- **Search-window defaults (used when Control fields are blank):** `price_min=200`, `price_max=1000`, `zipcode="98052"`, `radius_mi=100`.
- **Shared cap:** `MAX_CANDIDATES=150`, enforced at insert **by both writers** (low-volume; accept the benign race since cloud@3am and local-nightly rarely overlap).
- **`listing_key` (the NEW shared dedup key):** `"{source}:{stable_id}"` where `stable_id` is the source's listing id (eBay `legacyItemId`, CL posting id, FB item id, OfferUp id) or, if none, the **canonicalized** `listing_url`. v1's eBay path sets it to `"eBay:{ebay_item_id}"`. **Dedup keys on `listing_key` across all sources** (replaces eBay-only `ebay_item_id` dedup; `ebay_item_id` stays as a field). `airtable.listExistingKeys()` returns the `listing_key` set.
- **Distance filter rule (generalized):** keep a row iff `price ∈ [price_min, price_max]` **AND** `(distance_mi == null OR distance_mi <= radius_mi)`. `null` distance = "ships nationally / unknown" (retailers) — a valid in-budget deal, **kept** (v1 dropped it).
- **`source` singleSelect choices:** `eBay`, `Craigslist`, `FB Marketplace`, `OfferUp`, `Estate/Auction`, `Manual`, **and the NEW `Retailer`**. S1 writers emit exactly `FB Marketplace` / `OfferUp` / `Craigslist` / `Retailer`.
- **WRITE-LEGAL / NO-TYPECAST rows (both writers; Airtable 422s the whole batch otherwise):**
  - `owned` = checkbox → **boolean** `false` (never the string `"No"`).
  - `condition` = singleSelect, choices EXACTLY `{New, Refurbished, Used}` → map every raw condition through `mapCondition`/`map_condition`, returning one of the 3 or `None`/`null` (**omit** the field — never the raw string).
  - `type` = singleSelect → only `"Laptop"`/`"Desktop"` (existing choices).
  - `status` = `"candidate"`; `found_date` = Pacific date `YYYY-MM-DD`.
  - **Drop every `null`/`undefined`/empty field via the allowlist `pick`** before sending; send NO `typecast`.
- **Fail-soft per source (S1):** each source runs in its own try/except; a `login_wall` / `timeout` / block logs `re-seed cookies for {site}` (when `login_wall`) and **skips that source — never aborts the others**. Polite rate-limit + jitter between requests.
- **ToS posture (S1):** FB/Craigslist are ToS-gray → burner account, Camoufox stealth, polite rate-limits/jitter, residential IP. **Never republish scraped listing content publicly.** Only inserts (no deletes); dedup prevents dup rows; cap bounds growth.
- **WSL best-effort:** systemd user timer fires only while WSL is running; `loginctl enable-linger $(whoami)` so it survives logout. No always-on guarantee for scraped sources.
- **Secrets:** `AIRTABLE_CI_TOKEN` (read+write on the base) drives S1 via the systemd `EnvironmentFile=` (NOT committed). **Never commit secrets/.env to either repo (both are public-ish / shared).**
- **Branch first** in each repo:
  - S0 (`~/kids/computers`, on `main`): `git checkout -b feat/canvasser-phase2-s0`
  - S1 (`~/src`, on `_arch-_ops`): `git checkout -b feat/marketplace-scraper-phase2`
- **Commit footer — append to EVERY commit message body (second `-m` block, exactly):**
  ```
  Co-Authored-By: claude-flow <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk
  ```

---

## File Structure

### S0 — Node `kidscomputer` repo (`~/kids/computers`) — MODIFY in place

```
computers/
├── scripts/
│   ├── canvass.mjs                     # MODIFY: emit listing_key="eBay:{id}"; existing keys dedup
│   └── lib/
│       ├── filter.mjs                  # MODIFY: applyWindow keeps null distance; dedup on listing_key
│       └── airtable.mjs                # MODIFY: add listing_key to CANDIDATE_FIELDS; listExistingKeys()
├── tests/
│   ├── lib/filter.test.mjs             # MODIFY/ADD: null-distance kept; listing_key dedup
│   ├── lib/airtable.test.mjs           # MODIFY/ADD: listing_key in allowlist; listExistingKeys pages
│   └── canvass.test.mjs                # MODIFY: canvass sets listing_key + dedups on it
└── (Airtable schema, via MCP — out of the test loop)  # ADD `listing_key` field + `Retailer` source choice
```

### S1 — Python `~/src` agent (the bulk) — NEW

```
src/
├── scripts/
│   ├── capture_cookies.py              # MODIFY: add facebook/offerup/craigslist to TARGETS
│   └── marketplace_scraper.py          # NEW: orchestrator (read Control → per-source scrape → write)
├── _cour/_vault/allowlist.toml         # MODIFY (manual, runbook): +[cookies] fb/offerup/cl; -facebook from [deny]
├── _pattern/_sites/variants/
│   ├── facebook_marketplace_search_v1.yaml   # NEW playbook
│   ├── offerup_search_v1.yaml                # NEW playbook
│   ├── craigslist_search_v1.yaml             # NEW playbook
│   └── bestbuy_openbox_search_v1.yaml        # NEW playbook (friendliest retailer first)
├── _kids/                              # NEW package dir for the kids-computer agent libs
│   ├── __init__.py
│   ├── listing_parse.py                # NEW pure: title→specs, condition map, type, listing_key, clean_url
│   ├── airtable_py.py                  # NEW: REST list existing keys+count / batched create (allowlist, no typecast)
│   ├── filter_py.py                    # NEW pure: apply_window (null distance kept), dedup, cap_inserts
│   └── sources.py                      # NEW: per-source scrape→candidate adapters (FB/OfferUp/CL/Retailer)
├── tests/_kids/                        # NEW pytest suite (mocked HTTP / saved HTML fixtures — no live calls)
│   ├── __init__.py
│   ├── conftest.py
│   ├── fixtures/
│   │   ├── fb_cards.json               # saved extraction shape from a real FB search (sanitized)
│   │   └── craigslist_cards.json
│   ├── test_listing_parse.py
│   ├── test_airtable_py.py
│   ├── test_filter_py.py
│   └── test_sources.py
└── ~/command/systemd/                  # NEW (outside the repo; user units)
    ├── marketplace-scrape.service      # Type=oneshot ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py
    └── marketplace-scrape.timer        # nightly OnCalendar; Persistent=true
```

---

## Constraint → Task traceability

| Constraint | Where honored |
|---|---|
| Shared `listing_key` dedup | S0-2 (filter), S0-3 (airtable allowlist + `listExistingKeys`), S0-4 (canvass emits it); S1-3 (`listing_parse.build_listing_key`), S1-4 (`airtable_py`), S1-5 (`filter_py.dedup`) |
| Distance filter keeps null/ships | S0-1 (`applyWindow`); S1-5 (`apply_window`) |
| `Retailer` source choice | S0-5 (Airtable MCP); S1-7 (Best Buy adapter emits `source="Retailer"`) |
| Shared cap at insert | S0 (existing `capInserts` reused with `listing_key` count); S1-5 (`cap_inserts`), S1-8 (orchestrator) |
| Write-legal / no-typecast rows | S0-3 (allowlist unchanged shape); S1-3 (`map_condition`), S1-4 (`pick` + no typecast + `owned False`) |
| Fail-soft per source | S1-8 (orchestrator per-source try/except + `error_kind` handling) |
| ToS posture (burner/stealth/jitter/no-republish) | S1-1 (cookie seed runbook), S1-6/7 (Camoufox playbooks), S1-8 (jitter + log-only, no content republish) |
| WSL best-effort + linger + EnvironmentFile | S1-9 (systemd units + runbook) |
| Cookie re-seed on expiry | S1-8 (`login_wall` → log `re-seed cookies for {site}`) |

---

# Sub-project S0 — Shared data-layer generalizations (Node; do FIRST; small)

> Repo: `~/kids/computers`. Branch: `feat/canvasser-phase2-s0`. Runner: `pnpm test` (vitest, already wired). These edit the REAL shipped v1 modules. Run all commands from `/home/jaime/kids/computers`.

## Task S0-0 — Branch

- [ ] **Step 1:** `git -C /home/jaime/kids/computers checkout -b feat/canvasser-phase2-s0`
- [ ] **Step 2 (sanity baseline):** `cd /home/jaime/kids/computers && pnpm test` → confirm the existing 79 tests pass before changing anything.

---

## Task S0-1 — `applyWindow` keeps null/unknown distance (ships)

The v1 `applyWindow` (`scripts/lib/filter.mjs:1-10`) drops any row whose `distance_mi` is not a number. Retailers ship nationally → `distance_mi == null` is a valid in-budget deal. Change the rule to keep `null` distance, keep numeric `≤ radius`.

**Files:** Modify `scripts/lib/filter.mjs`; Modify `tests/lib/filter.test.mjs`.

- [ ] **Step 1: Add the failing test** — append to `tests/lib/filter.test.mjs` inside the `describe("applyWindow", …)` block:

```js
  it("keeps null distance (ships nationally / unknown) but still enforces price", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    const items = [
      { listing_key: "a", price: 500, distance_mi: null },   // ships → KEEP
      { listing_key: "b", price: 150, distance_mi: null },   // below price → drop
      { listing_key: "c", price: 500, distance_mi: 150 },    // too far → drop
      { listing_key: "d", price: 800, distance_mi: 40 },     // in window → KEEP
    ]
    expect(applyWindow(items, win).map((i) => i.listing_key)).toEqual(["a", "d"])
  })
```

- [ ] **Step 2: Run → confirm failure** — `pnpm test tests/lib/filter.test.mjs` → fails: item `"a"` is dropped (current code requires `typeof i.distance_mi === "number"`).

- [ ] **Step 3: Minimal REAL change** — replace the `applyWindow` body in `scripts/lib/filter.mjs`:

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

- [ ] **Step 4: Run → confirm green** — `pnpm test tests/lib/filter.test.mjs` (the existing eBay-shaped tests still pass; eBay rows always carry numeric distance).

- [ ] **Step 5: Commit**
```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat(canvass): applyWindow keeps null/ships distance (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-2 — `dedup` keys on `listing_key` (source-agnostic)

v1 `dedup` keys on `ebay_item_id`. Generalize to `listing_key` so all sources interoperate. Keep it tolerant: if a row lacks `listing_key`, fall back to `eBay:{ebay_item_id}` so the eBay path keeps working before S0-4 lands.

**Files:** Modify `scripts/lib/filter.mjs`; Modify `tests/lib/filter.test.mjs`.

- [ ] **Step 1: Add the failing test** — replace the existing `describe("dedup", …)` block with:

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
  it("dedups within the same batch (no duplicate listing_key inserted twice)", () => {
    const out = dedup([{ listing_key: "OfferUp:7" }, { listing_key: "OfferUp:7" }], new Set())
    expect(out).toHaveLength(1)
  })
  it("falls back to eBay:{ebay_item_id} when listing_key is absent", () => {
    const out = dedup([{ ebay_item_id: "5" }], new Set(["eBay:5"]))
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run → confirm failure** — `pnpm test tests/lib/filter.test.mjs` → fails (current `dedup` reads `item.ebay_item_id` only).

- [ ] **Step 3: Minimal REAL change** — replace the `dedup` function in `scripts/lib/filter.mjs`:

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

- [ ] **Step 4: Run → confirm green** — `pnpm test tests/lib/filter.test.mjs`.

- [ ] **Step 5: Commit**
```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat(canvass): dedup on shared listing_key with eBay fallback (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-3 — `airtable.mjs`: `listing_key` in the allowlist + `listExistingKeys()`

Add `listing_key` to `CANDIDATE_FIELDS` so writes carry it, and add a `listExistingKeys()` that pages the `listing_key` column for cross-source dedup (keeping `listExistingIds`/`count` for back-compat, but `count()` should reflect total rows via the key set).

**Files:** Modify `scripts/lib/airtable.mjs`; Modify `tests/lib/airtable.test.mjs`.

- [ ] **Step 1: Add the failing test** — append two cases to `tests/lib/airtable.test.mjs`:

```js
describe("airtable.listExistingKeys", () => {
  it("pages and returns the set of listing_key values", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ fields: { listing_key: "eBay:1" } }], offset: "o1" } },
      { body: { records: [{ fields: { listing_key: "Craigslist:x" } }] } },
    ])
    const keys = await at(fetch).listExistingKeys()
    expect([...keys].sort()).toEqual(["Craigslist:x", "eBay:1"])
  })
})

describe("airtable CANDIDATE_FIELDS", () => {
  it("includes listing_key for cross-source dedup", () => {
    expect(CANDIDATE_FIELDS).toContain("listing_key")
  })
})
```

- [ ] **Step 2: Run → confirm failure** — `pnpm test tests/lib/airtable.test.mjs` → fails: `listExistingKeys is not a function` and `listing_key` missing from `CANDIDATE_FIELDS`.

- [ ] **Step 3: Minimal REAL change** — in `scripts/lib/airtable.mjs`:
  - Add `"listing_key"` to the `CANDIDATE_FIELDS` array (append it).
  - Add this method inside `createAirtable` (mirror `listExistingIds`):

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
  - Update `count` to use the new key set: `async function count() { return (await listExistingKeys()).size }`
  - Export it: change the return to `return { listExistingIds, listExistingKeys, count, create }`.

- [ ] **Step 4: Run → confirm green** — `pnpm test tests/lib/airtable.test.mjs`.

- [ ] **Step 5: Commit**
```bash
git add scripts/lib/airtable.mjs tests/lib/airtable.test.mjs
git commit -m "feat(canvass): airtable listExistingKeys + listing_key in allowlist (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-4 — `canvass.mjs`: emit `listing_key` and dedup on it

Wire the generalizations into the orchestrator: build `listing_key = "eBay:{ebay_item_id}"`, dedup against `listExistingKeys()`, and write `listing_key` on each row.

**Files:** Modify `scripts/canvass.mjs`; Modify `tests/canvass.test.mjs`.

- [ ] **Step 1: Add/adjust the failing test** — in `tests/canvass.test.mjs`, ensure the mocked `airtable` exposes `listExistingKeys` and assert the written row carries `listing_key`. Add inside the existing happy-path test (adapt the mock shape already used there):

```js
  it("sets listing_key='eBay:{id}' and dedups on the existing key set", async () => {
    const created = []
    const result = await runCanvass({
      control: { read: async () => ({ enabled: true }), markRan: async () => {} },
      ebay: { search: async () => [
        { ebay_item_id: "111", title: "PC RTX 3060 16GB RAM", price: 500, url: "https://ebay.com/itm/111", distance_mi: 10, condition: "Used" },
        { ebay_item_id: "222", title: "PC", price: 500, url: "https://ebay.com/itm/222", distance_mi: 10, condition: "Used" },
      ] },
      airtable: {
        listExistingKeys: async () => new Set(["eBay:222"]),
        create: async (rows) => { created.push(...rows); return rows.length },
      },
      now: new Date("2026-07-01T10:00:00Z"),
      max: 150, pacificHourTarget: 3, enabledEnv: "true",
    })
    expect(result.inserted).toBe(1)
    expect(created[0].listing_key).toBe("eBay:111")
  })
```
> If the existing `runCanvass` happy-path test mocks `listExistingIds`, update that mock to `listExistingKeys` too (the orchestrator now calls the key-based method).

- [ ] **Step 2: Run → confirm failure** — `pnpm test tests/canvass.test.mjs` → fails (`runCanvass` still calls `airtable.listExistingIds()` and rows lack `listing_key`).

- [ ] **Step 3: Minimal REAL change** — in `scripts/canvass.mjs` `runCanvass`:
  - Change `const existing = await airtable.listExistingIds()` → `const existing = await airtable.listExistingKeys()`.
  - In the `rows = toInsert.map(...)` object, add `listing_key: \`eBay:${i.ebay_item_id}\`` and keep `ebay_item_id` as-is.
  - `capInserts` already counts via `existing.size`; with `listExistingKeys` that is now the total-row count — correct for the shared cap.

- [ ] **Step 4: Run → confirm green** — `pnpm test tests/canvass.test.mjs && pnpm test` (full suite green).

- [ ] **Step 5: Commit**
```bash
git add scripts/canvass.mjs tests/canvass.test.mjs
git commit -m "feat(canvass): write listing_key + dedup on shared key set (Phase 2 S0)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S0-5 — Airtable schema: add `listing_key` field + `Retailer` source choice (MCP, out of TDD loop)

Schema changes are a one-time live-base operation via the Airtable MCP (no unit test — it's not deterministic/local). Do it once, idempotently.

- [ ] **Step 1:** Add a `listing_key` field (singleLineText) to Hardware `tblnJoBqI7G2FaBke` in base `appLnCrA0kRqr9Di2` via the Airtable MCP `create_field` (skip if it already exists — re-running is a no-op since the field name collides).
- [ ] **Step 2:** Add a `Retailer` choice to the existing `source` singleSelect via the Airtable MCP `update_field` (append to the choices list; `FB Marketplace`/`OfferUp`/`Craigslist`/`eBay`/`Estate/Auction`/`Manual` already exist).
- [ ] **Step 3 (verify):** Read the Hardware schema back via MCP `get_table_schema`; confirm `listing_key` exists and `source` includes `Retailer`. (This unblocks both writers — without it, S1's `Retailer` rows and any `listing_key` write would 422 under no-typecast.)
- [ ] **Step 4 (data backfill, optional but recommended):** For the ~51 existing curated rows that have an `ebay_item_id` but no `listing_key`, set `listing_key = "eBay:{ebay_item_id}"` via MCP `update_records_for_table` so historical eBay rows dedup correctly. Rows without an id can be left blank (they won't collide).

> No commit (live-base change, not repo code). Record completion in the S0 task ledger.

---

# Sub-project S1 — Local scrape agent (Python, `~/src`; the bulk)

> Repo: `~/src`. Branch: `feat/marketplace-scraper-phase2`. Runner: `pytest`. Run pytest from the repo root so imports resolve: `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q`. The agent is self-contained under `_kids/` + `scripts/marketplace_scraper.py`; it imports `~/src` substrate organs directly. **All tests use mocked HTTP / saved fixtures — zero live network.**

## Task S1-0 — Branch + package skeleton

**Files:** Create `_kids/__init__.py`, `tests/_kids/__init__.py`, `tests/_kids/conftest.py`.

- [ ] **Step 1:** `git -C /home/jaime/src checkout -b feat/marketplace-scraper-phase2`
- [ ] **Step 2:** Create the empty package markers and a conftest that puts the repo root on `sys.path`:

`/home/jaime/src/_kids/__init__.py`:
```python
"""Kids-computer deal scrape agent (Phase 2, local WSL).

Self-contained: re-implements v1's pure parse/filter/map logic in Python and
writes to the same Airtable Hardware base via REST, honoring the SAME schema +
listing_key + write-legality (no typecast, owned=False) conventions as the Node v1.
Does NOT import the Node libs.
"""
```

`/home/jaime/src/tests/_kids/__init__.py`:
```python
```

`/home/jaime/src/tests/_kids/conftest.py`:
```python
import sys
from pathlib import Path

# Ensure `import _kids...` resolves when pytest is run from anywhere under ~/src.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
```

- [ ] **Step 3: Confirm pytest collects nothing yet (harness sanity)** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q` → `no tests ran` (exit 5 acceptable as the baseline; it proves collection works).

- [ ] **Step 4: Commit**
```bash
git -C /home/jaime/src add _kids/__init__.py tests/_kids/__init__.py tests/_kids/conftest.py
git -C /home/jaime/src commit -m "chore(_kids): Phase 2 scrape-agent package skeleton + pytest path shim" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-1 — Cookie-seed targets (runbook + `capture_cookies.py` TARGETS)

One-time manual seeding is a documented runbook step, but the `TARGETS` dict edit is real code we add now (the seeding *run* is manual/user, the code is testable by import).

**Files:** Modify `scripts/capture_cookies.py`; Test `tests/_kids/test_capture_targets.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_capture_targets.py`:
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

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_capture_targets.py -q` → `KeyError`/assertion (sites absent).

- [ ] **Step 3: Minimal REAL change** — add three entries to `TARGETS` in `scripts/capture_cookies.py` (after `chatgpt`):
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

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_capture_targets.py -q`.

- [ ] **Step 5: Document the manual runbook (in the orchestrator docstring later; note here):** The user must, ONE TIME — (a) `pip install --user playwright camoufox browserforge requests python-dotenv && playwright install chromium`; (b) edit `_cour/_vault/allowlist.toml` per S1-2; (c) `python3 scripts/capture_cookies.py facebook|offerup|craigslist` (burner account for FB/OfferUp), re-running to re-seed when cookies expire (~30–90d).

- [ ] **Step 6: Commit**
```bash
git -C /home/jaime/src add scripts/capture_cookies.py tests/_kids/test_capture_targets.py
git -C /home/jaime/src commit -m "feat(capture_cookies): add facebook/offerup/craigslist seed targets (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-2 — Vault allowlist exception (MANUAL, runbook — not a code task)

`_cour/_vault/allowlist.toml` is policy-gated config; loaded with strict validation (no duplicate domains, `version=1`, deny-beats-allow). This is a **manual user edit** documented in the runbook — NOT auto-edited by an agent, and NOT unit-tested (it gates real cookie reads).

- [ ] **Step 1 (runbook instruction for the user):** In `[cookies]` add:
```toml
facebook   = ["facebook.com", "m.facebook.com", "web.facebook.com"]
offerup    = ["offerup.com", "www.offerup.com"]
craigslist = ["craigslist.org", "www.craigslist.org"]
```
- [ ] **Step 2:** In `[deny].domains`, **remove the `"facebook.com"` line** (OfferUp/Craigslist are not in deny). Keep `version = 1`. Ensure no domain duplicates across cookie sites (the loader rejects ambiguity).
- [ ] **Step 3 (verify):** `cd /home/jaime/src && /usr/bin/python3 -c "from _util._browse.vault_session import inject_vault_cookies; print('allowlist loads')"` (or the project's allowlist-load entrypoint) → confirm it loads without `NotAllowlistedError`/duplicate-domain errors.

> No repo-code commit from the agent for the TOML (manual policy edit). If committed at all, the user does it deliberately. The runbook in the orchestrator docstring (S1-8) references this step.

---

## Task S1-3 — `_kids/listing_parse.py`: pure parse/map/key (port of v1 parse + condition + url)

Pure functions, no I/O. Ports `parse.mjs` (title→specs), `condition.mjs` (`mapCondition`), `url.mjs` (`cleanUrl`), and adds `build_listing_key` + `to_type`.

**Files:** Create `_kids/listing_parse.py`; Test `tests/_kids/test_listing_parse.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_listing_parse.py`:
```python
import pytest
from _kids.listing_parse import (
    parse_title, map_condition, ALLOWED_CONDITIONS, clean_url, build_listing_key,
)


def test_parse_title_extracts_specs():
    out = parse_title("Dell XPS 15 RTX 4060 8GB VRAM 32GB RAM i7 1TB SSD")
    assert out["ram"] == 32
    assert out["vram"] == 8
    assert "RTX 4060" in out["gpu_model"]
    assert out["type"] == "Laptop"


def test_parse_title_desktop_and_none():
    assert parse_title("Dell Precision tower desktop")["type"] == "Desktop"
    out = parse_title("Old computer for parts")
    assert out["ram"] is None and out["vram"] is None and out["gpu_model"] is None


def test_map_condition():
    assert ALLOWED_CONDITIONS == ["New", "Refurbished", "Used"]
    assert map_condition("new") == "New"
    assert map_condition("Seller refurbished") == "Refurbished"
    assert map_condition("Manufacturer refurbished") == "Refurbished"
    assert map_condition("Open box") == "Used"
    assert map_condition("Like New") == "Used"
    assert map_condition("For parts or not working") == "Used"
    assert map_condition("New with defects") == "New"
    assert map_condition("") is None
    assert map_condition(None) is None
    assert map_condition("¯\\_(ツ)_/¯") is None


def test_clean_url_strips_tracking_and_canonicalizes():
    dirty = "https://www.facebook.com/marketplace/item/123/?ref=share&utm_source=x&mibextid=abc"
    assert clean_url(dirty) == "https://www.facebook.com/marketplace/item/123/"
    assert clean_url("https://offerup.com/item/9?keep=1&utm_medium=x") == "https://offerup.com/item/9?keep=1"
    assert clean_url("not a url") == "not a url"


def test_build_listing_key():
    assert build_listing_key("FB Marketplace", stable_id="123") == "FB Marketplace:123"
    # no stable id → canonical URL
    assert build_listing_key("Craigslist", listing_url="https://seattle.craigslist.org/x/d/abc/777.html?utm=1") \
        == "Craigslist:https://seattle.craigslist.org/x/d/abc/777.html"
    assert build_listing_key("OfferUp", stable_id="", listing_url="") == ""
```

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_listing_parse.py -q` → `ModuleNotFoundError: No module named '_kids.listing_parse'`.

- [ ] **Step 3: Minimal REAL implementation** — `/home/jaime/src/_kids/listing_parse.py`:
```python
"""Pure parse/map/key helpers — Python port of v1's parse.mjs/condition.mjs/url.mjs.

No I/O. Mirrors the Node logic so candidate rows are write-legal against the
same Airtable Hardware schema (no typecast).
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

# ── title → specs (port of parse.mjs) ───────────────────────────────────────
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
        "gpu_model": f"{gpu.group(1).upper()} {re.sub(r'\\s+', ' ', gpu.group(2)).strip()}" if gpu else None,
        "vram": int(vram.group(1)) if vram else None,
        "ram": int(ram.group(1)) if ram else None,
    }


# ── condition map (port of condition.mjs) ────────────────────────────────────
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
    if s.startswith("new"):          # "new other", "new with defects"
        return "New"
    if "refurb" in s:                # seller/manufacturer/certified refurbished
        return "Refurbished"
    if any(k in s for k in ("open box", "like new", "pre-owned", "preowned",
                            "used", "parts", "not working", "for parts")):
        return "Used"
    return None                      # unknown → omit the field (no 422)


# ── url canonicalization (port + extension of url.mjs) ───────────────────────
_STRIP_PREFIXES = ("utm_",)
_STRIP_EXACT = {"campid", "mkcid", "mkrid", "mkevt", "_trkparms", "_trksid",
                "ref", "referrer", "mibextid", "fbclid", "gclid"}


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


# ── shared dedup key ─────────────────────────────────────────────────────────
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

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_listing_parse.py -q`.

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add _kids/listing_parse.py tests/_kids/test_listing_parse.py
git -C /home/jaime/src commit -m "feat(_kids): pure listing_parse (specs/condition/url/listing_key) port of v1" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-4 — `_kids/airtable_py.py`: REST list keys+count + batched create (allowlist, no typecast, owned=False)

Python equivalent of `airtable.mjs`: list existing `listing_key`s (paged) + total count, and batched (10/req) create with the strict field allowlist, NO typecast, preserving `owned: False`.

**Files:** Create `_kids/airtable_py.py`; Test `tests/_kids/test_airtable_py.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_airtable_py.py` (uses a fake `requests`-like session; no live HTTP):
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
    """Stands in for a requests.Session — records calls, replays queued responses."""
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


def test_candidate_fields_include_listing_key_and_source():
    for f in ("listing_key", "source", "owned", "condition", "z", "listing_url"):
        assert f in CANDIDATE_FIELDS
    assert "title" not in CANDIDATE_FIELDS and "price" not in CANDIDATE_FIELDS  # z is the price field


def test_list_existing_keys_pages():
    http = FakeHttp([
        FakeResp(200, {"records": [{"fields": {"listing_key": "eBay:1"}}], "offset": "o1"}),
        FakeResp(200, {"records": [{"fields": {"listing_key": "Craigslist:x"}}]}),
    ])
    keys = client(http).list_existing_keys()
    assert keys == {"eBay:1", "Craigslist:x"}


def test_create_strips_nonallowlisted_keeps_owned_false_no_typecast():
    http = FakeHttp([FakeResp(200, {"records": [{"id": "rec1"}]})])
    n = client(http).create([{
        "name": "X", "source": "FB Marketplace", "listing_key": "FB Marketplace:9",
        "owned": False, "condition": None, "z": 500, "evil": "DROP", "vram": None,
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
    assert "evil" not in fields            # not allow-listed


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

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_airtable_py.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Minimal REAL implementation** — `/home/jaime/src/_kids/airtable_py.py`:
```python
"""Airtable REST client (Python port of airtable.mjs).

Strict field allowlist; NEVER sends typecast; preserves owned=False; omits
None/empty values so singleSelect/number fields don't 422. Batches 10/req.
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
    """Allow-listed keys whose value is present. Keep falsy-but-legal `owned=False`;
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
                break
        return keys

    def count(self) -> int:
        return len(self.list_existing_keys())

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

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_airtable_py.py -q`.

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add _kids/airtable_py.py tests/_kids/test_airtable_py.py
git -C /home/jaime/src commit -m "feat(_kids): airtable_py REST client (allowlist, no typecast, owned=False, listing_key)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-5 — `_kids/filter_py.py`: apply_window (null distance kept) + dedup + cap

Python port of the **generalized** S0 filter: price∈window AND (distance null OR ≤ radius); dedup on `listing_key`; cap at insert.

**Files:** Create `_kids/filter_py.py`; Test `tests/_kids/test_filter_py.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_filter_py.py`:
```python
from _kids.filter_py import apply_window, dedup, cap_inserts


def mk(key, price, dist):
    return {"listing_key": key, "z": price, "distance_mi": dist}


def test_apply_window_keeps_null_distance_enforces_price():
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    items = [mk("a", 500, None), mk("b", 150, None), mk("c", 500, 150), mk("d", 800, 40)]
    assert [i["listing_key"] for i in apply_window(items, win)] == ["a", "d"]


def test_dedup_on_listing_key_across_sources_and_within_batch():
    out = dedup([mk("FB Marketplace:1", 1, 1), mk("eBay:2", 1, 1), mk("FB Marketplace:1", 1, 1)],
                {"eBay:2"})
    assert [i["listing_key"] for i in out] == ["FB Marketplace:1"]


def test_dedup_drops_rows_with_empty_key():
    out = dedup([{"listing_key": "", "z": 1, "distance_mi": 1}], set())
    assert out == []


def test_cap_inserts():
    r = cap_inserts([mk("a", 1, 1), mk("b", 1, 1), mk("c", 1, 1)], current_count=148, max=150)
    assert len(r["to_insert"]) == 2 and r["cap_reached"] is True
    r2 = cap_inserts([mk("a", 1, 1)], current_count=0, max=150)
    assert len(r2["to_insert"]) == 1 and r2["cap_reached"] is False
```

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_filter_py.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Minimal REAL implementation** — `/home/jaime/src/_kids/filter_py.py`:
```python
"""Filter/dedup/cap (Python port of the generalized S0 filter.mjs)."""
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
        if dist is None or (isinstance(dist, (int, float)) and dist <= win["radius_mi"]):
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


def cap_inserts(items: list[dict], *, current_count: int, max: int) -> dict:
    room = builtins_max(0, max - current_count)
    return {"to_insert": items[:room], "cap_reached": len(items) > room}


def builtins_max(a, b):  # avoid shadowing the `max` kwarg above
    return a if a > b else b
```

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_filter_py.py -q`.

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add _kids/filter_py.py tests/_kids/test_filter_py.py
git -C /home/jaime/src commit -m "feat(_kids): filter_py apply_window (null distance kept)/dedup/cap" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-6 — Marketplace playbooks: FB / OfferUp / Craigslist YAML variants

YAML playbooks for the substrate's `_pattern/_sites` factory (same schema as the existing `brave_search_v1.yaml`: `site/goal/variant_id/browser/headless/inputs/steps[goto|adaptive_fill|keyboard|wait|extract_text]/extraction{primary,result_selectors,completion_timeout_s}/fitness`). FB/OfferUp use Camoufox + cookies (logged-in); Craigslist is no-login but residential-IP. We **assert the YAML shape in a test** (parseable, has the substrate's required keys + headless=true + camoufox where required) — content is iterated live later.

**Files:** Create `_pattern/_sites/variants/facebook_marketplace_search_v1.yaml`, `offerup_search_v1.yaml`, `craigslist_search_v1.yaml`; Test `tests/_kids/test_playbooks.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_playbooks.py`:
```python
from pathlib import Path
import yaml

VARIANTS = Path(__file__).resolve().parents[2] / "_pattern" / "_sites" / "variants"
PLAYBOOKS = {
    "facebook_marketplace_search_v1.yaml": {"camoufox": True},
    "offerup_search_v1.yaml": {"camoufox": True},
    "craigslist_search_v1.yaml": {"camoufox": False},
}


def test_playbooks_parse_and_have_required_shape():
    for name, expect in PLAYBOOKS.items():
        doc = yaml.safe_load((VARIANTS / name).read_text())
        assert doc["site"] and doc["goal"] and doc["variant_id"]
        assert doc["headless"] is True  # local nightly runs headless
        kinds = [s["kind"] for s in doc["steps"]]
        assert "goto" in kinds and "extract_text" in kinds
        assert doc["extraction"]["result_selectors"]
        assert isinstance(doc["extraction"]["completion_timeout_s"], int)
        if expect["camoufox"]:
            assert doc["browser"]["engine"] == "camoufox"  # ToS-gray → stealth
```

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_playbooks.py -q` → `FileNotFoundError`.

- [ ] **Step 3: Minimal REAL implementation** — create the three YAML files.

`/home/jaime/src/_pattern/_sites/variants/facebook_marketplace_search_v1.yaml`:
```yaml
site: facebook.com
goal: marketplace_search
variant_id: facebook.marketplace.search.v1
status: experimental
browser:
  engine: camoufox      # ToS-gray → stealth + burner account + residential IP
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
  required_gate_policy: soft     # fail-soft per source
variant_notes:
  - Requires seeded burner-account cookies (capture_cookies.py facebook).
  - login_wall error_kind ⇒ re-seed cookies. Never republish scraped content.
```

`/home/jaime/src/_pattern/_sites/variants/offerup_search_v1.yaml`:
```yaml
site: offerup.com
goal: marketplace_search
variant_id: offerup.search.v1
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
variant_id: craigslist.search.v1
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
  - CL litigates scrapers → residential IP, polite rate-limit/jitter, never republish content.
```

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_playbooks.py -q`.

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add _pattern/_sites/variants/facebook_marketplace_search_v1.yaml _pattern/_sites/variants/offerup_search_v1.yaml _pattern/_sites/variants/craigslist_search_v1.yaml tests/_kids/test_playbooks.py
git -C /home/jaime/src commit -m "feat(_sites): FB/OfferUp/Craigslist marketplace search playbooks (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-7 — `_kids/sources.py`: per-source listing→candidate adapters (incl. Best Buy retailer playbook)

Pure adapters: take the substrate `execute(...)` result `data` (a list of raw card dicts the playbook extracted) for a source and map each card to a write-legal candidate row (the SAME shape v1 emits). One adapter per source; `SOURCES` registry holds `(site, intent, source_label, adapter)`. Best Buy open-box is the first **`Retailer`** (`distance_mi=None` → ships). Add its playbook too. Adapters are **pure** (no network) → fully unit-tested against fixtures.

**Files:** Create `_kids/sources.py`, `_pattern/_sites/variants/bestbuy_openbox_search_v1.yaml`, `tests/_kids/fixtures/fb_cards.json`, `tests/_kids/fixtures/craigslist_cards.json`; Test `tests/_kids/test_sources.py`.

- [ ] **Step 1: Failing test** — first create the fixtures, then the test.

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
        assert s["site"] and s["intent"] and callable(s["adapter"])


def test_fb_cards_to_candidates_are_write_legal():
    rows = to_candidates("FB Marketplace", load("fb_cards.json"))
    # second card has no id/url/price → dropped (no listing_key / not a deal)
    assert len(rows) == 1
    r = rows[0]
    assert r["source"] == "FB Marketplace"
    assert r["status"] == "candidate"
    assert r["owned"] is False                       # boolean, not "No"
    assert r["type"] == "Desktop"
    assert r["condition"] == "Used"                  # mapped legal singleSelect
    assert r["z"] == 500                             # price → z (number)
    assert r["distance_mi"] == 12
    assert r["listing_key"] == "FB Marketplace:100200300"
    assert r["listing_url"] == "https://www.facebook.com/marketplace/item/100200300/"  # tracking stripped
    assert r["vram"] == 12 and r["ram"] == 32
    assert "title" not in r and "price" not in r and "image" not in r  # only allow-listed keys


def test_craigslist_card_uses_url_key_and_null_distance():
    rows = to_candidates("Craigslist", load("craigslist_cards.json"))
    r = rows[0]
    assert r["source"] == "Craigslist"
    assert r["type"] == "Laptop"
    assert r["z"] == 350                             # "$350" parsed
    assert r["distance_mi"] is None                  # CL has no distance → null/ships kept downstream
    assert r["listing_key"] == "Craigslist:7700001"
    assert "condition" not in r or r["condition"] is None  # blank condition omitted


def test_retailer_adapter_emits_null_distance_and_retailer_source():
    cards = [{"id": "sku-abc", "title": "HP Desktop Refurbished 16GB RAM", "price": "399.99",
              "url": "https://www.bestbuy.com/site/x/sku-abc.p", "condition": "Open box"}]
    rows = to_candidates("Retailer", cards)
    r = rows[0]
    assert r["source"] == "Retailer"
    assert r["distance_mi"] is None
    assert r["condition"] == "Used"                  # "Open box" → Used
    assert r["listing_key"] == "Retailer:sku-abc"
```

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_sources.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Minimal REAL implementation.**

`/home/jaime/src/_kids/sources.py`:
```python
"""Per-source raw-card → write-legal candidate adapters.

A 'card' is one extracted listing dict from a playbook's `execute(...).data`.
Adapters are pure (no network): map → parse → build a candidate row matching
the v1 Airtable Hardware shape (no typecast: owned=False, condition mapped or
omitted, type Laptop/Desktop, price→z, listing_key set). Cards without a usable
listing_key (no id and no url) are dropped.
"""
from __future__ import annotations

import re
from _kids.listing_parse import parse_title, map_condition, clean_url, build_listing_key

_PRICE_RE = re.compile(r"(\d[\d,]*\.?\d*)")


def _to_price(raw):
    if raw is None:
        return None
    m = _PRICE_RE.search(str(raw).replace(",", ""))
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
    m = _PRICE_RE.search(str(raw))
    return float(m.group(1)) if m else None


def _base_card_to_row(source: str, card: dict, *, force_null_distance: bool) -> dict | None:
    title = str(card.get("title") or "")
    listing_key = build_listing_key(source, stable_id=str(card.get("id") or ""),
                                    listing_url=str(card.get("url") or ""))
    if not listing_key:
        return None  # no stable identity → cannot dedup, not a usable deal
    specs = parse_title(title)
    row = {
        "name": title[:120] or listing_key,
        "type": specs["type"],
        "owned": False,                       # checkbox boolean
        "source": source,
        "status": "candidate",
        "z": _to_price(card.get("price")),    # price → z (number); None omitted by airtable pick
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


# Adapters — one per source. Marketplace sources carry a real distance; retailers ship → None.
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


# Registry: (substrate site id, factory intent, Airtable source label, adapter).
SOURCES = [
    {"site": "facebook.com",  "intent": "marketplace_search", "source_label": "FB Marketplace", "adapter": _marketplace_adapter("FB Marketplace"), "backend": "camoufox"},
    {"site": "offerup.com",   "intent": "marketplace_search", "source_label": "OfferUp",        "adapter": _marketplace_adapter("OfferUp"),        "backend": "camoufox"},
    {"site": "craigslist.org","intent": "marketplace_search", "source_label": "Craigslist",     "adapter": _marketplace_adapter("Craigslist"),     "backend": "camoufox"},
    {"site": "bestbuy.com",   "intent": "openbox_search",     "source_label": "Retailer",       "adapter": _retailer_adapter("Retailer"),          "backend": "camoufox"},
]

_ADAPTERS = {s["source_label"]: s["adapter"] for s in SOURCES}


def to_candidates(source_label: str, cards: list[dict]) -> list[dict]:
    return _ADAPTERS[source_label](cards)
```

`/home/jaime/src/_pattern/_sites/variants/bestbuy_openbox_search_v1.yaml`:
```yaml
site: bestbuy.com
goal: openbox_search
variant_id: bestbuy.openbox.search.v1
status: experimental
browser:
  engine: camoufox       # retailer anti-bot → stealth; best-effort
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
  goal: openbox_search
  required_gate_policy: soft
variant_notes:
  - Retailer → distance_mi null (ships). Best-effort, friendliest retailer first.
  - Newegg/Back Market/Amazon Renewed playbooks added/iterated after this proves out.
```

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_sources.py tests/_kids/test_playbooks.py -q`.

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add _kids/sources.py _pattern/_sites/variants/bestbuy_openbox_search_v1.yaml tests/_kids/fixtures/fb_cards.json tests/_kids/fixtures/craigslist_cards.json tests/_kids/test_sources.py
git -C /home/jaime/src commit -m "feat(_kids): per-source candidate adapters + Best Buy open-box playbook (Phase 2)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-8 — `scripts/marketplace_scraper.py`: orchestrator (fail-soft, cap, cookie re-seed)

The orchestrator wires it together: read the Control window from Airtable → for each enabled source, open a `session_for(site, backend="camoufox")`, run `execute(...)`, adapt cards → candidates, filter (price/distance), dedup vs existing `listing_key`s, insert up to the shared cap — **fail-soft per source** (a `login_wall`/`timeout`/block logs and skips; on `login_wall` logs `re-seed cookies for {site}`), with polite jitter between requests. The pure decision core is split out as `process_source(...)` and `plan_run(...)` and unit-tested; the network/session shell (`main`) is thin and **not** unit-tested (verified live, one source at a time).

**Files:** Create `scripts/marketplace_scraper.py`; Test `tests/_kids/test_orchestrator.py`.

- [ ] **Step 1: Failing test** — `tests/_kids/test_orchestrator.py`:
```python
import importlib.util
from pathlib import Path

# Load the script module directly (it lives under scripts/, not a package).
SPEC = importlib.util.spec_from_file_location(
    "marketplace_scraper",
    Path(__file__).resolve().parents[2] / "scripts" / "marketplace_scraper.py",
)
ms = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ms)


def test_process_source_success_adapts_and_filters():
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    exec_result = {"success": True, "error_kind": None, "data": [
        {"id": "1", "title": "Desktop RTX 3060 16GB RAM", "price": "500", "url": "https://www.facebook.com/marketplace/item/1/", "condition": "Used", "distance_mi": "20"},
        {"id": "2", "title": "Cheapo", "price": "50", "url": "https://www.facebook.com/marketplace/item/2/", "condition": "Used", "distance_mi": "5"},
    ]}
    out = ms.process_source("FB Marketplace", exec_result, win, existing_keys=set())
    assert out["skipped"] is None
    assert [r["listing_key"] for r in out["candidates"]] == ["FB Marketplace:1"]  # $50 filtered out


def test_process_source_login_wall_is_failsoft_and_flags_reseed(caplog):
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    out = ms.process_source("OfferUp", {"success": False, "error_kind": "login_wall", "data": None, "error": "wall"},
                            win, existing_keys=set())
    assert out["candidates"] == []
    assert out["skipped"] == "login_wall"
    assert out["reseed"] is True            # caller logs "re-seed cookies for offerup"


def test_process_source_timeout_is_failsoft_no_reseed():
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    out = ms.process_source("Craigslist", {"success": False, "error_kind": "timeout", "data": None, "error": "t"},
                            win, existing_keys=set())
    assert out["candidates"] == [] and out["skipped"] == "timeout" and out["reseed"] is False


def test_plan_run_dedups_across_sources_and_caps():
    win = {"price_min": 200, "price_max": 1000, "radius_mi": 100}
    per_source = {
        "FB Marketplace": [{"listing_key": "FB Marketplace:1", "z": 500, "distance_mi": 10}],
        "Craigslist":     [{"listing_key": "Craigslist:9",      "z": 300, "distance_mi": None},
                           {"listing_key": "FB Marketplace:1",  "z": 400, "distance_mi": 10}],  # dup across sources
    }
    plan = ms.plan_run(per_source, existing_keys=set(), current_count=149, max=150)
    assert len(plan["to_insert"]) == 1            # cap leaves room for 1
    assert plan["cap_reached"] is True
```

- [ ] **Step 2: Run → confirm failure** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_orchestrator.py -q` → `FileNotFoundError`/import error.

- [ ] **Step 3: Minimal REAL implementation** — `/home/jaime/src/scripts/marketplace_scraper.py`:
```python
#!/usr/bin/env python3
"""Local marketplace scrape agent (Phase 2, WSL best-effort).

Reads the Control search window from Airtable, then for each enabled source
opens a vault-backed stealth session, runs the site's search playbook via the
~/src factory, adapts the extracted cards into write-legal candidate rows,
filters (price/distance), dedups vs existing listing_keys, and inserts up to
the shared MAX_CANDIDATES cap. FAIL-SOFT per source: a login_wall/timeout/block
logs and skips that source; the others continue. Polite jitter between sources.

ToS posture: FB/Craigslist are ToS-gray → burner account, Camoufox stealth,
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

# Standalone script under ~/src → ensure organs import.
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
        return int(n) if float(n).is_integer() else n
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
    """Pure: turn one source's execute(...) result into filtered candidates, fail-soft.

    Returns {candidates, skipped(None|error_kind), reseed(bool)}.
    """
    if not exec_result.get("success"):
        kind = exec_result.get("error_kind") or "error"
        return {"candidates": [], "skipped": kind, "reseed": kind in _RESEED_KINDS}
    cards = exec_result.get("data") or []
    rows = to_candidates(source_label, cards)
    windowed = apply_window(rows, win)
    # source-local dedup vs Airtable; cross-source dedup happens in plan_run
    fresh = dedup(windowed, existing_keys)
    return {"candidates": fresh, "skipped": None, "reseed": False}


def plan_run(per_source: dict[str, list[dict]], *, existing_keys: set, current_count: int, max: int) -> dict:
    """Pure: merge all sources' candidates, dedup globally, cap at insert."""
    merged = []
    for rows in per_source.values():
        merged.extend(rows)
    deduped = dedup(merged, existing_keys)         # also removes within-batch dups across sources
    capped = cap_inserts(deduped, current_count=current_count, max=max)
    return {"to_insert": capped["to_insert"], "cap_reached": capped["cap_reached"]}


# ── network/session shell (thin; verified live, not unit-tested) ─────────────
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
              enabled_sources: set[str] | None = None) -> dict:
    win = resolve_window(control_fields)
    existing = client.list_existing_keys()
    current_count = len(existing)
    per_source: dict[str, list[dict]] = {}
    for src in SOURCES:
        label = src["source_label"]
        if enabled_sources is not None and label not in enabled_sources:
            continue
        try:
            exec_result = await _scrape_source(src, win)
            out = process_source(label, exec_result, win, existing_keys=existing)
            if out["skipped"]:
                log.warning("source %s skipped (%s)", label, out["skipped"])
                if out["reseed"]:
                    log.warning("re-seed cookies for %s", src["site"])
                continue
            per_source[label] = out["candidates"]
            log.info("source %s → %d candidate(s)", label, len(out["candidates"]))
        except Exception as exc:                    # fail-soft: never abort the others
            log.warning("source %s failed: %s", label, exc)
        await asyncio.sleep(random.uniform(3.0, 8.0))  # polite jitter between sources
    plan = plan_run(per_source, existing_keys=existing, current_count=current_count, max=max_candidates)
    inserted = client.create(plan["to_insert"]) if plan["to_insert"] else 0
    if plan["cap_reached"]:
        log.warning("MAX_CANDIDATES cap reached — review candidates")
    return {"inserted": inserted, "cap_reached": plan["cap_reached"], "sources": list(per_source)}


def _read_control(client_token: str, base_id: str) -> dict:
    import requests
    url = f"https://api.airtable.com/v0/{base_id}/Control?maxRecords=1"
    res = requests.get(url, headers={"Authorization": f"Bearer {client_token}"}, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Control read {res.status_code}: {res.text}")
    recs = res.json().get("records", [])
    return recs[0]["fields"] if recs else {"enabled": False}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    token = os.environ.get("AIRTABLE_CI_TOKEN")
    base_id = os.environ.get("AIRTABLE_BASE_ID", "appLnCrA0kRqr9Di2")
    if not token:
        log.error("AIRTABLE_CI_TOKEN not set (provide via systemd EnvironmentFile)")
        return 1
    control = _read_control(token, base_id)
    if not control.get("enabled"):
        log.info("Control.enabled is false — no-op")
        return 0
    client = AirtableClient(token=token, base_id=base_id,
                            table=os.environ.get("AIRTABLE_TABLE", "Hardware"))
    max_candidates = int(os.environ.get("MAX_CANDIDATES", "150"))
    result = asyncio.run(run(client, control, max_candidates=max_candidates))
    log.info("marketplace_scrape: %s", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run → confirm green** — `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids/test_orchestrator.py -q && /usr/bin/python3 -m pytest tests/_kids -q` (whole S1 suite green).

- [ ] **Step 5: Commit**
```bash
git -C /home/jaime/src add scripts/marketplace_scraper.py tests/_kids/test_orchestrator.py
git -C /home/jaime/src commit -m "feat(_kids): marketplace_scraper orchestrator (fail-soft per source, shared cap, cookie re-seed log)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task S1-9 — systemd user units + runbook (schedule, best-effort, EnvironmentFile)

The schedule. systemd **user** units (mirroring `master-venue-guard.{service,timer}`). `loginctl enable-linger` so they survive logout; still WSL-best-effort. Secrets via `EnvironmentFile=` (NOT committed). No unit test (it's host config) — a smoke assert validates the unit files parse via `systemd-analyze verify` if available; otherwise grep the required directives.

**Files:** Create `~/command/systemd/marketplace-scrape.service`, `~/command/systemd/marketplace-scrape.timer`.

- [ ] **Step 1:** Create the service unit `/home/jaime/command/systemd/marketplace-scrape.service`:
```ini
[Unit]
Description=Kids-computer marketplace scrape (FB/OfferUp/Craigslist/retailers → Airtable)
After=network-online.target

[Service]
Type=oneshot
# Secrets (AIRTABLE_CI_TOKEN, optional AIRTABLE_BASE_ID/TABLE/MAX_CANDIDATES) live here — NOT committed:
EnvironmentFile=%h/command/env/marketplace-scrape.env
ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py
StandardOutput=journal
StandardError=journal
```

- [ ] **Step 2:** Create the timer unit `/home/jaime/command/systemd/marketplace-scrape.timer`:
```ini
[Unit]
Description=Nightly kids-computer marketplace scrape (WSL best-effort)

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
Unit=marketplace-scrape.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3 (smoke verify, best-effort):**
```bash
systemd-analyze --user verify /home/jaime/command/systemd/marketplace-scrape.service /home/jaime/command/systemd/marketplace-scrape.timer 2>&1 | head || \
  grep -l "ExecStart=/usr/bin/python3" /home/jaime/command/systemd/marketplace-scrape.service
```
Expected: no fatal parse errors (warnings about a missing `EnvironmentFile` are fine until the user creates it).

- [ ] **Step 4 (runbook — the user does these once; document, do not auto-run):**
```bash
# 1. Put secrets (NOT committed) in the EnvironmentFile:
mkdir -p ~/command/env && chmod 700 ~/command/env
printf 'AIRTABLE_CI_TOKEN=...\nMAX_CANDIDATES=150\n' > ~/command/env/marketplace-scrape.env
chmod 600 ~/command/env/marketplace-scrape.env

# 2. Link units into the user systemd dir, enable, and survive logout:
mkdir -p ~/.config/systemd/user
ln -sf ~/command/systemd/marketplace-scrape.service ~/.config/systemd/user/
ln -sf ~/command/systemd/marketplace-scrape.timer   ~/.config/systemd/user/
loginctl enable-linger "$(whoami)"        # timers fire while WSL is running (best-effort)
systemctl --user daemon-reload
systemctl --user enable --now marketplace-scrape.timer
systemctl --user list-timers | grep marketplace   # confirm scheduled

# 3. First live verification — run ONE source at a time, manually, to confirm cookies/playbooks:
AIRTABLE_CI_TOKEN=... /usr/bin/python3 ~/src/scripts/marketplace_scraper.py   # tail the journal / stdout
```

- [ ] **Step 5: Commit** (units are config, but they live in `~/command` which is a separate tree; commit there if it is a repo, otherwise leave as host config and note in the S1 ledger. If `~/command` is NOT under version control, skip the commit and record the unit paths in the handoff.) If committing in `~/src` is desired, copy the units into `~/src/_kids/systemd/` for reference and commit those copies:
```bash
mkdir -p /home/jaime/src/_kids/systemd
cp /home/jaime/command/systemd/marketplace-scrape.service /home/jaime/command/systemd/marketplace-scrape.timer /home/jaime/src/_kids/systemd/
git -C /home/jaime/src add _kids/systemd/marketplace-scrape.service _kids/systemd/marketplace-scrape.timer
git -C /home/jaime/src commit -m "chore(_kids): reference systemd user units for nightly marketplace scrape (WSL best-effort)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Final verification (both sub-projects)

- [ ] **S0:** `cd /home/jaime/kids/computers && pnpm test && pnpm build` → all vitest pass (the v1 79 + the new S0 cases), build clean. Open a PR on `feat/canvasser-phase2-s0` (`gh pr create`), final whole-branch review, merge.
- [ ] **S1:** `cd /home/jaime/src && /usr/bin/python3 -m pytest tests/_kids -q` → all green (zero live calls). Then the **live** verification per S1-9 Step 4 (one source at a time, WSL awake): confirm candidates land in Airtable with `source ∈ {FB Marketplace, OfferUp, Craigslist, Retailer}`, `owned=false`, `condition` legal/omitted, `listing_key` set and deduped, `distance_mi` numeric for marketplace + null for retailers, and the run stops at `MAX_CANDIDATES`. Confirm a `login_wall` on one source logs `re-seed cookies for {site}` and the others still complete (fail-soft). Open a PR on `feat/marketplace-scraper-phase2`.
- [ ] **Cross-cutting:** verify no secrets were committed in either repo (`git -C <repo> log -p | grep -iE "AIRTABLE_CI_TOKEN=|Bearer "` returns nothing but allow-listed placeholders); the `allowlist.toml` and `EnvironmentFile` edits are manual/uncommitted; cap headroom holds (records ≪ 1,000).

---

### Notes for the implementer (load-bearing facts confirmed against the live trees)

- The REAL shipped `scripts/lib/airtable.mjs` `CANDIDATE_FIELDS` does **NOT** contain `title`/`price` (the v1 final review removed those non-schema fields; **`z` is the price/currency field**). S0-3 only *appends* `listing_key`. Do not re-add `title`/`price`.
- `~/src` substrate is verified: `from _util._browse.session import session_for` yields a `Session` with `.engine`/`.page`/`.context` (cookies auto-injected; pass `backend="camoufox"` for stealth); `from _pattern._sites import execute` → `await execute(site, intent, params=dict, handle=session.engine)` returns a uniform dict with `success`, `data`, `error_kind` (`login_wall`/`timeout`/`selector_miss`/…), `steps_completed`. (`_make_result`, `factory.py:82,360`.)
- Tooling present: `/usr/bin/python3` is 3.12.3; `pytest` 9.0.2 and `requests` 2.32.5 are already importable. vitest 2.1.8 is already installed in the Node repo. `~/src` is on branch `_arch-_ops`; `~/kids/computers` is on `main`.
- The vault loader rejects duplicate domains across cookie sites and `version != 1`; FB is currently in `[deny].domains` (line 86 of `allowlist.toml`) and MUST be removed there (S1-2) or `session_for("facebook.com")` raises `NotAllowlistedError`/deny-rejection.