import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (p) => readFileSync(root + p, "utf8")

describe("vercel ignored-build wiring", () => {
  it("vercel.json runs the ignore script", () => {
    const vercel = read("vercel.json")
    expect(vercel).toContain("ignoreCommand")
    expect(vercel).toContain("scripts/vercel-ignore.mjs")
  })
  it("the ignore script only skips when every changed file is non-app (e.g. .github/last-run)", () => {
    const script = read("scripts/vercel-ignore.mjs")
    expect(script).toContain(".github/last-run")
    expect(script).toContain("VERCEL_GIT_PREVIOUS_SHA")
  })
})

describe("workflows: keepalive-first, SHA-pinned, least-priv", () => {
  for (const f of ["canvass", "digest"]) {
    const yml = read(`.github/workflows/${f}.yml`)
    it(`${f}: keepalive commits .github/last-run BEFORE the script step`, () => {
      const keepaliveAt = yml.indexOf(".github/last-run")
      const scriptAt = yml.indexOf(`scripts/${f}.mjs`)
      expect(keepaliveAt).toBeGreaterThan(-1)
      expect(scriptAt).toBeGreaterThan(keepaliveAt)
      expect(yml).toContain("[skip ci]")
      expect(yml).toContain("git pull --rebase")
    })
    it(`${f}: least-priv permissions + concurrency`, () => {
      expect(yml).toMatch(/permissions:\s*\n\s*contents: write\s*\n\s*issues: write/)
      expect(yml).toContain("concurrency:")
      expect(yml).toContain("cancel-in-progress: false")
    })
    it(`${f}: third-party actions are SHA-pinned`, () => {
      expect(yml).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683")
      expect(yml).toContain("pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d")
      expect(yml).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020")
    })
  }
  it("canvass cron = 0 10,11; digest cron = 0 17,18", () => {
    expect(read(".github/workflows/canvass.yml")).toContain('cron: "0 10,11 * * *"')
    expect(read(".github/workflows/digest.yml")).toContain('cron: "0 17,18 * * *"')
  })
})

describe("index.html search-settings panel", () => {
  const html = read("public/index.html")
  it("has the four window inputs + PIN input + save button", () => {
    for (const id of ["s-price-min", "s-price-max", "s-zip", "s-radius", "s-pin", "s-save"]) {
      expect(html).toContain(`id="${id}"`)
    }
  })
  it("reads PIN from localStorage and never hardcodes a PIN value", () => {
    expect(html).toContain("localStorage.getItem('settings_pin')")
    expect(html).toContain("localStorage.setItem('settings_pin'")
  })
  it("GETs and PUTs /api/settings with the secret header", () => {
    expect(html).toContain("fetch('/api/settings')")
    expect(html).toContain("'x-settings-secret'")
    expect(html).toContain("method: 'PUT'")
  })
})
