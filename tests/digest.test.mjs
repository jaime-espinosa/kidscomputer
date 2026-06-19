import { describe, it, expect, vi } from "vitest"
import { buildDigestBody, gatedLinks, runDigest, postOrUpdateDigestIssue } from "../scripts/digest.mjs"

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
  it("estatesales URL uses configured zipcode not a hardcoded city path", () => {
    const urls = gatedLinks({ ...win, zipcode: "90210" }).map((l) => l.url).join(" ")
    expect(urls).toContain("90210")
    expect(urls).not.toContain("Redmond")
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

  it("no-ops with zero outbound calls when hour matches but fewer than minDays elapsed (cadence branch)", async () => {
    const listCandidatesSince = vi.fn()
    const postIssue = vi.fn()
    // now = 2026-07-01T17:30:00Z → 10:30 PDT → hour 10 matches pacificHourTarget
    // last_digest_date = "2026-06-30" → daysSince = 1 < minDays=2 → cadence skip
    const r = await runDigest({
      control: { read: vi.fn(async () => ({ enabled: true, last_digest_date: "2026-06-30", ...win })), markDigest: vi.fn() },
      airtable: { listCandidatesSince },
      postIssue,
      now: new Date("2026-07-01T17:30:00Z"), // 10:30 PDT → hour 10 passes
      pacificHourTarget: 10,
      minDays: 2,
      enabledEnv: "true",
    })
    expect(r.skipped).toBe("cadence")
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

describe("postOrUpdateDigestIssue dedup", () => {
  it("comments on existing open digest issue instead of creating a new one", async () => {
    const fetchImpl = vi.fn()
    // First call: list open issues → returns one existing issue
    fetchImpl.mockResolvedValueOnce({ json: async () => [{ number: 42 }] })
    // Second call: POST comment → success
    fetchImpl.mockResolvedValueOnce({ json: async () => ({}) })

    const result = await postOrUpdateDigestIssue({
      repo: "owner/repo",
      token: "gh-token",
      title: "Deal digest — 2026-07-01",
      body: "## New eBay candidates",
      fetchImpl,
    })

    expect(result).toEqual({ issue: 42, action: "comment" })
    // Should only have been called twice: once to list, once to comment
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // The second call should POST a comment, not create a new issue
    const [, commentUrl] = fetchImpl.mock.calls[1]
    expect(fetchImpl.mock.calls[1][0]).toContain("/issues/42/comments")
    expect(commentUrl.method).toBe("POST")
    // Must NOT have called the /issues create endpoint
    const createCall = fetchImpl.mock.calls.find(
      ([url, opts]) => url.endsWith("/issues") && opts?.method === "POST"
    )
    expect(createCall).toBeUndefined()
  })

  it("creates a new issue when no open digest issue exists", async () => {
    const fetchImpl = vi.fn()
    fetchImpl.mockResolvedValueOnce({ json: async () => [] })
    fetchImpl.mockResolvedValueOnce({ json: async () => ({ number: 99 }) })

    const result = await postOrUpdateDigestIssue({
      repo: "owner/repo",
      token: "gh-token",
      title: "Deal digest — 2026-07-03",
      body: "## New eBay candidates",
      fetchImpl,
    })

    expect(result).toEqual({ issue: 99, action: "create" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
