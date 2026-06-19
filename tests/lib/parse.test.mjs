import { describe, it, expect } from "vitest"
import { parseTitle } from "../../scripts/lib/parse.mjs"

describe("parseTitle", () => {
  it("extracts ram / vram / gpu_model from a typical listing title", () => {
    const out = parseTitle("Dell XPS 15 RTX 4060 8GB VRAM 32GB RAM i7 1TB SSD")
    expect(out.ram).toBe(32)
    expect(out.vram).toBe(8)
    expect(out.gpu_model).toContain("RTX 4060")
  })
  it("classifies laptop vs desktop", () => {
    expect(parseTitle("Lenovo ThinkPad laptop").type).toBe("Laptop")
    expect(parseTitle("Dell Precision tower desktop").type).toBe("Desktop")
  })
  it("returns nulls when nothing is parseable (never throws)", () => {
    const out = parseTitle("Old computer for parts")
    expect(out.ram).toBeNull()
    expect(out.vram).toBeNull()
    expect(out.gpu_model).toBeNull()
  })
})
