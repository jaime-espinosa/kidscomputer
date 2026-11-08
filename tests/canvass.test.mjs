import { describe, it, expect, vi } from "vitest"
import { runCanvass } from "../scripts/canvass.mjs"

const win = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

function deps(overrides = {}) {
  return {
    control: {
      read: vi.fn(async () => ({ enabled: true, last_canvass_pacific_date: "", ...win })),
      markRan: vi.fn(async () => {}),
    },
    ebay: {
      // ebay.search returns ALREADY-NORMALIZED items: condition is a legal singleSelect choice or null.
      search: vi.fn(async () => [
        { ebay_item_id: "1", title: "PC RTX 4060 8GB VRAM 32GB RAM", price: 500, url: "https://ebay.com/itm/1?utm_source=x", distance_mi: 40, condition: "Refurbished" },
        { ebay_item_id: "2", title: "Cheap", price: 100, url: "https://ebay.com/itm/2", distance_mi: 10, condition: null },
      ]),
    },
    airtable: { listExistingKeys: vi.fn(async () => new Set()), count: vi.fn(async () => 0), create: vi.fn(async () => 1) },
    health: vi.fn(async () => {}),
    now: new Date("2026-07-01T10:30:00Z"), // 03:30 PDT → hour matches target 3
    max: 150,
    pacificHourTarget: 3,
    enabledEnv: "true",
    ...overrides,
  }
}

describe("runCanvass", () => {
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

  it("NO-OPS with zero outbound calls when disabled", async () => {
    const d = deps({ control: { read: vi.fn(async () => ({ enabled: false, ...win })), markRan: vi.fn() } })
    const r = await runCanvass(d)
    expect(r.skipped).toBe("disabled")
    expect(d.ebay.search).not.toHaveBeenCalled()
    expect(d.airtable.listExistingKeys).not.toHaveBeenCalled()
  })

  it("NO-OPS with zero outbound calls when the Pacific hour does not match", async () => {
    const d = deps({ now: new Date("2026-07-01T18:00:00Z") }) // 11:00 PDT ≠ 3
    const r = await runCanvass(d)
    expect(r.skipped).toBe("off-hour")
    expect(d.ebay.search).not.toHaveBeenCalled()
  })

  it("reports health and rethrows on eBay failure (fail loud)", async () => {
    const d = deps({ ebay: { search: vi.fn(async () => { throw new Error("eBay token 401") }) } })
    await expect(runCanvass(d)).rejects.toThrow(/eBay token 401/)
    expect(d.health).toHaveBeenCalledWith(expect.stringContaining("eBay token 401"))
  })
})
