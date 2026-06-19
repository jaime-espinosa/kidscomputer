export function applyWindow(items, win) {
  return items.filter(
    (i) =>
      typeof i.price === "number" &&
      i.price >= win.price_min &&
      i.price <= win.price_max &&
      typeof i.distance_mi === "number" &&
      i.distance_mi <= win.radius_mi,
  )
}

export function dedup(items, existingIds) {
  return items.filter((i) => !existingIds.has(String(i.ebay_item_id)))
}

export function capInserts(items, { currentCount, max }) {
  const room = Math.max(0, max - currentCount)
  const toInsert = items.slice(0, room)
  return { toInsert, capReached: items.length > room }
}
