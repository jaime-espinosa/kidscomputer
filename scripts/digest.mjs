import { resolveWindow } from "./lib/control.mjs"
import { pacificHour, pacificDateString, daysSince } from "./lib/pacific.mjs"
import { reportHealth } from "./lib/health.mjs"

const DIGEST_LABEL = "canvasser-digest"
const GH_API = "https://api.github.com"

/** Open-or-update a single digest issue (mirrors health.mjs dedup pattern). */
export async function postOrUpdateDigestIssue({ repo, token, title, body, fetchImpl = fetch }) {
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY/GITHUB_TOKEN required")
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
  const listRes = await fetchImpl(`${GH_API}/repos/${repo}/issues?state=open&labels=${DIGEST_LABEL}`, { headers })
  const open = (await listRes.json()) ?? []

  if (Array.isArray(open) && open.length > 0) {
    const num = open[0].number
    await fetchImpl(`${GH_API}/repos/${repo}/issues/${num}/comments`, {
      method: "POST", headers, body: JSON.stringify({ body }),
    })
    return { issue: num, action: "comment" }
  }
  const createRes = await fetchImpl(`${GH_API}/repos/${repo}/issues`, {
    method: "POST", headers,
    body: JSON.stringify({ title, body, labels: ["canvasser", DIGEST_LABEL] }),
  })
  const created = await createRes.json()
  return { issue: created.number, action: "create" }
}

export function gatedLinks(win) {
  const q = encodeURIComponent("computer")
  return [
    { name: "Craigslist (Seattle)", url: `https://seattle.craigslist.org/search/sss?query=${q}&min_price=${win.price_min}&max_price=${win.price_max}&postal=${win.zipcode}&search_distance=${win.radius_mi}` },
    { name: "FB Marketplace", url: `https://www.facebook.com/marketplace/seattle/search/?query=${q}&minPrice=${win.price_min}&maxPrice=${win.price_max}&radius=${win.radius_mi}` },
    { name: "OfferUp", url: `https://offerup.com/search?q=${q}&price_min=${win.price_min}&price_max=${win.price_max}&radius=${win.radius_mi}` },
    // EstateSales.NET zip search — city/state not encoded in URL; zip+radius query form is the closest config-driven option
    { name: "EstateSales.NET", url: `https://www.estatesales.net/search?zip=${win.zipcode}&radius=${win.radius_mi}` },
    { name: "HiBid", url: `https://hibid.com/auctions?zip=${win.zipcode}&miles=${win.radius_mi}&q=${q}` },
  ]
}

export function buildDigestBody({ candidates, window, capReached }) {
  const lines = []
  lines.push(`## New eBay candidates (${candidates.length})`)
  if (candidates.length === 0) lines.push("_No new candidates this cycle._")
  for (const c of candidates) {
    const dist = typeof c.distance_mi === "number" ? `${c.distance_mi} mi` : "ships/unknown"
    lines.push(`- **${c.title}** — $${c.price} · ${dist} · [listing](${c.listing_url}) · \`${c.ebay_item_id}\``)
  }
  if (capReached) lines.push(`\n> cap reached — review candidates before the next run.`)
  lines.push(`\n## Human-loop (gated sources — search by hand, never scraped)`)
  for (const l of gatedLinks(window)) lines.push(`- [${l.name}](${l.url})`)
  lines.push(`\n_Window: $${window.price_min}–${window.price_max}, ${window.zipcode} / ${window.radius_mi}mi._`)
  return lines.join("\n")
}

export async function runDigest(deps) {
  const { control, airtable, postIssue, now, pacificHourTarget, minDays, enabledEnv } = deps
  const ctrl = await control.read()
  if (!ctrl.enabled || enabledEnv === "false") return { skipped: "disabled" }
  if (pacificHour(now) !== pacificHourTarget) return { skipped: "off-hour" }
  if (daysSince(ctrl.last_digest_date, now) < minDays) return { skipped: "cadence" }

  const window = resolveWindow(ctrl)
  const { candidates, capReached } = await airtable.listCandidatesSince(ctrl.last_digest_date)
  const body = buildDigestBody({ candidates, window, capReached })
  await postIssue({ title: `Deal digest — ${pacificDateString(now)}`, body })
  await control.markDigest(pacificDateString(now))
  return { posted: candidates.length, capReached }
}

async function main() {
  const baseId = process.env.AIRTABLE_BASE_ID || "appLnCrA0kRqr9Di2"
  const token = process.env.AIRTABLE_CI_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const ghToken = process.env.GITHUB_TOKEN
  const max = Number(process.env.MAX_CANDIDATES || 150)
  const controlUrl = `https://api.airtable.com/v0/${baseId}/Control`
  const hwUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(process.env.AIRTABLE_TABLE || "Hardware")}`
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const control = {
    read: async () => {
      const res = await fetch(`${controlUrl}?maxRecords=1`, { headers })
      if (!res.ok) throw new Error(`Control read ${res.status}: ${await res.text()}`)
      const rec = (await res.json()).records?.[0]
      return { id: rec?.id, ...(rec?.fields ?? { enabled: false }) }
    },
    markDigest: async (date) => {
      const res = await fetch(`${controlUrl}?maxRecords=1`, { headers })
      const id = (await res.json()).records?.[0]?.id
      if (!id) return
      await fetch(`${controlUrl}/${id}`, {
        method: "PATCH", headers, body: JSON.stringify({ fields: { last_digest_date: date } }),
      })
    },
  }

  const airtable = {
    listCandidatesSince: async (since) => {
      const candidates = []
      let offset
      const formula = since
        ? `AND({status}='candidate', IS_AFTER({found_date}, '${since}'))`
        : `{status}='candidate'`
      do {
        const url = new URL(hwUrl)
        url.searchParams.set("pageSize", "100")
        url.searchParams.set("filterByFormula", formula)
        // Only real Hardware fields — requesting non-existent fields (title/price) 422s the list.
        for (const f of ["name", "z", "distance_mi", "listing_url", "ebay_item_id", "found_date"]) url.searchParams.append("fields[]", f)
        if (offset) url.searchParams.set("offset", offset)
        const res = await fetch(url.toString(), { headers })
        if (!res.ok) throw new Error(`candidates list ${res.status}: ${await res.text()}`)
        const data = await res.json()
        for (const r of data.records ?? []) {
          const f = r.fields ?? {}
          candidates.push({ ebay_item_id: f.ebay_item_id, title: f.title ?? f.name, price: f.price ?? f.z, distance_mi: f.distance_mi, listing_url: f.listing_url })
        }
        offset = data.offset
      } while (offset)
      return { candidates, capReached: candidates.length >= max }
    },
  }

  const postIssue = ({ title, body }) =>
    postOrUpdateDigestIssue({ repo, token: ghToken, title, body })

  try {
    const result = await runDigest({
      control, airtable, postIssue,
      now: new Date(), pacificHourTarget: 10, minDays: 2, enabledEnv: process.env.CANVASSER_ENABLED,
    })
    console.log("digest:", JSON.stringify(result))
  } catch (err) {
    await reportHealth({ repo, token: ghToken, body: `Digest run failed: ${err.message}\n\n${err.stack ?? ""}` })
    throw err
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
