import { describe, it, expect, beforeEach, vi } from "vitest"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)
process.env.SETTINGS_SECRET = "pin1234"
process.env.AIRTABLE_TOKEN = "tok"
process.env.AIRTABLE_BASE_ID = "appLnCrA0kRqr9Di2"

import { GET, PUT } from "../../app/api/settings/route"

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => fetchMock.mockReset())

describe("/api/settings PUT", () => {
  const valid = { price_min: 300, price_max: 1500, zipcode: "98101", radius_mi: 75 }

  it("401 on missing PIN [P0-3]", async () => {
    const r = await PUT(req(valid))
    expect(r.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("401 on wrong PIN [P0-3]", async () => {
    const r = await PUT(req(valid, { "x-settings-secret": "wrong-pin" }))
    expect(r.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("429 when per-IP rate limit is exhausted [P0-3]", async () => {
    // Use a dedicated IP so the module-scope limiter (limit=10) is not shared
    // with other test IPs. Drive 10 allowed calls then assert the 11th is 429.
    const limitIp = "5.5.5.5"
    const limitReq = (body: unknown) =>
      new Request("http://x/api/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": limitIp,
          "x-settings-secret": "pin1234",
        },
        body: JSON.stringify(body),
      })

    // Each of the first 10 calls passes auth and hits the limiter (they may
    // return 400/502 for body/airtable reasons — that's fine; limiter counted).
    for (let i = 0; i < 10; i++) {
      fetchMock.mockReset()
      await PUT(limitReq({ price_min: 9, price_max: 1 })) // invalid body → 400 after limiter passes
    }

    // 11th call must be rate-limited before fetch is ever called.
    fetchMock.mockReset()
    const r = await PUT(limitReq(valid))
    expect(r.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("400 on invalid body", async () => {
    const r = await PUT(req({ price_min: 9, price_max: 1, zipcode: "x", radius_mi: 0 }, { "x-settings-secret": "pin1234" }))
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("200 writes ONLY the 4 fields with no typecast", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ records: [{ id: "recCtl" }] }) }) // find row
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "recCtl", fields: valid }) }) // patch
    const r = await PUT(req({ ...valid, owned: true, evil: "x" }, { "x-settings-secret": "pin1234" }))
    expect(r.status).toBe(200)
    const patchCall = fetchMock.mock.calls[1]
    const sent = JSON.parse(patchCall[1].body)
    expect(sent.typecast).toBeUndefined()
    expect(sent.fields).toEqual(valid)
    expect(sent.fields.owned).toBeUndefined()
  })
})

describe("/api/settings GET", () => {
  it("returns the current window", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ records: [{ id: "r", fields: { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 } }] }) })
    const r = await GET()
    const j = await r.json()
    expect(j).toMatchObject({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})
