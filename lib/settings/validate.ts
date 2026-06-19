import type { SearchWindow } from "./window"

export type Result = { ok: true; value: SearchWindow } | { ok: false; error: string }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)

export function validateSettings(input: unknown): Result {
  if (typeof input !== "object" || input === null) return { ok: false, error: "body must be an object" }
  const o = input as Record<string, unknown>
  const { price_min, price_max, radius_mi, zipcode } = o

  if (![price_min, price_max, radius_mi].every(isInt)) return { ok: false, error: "prices/radius must be integers" }
  if ((price_min as number) < 0 || (price_max as number) < 0) return { ok: false, error: "prices must be >= 0" }
  if ((price_min as number) > (price_max as number)) return { ok: false, error: "price_min > price_max" }
  if ((radius_mi as number) < 1 || (radius_mi as number) > 500) return { ok: false, error: "radius_mi out of range" }
  if (typeof zipcode !== "string" || !/^\d{5}$/.test(zipcode)) return { ok: false, error: "zipcode must be 5 digits" }

  return { ok: true, value: { price_min: price_min as number, price_max: price_max as number, zipcode, radius_mi: radius_mi as number } }
}
