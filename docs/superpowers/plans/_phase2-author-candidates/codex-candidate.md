# Deal Canvasser Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing eBay canvasser data layer for shared Airtable dedup, then add a local Python scrape agent in `~/src` for retailer/refurb, Facebook Marketplace, OfferUp, and Craigslist candidates.

**Architecture:** S0 stays in the public `kidscomputer` Node repo and updates only the shared Airtable write/filter contract used by the existing GitHub Actions eBay flow. S1 is a separate Python 3.12 project under `~/src` that uses the existing `_util._browse.session_for(..., backend="camoufox")` and `_pattern._sites.execute(...)` substrate, re-implements the small parse/map/filter pieces in Python, and writes the same no-typecast Hardware rows to Airtable via REST. Tests never hit live networks.

**Tech Stack:** Node ESM, vitest, Airtable Metadata/API, Python 3.12, pytest, requests, python-dotenv, Playwright/Camoufox/browserforge through the existing `~/src` substrate, systemd user timers.

---

## Global Constraints

- Airtable base appLnCrA0kRqr9Di2; Hardware tblnJoBqI7G2FaBke; Control tbljHjoeyh5jZGJLg; defaults price 200/1000, zip 98052, radius 100.
- Write-legal rows, NO typecast: owned=false, condition∈{New,Refurbished,Used}|omit, type∈{Laptop,Desktop}, source∈{eBay,Retailer,FB Marketplace,OfferUp,Craigslist}, null/undefined omitted.
- ToS posture: burner account, Camoufox stealth, polite rate-limits/jitter, residential IP; NEVER republish scraped content publicly.
- Commit footer on EVERY commit:
  Co-Authored-By: claude-flow <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk
- Test runners: vitest (Node/S0), pytest (Python/S1). No live network in tests.

## Airtable Schema Operations

The build requires two Airtable metadata changes before any writer sends Phase 2 rows:

- Hardware field `listing_key`: `singleLineText`
- Hardware `source` singleSelect gains `Retailer`

Use the Airtable MCP metadata tools at execution time when available. Do not require a schema-write token in code. Verify the live schema after creation with one of these checks:

```bash
node --env-file=.env.local -e '
const base = "appLnCrA0kRqr9Di2";
const table = "tblnJoBqI7G2FaBke";
const token = process.env.AIRTABLE_CI_TOKEN || process.env.AIRTABLE_TOKEN;
if (!token) throw new Error("AIRTABLE_CI_TOKEN or AIRTABLE_TOKEN required for schema verification");
const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
const schema = await res.json();
const hardware = schema.tables.find((t) => t.id === table);
const listingKey = hardware.fields.find((f) => f.name === "listing_key");
const source = hardware.fields.find((f) => f.name === "source");
console.log(JSON.stringify({
  listing_key_type: listingKey?.type,
  source_choices: source?.options?.choices?.map((c) => c.name).sort(),
}, null, 2));
'
```

Expected output includes:

```json
{
  "listing_key_type": "singleLineText",
  "source_choices": [
    "Craigslist",
    "eBay",
    "FB Marketplace",
    "OfferUp",
    "Retailer"
  ]
}
```

## File Structure

### S0: `/home/jaime/kids/computers`

- Modify `scripts/lib/filter.mjs`: make `applyWindow` keep `distance_mi == null`, make `dedup` use `listing_key`.
- Modify `scripts/lib/airtable.mjs`: add `listing_key` to `CANDIDATE_FIELDS`; make `listExistingIds()` page `listing_key`; make `count()` count all Hardware records with `pageSize=100`, not just keyed records.
- Modify `scripts/canvass.mjs`: set `listing_key: "eBay:" + ebay_item_id` on eBay rows before dedup/create.
- Modify `scripts/bootstrap.mjs`: add `listing_key` to bootstrap field plan and `Retailer` to the local schema plan choices. Live source choice update is still a metadata operation, verified separately.
- Modify `tests/lib/filter.test.mjs`: cross-source `listing_key` dedup and null-distance behavior.
- Modify `tests/lib/airtable.test.mjs`: `listing_key` projection, allowlist, and count behavior.
- Modify `tests/canvass.test.mjs`: eBay rows produce `listing_key`.
- Modify `tests/lib/bootstrap.plan.test.mjs`: bootstrap plan includes `listing_key` and `Retailer`.

### S1: `/home/jaime/src`

- Create `scripts/lib/__init__.py`: package marker for local scripts imports.
- Create `scripts/lib/listing_parse.py`: pure title parsing, condition mapping, type mapping, URL cleaning, listing key construction, row normalization/filtering helpers.
- Create `scripts/lib/airtable_py.py`: Airtable REST wrapper for Control read, existing `listing_key` set, total Hardware count, and batched no-typecast creates.
- Create `scripts/lib/marketplace_extract.py`: deterministic extraction from saved HTML or factory result data into raw listing dicts.
- Create `_pattern/_sites/variants/facebook_marketplace_search_v1.yaml`
- Create `_pattern/_sites/variants/offerup_search_v1.yaml`
- Create `_pattern/_sites/variants/craigslist_search_v1.yaml`
- Create `_pattern/_sites/variants/bestbuy_openbox_search_v1.yaml`
- Create `_pattern/_sites/variants/woot_search_v1.yaml`
- Create `_pattern/_sites/variants/microcenter_search_v1.yaml`
- Create `_pattern/_sites/variants/newegg_refurb_search_v1.yaml`
- Create `_pattern/_sites/variants/backmarket_search_v1.yaml`
- Create `_pattern/_sites/variants/amazon_renewed_search_v1.yaml`
- Create `scripts/marketplace_scraper.py`: async orchestrator using injected dependencies in tests and real `session_for`/`execute` in production.
- Modify `scripts/capture_cookies.py`: add `facebook`, `offerup`, and `craigslist` `TARGETS`.
- Modify `_cour/_vault/allowlist.toml`: add the three cookie sites and remove `facebook.com` from `[deny].domains`.
- Create `docs/deal_canvasser_phase2_local_setup.md`: one-time setup and operational runbook.
- Create `command/systemd/marketplace-scrape.service`
- Create `command/systemd/marketplace-scrape.timer`
- Create tests:
  - `scripts/tests/test_listing_parse.py`
  - `scripts/tests/test_airtable_py.py`
  - `scripts/tests/test_marketplace_extract.py`
  - `scripts/tests/test_marketplace_scraper.py`
  - `scripts/tests/test_capture_cookie_targets.py`
  - `scripts/tests/test_systemd_units.py`
- Create fixtures:
  - `scripts/tests/fixtures/facebook_marketplace.html`
  - `scripts/tests/fixtures/offerup.html`
  - `scripts/tests/fixtures/craigslist.html`
  - `scripts/tests/fixtures/bestbuy_openbox.html`
  - `scripts/tests/fixtures/woot.html`
  - `scripts/tests/fixtures/microcenter.html`

---

## S0 — Shared Data-Layer Generalizations

### Task 1: Schema Plan And Verification Hooks

**Files:**
- Modify: `scripts/bootstrap.mjs`
- Test: `tests/lib/bootstrap.plan.test.mjs`

- [ ] **Step 1: Write the failing test**

Replace `tests/lib/bootstrap.plan.test.mjs` with:

```js
import { describe, it, expect } from "vitest"
import { NEW_FIELDS, planSchema } from "../../scripts/bootstrap.mjs"

describe("bootstrap schema plan", () => {
  it("creates missing listing_key and keeps Retailer in the source choices", () => {
    const plan = planSchema({ fields: ["name", "source", "status"], tables: ["Hardware"] })
    const names = plan.fieldsToCreate.map((f) => f.name)
    expect(names).not.toContain("source")
    expect(names).toContain("listing_key")

    const source = NEW_FIELDS.find((f) => f.name === "source")
    expect(source.options.choices.map((c) => c.name)).toEqual([
      "eBay",
      "Retailer",
      "FB Marketplace",
      "OfferUp",
      "Craigslist",
      "Estate/Auction",
      "Manual",
    ])
  })

  it("does not recreate fields that already exist", () => {
    const existing = [
      "source", "status", "found_date", "distance_mi", "listing_url", "ebay_item_id", "listing_key",
    ]
    const plan = planSchema({ fields: existing, tables: ["Hardware", "Control"] })
    expect(plan.fieldsToCreate).toEqual([])
    expect(plan.createControl).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/lib/bootstrap.plan.test.mjs
```

