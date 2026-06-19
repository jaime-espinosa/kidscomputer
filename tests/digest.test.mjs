import { describe, it, expect, vi } from "vitest"
import { buildDigestBody, gatedLinks, runDigest } from "../scripts/digest.mjs"

const win = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

describe("gatedLinks", () => {
  it("builds search deep-links for each gated source using the window+zip", () => {
    const urls = gatedLinks(win).map((l) => l.url).join(" ")
    expect(urls).toContain("craigslist.org")
    expect(urls).toContain("facebook.com/marketplace")
    expect(urls).toContain("offerup.com")
    expect(urls).toMatch(/estatesales|hibid/)
    expect(urls).toContain("200")
    expect(urls).toContain("1000")
  })
})

describe("buildDigestBody", () => {
  it("lists candidates with derived fields only and appends gated links", () => {
    const body = buildDigestBody({
      candidates: [{ ebay_item_id: "1", title: "Dell PC", price: 500, distance_mi: 40, listing_url: "https://ebay.com/itm/1" }],
      window: win,
      capReached: false,
    })
    expect(body).toContain("Dell PC")
    expect(body).toContain("$500")
    expect(body).toContain("40 mi")
    expect(body).toContain("Human-loop")
    expect(body).not.toMatch(/seller|email|phone/i) // no PII leak
  })
  it("notes cap reached when set", () => {
    expect(buildDigestBody({ candidates: [], window: win, capReached: true })).toContain("cap reached")
  })
})

describe("runDigest cadence", () => {
  it("no-ops with zero outbound calls when fewer than 2 Pacific days since last digest", async () => {
    const listCandidatesSince = vi.fn()
    const postIssue = vi.fn()
    const r = await runDigest({
      control: { read: vi.fn(async () => ({ enabled: true, last_digest_date: "2026-06-30", ...win })), markDigest: vi.fn() },
      airtable: { listCandidatesSince },
      postIssue,
      now: new Date("2026-07-01T18:00:00Z"), // 11:00 PDT ≠ target 10 → off-hour
      pacificHourTarget: 10,
      minDays: 2,
      enabledEnv: "true",
    })
    expect(r.skipped).toBe("off-hour")
    expect(postIssue).not.toHaveBeenCalled()
    expect(listCandidatesSince).not.toHaveBeenCalled()
  })

  it("posts an issue and marks the digest when due", async () => {
    const postIssue = vi.fn(async () => {})
    const markDigest = vi.fn(async () => {})
    const r = await runDigest({
      control: { read: vi.fn(async () => ({ enabled: true, last_digest_date: "2026-06-25", ...win })), markDigest },
      airtable: { listCandidatesSince: vi.fn(async () => ({ candidates: [{ ebay_item_id: "1", title: "Dell PC", price: 500, distance_mi: 40, listing_url: "https://ebay.com/itm/1" }], capReached: false })) },
      postIssue,
      now: new Date("2026-07-01T17:30:00Z"), // 10:30 PDT → target 10
      pacificHourTarget: 10,
      minDays: 2,
      enabledEnv: "true",
    })
    expect(postIssue).toHaveBeenCalledTimes(1)
    expect(markDigest).toHaveBeenCalled()
    expect(r.posted).toBe(1)
  })
})
