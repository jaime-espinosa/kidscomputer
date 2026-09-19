export const CANDIDATE_FIELDS = [
  "name", "type", "condition", "owned", "source", "status", "found_date",
  "distance_mi", "listing_url", "listing_key", "ebay_item_id", "gpu_model", "vram", "ram", "z",
]

export function createAirtable({ token, baseId, table = "Hardware", fetchImpl = fetch }) {
  const base = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
  const auth = { Authorization: `Bearer ${token}` }

  async function listExistingIds() {
    const ids = new Set()
    let offset
    do {
      const url = new URL(base)
      url.searchParams.set("pageSize", "100")
      url.searchParams.set("fields[]", "ebay_item_id")
      if (offset) url.searchParams.set("offset", offset)
      const res = await fetchImpl(url.toString(), { headers: auth })
      if (!res.ok) throw new Error(`Airtable list ${res.status}: ${await res.text()}`)
      const data = await res.json()
      for (const r of data.records ?? []) {
        const id = r.fields?.ebay_item_id
        if (id) ids.add(String(id))
      }
      offset = data.offset
    } while (offset)
    return ids
  }

  async function listExistingKeys() {
    const keys = new Set()
    let offset
    do {
      const url = new URL(base)
      url.searchParams.set("pageSize", "100")
      url.searchParams.set("fields[]", "listing_key")
      if (offset) url.searchParams.set("offset", offset)
      const res = await fetchImpl(url.toString(), { headers: auth })
      if (!res.ok) throw new Error(`Airtable list ${res.status}: ${await res.text()}`)
      const data = await res.json()
      for (const r of data.records ?? []) {
        const k = r.fields?.listing_key
        if (k) keys.add(String(k))
      }
      offset = data.offset
    } while (offset)
    return keys
  }

  async function count() {
    let total = 0
    let offset
    do {
      const url = new URL(base)
      url.searchParams.set("pageSize", "100")
      if (offset) url.searchParams.set("offset", offset)
      const res = await fetchImpl(url.toString(), { headers: auth })
      if (!res.ok) throw new Error(`Airtable count ${res.status}: ${await res.text()}`)
      const data = await res.json()
      total += data.records?.length ?? 0
      offset = data.offset
    } while (offset)
    return total
  }

  async function create(rows) {
    let created = 0
    for (let i = 0; i < rows.length; i += 10) {
      const chunk = rows.slice(i, i + 10).map((row) => ({ fields: pick(row) }))
      const res = await fetchImpl(base, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ records: chunk }), // NO typecast — council [P0-3/4]
      })
      if (!res.ok) throw new Error(`Airtable create ${res.status}: ${await res.text()}`)
      const data = await res.json()
      created += data.records?.length ?? 0
    }
    return created
  }

  return { listExistingIds, listExistingKeys, count, create }
}

function pick(row) {
  const out = {}
  // Keep allow-listed keys whose value is present. Use explicit undefined/null checks (NOT truthiness)
  // so the falsy-but-legal checkbox value `owned: false` is preserved, not silently dropped.
  // null/undefined are omitted because Airtable singleSelect and number fields 422 on null with no typecast.
  for (const k of CANDIDATE_FIELDS) if (row[k] !== undefined && row[k] !== null) out[k] = row[k]
  return out
}
