import { describe, it, expect, vi } from "vitest"
import { reportHealth } from "../../scripts/lib/health.mjs"

function fakeGh(existing) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body ? JSON.parse(opts.body) : null })
    if (String(url).includes("/issues?")) return { ok: true, json: async () => existing }
    return { ok: true, json: async () => ({ number: 7 }) }
  })
  fn.calls = calls
  return fn
}

describe("reportHealth", () => {
  it("creates a new issue when none is open with the marker label", async () => {
    const gh = fakeGh([])
    await reportHealth({ repo: "o/r", token: "t", body: "boom", fetchImpl: gh })
    const post = gh.calls.find((c) => c.method === "POST")
    expect(post.url).toContain("/repos/o/r/issues")
    expect(post.body.title).toContain("Canvasser health")
    expect(post.body.labels).toContain("canvasser-health")
  })
  it("comments on the existing open issue instead of duplicating", async () => {
    const gh = fakeGh([{ number: 42, title: "Canvasser health" }])
    await reportHealth({ repo: "o/r", token: "t", body: "again", fetchImpl: gh })
    const post = gh.calls.find((c) => c.method === "POST")
    expect(post.url).toContain("/issues/42/comments")
  })
})
