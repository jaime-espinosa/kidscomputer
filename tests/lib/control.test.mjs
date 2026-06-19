import { describe, it, expect } from "vitest"
import { resolveWindow, DEFAULT_WINDOW } from "../../scripts/lib/control.mjs"

describe("DEFAULT_WINDOW", () => {
  it("matches the global constraint defaults", () => {
    expect(DEFAULT_WINDOW).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})

describe("resolveWindow", () => {
  it("fills blank fields with defaults", () => {
    expect(resolveWindow({})).toEqual(DEFAULT_WINDOW)
    expect(resolveWindow({ price_max: 1500 })).toEqual({ ...DEFAULT_WINDOW, price_max: 1500 })
  })
  it("coerces numeric strings and keeps zipcode as a string", () => {
    const w = resolveWindow({ price_min: "300", radius_mi: "50", zipcode: "98101" })
    expect(w.price_min).toBe(300)
    expect(w.radius_mi).toBe(50)
    expect(w.zipcode).toBe("98101")
  })
})
