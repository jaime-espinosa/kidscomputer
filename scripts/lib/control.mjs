export const DEFAULT_WINDOW = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

const numOr = (v, d) => {
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : d
}

export function resolveWindow(fields = {}) {
  return {
    price_min: numOr(fields.price_min, DEFAULT_WINDOW.price_min),
    price_max: numOr(fields.price_max, DEFAULT_WINDOW.price_max),
    zipcode: fields.zipcode ? String(fields.zipcode) : DEFAULT_WINDOW.zipcode,
    radius_mi: numOr(fields.radius_mi, DEFAULT_WINDOW.radius_mi),
  }
}