Expected: FAIL because `listing_key` is absent and `Retailer` is not in the `source` choices.

- [ ] **Step 3: Write minimal implementation**

Edit `scripts/bootstrap.mjs` so `NEW_FIELDS` starts with:

```js
export const NEW_FIELDS = [
  { name: "source", type: "singleSelect", options: { choices: ["eBay", "Retailer", "FB Marketplace", "OfferUp", "Craigslist", "Estate/Auction", "Manual"].map((name) => ({ name })) } },
  { name: "status", type: "singleSelect", options: { choices: ["candidate", "reviewing", "kept", "dismissed"].map((name) => ({ name })) } },
  { name: "found_date", type: "date", options: { dateFormat: { name: "iso" } } },
  { name: "distance_mi", type: "number", options: { precision: 1 } },
  { name: "listing_url", type: "url" },
  { name: "ebay_item_id", type: "singleLineText" },
  { name: "listing_key", type: "singleLineText" },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run tests/lib/bootstrap.plan.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Verify live Airtable schema**

Use Airtable MCP metadata tools to create `listing_key` and add `Retailer`, then run the schema verification command from the "Airtable Schema Operations" section.

Expected: `listing_key_type` is `singleLineText`, and `source_choices` includes `Retailer`.

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap.mjs tests/lib/bootstrap.plan.test.mjs
git commit -m "feat: plan phase 2 airtable fields" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 2: Filter And Dedup On `listing_key`

**Files:**
- Modify: `scripts/lib/filter.mjs`
- Test: `tests/lib/filter.test.mjs`

- [ ] **Step 1: Write the failing test**

Replace `tests/lib/filter.test.mjs` with:

```js
import { describe, it, expect } from "vitest"
import { applyWindow, dedup, capInserts } from "../../scripts/lib/filter.mjs"

const mk = (listing_key, price = 500, dist = 50) => ({ listing_key, price, distance_mi: dist })

describe("applyWindow", () => {
  it("keeps price in [min,max] and distance <= radius", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    const items = [
      mk("eBay:1", 150, 10),
      mk("eBay:2", 500, 50),
      mk("eBay:3", 500, 150),
    ]
    expect(applyWindow(items, win).map((i) => i.listing_key)).toEqual(["eBay:2"])
  })

  it("keeps null distance because null means ships or unknown", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    expect(applyWindow([mk("Retailer:https://x", 800, null)], win).map((i) => i.listing_key)).toEqual([
      "Retailer:https://x",
    ])
  })
})

describe("dedup", () => {
  it("removes items whose listing_key already exists across sources", () => {
    const existing = new Set(["eBay:2", "Craigslist:abc"])
    const items = [mk("eBay:2"), mk("Craigslist:abc"), mk("OfferUp:ou-3")]
    expect(dedup(items, existing).map((i) => i.listing_key)).toEqual(["OfferUp:ou-3"])
  })

  it("removes within-batch duplicate listing_key values and keeps the first occurrence", () => {
    const result = dedup([mk("FB Marketplace:1", 100, 50), mk("FB Marketplace:1", 200, 75), mk("Retailer:u", 300, null)], new Set())
    expect(result).toHaveLength(2)
    expect(result.map((i) => i.listing_key)).toEqual(["FB Marketplace:1", "Retailer:u"])
    expect(result[0].price).toBe(100)
  })
})

