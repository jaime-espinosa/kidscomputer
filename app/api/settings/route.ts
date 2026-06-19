import { NextResponse } from "next/server"
import { validateSettings } from "@/lib/settings/validate"
import { createRateLimiter } from "@/lib/settings/ratelimit"
import { resolveWindow } from "@/lib/settings/window"

const CONTROL = "Control"

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

function controlUrl(baseId: string, suffix = "") {
  return `https://api.airtable.com/v0/${baseId}/${CONTROL}${suffix}`
}
function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
}

export async function GET() {
  const TOKEN = process.env.AIRTABLE_TOKEN
  const BASE_ID = process.env.AIRTABLE_BASE_ID
  if (!TOKEN || !BASE_ID) return NextResponse.json(resolveWindow({}), { status: 200 })
  const res = await fetch(`${controlUrl(BASE_ID)}?maxRecords=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) return NextResponse.json(resolveWindow({}), { status: 200 })
  const data = await res.json()
  return NextResponse.json(resolveWindow(data.records?.[0]?.fields ?? {}))
}

export async function PUT(req: Request) {
  const SECRET = process.env.SETTINGS_SECRET
  const TOKEN = process.env.AIRTABLE_TOKEN
  const BASE_ID = process.env.AIRTABLE_BASE_ID

  if (!SECRET) return NextResponse.json({ error: "settings disabled" }, { status: 503 })
  if (req.headers.get("x-settings-secret") !== SECRET)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!limiter.allow(clientIp(req)))
    return NextResponse.json({ error: "rate limited" }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const result = validateSettings(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  if (!TOKEN || !BASE_ID) return NextResponse.json({ error: "airtable not configured" }, { status: 503 })
  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  const findRes = await fetch(`${controlUrl(BASE_ID)}?maxRecords=1`, { headers: auth, cache: "no-store" })
  if (!findRes.ok) return NextResponse.json({ error: "control read failed" }, { status: 502 })
  const id = (await findRes.json()).records?.[0]?.id
  if (!id) return NextResponse.json({ error: "control row missing (run bootstrap)" }, { status: 409 })

  const patch = await fetch(`${controlUrl(BASE_ID, `/${id}`)}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ fields: result.value }), // NO typecast  [P0-3]
  })
  if (!patch.ok) return NextResponse.json({ error: "control write failed" }, { status: 502 })
  return NextResponse.json({ ok: true, value: result.value })
}
