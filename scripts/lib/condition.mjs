// Live Hardware.condition is a singleSelect with EXACTLY these choices.
// airtable.create sends NO typecast, so any other string 422s the batch — map first.
export const ALLOWED_CONDITIONS = ["New", "Refurbished", "Used"]

export function mapCondition(raw) {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  // exact legal values (any case)
  if (s === "new") return "New"
  if (s === "refurbished") return "Refurbished"
  if (s === "used") return "Used"
  // eBay "New …" variants (new other / new with defects) → New
  if (s.startsWith("new")) return "New"
  // any refurbished phrasing (seller/manufacturer/certified refurbished)
  if (s.includes("refurb")) return "Refurbished"
  // everything else that clearly means second-hand → Used
  if (
    s.includes("open box") ||
    s.includes("like new") ||
    s.includes("pre-owned") ||
    s.includes("preowned") ||
    s.includes("used") ||
    s.includes("parts") ||
    s.includes("not working") ||
    s.includes("for parts")
  ) {
    return "Used"
  }
  return null // unknown → omit the field rather than 422
}
