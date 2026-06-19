import { describe, it, expect } from "vitest"
import { pacificDateString, pacificHour, alreadyRanToday, daysSince } from "../../scripts/lib/pacific.mjs"

describe("pacific helpers", () => {
  it("formats a UTC instant as the Pacific calendar date (DST aware)", () => {
    // 2026-07-01T06:30:00Z = 2026-06-30 23:30 PDT (UTC-7)
    expect(pacificDateString(new Date("2026-07-01T06:30:00Z"))).toBe("2026-06-30")
    // 2026-12-01T06:30:00Z = 2026-11-30 22:30 PST (UTC-8)
    expect(pacificDateString(new Date("2026-12-01T06:30:00Z"))).toBe("2026-11-30")
  })
  it("returns the Pacific hour 0-23 across DST", () => {
    expect(pacificHour(new Date("2026-07-01T10:00:00Z"))).toBe(3) // PDT
    expect(pacificHour(new Date("2026-12-01T11:00:00Z"))).toBe(3) // PST
  })
  it("alreadyRanToday compares stored date to today's Pacific date", () => {
    const now = new Date("2026-07-01T06:30:00Z")
    expect(alreadyRanToday("2026-06-30", now)).toBe(true)
    expect(alreadyRanToday("2026-06-29", now)).toBe(false)
    expect(alreadyRanToday("", now)).toBe(false)
  })
  it("daysSince counts elapsed Pacific calendar days across year boundaries", () => {
    const now = new Date("2027-01-01T07:00:00Z") // 2026-12-31 PST
    expect(daysSince("2026-12-29", now)).toBe(2)
    expect(daysSince("", now)).toBe(Infinity)
  })
})
