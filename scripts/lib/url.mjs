const STRIP = [/^utm_/i, /^campid$/i, /^mkcid$/i, /^mkrid$/i, /^mkevt$/i, /^_trkparms$/i, /^_trksid$/i]

export function cleanUrl(input) {
  let u
  try {
    u = new URL(input)
  } catch {
    return input
  }
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP.some((re) => re.test(key))) u.searchParams.delete(key)
  }
  const qs = u.searchParams.toString()
  return `${u.origin}${u.pathname}${qs ? `?${qs}` : ""}`
}
