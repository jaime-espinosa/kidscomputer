import { describe, it, expect } from "vitest"
import { applyWindow, dedup, capInserts } from "../../scripts/lib/filter.mjs"

const mk = (id, price, dist) => ({ ebay_item_id: id, price, distance_mi: dist })

describe("applyWindow", () => {
  it("keeps only price in [min,max] AND distance <= radius (null distance dropped)", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    const items = [mk("1", 150, 10), mk("2", 500, 50), mk("3", 500, 150), mk("4", 800, null)]
    expect(applyWindow(items, win).map((i) => i.ebay_item_id)).toEqual(["2"])
  })
})

describe("dedup", () => {
  it("removes items whose ebay_item_id already exists", () => {
    const existing = new Set(["2"])
    expect(dedup([mk("2", 1, 1), mk("3", 1, 1)], existing).map((i) => i.ebay_item_id)).toEqual(["3"])
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
