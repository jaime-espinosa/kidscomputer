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
