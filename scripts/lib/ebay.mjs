import { mapCondition } from "./condition.mjs"

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
const SCOPE = "https://api.ebay.com/oauth/api_scope"

export function createEbayClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let cached = { token: null, expiresAt: 0 }

  async function getToken() {
    if (cached.token && now() < cached.expiresAt) return cached.token
    if (!clientId || !clientSecret) throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET")
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    })
    if (!res.ok) throw new Error(`eBay token ${res.status}: ${await res.text()}`)
    const data = await res.json()
    // cache ~2h, refresh 5 min early
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) - 300) * 1000 }
    return cached.token
  }

  async function search(win, { limit = 100, attempt = 0 } = {}) {
    const token = await getToken()
    const url = new URL(BROWSE_URL)
    url.searchParams.set("q", "computer")
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("filter", `price:[${win.price_min}..${win.price_max}],priceCurrency:USD`)
    url.searchParams.set("deliveryOptions", "SELLER_ARRANGED_LOCAL_PICKUP")
    url.searchParams.set("pickupPostalCode", String(win.zipcode))
    url.searchParams.set("pickupRadius", String(win.radius_mi))
    url.searchParams.set("pickupRadiusUnit", "mi")

    const res = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    })
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * 2 ** attempt)
      return search(win, { limit, attempt: attempt + 1 })
    }
    if (!res.ok) throw new Error(`eBay browse ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return (data.itemSummaries ?? []).map(normalize)
  }

  return { search, getToken }
}

function normalize(it) {
  const price = it.price?.value != null ? Number(it.price.value) : null
  const dist = it.distance?.value != null ? Number(it.distance.value) : null
  return {
    ebay_item_id: String(it.legacyItemId ?? it.itemId ?? ""),
    title: it.title ?? "",
    price: Number.isFinite(price) ? price : null,
    url: it.itemWebUrl ?? "",
    distance_mi: Number.isFinite(dist) ? dist : null,
    // map eBay's free-form condition → a LEGAL Hardware singleSelect choice or null (omit).
    // airtable.create sends NO typecast, so the raw eBay string would 422 the batch.
    condition: mapCondition(it.condition),
    image: it.image?.imageUrl ?? "",
  }
}
