import { createEbayClient } from "./lib/ebay.mjs"
import { createAirtable } from "./lib/airtable.mjs"
import { parseTitle } from "./lib/parse.mjs"
import { applyWindow, dedup, capInserts } from "./lib/filter.mjs"
import { cleanUrl } from "./lib/url.mjs"
import { resolveWindow } from "./lib/control.mjs"
import { pacificHour, pacificDateString, alreadyRanToday } from "./lib/pacific.mjs"
import { reportHealth } from "./lib/health.mjs"

export async function runCanvass(deps) {
  const { control, ebay, airtable, health, now, max, pacificHourTarget, enabledEnv } = deps
  try {
    const ctrl = await control.read()
    if (!ctrl.enabled || enabledEnv === "false") return { skipped: "disabled" }
    if (pacificHour(now) !== pacificHourTarget) return { skipped: "off-hour" }
    if (alreadyRanToday(ctrl.last_canvass_pacific_date, now)) return { skipped: "already-ran" }

    const win = resolveWindow(ctrl)
    const raw = await ebay.search(win)
    const windowed = applyWindow(raw, win)
    const existing = await airtable.listExistingKeys()
    const currentCount = await airtable.count()
    const fresh = dedup(windowed, existing)
    const { toInsert, capReached } = capInserts(fresh, { currentCount, max })

    const rows = toInsert.map((i) => {
      const specs = parseTitle(i.title)
      return {
        name: i.title.slice(0, 120),
        type: specs.type,
        // i.condition is already a LEGAL singleSelect choice or null (mapped in ebay.normalize).
        // null is dropped by airtable.pick(), so the singleSelect is simply left empty — never a 422.
        condition: i.condition ?? undefined,
        owned: false, // checkbox/boolean — NOT the string "No" (would 422 with no typecast)
        source: "eBay",
        status: "candidate",
        found_date: pacificDateString(now),
        distance_mi: i.distance_mi,
        listing_url: cleanUrl(i.url),
        listing_key: `eBay:${i.ebay_item_id}`,
        ebay_item_id: i.ebay_item_id,
        z: i.price,
        gpu_model: specs.gpu_model ?? undefined,
        vram: specs.vram ?? undefined,
        ram: specs.ram ?? undefined,
      }
    })
    const inserted = rows.length ? await airtable.create(rows) : 0
    await control.markRan(pacificDateString(now))
    return { inserted, capReached, scanned: raw.length }
  } catch (err) {
    if (health) await health(`Canvass run failed: ${err.message}\n\n${err.stack ?? ""}`)
    throw err // fail loud — Actions emails on non-zero exit  [P1]
  }
}

async function main() {
  const baseId = process.env.AIRTABLE_BASE_ID || "appLnCrA0kRqr9Di2"
  const token = process.env.AIRTABLE_CI_TOKEN
  const air = createAirtable({ token, baseId, table: process.env.AIRTABLE_TABLE || "Hardware" })
  const controlUrl = `https://api.airtable.com/v0/${baseId}/Control`
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const control = {
    read: async () => {
      const res = await fetch(`${controlUrl}?maxRecords=1`, { headers })
      if (!res.ok) throw new Error(`Control read ${res.status}: ${await res.text()}`)
      const rec = (await res.json()).records?.[0]
      return { id: rec?.id, ...(rec?.fields ?? { enabled: false }) }
    },
    markRan: async (date) => {
      const res = await fetch(`${controlUrl}?maxRecords=1`, { headers })
      const id = (await res.json()).records?.[0]?.id
      if (!id) return
      await fetch(`${controlUrl}/${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ fields: { last_canvass_pacific_date: date } }),
      })
    },
  }

  const result = await runCanvass({
    control,
    ebay: createEbayClient({ clientId: process.env.EBAY_CLIENT_ID, clientSecret: process.env.EBAY_CLIENT_SECRET }),
    airtable: air,
    health: (body) => reportHealth({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, body }),
    now: new Date(),
    max: Number(process.env.MAX_CANDIDATES || 150),
    pacificHourTarget: 3,
    enabledEnv: process.env.CANVASSER_ENABLED,
  })
  console.log("canvass:", JSON.stringify(result))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
