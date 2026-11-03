export function applyWindow(items, win) {
  return items.filter(
    (i) =>
      typeof i.price === "number" &&
      i.price >= win.price_min &&
      i.price <= win.price_max &&
      // null/undefined distance = ships nationally / unknown → keep; numeric must be within radius
      (i.distance_mi == null || (typeof i.distance_mi === "number" && i.distance_mi <= win.radius_mi)),
  )
}

export function keyOf(item) {
  if (item.listing_key) return String(item.listing_key)
  if (item.ebay_item_id != null) return `eBay:${item.ebay_item_id}` // back-compat fallback
  return ""
}

export function dedup(items, existingKeys) {
  const seen = new Set(existingKeys)
  const result = []
  for (const item of items) {
    const key = keyOf(item)
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

export function capInserts(items, { currentCount, max }) {
  const room = Math.max(0, max - currentCount)
  const toInsert = items.slice(0, room)
  return { toInsert, capReached: items.length > room }
}
