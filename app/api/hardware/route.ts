import { NextResponse } from "next/server"

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE_ID = process.env.AIRTABLE_BASE_ID
const TABLE = process.env.AIRTABLE_TABLE || "Hardware"

const configured = Boolean(TOKEN && BASE_ID)

function api(path = "") {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`
}

function safeParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

// Airtable can return objects for AI-generated cells ({ state, value, isStale })
// or formula errors ({ error: "#ERROR!" }). Unwrap them to a plain scalar.
function cell(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("error" in obj) return null
    if ("value" in obj) return obj.value
  }
  return value
}

function str(value: unknown, fallback = ""): string {
  const v = cell(value)
  return v == null || v === "" ? fallback : String(v)
}

function num(value: unknown, fallback = 0): number {
  const v = cell(value)
  const n = typeof v === "string" ? Number.parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : fallback
}

// Map a raw Airtable record's fields to the dashboard schema, deriving
// metrics when they are missing.
function mapRecord(fields: Record<string, unknown>) {
  const vram = num(fields.vram)
  const ram = num(fields.ram)
  const g3d = num(fields.g3d)
  const z = num(fields.z)

  const agents = fields.agents != null ? num(fields.agents) : vram > 0 ? Math.floor(vram / 2) : 1
  const fps = fields.fps != null ? num(fields.fps) : Math.floor(g3d * 0.015)
  const mem_per_dollar =
    fields.mem_per_dollar != null ? num(fields.mem_per_dollar) : z > 0 ? Math.round(((ram + vram) / z) * 1000) / 1000 : 0

  // Purchases / reviews: prefer the JSON columns, fall back to the single-link columns
  let purchases = safeParse<Array<{ merchant: string; url: string; price: number }>>(fields.purchases, [])
  if (purchases.length === 0 && str(fields.purchase_link_1)) {
    purchases = [{ merchant: "Retailer", url: str(fields.purchase_link_1), price: z }]
  }
  let reviews = safeParse<Array<{ title: string; url: string }>>(fields.reviews, [])
  if (reviews.length === 0 && str(fields.review_link_1)) {
    reviews = [{ title: "Review", url: str(fields.review_link_1) }]
  }

  return {
    name: str(fields.name, "Unknown"),
    type: str(fields.type, "Laptop"),
    condition: str(fields.condition, "New"),
    owned: fields.owned === true || fields.owned === "Yes" ? "Yes" : "No",
    cpu: str(fields.cpu),
    gpu: str(fields.gpu),
    gpu_model: str(fields.gpu_model),
    vram,
    ram,
    ram_type: str(fields.ram_type),
    storage: str(fields.storage),
    storage_capacity_gb: num(fields.storage_capacity_gb),
    g3d,
    agents,
    fps,
    z,
    survivability: num(fields.survivability, 3),
    mem_per_dollar,
    ai_suitability_rating: str(fields.ai_suitability_rating),
    price_performance_score: num(fields.price_performance_score),
    hardware_summary: str(fields.hardware_summary),
    purchases,
    reviews,
  }
}

export async function GET() {
  if (!configured) {
    return NextResponse.json(
      { records: [], source: "sample", message: "Airtable env vars not set" },
      { status: 200 },
    )
  }

  try {
    const records: ReturnType<typeof mapRecord>[] = []
    let offset: string | undefined

    do {
      const url = new URL(api())
      url.searchParams.set("pageSize", "100")
      if (offset) url.searchParams.set("offset", offset)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}` },
        cache: "no-store",
      })

      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json(
          { records: [], source: "error", message: `Airtable ${res.status}: ${text.slice(0, 200)}` },
          { status: 200 },
        )
      }

      const data = (await res.json()) as {
        records?: Array<{ fields: Record<string, unknown> }>
        offset?: string
      }
      for (const rec of data.records ?? []) records.push(mapRecord(rec.fields))
      offset = data.offset
    } while (offset)

    return NextResponse.json({ records, source: "airtable" })
  } catch (err) {
    return NextResponse.json(
      { records: [], source: "error", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 200 },
    )
  }
}
