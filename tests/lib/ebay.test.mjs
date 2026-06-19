import { describe, it, expect, vi } from "vitest"
import { createEbayClient } from "../../scripts/lib/ebay.mjs"

function fakeFetch(responses) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts })
    const next = responses.shift()
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    }
  })
  fn.calls = calls
  return fn
}

describe("createEbayClient", () => {
  it("requests an OAuth token then sends the local-pickup search with required params/headers", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        body: {
          itemSummaries: [
            {
              itemId: "v1|123|0",
              legacyItemId: "123456789012",
              title: "Dell RTX 4060 8GB VRAM 32GB RAM",
              price: { value: "500.00" },
              itemWebUrl: "https://www.ebay.com/itm/123?campid=5338",
              condition: "Seller refurbished", // free-form eBay value — NOT a legal singleSelect choice
              distance: { value: "42.0", unit: "mi" },
              image: { imageUrl: "https://i.ebayimg.com/x.jpg" },
            },
          ],
        },
      },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    const items = await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })

    const tokenCall = fetch.calls[0]
    expect(tokenCall.url).toContain("/identity/v1/oauth2/token")

    const searchCall = fetch.calls[1]
    expect(searchCall.url).toContain("deliveryOptions=SELLER_ARRANGED_LOCAL_PICKUP")
    expect(searchCall.url).toContain("pickupPostalCode=98052")
    expect(searchCall.url).toContain("pickupRadius=100")
    expect(searchCall.url).toContain("price%3A%5B200..1000%5D") // price:[200..1000] encoded
    expect(searchCall.opts.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_US")
    expect(searchCall.opts.headers.Authorization).toBe("Bearer tok")

    expect(items[0]).toMatchObject({
      ebay_item_id: "123456789012",
      title: "Dell RTX 4060 8GB VRAM 32GB RAM",
      price: 500,
      distance_mi: 42,
      condition: "Refurbished", // normalized to a LEGAL singleSelect choice (no typecast needed)
    })
  })

  it("normalizes an unknown condition to null so the field is omitted (never a 422)", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        body: {
          itemSummaries: [
            { itemId: "v1|9|0", legacyItemId: "9", title: "PC", price: { value: "300.00" }, itemWebUrl: "https://ebay.com/itm/9", condition: "Weird", distance: { value: "5", unit: "mi" } },
          ],
        },
      },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    const items = await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    expect(items[0].condition).toBeNull()
  })

  it("reuses the cached token on a second search (no second token call)", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { itemSummaries: [] } },
      { body: { itemSummaries: [] } },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    expect(fetch.calls.filter((c) => c.url.includes("/oauth2/token"))).toHaveLength(1)
  })

  it("throws loudly on a non-ok token response (no swallow)", async () => {
    const fetch = fakeFetch([{ ok: false, status: 401, body: { error: "invalid_client" } }])
    const client = createEbayClient({ clientId: "bad", clientSecret: "bad", fetchImpl: fetch })
    await expect(
      client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }),
    ).rejects.toThrow(/eBay token 401/)
  })
})
