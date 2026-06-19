import { describe, it, expect } from "vitest"
import * as route from "../../app/api/hardware/route"

describe("/api/hardware", () => {
  it("exports GET", () => {
    expect(typeof route.GET).toBe("function")
  })
  it("does NOT export POST (write hole removed) [P0-3]", () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined()
  })
})
