import { describe, it, expect } from "vitest"
import { cleanUrl } from "../../scripts/lib/url.mjs"

describe("cleanUrl", () => {
  it("drops utm_* / campid / mkcid / mkrid / mkevt / _trkparms / _trksid tracking params", () => {
    const dirty =
      "https://www.ebay.com/itm/123456789012?utm_source=x&campid=5338&mkcid=1&_trkparms=abc&hash=keep"
    expect(cleanUrl(dirty)).toBe("https://www.ebay.com/itm/123456789012?hash=keep")
  })
  it("strips all query when nothing survives", () => {
    expect(cleanUrl("https://www.ebay.com/itm/999?utm_source=x")).toBe("https://www.ebay.com/itm/999")
  })
  it("returns input unchanged when not a URL", () => {
    expect(cleanUrl("not a url")).toBe("not a url")
  })
})
