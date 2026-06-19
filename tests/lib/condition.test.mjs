import { describe, it, expect } from "vitest"
import { mapCondition, ALLOWED_CONDITIONS } from "../../scripts/lib/condition.mjs"

describe("mapCondition", () => {
  it("exposes exactly the live singleSelect choices", () => {
    expect(ALLOWED_CONDITIONS).toEqual(["New", "Refurbished", "Used"])
  })
  it("passes through the 3 legal values (case-insensitive)", () => {
    expect(mapCondition("New")).toBe("New")
    expect(mapCondition("used")).toBe("Used")
    expect(mapCondition("REFURBISHED")).toBe("Refurbished")
  })
  it("maps eBay refurbished variants to Refurbished", () => {
    expect(mapCondition("Seller refurbished")).toBe("Refurbished")
    expect(mapCondition("Manufacturer refurbished")).toBe("Refurbished")
    expect(mapCondition("Certified - Refurbished")).toBe("Refurbished")
  })
  it("maps used-ish / open-box / parts variants to Used", () => {
    expect(mapCondition("Open box")).toBe("Used")
    expect(mapCondition("Like New")).toBe("Used")
    expect(mapCondition("For parts or not working")).toBe("Used")
    expect(mapCondition("Pre-owned")).toBe("Used")
  })
  it("maps new-with-defects variants to New", () => {
    expect(mapCondition("New other (see details)")).toBe("New")
    expect(mapCondition("New with defects")).toBe("New")
  })
  it("returns null for blank/unknown so the field is OMITTED (never a 422)", () => {
    expect(mapCondition("")).toBeNull()
    expect(mapCondition(undefined)).toBeNull()
    expect(mapCondition("¯\\_(ツ)_/¯")).toBeNull()
  })
})
