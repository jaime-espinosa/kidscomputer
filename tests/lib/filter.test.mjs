import { describe, it, expect } from "vitest"
import { applyWindow, dedup, capInserts } from "../../scripts/lib/filter.mjs"

const mk = (id, price, dist) => ({ ebay_item_id: id, price, distance_mi: dist })

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
