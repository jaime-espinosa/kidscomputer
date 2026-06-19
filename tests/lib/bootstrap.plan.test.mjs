import { describe, it, expect } from "vitest"
import { planSchema, NEW_FIELDS, CONTROL_FIELDS } from "../../scripts/bootstrap.mjs"

describe("planSchema (idempotent diff)", () => {
  it("requests only the missing Hardware fields", () => {
    const plan = planSchema({ fields: ["name", "source", "status"], tables: ["Hardware"] })
    const names = plan.fieldsToCreate.map((f) => f.name)
    expect(names).not.toContain("source")
    expect(names).toContain("ebay_item_id")
    expect(names).toContain("distance_mi")
  })
  it("creates the Control table only when absent", () => {
    expect(planSchema({ fields: [], tables: ["Hardware"] }).createControl).toBe(true)
    expect(planSchema({ fields: [], tables: ["Hardware", "Control"] }).createControl).toBe(false)
  })
  it("covers all 6 new Hardware fields and 7 Control fields", () => {
    expect(NEW_FIELDS.map((f) => f.name)).toEqual([
      "source", "status", "found_date", "distance_mi", "listing_url", "ebay_item_id",
    ])
    expect(CONTROL_FIELDS.map((f) => f.name)).toEqual([
      "enabled", "last_canvass_pacific_date", "last_digest_date",
      "price_min", "price_max", "zipcode", "radius_mi",
    ])
  })
})
