import { describe, it, expect } from "vitest"
import { createRateLimiter } from "../../lib/settings/ratelimit"

describe("createRateLimiter", () => {
  it("allows up to N then blocks within the window", () => {
    const t = 1000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t })
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(false)
  })
  it("refills after the window elapses", () => {
    let t = 0
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
    expect(rl.allow("a")).toBe(true)
    expect(rl.allow("a")).toBe(false)
    t = 1001
    expect(rl.allow("a")).toBe(true)
  })
  it("tracks IPs independently", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
    expect(rl.allow("a")).toBe(true)
    expect(rl.allow("b")).toBe(true)
  })
})