describe("capInserts", () => {
  it("inserts only up to MAX - currentCount, reporting capReached", () => {
    const r = capInserts([mk("a"), mk("b"), mk("c")], { currentCount: 148, max: 150 })
    expect(r.toInsert).toHaveLength(2)
    expect(r.capReached).toBe(true)
  })

  it("inserts all when under cap", () => {
    const r = capInserts([mk("a")], { currentCount: 0, max: 150 })
    expect(r.toInsert).toHaveLength(1)
    expect(r.capReached).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/lib/filter.test.mjs
```

Expected: FAIL because null distance is dropped and dedup still reads `ebay_item_id`.

- [ ] **Step 3: Write minimal implementation**

Replace `scripts/lib/filter.mjs` with:

```js
export function applyWindow(items, win) {
  return items.filter((i) => {
    const inPrice =
      typeof i.price === "number" &&
      i.price >= win.price_min &&
      i.price <= win.price_max
    const inRadius = i.distance_mi == null || (
      typeof i.distance_mi === "number" &&
      i.distance_mi <= win.radius_mi
    )
    return inPrice && inRadius
  })
}

export function dedup(items, existingIds) {
  const seen = new Set(existingIds)
  const result = []
  for (const item of items) {
    const id = item.listing_key == null ? "" : String(item.listing_key)
    if (id && !seen.has(id)) {
      seen.add(id)
      result.push(item)
    }
  }
  return result
}

export function capInserts(items, { currentCount, max }) {
  const room = Math.max(0, max - currentCount)
  const toInsert = items.slice(0, room)
  return { toInsert, capReached: items.length > room }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run tests/lib/filter.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat: dedup candidates by listing key" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 3: Airtable Node Client Uses `listing_key`

**Files:**
- Modify: `scripts/lib/airtable.mjs`
- Test: `tests/lib/airtable.test.mjs`

- [ ] **Step 1: Write the failing test**

Replace `tests/lib/airtable.test.mjs` with:

```js
import { describe, it, expect, vi } from "vitest"
import { createAirtable, CANDIDATE_FIELDS } from "../../scripts/lib/airtable.mjs"

function fakeFetch(responses) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts, body: opts?.body ? JSON.parse(opts.body) : null })
    const next = responses.shift()
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body, text: async () => "" }
  })
  fn.calls = calls
  return fn
}

const at = (fetchImpl) =>
  createAirtable({ token: "t", baseId: "appLnCrA0kRqr9Di2", table: "Hardware", fetchImpl })

describe("airtable.listExistingIds", () => {
  it("pages and returns the set of listing_key values", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ fields: { listing_key: "eBay:1" } }], offset: "o1" } },
      { body: { records: [{ fields: { listing_key: "Craigslist:2" } }, { fields: {} }] } },
    ])
    const ids = await at(fetch).listExistingIds()
    expect([...ids].sort()).toEqual(["Craigslist:2", "eBay:1"])
    expect(fetch.calls[0].url).toContain("fields%5B%5D=listing_key")
  })
})

describe("airtable.count", () => {
  it("counts all Hardware records even when a legacy row lacks listing_key", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ id: "rec1" }, { id: "rec2" }], offset: "o1" } },
      { body: { records: [{ id: "rec3" }] } },
    ])
    await expect(at(fetch).count()).resolves.toBe(3)
  })
})

describe("airtable.create", () => {
  it("strips non-allowlisted fields, keeps owned:false, includes listing_key, and NEVER sends typecast", async () => {
    const fetch = fakeFetch([{ body: { records: [{ id: "rec1" }] } }])
    await at(fetch).create([{ listing_key: "eBay:123", ebay_item_id: "123", z: 500, evil: "DROP TABLE", title: "X", price: 500, owned: false }])
    const sent = fetch.calls[0].body
    expect(sent.typecast).toBeUndefined()
    expect(Object.keys(sent.records[0].fields)).toEqual(
      expect.arrayContaining(["listing_key", "ebay_item_id", "z", "owned"]),
    )
    expect(sent.records[0].fields.evil).toBeUndefined()
    expect(sent.records[0].fields.title).toBeUndefined()
    expect(sent.records[0].fields.price).toBeUndefined()
    expect(sent.records[0].fields.owned).toBe(false)
  })

  it("batches in chunks of 10", async () => {
    const fetch = fakeFetch([{ body: { records: [] } }, { body: { records: [] } }])
    const rows = Array.from({ length: 15 }, (_, i) => ({ listing_key: `Retailer:${i}`, z: 300 }))
    await at(fetch).create(rows)
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[0].body.records).toHaveLength(10)
    expect(fetch.calls[1].body.records).toHaveLength(5)
  })

  it("CANDIDATE_FIELDS matches the phase 2 data model", () => {
    expect(CANDIDATE_FIELDS).toEqual([
      "name", "type", "condition", "owned", "source", "status", "found_date",
      "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
    ])
  })

  it("omits null/undefined fields but keeps owned:false", async () => {
    const fetch = fakeFetch([{ body: { records: [{ id: "rec2" }] } }])
    await at(fetch).create([{
      owned: false,
      condition: null,
      distance_mi: null,
      listing_key: "Retailer:https://store.example/item",
      name: "GPU",
      z: 400,
    }])
    const fields = fetch.calls[0].body.records[0].fields
    expect(fields).not.toHaveProperty("condition")
    expect(fields).not.toHaveProperty("distance_mi")
    expect(fields.owned).toBe(false)
    expect(fields.listing_key).toBe("Retailer:https://store.example/item")
    expect(fields.name).toBe("GPU")
    expect(fields.z).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/lib/airtable.test.mjs
```

Expected: FAIL because the client projects `ebay_item_id`, omits `listing_key`, and `count()` proxies through the keyed ID set.

- [ ] **Step 3: Write minimal implementation**

Replace `scripts/lib/airtable.mjs` with:

```js
export const CANDIDATE_FIELDS = [
  "name", "type", "condition", "owned", "source", "status", "found_date",
  "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
]

export function createAirtable({ token, baseId, table = "Hardware", fetchImpl = fetch }) {
  const base = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
  const auth = { Authorization: `Bearer ${token}` }

  async function listExistingIds() {
    const ids = new Set()
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
        const id = r.fields?.listing_key
        if (id) ids.add(String(id))
      }
      offset = data.offset
    } while (offset)
    return ids
  }

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

  async function create(rows) {
    let created = 0
    for (let i = 0; i < rows.length; i += 10) {
      const chunk = rows.slice(i, i + 10).map((row) => ({ fields: pick(row) }))
      const res = await fetchImpl(base, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ records: chunk }),
      })
      if (!res.ok) throw new Error(`Airtable create ${res.status}: ${await res.text()}`)
      const data = await res.json()
      created += data.records?.length ?? 0
    }
    return created
  }

  return { listExistingIds, count, create }
}

function pick(row) {
  const out = {}
  for (const k of CANDIDATE_FIELDS) if (row[k] !== undefined && row[k] !== null) out[k] = row[k]
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run tests/lib/airtable.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/airtable.mjs tests/lib/airtable.test.mjs
git commit -m "feat: use listing keys in airtable client" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 4: eBay Canvass Emits `listing_key`

**Files:**
- Modify: `scripts/canvass.mjs`
- Test: `tests/canvass.test.mjs`

- [ ] **Step 1: Write the failing test**

In `tests/canvass.test.mjs`, update the first test body to assert the new key:

```js
  it("inserts filtered+deduped candidates with listing_key, stripped URL, and marks the run", async () => {
    const d = deps()
    const r = await runCanvass(d)
    expect(d.ebay.search).toHaveBeenCalledWith(expect.objectContaining(win))
    const inserted = d.airtable.create.mock.calls[0][0]
    expect(inserted.map((x) => x.listing_key)).toEqual(["eBay:1"])
    expect(inserted.map((x) => x.ebay_item_id)).toEqual(["1"])
    expect(inserted[0].listing_url).toBe("https://ebay.com/itm/1")
    expect(inserted[0].status).toBe("candidate")
    expect(inserted[0].source).toBe("eBay")
    expect(inserted[0].z).toBe(500)
    expect(inserted[0].owned).toBe(false)
    expect(inserted[0].condition).toBe("Refurbished")
    expect(d.control.markRan).toHaveBeenCalled()
    expect(r.inserted).toBe(1)
  })
```

Also update the `deps()` eBay search fixture to include keys before filtering/dedup:

```js
      search: vi.fn(async () => [
        { listing_key: "eBay:1", ebay_item_id: "1", title: "PC RTX 4060 8GB VRAM 32GB RAM", price: 500, url: "https://ebay.com/itm/1?utm_source=x", distance_mi: 40, condition: "Refurbished" },
        { listing_key: "eBay:2", ebay_item_id: "2", title: "Cheap", price: 100, url: "https://ebay.com/itm/2", distance_mi: 10, condition: null },
      ]),
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/canvass.test.mjs
```

Expected: FAIL because `runCanvass()` does not set `listing_key` on rows when the upstream eBay client does not.

- [ ] **Step 3: Write minimal implementation**

In `scripts/canvass.mjs`, change the raw eBay result handling to normalize `listing_key` immediately:

```js
    const raw = (await ebay.search(win)).map((item) => ({
      ...item,
      listing_key: item.listing_key ?? `eBay:${item.ebay_item_id}`,
    }))
```

In the row mapping object, add `listing_key` before `ebay_item_id`:

```js
        listing_url: cleanUrl(i.url),
        listing_key: i.listing_key,
        ebay_item_id: i.ebay_item_id,
```

- [ ] **Step 4: Run S0 tests**

Run:

```bash
pnpm vitest run tests/lib/filter.test.mjs tests/lib/airtable.test.mjs tests/canvass.test.mjs tests/lib/bootstrap.plan.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/canvass.mjs tests/canvass.test.mjs
git commit -m "feat: emit ebay listing keys" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## S1 — Local Scrape Agent

### Task 5: One-Time Local Setup Runbook And Cookie Targets

**Files:**
- Create: `/home/jaime/src/docs/deal_canvasser_phase2_local_setup.md`
- Modify: `/home/jaime/src/scripts/capture_cookies.py`
- Modify: `/home/jaime/src/_cour/_vault/allowlist.toml`
- Test: `/home/jaime/src/scripts/tests/test_capture_cookie_targets.py`

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_capture_cookie_targets.py`:

```python
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_capture_module():
    path = ROOT / "scripts" / "capture_cookies.py"
    spec = importlib.util.spec_from_file_location("capture_cookies", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_marketplace_cookie_targets_are_registered():
    module = load_capture_module()
    assert module.TARGETS["facebook"]["url"] == "https://www.facebook.com/marketplace"
    assert "facebook.com" in module.TARGETS["facebook"]["domains"]
    assert module.TARGETS["offerup"]["url"] == "https://offerup.com"
    assert "offerup.com" in module.TARGETS["offerup"]["domains"]
    assert module.TARGETS["craigslist"]["url"] == "https://craigslist.org"
    assert "craigslist.org" in module.TARGETS["craigslist"]["domains"]


def test_vault_allowlist_allows_marketplaces_and_does_not_deny_facebook():
    text = (ROOT / "_cour" / "_vault" / "allowlist.toml").read_text()
    assert 'facebook   = ["facebook.com", "m.facebook.com", "web.facebook.com"]' in text
    assert 'offerup    = ["offerup.com", "www.offerup.com"]' in text
    assert 'craigslist = ["craigslist.org", "www.craigslist.org"]' in text
    deny_section = text.split("[deny]", 1)[1]
    assert '"facebook.com"' not in deny_section
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_capture_cookie_targets.py -q
```

Expected: FAIL because targets and allowlist entries are not present.

- [ ] **Step 3: Update cookie targets**

In `/home/jaime/src/scripts/capture_cookies.py`, add these entries to `TARGETS`:

```python
    "facebook": {
        "url": "https://www.facebook.com/marketplace",
        "cookie_file": "_cour/_vault/cookies/facebook.json",
        "domains": [".facebook.com", "facebook.com", "m.facebook.com", "web.facebook.com"],
        "logged_in_check": lambda page: page.locator("[aria-label*='Marketplace'], a[href*='/marketplace']").count(),
    },
    "offerup": {
        "url": "https://offerup.com",
        "cookie_file": "_cour/_vault/cookies/offerup.json",
        "domains": [".offerup.com", "offerup.com", "www.offerup.com"],
        "logged_in_check": lambda page: page.locator("a[href*='/accounts/'], [data-testid*='profile']").count(),
    },
    "craigslist": {
        "url": "https://craigslist.org",
        "cookie_file": "_cour/_vault/cookies/craigslist.json",
        "domains": [".craigslist.org", "craigslist.org", "www.craigslist.org"],
        "logged_in_check": lambda page: page.locator("body").count(),
    },
```

- [ ] **Step 4: Update vault allowlist**

In `/home/jaime/src/_cour/_vault/allowlist.toml`, add under `[cookies]`:

```toml
facebook   = ["facebook.com", "m.facebook.com", "web.facebook.com"]
offerup    = ["offerup.com", "www.offerup.com"]
craigslist = ["craigslist.org", "www.craigslist.org"]
```

Remove this line from `[deny].domains`:

```toml
    "facebook.com",
```

- [ ] **Step 5: Add runbook**

Create `/home/jaime/src/docs/deal_canvasser_phase2_local_setup.md`:

```markdown
# Deal Canvasser Phase 2 Local Setup

This local scraper runs on the WSL box. It is best-effort: systemd user timers run only while WSL is running.

## Dependencies

Run from `/home/jaime/src`:

```bash
python3 -m pip install --user playwright camoufox browserforge requests python-dotenv
python3 -m playwright install chromium
```

## Cookie Seeding

Use burner Facebook and OfferUp accounts. Do not use a personal account.

```bash
python3 scripts/capture_cookies.py facebook
python3 scripts/capture_cookies.py offerup
python3 scripts/capture_cookies.py craigslist
```

Cookies are saved under `_cour/_vault/cookies/`. Re-run the relevant command when the scraper logs `login_wall` or `re-seed cookies`.

## Environment File

Create `%h/.config/kidscomputer/marketplace-scrape.env` locally. Do not commit it.

```bash
AIRTABLE_CI_TOKEN=pat...
AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2
AIRTABLE_HARDWARE_TABLE=Hardware
AIRTABLE_CONTROL_TABLE=Control
MAX_CANDIDATES=150
MARKETPLACE_ENABLED_SOURCES=facebook_marketplace,offerup,craigslist,bestbuy_openbox,woot,microcenter,newegg_refurb,backmarket,amazon_renewed
```

## Manual Smoke Run

Run one source at a time:

```bash
cd /home/jaime/src
AIRTABLE_CI_TOKEN=pat... MARKETPLACE_ENABLED_SOURCES=craigslist python3 scripts/marketplace_scraper.py
```

## Timer

```bash
mkdir -p ~/.config/systemd/user
ln -sf /home/jaime/src/command/systemd/marketplace-scrape.service ~/.config/systemd/user/marketplace-scrape.service
ln -sf /home/jaime/src/command/systemd/marketplace-scrape.timer ~/.config/systemd/user/marketplace-scrape.timer
systemctl --user daemon-reload
systemctl --user enable --now marketplace-scrape.timer
loginctl enable-linger "$(whoami)"
```

WSL caveat: the timer is not an always-on cloud scheduler. If WSL is stopped, runs are missed until WSL starts again.

## Safety

Use Camoufox stealth, polite rate-limits and jitter, and a residential IP. Never republish scraped listing content publicly.
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_capture_cookie_targets.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/jaime/src
git add docs/deal_canvasser_phase2_local_setup.md scripts/capture_cookies.py _cour/_vault/allowlist.toml scripts/tests/test_capture_cookie_targets.py
git commit -m "feat: document marketplace cookie setup" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 6: Pure Listing Parse Library

**Files:**
- Create: `/home/jaime/src/scripts/lib/__init__.py`
- Create: `/home/jaime/src/scripts/lib/listing_parse.py`
- Test: `/home/jaime/src/scripts/tests/test_listing_parse.py`

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_listing_parse.py`:

```python
from scripts.lib.listing_parse import (
    apply_window,
    build_listing_key,
    clean_url,
    map_condition,
    normalize_candidate,
    parse_title,
)


def test_parse_title_ports_node_regexes():
    specs = parse_title("Lenovo Legion laptop RTX-4060 Ti 8GB GDDR6 video 32GB DDR5 RAM")
    assert specs == {
        "type": "Laptop",
        "gpu_model": "RTX 4060 Ti",
        "vram": 8,
        "ram": 32,
    }


def test_parse_title_defaults_desktop():
    assert parse_title("Dell Optiplex GTX 1650 4GB VRAM 16GB RAM")["type"] == "Desktop"


def test_map_condition_write_legal_values():
    assert map_condition("Certified Refurbished") == "Refurbished"
    assert map_condition("open box") == "Used"
    assert map_condition("NEW other") == "New"
    assert map_condition("seller says works") is None


def test_clean_url_removes_tracking_and_fragments():
    assert clean_url("https://example.com/item/1?utm_source=x&campid=1&keep=yes#frag") == "https://example.com/item/1?keep=yes"


def test_build_listing_key_uses_stable_id_then_clean_url():
    assert build_listing_key("eBay", "123", "https://x.test/a?utm_source=x") == "eBay:123"
    assert build_listing_key("Retailer", None, "https://x.test/a?utm_source=x") == "Retailer:https://x.test/a"


def test_apply_window_keeps_null_distance():
    rows = [{"listing_key": "Retailer:u", "price": 800, "distance_mi": None}]
    assert apply_window(rows, {"price_min": 200, "price_max": 1000, "radius_mi": 100}) == rows


def test_normalize_candidate_omits_null_fields_and_sets_write_legal_shape():
    row = normalize_candidate(
        raw={
            "title": "Dell PC RTX 4060 8GB VRAM 32GB RAM",
            "price": 500,
            "url": "https://store.example/item?utm_source=x",
            "stable_id": "abc",
            "condition": "unknown words",
            "distance_mi": None,
        },
        source="Retailer",
        found_date="2026-06-19",
    )
    assert row == {
        "name": "Dell PC RTX 4060 8GB VRAM 32GB RAM",
        "type": "Desktop",
        "owned": False,
        "source": "Retailer",
        "status": "candidate",
        "found_date": "2026-06-19",
        "listing_url": "https://store.example/item",
        "listing_key": "Retailer:abc",
        "gpu_model": "RTX 4060",
        "vram": 8,
        "ram": 32,
        "z": 500,
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_listing_parse.py -q
```

Expected: FAIL because `scripts.lib.listing_parse` does not exist.

- [ ] **Step 3: Write implementation**

Create `/home/jaime/src/scripts/lib/__init__.py` as an empty file.

Create `/home/jaime/src/scripts/lib/listing_parse.py`:

```python
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ALLOWED_CONDITIONS = {"New", "Refurbished", "Used"}
ALLOWED_TYPES = {"Laptop", "Desktop"}
ALLOWED_SOURCES = {"eBay", "Retailer", "FB Marketplace", "OfferUp", "Craigslist"}

GPU_RE = re.compile(r"\b(RTX|GTX|RX|Arc)\s?-?\s?(\d{3,4}\s?(?:Ti|XT|Super)?)\b", re.I)
VRAM_RE = re.compile(r"(\d{1,2})\s?GB\s?(?:GDDR\d?|VRAM|video)", re.I)
RAM_RE = re.compile(r"(\d{1,3})\s?GB\s?(?:DDR\d\s?)?RAM\b", re.I)
LAPTOP_RE = re.compile(r"\b(laptop|notebook|thinkpad|macbook|ideapad|legion(?!\s*tower))\b", re.I)
TRACKING_PREFIXES = ("utm_",)
TRACKING_KEYS = {"campid", "mkcid", "_trkparms", "hash"}


def parse_title(title: str = "") -> dict[str, object | None]:
    text = str(title or "")
    gpu = GPU_RE.search(text)
    vram = VRAM_RE.search(text)
    ram = RAM_RE.search(text)
    gpu_model = None
    if gpu:
        gpu_model = f"{gpu.group(1).upper()} {' '.join(gpu.group(2).split())}"
    return {
        "type": "Laptop" if LAPTOP_RE.search(text) else "Desktop",
        "gpu_model": gpu_model,
        "vram": int(vram.group(1)) if vram else None,
        "ram": int(ram.group(1)) if ram else None,
    }


def map_condition(raw: object | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    if s == "new" or s.startswith("new"):
        return "New"
    if s == "refurbished" or "refurb" in s:
        return "Refurbished"
    if any(token in s for token in ("open box", "like new", "pre-owned", "preowned", "used", "parts", "not working", "for parts")):
        return "Used"
    return None


def clean_url(url: str) -> str:
    parts = urlsplit(str(url or "").strip())
    pairs = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key in TRACKING_KEYS:
            continue
        if any(key.startswith(prefix) for prefix in TRACKING_PREFIXES):
            continue
        pairs.append((key, value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(pairs), ""))


def build_listing_key(source: str, stable_id: object | None, url: str) -> str:
    stable = str(stable_id).strip() if stable_id is not None else ""
    return f"{source}:{stable or clean_url(url)}"


def apply_window(items: list[dict], win: dict) -> list[dict]:
    kept = []
    for item in items:
        price = item.get("price")
        distance = item.get("distance_mi")
        in_price = isinstance(price, (int, float)) and win["price_min"] <= price <= win["price_max"]
        in_radius = distance is None or (isinstance(distance, (int, float)) and distance <= win["radius_mi"])
        if in_price and in_radius:
            kept.append(item)
    return kept


def omit_empty(row: dict) -> dict:
    return {k: v for k, v in row.items() if v is not None}


def normalize_candidate(raw: dict, source: str, found_date: str) -> dict:
    if source not in ALLOWED_SOURCES:
        raise ValueError(f"illegal source: {source}")
    specs = parse_title(raw.get("title", ""))
    condition = map_condition(raw.get("condition"))
    listing_url = clean_url(raw["url"])
    row = {
        "name": str(raw.get("title", ""))[:120],
        "type": specs["type"] if specs["type"] in ALLOWED_TYPES else "Desktop",
        "condition": condition if condition in ALLOWED_CONDITIONS else None,
        "owned": False,
        "source": source,
        "status": "candidate",
        "found_date": found_date,
        "distance_mi": raw.get("distance_mi"),
        "listing_url": listing_url,
        "listing_key": build_listing_key(source, raw.get("stable_id"), listing_url),
        "gpu_model": specs["gpu_model"],
        "vram": specs["vram"],
        "ram": specs["ram"],
        "z": raw.get("price"),
    }
    return omit_empty(row)
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_listing_parse.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jaime/src
git add scripts/lib/__init__.py scripts/lib/listing_parse.py scripts/tests/test_listing_parse.py
git commit -m "feat: add marketplace listing parser" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 7: Airtable Python REST Client

**Files:**
- Create: `/home/jaime/src/scripts/lib/airtable_py.py`
- Test: `/home/jaime/src/scripts/tests/test_airtable_py.py`

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_airtable_py.py`:

```python
from scripts.lib.airtable_py import AirtableClient, CANDIDATE_FIELDS


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = "ERR" if status_code >= 400 else ""

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"{self.status_code}: {self.text}")


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}

    def get(self, url, params=None, timeout=None):
        self.calls.append(("GET", url, params, None, timeout))
        return self.responses.pop(0)

    def post(self, url, json=None, timeout=None):
        self.calls.append(("POST", url, None, json, timeout))
        return self.responses.pop(0)


def client(session):
    return AirtableClient(
        token="t",
        base_id="appLnCrA0kRqr9Di2",
        hardware_table="Hardware",
        control_table="Control",
        session=session,
    )


def test_list_existing_listing_keys_pages():
    session = FakeSession([
        FakeResponse({"records": [{"fields": {"listing_key": "eBay:1"}}], "offset": "next"}),
        FakeResponse({"records": [{"fields": {"listing_key": "OfferUp:2"}}, {"fields": {}}]}),
    ])
    assert client(session).list_existing_listing_keys() == {"eBay:1", "OfferUp:2"}
    assert session.calls[0][2]["fields[]"] == ["listing_key"]


def test_count_hardware_counts_all_records():
    session = FakeSession([
        FakeResponse({"records": [{"id": "1"}, {"id": "2"}], "offset": "next"}),
        FakeResponse({"records": [{"id": "3"}]}),
    ])
    assert client(session).count_hardware() == 3


def test_read_control_defaults_and_enabled_sources():
    session = FakeSession([
        FakeResponse({"records": [{"fields": {"enabled": True, "price_min": 300, "price_max": 900, "zipcode": "98052", "radius_mi": 75}}]}),
    ])
    control = client(session).read_control()
    assert control == {
        "enabled": True,
        "price_min": 300,
        "price_max": 900,
        "zipcode": "98052",
        "radius_mi": 75,
    }


def test_create_candidates_allowlists_omits_nulls_batches_and_never_typecasts():
    session = FakeSession([
        FakeResponse({"records": [{"id": str(i)} for i in range(10)]}),
        FakeResponse({"records": [{"id": "10"}]}),
    ])
    rows = [
        {"listing_key": f"Retailer:{i}", "name": "PC", "owned": False, "condition": None, "z": 500, "evil": "x"}
        for i in range(11)
    ]
    assert client(session).create_candidates(rows) == 11
    posts = [c for c in session.calls if c[0] == "POST"]
    assert len(posts) == 2
    first_payload = posts[0][3]
    assert "typecast" not in first_payload
    assert len(first_payload["records"]) == 10
    fields = first_payload["records"][0]["fields"]
    assert fields["listing_key"] == "Retailer:0"
    assert fields["owned"] is False
    assert "condition" not in fields
    assert "evil" not in fields


def test_candidate_field_allowlist_matches_schema_contract():
    assert CANDIDATE_FIELDS == [
        "name", "type", "condition", "owned", "source", "status", "found_date",
        "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_airtable_py.py -q
```

Expected: FAIL because `scripts.lib.airtable_py` does not exist.

- [ ] **Step 3: Write implementation**

Create `/home/jaime/src/scripts/lib/airtable_py.py`:

```python
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests

DEFAULT_WINDOW = {"price_min": 200, "price_max": 1000, "zipcode": "98052", "radius_mi": 100}
CANDIDATE_FIELDS = [
    "name", "type", "condition", "owned", "source", "status", "found_date",
    "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
]


def _num_or(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@dataclass
class AirtableClient:
    token: str
    base_id: str = "appLnCrA0kRqr9Di2"
    hardware_table: str = "Hardware"
    control_table: str = "Control"
    session: Any = None
    timeout: int = 20

    @classmethod
    def from_env(cls) -> "AirtableClient":
        token = os.environ.get("AIRTABLE_CI_TOKEN") or os.environ.get("AIRTABLE_TOKEN")
        if not token:
            raise RuntimeError("AIRTABLE_CI_TOKEN or AIRTABLE_TOKEN is required")
        return cls(
            token=token,
            base_id=os.environ.get("AIRTABLE_BASE_ID", "appLnCrA0kRqr9Di2"),
            hardware_table=os.environ.get("AIRTABLE_HARDWARE_TABLE", "Hardware"),
            control_table=os.environ.get("AIRTABLE_CONTROL_TABLE", "Control"),
        )

    def __post_init__(self):
        if self.session is None:
            self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})

    def _url(self, table: str) -> str:
        return f"https://api.airtable.com/v0/{self.base_id}/{table}"

    def list_existing_listing_keys(self) -> set[str]:
        keys: set[str] = set()
        offset = None
        while True:
            params: dict[str, Any] = {"pageSize": 100, "fields[]": ["listing_key"]}
            if offset:
                params["offset"] = offset
            res = self.session.get(self._url(self.hardware_table), params=params, timeout=self.timeout)
            res.raise_for_status()
            data = res.json()
            for record in data.get("records", []):
                key = record.get("fields", {}).get("listing_key")
                if key:
                    keys.add(str(key))
            offset = data.get("offset")
            if not offset:
                return keys

    def count_hardware(self) -> int:
        total = 0
        offset = None
        while True:
            params: dict[str, Any] = {"pageSize": 100}
            if offset:
                params["offset"] = offset
            res = self.session.get(self._url(self.hardware_table), params=params, timeout=self.timeout)
            res.raise_for_status()
            data = res.json()
            total += len(data.get("records", []))
            offset = data.get("offset")
            if not offset:
                return total

    def read_control(self) -> dict[str, Any]:
        res = self.session.get(self._url(self.control_table), params={"maxRecords": 1}, timeout=self.timeout)
        res.raise_for_status()
        fields = (res.json().get("records") or [{}])[0].get("fields", {})
        return {
            "enabled": bool(fields.get("enabled", False)),
            "price_min": _num_or(fields.get("price_min"), DEFAULT_WINDOW["price_min"]),
            "price_max": _num_or(fields.get("price_max"), DEFAULT_WINDOW["price_max"]),
            "zipcode": str(fields.get("zipcode") or DEFAULT_WINDOW["zipcode"]),
            "radius_mi": _num_or(fields.get("radius_mi"), DEFAULT_WINDOW["radius_mi"]),
        }

    def create_candidates(self, rows: list[dict[str, Any]]) -> int:
        created = 0
        for i in range(0, len(rows), 10):
            chunk = [{"fields": self._pick(row)} for row in rows[i:i + 10]]
            res = self.session.post(self._url(self.hardware_table), json={"records": chunk}, timeout=self.timeout)
            res.raise_for_status()
            created += len(res.json().get("records", []))
        return created

    @staticmethod
    def _pick(row: dict[str, Any]) -> dict[str, Any]:
        return {k: row[k] for k in CANDIDATE_FIELDS if row.get(k) is not None}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_airtable_py.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jaime/src
git add scripts/lib/airtable_py.py scripts/tests/test_airtable_py.py
git commit -m "feat: add airtable rest client for marketplace scraper" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 8: Saved-HTML Extraction And Site Playbooks

**Files:**
- Create: `/home/jaime/src/scripts/lib/marketplace_extract.py`
- Create: `/home/jaime/src/scripts/tests/test_marketplace_extract.py`
- Create fixtures and YAML variants listed in File Structure.

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_marketplace_extract.py`:

```python
from pathlib import Path

import yaml

from scripts.lib.marketplace_extract import extract_cards_from_html, parse_price, parse_distance

ROOT = Path(__file__).resolve().parents[2]


def test_extract_cards_from_saved_fixtures():
    html = (ROOT / "scripts" / "tests" / "fixtures" / "craigslist.html").read_text()
    cards = extract_cards_from_html(html, "craigslist")
    assert cards == [{
        "stable_id": "7711223344",
        "title": "Dell Optiplex RTX 3060 12GB VRAM 32GB RAM",
        "price": 450,
        "url": "https://seattle.craigslist.org/see/sys/d/seattle-dell/7711223344.html",
        "condition": "used",
        "distance_mi": 18.0,
    }]


def test_price_and_distance_parsers():
    assert parse_price("$1,050") == 1050
    assert parse_price("free") is None
    assert parse_distance("ships") is None
    assert parse_distance("12.4 mi") == 12.4


def test_all_marketplace_playbooks_have_marketplace_search_goal_and_selectors():
    variants = [
        "facebook_marketplace_search_v1.yaml",
        "offerup_search_v1.yaml",
        "craigslist_search_v1.yaml",
        "bestbuy_openbox_search_v1.yaml",
        "woot_search_v1.yaml",
        "microcenter_search_v1.yaml",
        "newegg_refurb_search_v1.yaml",
        "backmarket_search_v1.yaml",
        "amazon_renewed_search_v1.yaml",
    ]
    for name in variants:
        data = yaml.safe_load((ROOT / "_pattern" / "_sites" / "variants" / name).read_text())
        assert data["goal"] == "marketplace_search"
        assert data["status"] in {"experimental", "best_effort"}
        assert data["extraction"]["result_selectors"]
        assert any(step["kind"] == "goto" for step in data["steps"])
```

- [ ] **Step 2: Add fixtures**

Create `/home/jaime/src/scripts/tests/fixtures/craigslist.html`:

```html
<html><body>
  <li class="cl-static-search-result" data-pid="7711223344">
    <a href="https://seattle.craigslist.org/see/sys/d/seattle-dell/7711223344.html">
      <div class="title">Dell Optiplex RTX 3060 12GB VRAM 32GB RAM</div>
      <div class="price">$450</div>
      <div class="location">18 mi</div>
      <div class="condition">used</div>
    </a>
  </li>
</body></html>
```

Create the other five first-wave fixtures with the same attributes so tests can expand without network:

```html
<html><body>
  <article data-listing-id="fixture-1">
    <a href="https://example.test/item/fixture-1">
      <h3>Lenovo Legion laptop RTX 4060 8GB VRAM 32GB RAM</h3>
      <span class="price">$799</span>
      <span class="distance">ships</span>
      <span class="condition">open box</span>
    </a>
  </article>
</body></html>
```

Write that content to:

```bash
/home/jaime/src/scripts/tests/fixtures/facebook_marketplace.html
/home/jaime/src/scripts/tests/fixtures/offerup.html
/home/jaime/src/scripts/tests/fixtures/bestbuy_openbox.html
/home/jaime/src/scripts/tests/fixtures/woot.html
/home/jaime/src/scripts/tests/fixtures/microcenter.html
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_marketplace_extract.py -q
```

Expected: FAIL because extractor and YAML variants do not exist.

- [ ] **Step 4: Write extractor**

Create `/home/jaime/src/scripts/lib/marketplace_extract.py`:

```python
from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urljoin


def parse_price(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"\$?\s*([0-9][0-9,]*)", text)
    return int(match.group(1).replace(",", "")) if match else None


def parse_distance(text: str | None) -> float | None:
    if not text:
        return None
    if "ship" in text.lower():
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*mi", text, re.I)
    return float(match.group(1)) if match else None


class CardParser(HTMLParser):
    def __init__(self, base_url: str = ""):
        super().__init__()
        self.base_url = base_url
        self.cards = []
        self.current = None
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        listing_id = attrs.get("data-pid") or attrs.get("data-listing-id")
        if tag in {"li", "article", "div"} and listing_id:
            self.current = {"stable_id": listing_id, "title": "", "price": None, "url": "", "condition": None, "distance_mi": None}
        if self.current is None:
            return
        classes = set((attrs.get("class") or "").split())
        if tag == "a" and attrs.get("href") and not self.current["url"]:
            self.current["url"] = urljoin(self.base_url, attrs["href"])
        if tag in {"h2", "h3"} or "title" in classes:
            self.capture = "title"
        elif "price" in classes:
            self.capture = "price"
        elif "condition" in classes:
            self.capture = "condition"
        elif "distance" in classes or "location" in classes:
            self.capture = "distance"

    def handle_data(self, data):
        if self.current is None or self.capture is None:
            return
        text = data.strip()
        if not text:
            return
        if self.capture == "title":
            self.current["title"] = (self.current["title"] + " " + text).strip()
        elif self.capture == "price":
            self.current["price"] = parse_price(text)
        elif self.capture == "condition":
            self.current["condition"] = text
        elif self.capture == "distance":
            self.current["distance_mi"] = parse_distance(text)

    def handle_endtag(self, tag):
        if self.capture and tag in {"div", "span", "h2", "h3"}:
            self.capture = None
        if self.current is not None and tag in {"li", "article", "div"}:
            if self.current.get("title") and self.current.get("price") is not None and self.current.get("url"):
                self.cards.append(self.current)
            self.current = None
            self.capture = None


def extract_cards_from_html(html: str, site: str, base_url: str = "") -> list[dict]:
    parser = CardParser(base_url=base_url)
    parser.feed(html)
    return parser.cards


def extract_cards_from_execute_data(data) -> list[dict]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        if isinstance(data.get("listings"), list):
            return data["listings"]
        if isinstance(data.get("html"), str):
            return extract_cards_from_html(data["html"], str(data.get("site", "")), str(data.get("base_url", "")))
        if isinstance(data.get("text"), str):
            return []
    return []
```

- [ ] **Step 5: Add YAML playbooks**

Create `/home/jaime/src/_pattern/_sites/variants/craigslist_search_v1.yaml`:

```yaml
site: craigslist
goal: marketplace_search
variant_id: craigslist.marketplace_search.v1
status: experimental
browser:
  engine: playwright
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://seattle.craigslist.org/search/sya?query={query}&postal={zipcode}&search_distance=100&min_price={price_min}&max_price={price_max}"
  - id: wait_results
    kind: wait
    selector: ".cl-static-search-result, .result-row"
extraction:
  primary: extract_results_text
  result_selectors:
    - ".cl-static-search-result"
    - ".result-row"
  completion_timeout_s: 15
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

Create `/home/jaime/src/_pattern/_sites/variants/facebook_marketplace_search_v1.yaml`:

```yaml
site: facebook
goal: marketplace_search
variant_id: facebook.marketplace_search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://www.facebook.com/marketplace/search/?query={query}&minPrice={price_min}&maxPrice={price_max}"
  - id: wait_results
    kind: wait
    selector: "a[href*='/marketplace/item/']"
  - id: scroll
    kind: keyboard
    key: PageDown
extraction:
  primary: extract_results_text
  result_selectors:
    - "a[href*='/marketplace/item/']"
    - "[role='main']"
  completion_timeout_s: 20
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

Create `/home/jaime/src/_pattern/_sites/variants/offerup_search_v1.yaml`:

```yaml
site: offerup
goal: marketplace_search
variant_id: offerup.marketplace_search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://offerup.com/search?q={query}&PRICE_MIN={price_min}&PRICE_MAX={price_max}&delivery_param=p"
  - id: wait_results
    kind: wait
    selector: "a[href*='/item/detail/'], article"
extraction:
  primary: extract_results_text
  result_selectors:
    - "a[href*='/item/detail/']"
    - "article"
  completion_timeout_s: 20
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

For retailer/refurb variants, create these six files with the same shape and site-specific URL:

`bestbuy_openbox_search_v1.yaml`

```yaml
site: bestbuy_openbox
goal: marketplace_search
variant_id: bestbuy.openbox_search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://www.bestbuy.com/site/searchpage.jsp?st={query}&qp=condition_facet%3DCondition~Open-Box"
  - id: wait_results
    kind: wait
    selector: ".sku-item, [data-testid='product-card']"
extraction:
  primary: extract_results_text
  result_selectors:
    - ".sku-item"
    - "[data-testid='product-card']"
  completion_timeout_s: 20
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

`woot_search_v1.yaml`

```yaml
site: woot
goal: marketplace_search
variant_id: woot.search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://www.woot.com/search?q={query}"
  - id: wait_results
    kind: wait
    selector: ".product-card, article"
extraction:
  primary: extract_results_text
  result_selectors:
    - ".product-card"
    - "article"
  completion_timeout_s: 20
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

`microcenter_search_v1.yaml`

```yaml
site: microcenter
goal: marketplace_search
variant_id: microcenter.search.v1
status: experimental
browser:
  engine: camoufox
  channel: chrome
headless: true
inputs:
  params:
    - key: query
      required: true
    - key: zipcode
      required: true
    - key: price_min
      required: true
    - key: price_max
      required: true
steps:
  - id: search
    kind: goto
    url: "https://www.microcenter.com/search/search_results.aspx?Ntt={query}"
  - id: wait_results
    kind: wait
    selector: ".product_wrapper, article"
extraction:
  primary: extract_results_text
  result_selectors:
    - ".product_wrapper"
    - "article"
  completion_timeout_s: 20
fitness:
  goal: marketplace_search
  required_gate_policy: soft
```

`newegg_refurb_search_v1.yaml`, `backmarket_search_v1.yaml`, and `amazon_renewed_search_v1.yaml` use `status: best_effort`, `engine: camoufox`, `goal: marketplace_search`, and URLs:

```yaml
url: "https://www.newegg.com/p/pl?d={query}&N=4814"
```

```yaml
url: "https://www.backmarket.com/en-us/search?q={query}"
```

```yaml
url: "https://www.amazon.com/s?k={query}+renewed"
```

Use result selectors respectively:

```yaml
result_selectors: [".item-cell", ".item-container"]
result_selectors: ["[data-test='product-card']", "article"]
result_selectors: ["[data-component-type='s-search-result']"]
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_marketplace_extract.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/jaime/src
git add scripts/lib/marketplace_extract.py scripts/tests/test_marketplace_extract.py scripts/tests/fixtures _pattern/_sites/variants/*marketplace_search_v1.yaml _pattern/_sites/variants/*openbox_search_v1.yaml _pattern/_sites/variants/woot_search_v1.yaml _pattern/_sites/variants/microcenter_search_v1.yaml _pattern/_sites/variants/newegg_refurb_search_v1.yaml _pattern/_sites/variants/backmarket_search_v1.yaml _pattern/_sites/variants/amazon_renewed_search_v1.yaml
git commit -m "feat: add marketplace scrape playbooks" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 9: Marketplace Scraper Orchestrator

**Files:**
- Create: `/home/jaime/src/scripts/marketplace_scraper.py`
- Test: `/home/jaime/src/scripts/tests/test_marketplace_scraper.py`

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_marketplace_scraper.py`:

```python
import asyncio

from scripts.marketplace_scraper import SOURCE_CONFIGS, run_once


class FakeAirtable:
    def __init__(self):
        self.created = []

    def read_control(self):
        return {"enabled": True, "price_min": 200, "price_max": 1000, "zipcode": "98052", "radius_mi": 100}

    def list_existing_listing_keys(self):
        return {"Craigslist:old"}

    def count_hardware(self):
        return 148

    def create_candidates(self, rows):
        self.created.extend(rows)
        return len(rows)


class FakeSession:
    def __init__(self):
        self.engine = object()


class FakeSessionFactory:
    def __init__(self):
        self.sites = []

    def __call__(self, site, **kwargs):
        self.sites.append((site, kwargs))
        return self

    async def __aenter__(self):
        return FakeSession()

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def fake_execute(site, intent, params, handle):
    if site == "offerup":
        return {"success": False, "error_kind": "login_wall", "error": "login required"}
    return {
        "success": True,
        "data": {"listings": [
            {"stable_id": "old", "title": "Old PC", "price": 500, "url": "https://cl.test/old", "distance_mi": 10, "condition": "used"},
            {"stable_id": "new", "title": "Dell PC RTX 4060 8GB VRAM 32GB RAM", "price": 600, "url": "https://cl.test/new?utm_source=x", "distance_mi": None, "condition": "used"},
            {"stable_id": "far", "title": "Far PC", "price": 600, "url": "https://cl.test/far", "distance_mi": 500, "condition": "used"},
        ]}
    }


def test_source_configs_include_required_sources():
    assert set(SOURCE_CONFIGS) == {
        "facebook_marketplace", "offerup", "craigslist",
        "bestbuy_openbox", "woot", "microcenter",
        "newegg_refurb", "backmarket", "amazon_renewed",
    }


def test_run_once_dedups_filters_caps_and_fails_soft():
    airtable = FakeAirtable()
    factory = FakeSessionFactory()
    result = asyncio.run(run_once(
        airtable=airtable,
        enabled_sources=["craigslist", "offerup"],
        session_factory=factory,
        execute_fn=fake_execute,
        sleep_fn=lambda _: None,
        jitter_fn=lambda: 0,
        found_date="2026-06-19",
        max_candidates=150,
    ))
    assert result["inserted"] == 1
    assert result["failures"] == {"offerup": "login_wall"}
    assert airtable.created[0]["listing_key"] == "Craigslist:new"
    assert airtable.created[0]["distance_mi"] is None
    assert airtable.created[0]["listing_url"] == "https://cl.test/new"
    assert factory.sites[0] == ("craigslist", {"backend": "camoufox", "headless": True})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_marketplace_scraper.py -q
```

Expected: FAIL because `scripts/marketplace_scraper.py` does not exist.

- [ ] **Step 3: Write implementation**

Create `/home/jaime/src/scripts/marketplace_scraper.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import logging
import os
import random
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None

from scripts.lib.airtable_py import AirtableClient
from scripts.lib.listing_parse import apply_window, normalize_candidate
from scripts.lib.marketplace_extract import extract_cards_from_execute_data

LOG = logging.getLogger("marketplace_scraper")
FAIL_SOFT = {"login_wall", "timeout", "selector_miss", "forbidden", "block", "server_error"}


@dataclass(frozen=True)
class SourceConfig:
    site: str
    source: str
    query: str = "gaming pc rtx"


SOURCE_CONFIGS = {
    "facebook_marketplace": SourceConfig(site="facebook", source="FB Marketplace"),
    "offerup": SourceConfig(site="offerup", source="OfferUp"),
    "craigslist": SourceConfig(site="craigslist", source="Craigslist"),
    "bestbuy_openbox": SourceConfig(site="bestbuy_openbox", source="Retailer"),
    "woot": SourceConfig(site="woot", source="Retailer"),
    "microcenter": SourceConfig(site="microcenter", source="Retailer"),
    "newegg_refurb": SourceConfig(site="newegg_refurb", source="Retailer"),
    "backmarket": SourceConfig(site="backmarket", source="Retailer"),
    "amazon_renewed": SourceConfig(site="amazon_renewed", source="Retailer"),
}


def default_enabled_sources() -> list[str]:
    raw = os.environ.get("MARKETPLACE_ENABLED_SOURCES")
    if raw:
        return [s.strip() for s in raw.split(",") if s.strip()]
    return list(SOURCE_CONFIGS)


def pacific_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")


async def _maybe_sleep(sleep_fn: Callable[[float], Any], seconds: float) -> None:
    result = sleep_fn(seconds)
    if isinstance(result, Awaitable):
        await result


async def scrape_source(config: SourceConfig, control: dict, session_factory, execute_fn) -> list[dict]:
    params = {
        "query": config.query,
        "zipcode": control["zipcode"],
        "price_min": control["price_min"],
        "price_max": control["price_max"],
        "radius_mi": control["radius_mi"],
    }
    async with session_factory(config.site, backend="camoufox", headless=True) as session:
        result = await execute_fn(config.site, "marketplace_search", params=params, handle=session.engine)
    if not result.get("success"):
        kind = result.get("error_kind") or "unknown"
        raise RuntimeError(f"{kind}: {result.get('error', '')}")
    return extract_cards_from_execute_data(result.get("data"))


async def run_once(
    *,
    airtable: AirtableClient,
    enabled_sources: list[str],
    session_factory,
    execute_fn,
    sleep_fn: Callable[[float], Any] = asyncio.sleep,
    jitter_fn: Callable[[], float] = lambda: random.uniform(1.5, 5.0),
    found_date: str | None = None,
    max_candidates: int = 150,
) -> dict[str, Any]:
    control = airtable.read_control()
    if not control.get("enabled"):
        return {"skipped": "disabled", "inserted": 0, "failures": {}}

    existing = airtable.list_existing_listing_keys()
    current_count = airtable.count_hardware()
    remaining = max(0, max_candidates - current_count)
    failures: dict[str, str] = {}
    candidates: list[dict] = []
    found = found_date or pacific_date()

    for source_name in enabled_sources:
        config = SOURCE_CONFIGS[source_name]
        try:
            raw = await scrape_source(config, control, session_factory, execute_fn)
            windowed = apply_window(raw, control)
            for item in windowed:
                row = normalize_candidate(item, config.source, found)
                if row["listing_key"] in existing:
                    continue
                existing.add(row["listing_key"])
                candidates.append(row)
                if len(candidates) >= remaining:
                    break
        except Exception as exc:
            text = str(exc)
            kind = text.split(":", 1)[0]
            failures[source_name] = kind
            if kind not in FAIL_SOFT:
                LOG.exception("source failed: %s", source_name)
            else:
                LOG.warning("source skipped: %s kind=%s", source_name, kind)
        if len(candidates) >= remaining:
            break
        await _maybe_sleep(sleep_fn, 5 + jitter_fn())

    inserted = airtable.create_candidates(candidates[:remaining]) if candidates and remaining > 0 else 0
    return {"inserted": inserted, "failures": failures, "scanned_sources": enabled_sources}


async def async_main() -> dict[str, Any]:
    if load_dotenv:
        load_dotenv()
    from _pattern._sites import execute
    from _util._browse.session import session_for

    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    airtable = AirtableClient.from_env()
    result = await run_once(
        airtable=airtable,
        enabled_sources=default_enabled_sources(),
        session_factory=session_for,
        execute_fn=execute,
        max_candidates=int(os.environ.get("MAX_CANDIDATES", "150")),
    )
    LOG.info("marketplace scrape result: %s", result)
    return result


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run orchestrator tests**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_marketplace_scraper.py -q
```

Expected: PASS.

- [ ] **Step 5: Run all S1 Python tests so far**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_listing_parse.py scripts/tests/test_airtable_py.py scripts/tests/test_marketplace_extract.py scripts/tests/test_marketplace_scraper.py scripts/tests/test_capture_cookie_targets.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/jaime/src
git add scripts/marketplace_scraper.py scripts/tests/test_marketplace_scraper.py
git commit -m "feat: add marketplace scraper orchestrator" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 10: systemd User Timer

**Files:**
- Create: `/home/jaime/src/command/systemd/marketplace-scrape.service`
- Create: `/home/jaime/src/command/systemd/marketplace-scrape.timer`
- Test: `/home/jaime/src/scripts/tests/test_systemd_units.py`

- [ ] **Step 1: Write the failing test**

Create `/home/jaime/src/scripts/tests/test_systemd_units.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_marketplace_scrape_service_uses_env_file_and_python_script():
    service = (ROOT / "command" / "systemd" / "marketplace-scrape.service").read_text()
    assert "Type=oneshot" in service
    assert "EnvironmentFile=%h/.config/kidscomputer/marketplace-scrape.env" in service
    assert "ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py" in service
    assert "AIRTABLE_CI_TOKEN" not in service


def test_marketplace_scrape_timer_is_nightly_and_persistent():
    timer = (ROOT / "command" / "systemd" / "marketplace-scrape.timer").read_text()
    assert "OnCalendar=*-*-* 04:30:00" in timer
    assert "Persistent=true" in timer
    assert "WantedBy=timers.target" in timer
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_systemd_units.py -q
```

Expected: FAIL because the units do not exist.

- [ ] **Step 3: Write service**

Create `/home/jaime/src/command/systemd/marketplace-scrape.service`:

```ini
[Unit]
Description=Deal Canvasser marketplace scrape
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=%h/src
EnvironmentFile=%h/.config/kidscomputer/marketplace-scrape.env
ExecStart=/usr/bin/python3 %h/src/scripts/marketplace_scraper.py
Nice=10
```

- [ ] **Step 4: Write timer**

Create `/home/jaime/src/command/systemd/marketplace-scrape.timer`:

```ini
[Unit]
Description=Nightly Deal Canvasser marketplace scrape

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=20m
Persistent=true
Unit=marketplace-scrape.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Run systemd tests**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_systemd_units.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/jaime/src
git add command/systemd/marketplace-scrape.service command/systemd/marketplace-scrape.timer scripts/tests/test_systemd_units.py
git commit -m "feat: schedule marketplace scraper locally" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

### Task 11: Final Verification Gate

**Files:**
- No new files.

- [ ] **Step 1: Run S0 verification**

Run:

```bash
cd /home/jaime/kids/computers
pnpm test -- --run
pnpm build
```

Expected: all vitest suites pass and Next build completes.

- [ ] **Step 2: Run S1 verification**

Run:

```bash
cd /home/jaime/src
PYTHONPATH=/home/jaime/src pytest scripts/tests/test_listing_parse.py scripts/tests/test_airtable_py.py scripts/tests/test_marketplace_extract.py scripts/tests/test_marketplace_scraper.py scripts/tests/test_capture_cookie_targets.py scripts/tests/test_systemd_units.py -q
```

Expected: all local tests pass with no live network.

- [ ] **Step 3: Verify Airtable schema**

Run the schema verification command from the "Airtable Schema Operations" section.

Expected: `listing_key` exists as `singleLineText`; `source` choices include `Retailer`.

- [ ] **Step 4: Optional one-source dry run after manual cookie setup**

After the user has seeded cookies and created the local env file:

```bash
cd /home/jaime/src
MARKETPLACE_ENABLED_SOURCES=craigslist python3 scripts/marketplace_scraper.py
```

Expected: script logs a result dict and does not crash. Candidate creation depends on live Craigslist output and current Airtable cap.

- [ ] **Step 5: Commit any verification-only adjustments**

Only if verification required edits:

```bash
git add <changed-files>
git commit -m "fix: pass phase 2 verification" -m "Co-Authored-By: claude-flow <ruv@ruv.net>" -m "Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

## Residual Risks

- The live Airtable schema must be changed through metadata tools before either writer sends `listing_key` or `source=Retailer`; otherwise no-typecast writes can 422.
- The `~/src` site factory returns text-oriented extraction today; the deterministic HTML/card extraction layer may need adaptation after the first real `execute()` payload is observed per site.
- Facebook and OfferUp login cookies can expire or trigger login walls; the agent fails soft and requires manual reseeding.
- Retailer anti-bot behavior can vary by IP and session; the local Camoufox path is free and pragmatic, but not guaranteed.
- WSL systemd user timers run only while WSL is active. eBay remains the only always-on cloud path.
- The current plan deliberately leaves existing v1 digest formatting keyed on `ebay_item_id`; Phase 2 local candidates land in Hardware, but digest generalization is not part of this brief.
