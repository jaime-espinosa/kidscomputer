const TZ = "America/Los_Angeles"

export function pacificDateString(now = new Date()) {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function pacificHour(now = new Date()) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).format(now)
  return Number(h) % 24
}

export function alreadyRanToday(storedDate, now = new Date()) {
  return Boolean(storedDate) && storedDate === pacificDateString(now)
}

export function daysSince(storedDate, now = new Date()) {
  if (!storedDate) return Infinity
  const a = Date.parse(`${storedDate}T00:00:00Z`)
  const b = Date.parse(`${pacificDateString(now)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}
