import { describe, it, expect } from "vitest"
import { validateSettings } from "../../lib/settings/validate"
import { DEFAULT_WINDOW } from "../../lib/settings/window"

describe("DEFAULT_WINDOW", () => {
  it("matches the global constraint defaults", () => {
    expect(DEFAULT_WINDOW).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})

describe("validateSettings", () => {
  it("accepts a valid window and drops unknown keys", () => {
    const r = validateSettings({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100, owned: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
  it("rejects price_min > price_max", () => {
    expect(validateSettings({ price_min: 900, price_max: 200, zipcode: "98052", radius_mi: 50 }).ok).toBe(false)
  })
  it("rejects a 4-digit zip and a >500mi radius", () => {
    expect(validateSettings({ price_min: 1, price_max: 2, zipcode: "9805", radius_mi: 50 }).ok).toBe(false)
    expect(validateSettings({ price_min: 1, price_max: 2, zipcode: "98052", radius_mi: 9999 }).ok).toBe(false)
  })
  it("rejects negative / non-numeric prices", () => {
    expect(validateSettings({ price_min: -5, price_max: 100, zipcode: "98052", radius_mi: 10 }).ok).toBe(false)
    expect(validateSettings({ price_min: "x", price_max: 100, zipcode: "98052", radius_mi: 10 } as never).ok).toBe(false)
  })
})
