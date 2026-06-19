const META = "https://api.airtable.com/v0/meta/bases"

export const NEW_FIELDS = [
  { name: "source", type: "singleSelect", options: { choices: ["eBay", "Craigslist", "FB Marketplace", "OfferUp", "Estate/Auction", "Manual"].map((name) => ({ name })) } },
  { name: "status", type: "singleSelect", options: { choices: ["candidate", "reviewing", "kept", "dismissed"].map((name) => ({ name })) } },
  { name: "found_date", type: "date", options: { dateFormat: { name: "iso" } } },
  { name: "distance_mi", type: "number", options: { precision: 1 } },
  { name: "listing_url", type: "url" },
  { name: "ebay_item_id", type: "singleLineText" },
]

export const CONTROL_FIELDS = [
  { name: "enabled", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  { name: "last_canvass_pacific_date", type: "singleLineText" },
  { name: "last_digest_date", type: "singleLineText" },
  { name: "price_min", type: "number", options: { precision: 0 } },
  { name: "price_max", type: "number", options: { precision: 0 } },
  { name: "zipcode", type: "singleLineText" },
  { name: "radius_mi", type: "number", options: { precision: 0 } },
]

export function planSchema({ fields, tables }) {
  const have = new Set(fields)
  return {
    fieldsToCreate: NEW_FIELDS.filter((f) => !have.has(f.name)),
    createControl: !tables.includes("Control"),
  }
}

// ---- network shell (exercised by manual `pnpm bootstrap`) ----
async function run() {
  const token = process.env.AIRTABLE_CI_TOKEN || process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID || "appLnCrA0kRqr9Di2"
  if (!token) throw new Error("AIRTABLE_CI_TOKEN (or AIRTABLE_TOKEN) required")
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const schemaRes = await fetch(`${META}/${baseId}/tables`, { headers })
  if (!schemaRes.ok) throw new Error(`schema read ${schemaRes.status}: ${await schemaRes.text()}`)
  const schema = await schemaRes.json()
  const hardware = schema.tables.find((t) => t.id === "tblnJoBqI7G2FaBke" || t.name === "Hardware")
  if (!hardware) throw new Error("Hardware table not found")
  const plan = planSchema({
    fields: hardware.fields.map((f) => f.name),
    tables: schema.tables.map((t) => t.name),
  })

  for (const f of plan.fieldsToCreate) {
    const res = await fetch(`${META}/${baseId}/tables/${hardware.id}/fields`, {
      method: "POST", headers, body: JSON.stringify(f),
    })
    if (!res.ok) throw new Error(`create field ${f.name} ${res.status}: ${await res.text()}`)
    console.log(`+ field ${f.name}`)
  }

  let controlId = schema.tables.find((t) => t.name === "Control")?.id
  if (plan.createControl) {
    const res = await fetch(`${META}/${baseId}/tables`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Control", fields: [{ name: "key", type: "singleLineText" }, ...CONTROL_FIELDS] }),
    })
    if (!res.ok) throw new Error(`create Control ${res.status}: ${await res.text()}`)
    controlId = (await res.json()).id
    console.log("+ table Control")
  }

  const recUrl = `https://api.airtable.com/v0/${baseId}/Control`
  const existing = await (await fetch(`${recUrl}?maxRecords=1`, { headers })).json()
  if (!existing.records?.length) {
    const seed = await fetch(recUrl, {
      method: "POST", headers,
      body: JSON.stringify({ records: [{ fields: { key: "singleton", enabled: true, price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 } }] }),
    })
    if (!seed.ok) throw new Error(`seed Control ${seed.status}: ${await seed.text()}`)
    console.log("+ seeded Control enabled=true (200/1000/98052/100)")
  }
  console.log("bootstrap complete (idempotent)", { controlId })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1) })
}
