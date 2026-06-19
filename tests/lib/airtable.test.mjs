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
  it("pages and returns the set of ebay_item_id values", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ fields: { ebay_item_id: "1" } }], offset: "o1" } },
      { body: { records: [{ fields: { ebay_item_id: "2" } }] } },
    ])
    const ids = await at(fetch).listExistingIds()
    expect([...ids].sort()).toEqual(["1", "2"])
  })
})

describe("airtable.create", () => {
  it("strips non-allowlisted fields, keeps owned:false (checkbox boolean), and NEVER sends typecast", async () => {
    const fetch = fakeFetch([{ body: { records: [{ id: "rec1" }] } }])
    await at(fetch).create([{ ebay_item_id: "123", z: 500, evil: "DROP TABLE", title: "X", price: 500, owned: false }])
    const sent = fetch.calls[0].body
    expect(sent.typecast).toBeUndefined()
    expect(Object.keys(sent.records[0].fields)).toEqual(
      expect.arrayContaining(["ebay_item_id", "z", "owned"]),
    )
    // non-schema keys (NOT in CANDIDATE_FIELDS) must be stripped — title/price/evil are not Hardware fields
    // and would 422 the no-typecast write if sent.
    expect(sent.records[0].fields.evil).toBeUndefined()
    expect(sent.records[0].fields.title).toBeUndefined()
    expect(sent.records[0].fields.price).toBeUndefined()
    // owned is a checkbox/boolean: the falsy value false must NOT be dropped by the allowlist pick()
    expect(sent.records[0].fields.owned).toBe(false)
  })
  it("batches in chunks of 10", async () => {
    const fetch = fakeFetch([{ body: { records: [] } }, { body: { records: [] } }])
    const rows = Array.from({ length: 15 }, (_, i) => ({ ebay_item_id: String(i), z: 300 }))
    await at(fetch).create(rows)
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[0].body.records).toHaveLength(10)
    expect(fetch.calls[1].body.records).toHaveLength(5)
  })
  it("CANDIDATE_FIELDS matches the v2 data model", () => {
    expect(CANDIDATE_FIELDS).toEqual([
      "name", "type", "condition", "owned", "source", "status", "found_date",
      "distance_mi", "listing_url", "ebay_item_id", "gpu_model", "vram", "ram", "z",
    ])
  })
  it("omits null/undefined fields (e.g. condition:null, distance_mi:null) but keeps owned:false", async () => {
    // eBay normalize() emits condition:null for unmapped conditions and distance_mi:null for ship-only.
    // With NO typecast, sending null to a singleSelect or number field would 422 — must be omitted.
    const fetch = fakeFetch([{ body: { records: [{ id: "rec2" }] } }])
    await at(fetch).create([{
      owned: false,
      condition: null,
      distance_mi: null,
      ebay_item_id: "1",
      name: "GPU",
      z: 400,
    }])
    const fields = fetch.calls[0].body.records[0].fields
    // null-valued fields must be absent
    expect(fields).not.toHaveProperty("condition")
    expect(fields).not.toHaveProperty("distance_mi")
    // owned:false must survive (falsy but not null/undefined)
    expect(fields.owned).toBe(false)
    // other present fields must survive
    expect(fields.ebay_item_id).toBe("1")
    expect(fields.name).toBe("GPU")
    expect(fields.z).toBe(400)
  })
})
