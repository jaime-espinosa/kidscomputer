# Implementation Plan — Nightly Computer-Deal Canvasser (v1, lean)

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Every task is a strict TDD loop: write the failing test → run it and confirm the stated failure → write minimal REAL implementation → run and confirm green → commit.

**Goal:** Build the lean v1 eBay local-pickup deal canvasser — nightly off-machine ingestion of used-computer listings ($200–1000 within 100 mi of 98052) into the Airtable `Hardware` base as reviewable `candidate` rows, a ~2-day GitHub-issue digest with human-loop deep-links for gated sources, a UI-settable search window via an authenticated settings endpoint, and cron liveness safeguards — honoring every council P0/P1 with no Phase-2 scope creep.

**Architecture:** Two independent runtimes, no shared process state. (1) **CI (Node ESM scripts under `scripts/`)** — `bootstrap.mjs` (one-time idempotent schema setup), `canvass.mjs` (nightly ingest), `digest.mjs` (~2-day issue digest), running in GitHub Actions (free on a public repo) and writing eBay candidates straight into Airtable from CI via `AIRTABLE_CI_TOKEN`. All pure logic (URL cleaning, title parsing, filter/dedup/cap, Pacific date guards, search-window resolution, eBay→Hardware condition mapping) lives in small testable `scripts/lib/*` modules with zero network. Because `airtable.create` sends **no `typecast`**, the canvass write only ever emits values already legal against the live Hardware schema — `owned: false` (checkbox boolean), `condition` mapped to one of `{New, Refurbished, Used}` or omitted, and `type` from `{Laptop, Desktop}` — so the spec's "candidates written into Hardware as `status=candidate`" goal actually succeeds on the real base rather than 422-ing. (2) **Vercel (Next.js App Router route handlers)** — `app/api/hardware/route.ts` keeps **GET only** (the unauthenticated POST write hole is removed). The single authenticated writer is `app/api/settings/route.ts`: `GET` returns the Control search window; `PUT` requires the `x-settings-secret` PIN, allow-lists exactly `{price_min, price_max, zipcode, radius_mi}`, validates, never uses `typecast`, and is per-IP rate-limited. `public/index.html` gains a Search-settings panel whose PIN lives only in `localStorage`.

**Tech Stack:** Node ESM (`.mjs`), Next.js 16 App Router (React 19, TypeScript 5.7), pnpm, **vitest** test runner (one runner for both `.mjs` scripts and `.ts` route handlers — see Test-tooling decision below), Airtable REST + Metadata API, eBay Browse API (client-credentials OAuth), GitHub REST (issues), GitHub Actions. No new website runtime dependencies.

---

## Global Constraints (copy these exact values — do not paraphrase)

- **Search-window defaults (used when Control fields are blank):** `price_min=200`, `price_max=1000`, `zipcode=98052`, `radius_mi=100`.
- **Airtable base:** `appLnCrA0kRqr9Di2`. **Hardware table:** `tblnJoBqI7G2FaBke` (primary field `name`). **Control table:** `Control` (created by bootstrap).
- **eBay:** marketplace header `X-EBAY-C-MARKETPLACE-ID: EBAY_US`; local-pickup only via `deliveryOptions=SELLER_ARRANGED_LOCAL_PICKUP` + `pickupPostalCode=98052` + `pickupRadius=100`; price filter `price:[200..1000]`; cache client-credentials token ~2h (refresh 5 min early).
- **Cap:** `MAX_CANDIDATES=150`, enforced at insert.
- **LIVE Hardware field types the candidate write MUST honor (verified against `appLnCrA0kRqr9Di2`/`tblnJoBqI7G2FaBke`; `airtable.create` sends NO `typecast`, so every written value must already be legal or Airtable 422s the whole batch):**
  - `owned` (`fldzCkBiMYMgt8sD3`) = **checkbox → boolean**. eBay finds are not owned ⇒ write **`owned: false`** (never the string `"No"`). (The GET route reads `fields.owned === true || fields.owned === "Yes"`, so `false`/absent both render as "No".)
  - `condition` (`fldNI5n2rptQaKvx9`) = **singleSelect**, choices exactly `{New, Refurbished, Used}`. eBay Browse returns free-form conditions ("For parts or not working", "Open box", "Seller refurbished", "Manufacturer refurbished", "Like New", etc.). Pass every eBay condition through `mapCondition` (Task 6) which returns one of the 3 choices or **`null`** (omit the field) — never the raw eBay string.
  - `type` (singleSelect) only ever receives `parseTitle`'s `"Laptop"`/`"Desktop"` — both are existing choices, so no mapping needed.
- **Cron (DST-safe, dual UTC hours):** canvass `0 10,11 * * *` (3am PT), digest `0 17,18 * * *` (10am PT). Each run no-ops unless the real Pacific hour matches and it has not already run that Pacific day; the no-op branch makes **zero outbound API calls**.
- **Runtime:** Node ESM throughout `scripts/`; Node 24 in CI.
- **Test-tooling decision:** **vitest** — the repo has TypeScript route handlers (`app/api/*/route.ts`) that `node --test` cannot run without a TS loader, and vitest runs the `.mjs` scripts too, giving one runner for both layers; it also makes `fetch`/`now`/`sleep` injection and assertion ergonomic.
- **File-layout decision:** keep all pure logic in small single-responsibility `scripts/lib/*` modules (url / parse / filter / pacific / control / ebay / airtable / health), and split the settings validator + rate limiter into `lib/settings/*` so route handlers stay thin. (This is Opus's decomposition; it is cleaner and more testable than the larger combined modules.)
- **Branch first** (repo is on `main`):

```bash
git checkout -b feat/deal-canvasser-v1
```

- **Commit footer — append to EVERY commit message body:**

```
Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk
```

> Throughout this plan, the commit commands show the subject line via `-m`; append the footer with a second `-m` block exactly as shown in Task 0 and replicate it on every commit.

---

## File Structure

```
computers/
├── app/
│   └── api/
│       ├── hardware/route.ts            # MODIFY: remove POST + unused NextRequest import  [P0-3]
│       └── settings/route.ts            # NEW: GET window / PUT (PIN auth + allowlist + ratelimit, no typecast)  [P0-3]
├── lib/
│   └── settings/
│       ├── window.ts                    # NEW: DEFAULT_WINDOW + resolveWindow (TS, single source of defaults)
│       ├── validate.ts                  # NEW: pure allow-list validator for the 4 search fields
│       └── ratelimit.ts                 # NEW: in-memory per-IP token bucket
├── scripts/
│   ├── bootstrap.mjs                    # NEW: idempotent schema + Control seed  [P0-5]
│   ├── canvass.mjs                      # NEW: nightly ingest orchestrator (fail-loud, zero-call no-op)
│   ├── digest.mjs                       # NEW: ~2-day GitHub-issue digest + gated deep-links  [P0-7]
│   ├── vercel-ignore.mjs               # NEW: ignore Vercel builds for keepalive/non-app commits  [P1]
│   └── lib/
│       ├── url.mjs                       # NEW: strip tracking params from listing_url  [P1]
│       ├── parse.mjs                     # NEW: title → specs regex parser (no AI)
│       ├── filter.mjs                    # NEW: price/distance filter + dedup + cap-at-insert  [P1]
│       ├── pacific.mjs                  # NEW: DST-safe Pacific date/hour + elapsed-days guards
│       ├── control.mjs                  # NEW: resolveWindow + DEFAULT_WINDOW (mjs, used by scripts)
│       ├── condition.mjs                # NEW: map eBay condition strings → Hardware singleSelect {New,Refurbished,Used}|null  [P0-4 typecast-safe]
│       ├── ebay.mjs                      # NEW: Browse client (local pickup, token cache, 429 backoff)  [P0-6]
│       ├── airtable.mjs                # NEW: REST list/create + strict allowlist + no typecast  [P0-4]
│       └── health.mjs                    # NEW: open/update "Canvasser health" issue  [P1]
├── tests/
│   ├── lib/url.test.mjs
│   ├── lib/parse.test.mjs
│   ├── lib/filter.test.mjs
│   ├── lib/pacific.test.mjs
│   ├── lib/control.test.mjs
│   ├── lib/condition.test.mjs
│   ├── lib/ebay.test.mjs
│   ├── lib/airtable.test.mjs
│   ├── lib/health.test.mjs
│   ├── lib/bootstrap.plan.test.mjs
│   ├── canvass.test.mjs
│   ├── digest.test.mjs
│   ├── settings/validate.test.ts
│   ├── settings/ratelimit.test.ts
│   ├── api/hardware.route.test.ts
│   ├── api/settings.route.test.ts
│   └── static/wiring.test.mjs            # workflows + index.html + vercel.json static assertions
├── .github/
│   ├── last-run                          # NEW: keepalive touch target  [P0-2]
│   └── workflows/
│       ├── canvass.yml                  # NEW: cron 3am PT, keepalive→canvass  [P0-2][P0-4]
│       ├── digest.yml                   # NEW: cron 10am PT, keepalive→digest  [P0-2][P0-4]
│       └── ci.yml                        # NEW: pnpm test + build on PR/push
├── public/
│   └── index.html                        # MODIFY: Search-settings panel + PIN (localStorage only)
├── vitest.config.ts                      # NEW
├── .env.example                          # NEW: documents required env (no secret values)
├── package.json                          # MODIFY: add vitest/dotenv (dev) + test/script entrypoints
└── vercel.json                           # MODIFY: ignoreCommand → scripts/vercel-ignore.mjs  [P1]
```

---

## P0/P1 → Task traceability

| Council finding | Where honored |
|---|---|
| P0-1 Vercel AI mispriced | Out of v1 (non-goal; Phase 2) — Architecture + spec §Non-goals |
| P0-2 dormancy↔60-day-disable deadlock | Task 15 keepalive-first commit (before any gate); Task 4 guards; Task 9 zero-call no-op |
| P0-3 unauthenticated writes | Task 10 (remove POST), Tasks 11–14 (PIN auth, allowlist, no typecast, rate-limit, UI panel) |
| P0-4 one over-scoped PAT | Task 7 (CI token + no typecast), Task 15 (split secrets, SHA-pinned actions, least-priv) |
| P0-5 no schema bootstrap | Task 8 |
| P0-6 eBay radius via local pickup | Task 6 |
| P0-7 Craigslist out of autonomous v1 | Task 13 (human-loop deep-links only) |
| P1 reaper/eviction | Deferred Phase 2; cap-at-insert (Task 3) prevents runaway |
| P1 dedup canonical id + strip tracking | Tasks 1, 3, 7 |
| P1 CSV redeploy storm | Task 16 ignoreCommand (+ no CSV in v1) |
| P1 silent failure | Tasks 5, 9 (fail loud + health issue) |
| P1 privacy/ToS derived fields only | Tasks 7, 13 |
| BLOCKER candidate writes must be legal against the LIVE base schema with **no typecast** (`owned`=checkbox/boolean, `condition`=singleSelect{New,Refurbished,Used}) | Task 6 (`condition.mjs` + `normalize` mapping), Task 7 (`owned` boolean test), Task 9 (canvass writes `owned:false` + mapped condition) |
| P2 digest cadence by elapsed Pacific days | Tasks 4 (`daysSince`), 13 |
| P2 eBay marketplace header + token cache | Task 6 |

---

## Task 0 — Test harness + script entrypoints

No business logic; establishes the TDD loop everything else uses.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

- [ ] **Step 1: Add dev deps**

```bash
pnpm add -D vitest@2.1.8 @vitest/coverage-v8@2.1.8 dotenv@16.4.7
```

- [ ] **Step 2: Replace the `"scripts"` block in `package.json`** with:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:scripts": "vitest run tests/lib tests/canvass.test.mjs tests/digest.test.mjs tests/static",
    "bootstrap": "node --env-file=.env.local scripts/bootstrap.mjs",
    "canvass": "node --env-file=.env.local scripts/canvass.mjs",
    "digest": "node --env-file=.env.local scripts/digest.mjs"
  },
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,mjs}"],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
})
```

- [ ] **Step 4: Create `.env.example`** (committed; documents env, contains NO secret values)

```bash
# --- Vercel (website) ---
AIRTABLE_TOKEN=               # base-scoped data.records:read+write (this base only)  [P0-4]
AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2
AIRTABLE_TABLE=Hardware
SETTINGS_SECRET=              # PIN that unlocks /api/settings PUT  [P0-3]

# --- GitHub Actions (CI canvasser) ---
AIRTABLE_CI_TOKEN=           # separate base-scoped read+write secret  [P0-4]
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
GITHUB_TOKEN=                # provided by the Actions runtime for issue creation
GITHUB_REPOSITORY=           # owner/repo, provided by Actions
MAX_CANDIDATES=150
CANVASSER_ENABLED=true
```

- [ ] **Step 5: Run the harness to confirm it is wired**

Run: `pnpm test`

Expected: exits 0 with `No test files found` (no tests authored yet) — acceptable; this only confirms vitest is installed and configured.

- [ ] **Step 6: Commit** (note the two `-m` blocks — replicate this footer on every commit)

```bash
git add package.json pnpm-lock.yaml vitest.config.ts .env.example
git commit -m "chore: add vitest harness + canvasser script entrypoints" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 1 — `url.mjs`: strip tracking params `[P1]`

Stored `listing_url` must be canonical so relists/tracking variants don't defeat dedup.

**Files:**
- Create: `scripts/lib/url.mjs`
- Test: `tests/lib/url.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/url.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { cleanUrl } from "../../scripts/lib/url.mjs"

describe("cleanUrl", () => {
  it("drops utm_* / campid / mkcid / mkrid / mkevt / _trkparms / _trksid tracking params", () => {
    const dirty =
      "https://www.ebay.com/itm/123456789012?utm_source=x&campid=5338&mkcid=1&_trkparms=abc&hash=keep"
    expect(cleanUrl(dirty)).toBe("https://www.ebay.com/itm/123456789012?hash=keep")
  })
  it("strips all query when nothing survives", () => {
    expect(cleanUrl("https://www.ebay.com/itm/999?utm_source=x")).toBe("https://www.ebay.com/itm/999")
  })
  it("returns input unchanged when not a URL", () => {
    expect(cleanUrl("not a url")).toBe("not a url")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/url.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/url.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/url.mjs`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/url.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/url.mjs tests/lib/url.test.mjs
git commit -m "feat(canvass): cleanUrl strips tracking params for stable listing_url [P1]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 2 — `parse.mjs`: title → specs (regex, no AI)

Non-goal compliance: candidates carry raw + regex-parsed fields only, no AI enrichment.

**Files:**
- Create: `scripts/lib/parse.mjs`
- Test: `tests/lib/parse.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/parse.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { parseTitle } from "../../scripts/lib/parse.mjs"

describe("parseTitle", () => {
  it("extracts ram / vram / gpu_model from a typical listing title", () => {
    const out = parseTitle("Dell XPS 15 RTX 4060 8GB VRAM 32GB RAM i7 1TB SSD")
    expect(out.ram).toBe(32)
    expect(out.vram).toBe(8)
    expect(out.gpu_model).toContain("RTX 4060")
  })
  it("classifies laptop vs desktop", () => {
    expect(parseTitle("Lenovo ThinkPad laptop").type).toBe("Laptop")
    expect(parseTitle("Dell Precision tower desktop").type).toBe("Desktop")
  })
  it("returns nulls when nothing is parseable (never throws)", () => {
    const out = parseTitle("Old computer for parts")
    expect(out.ram).toBeNull()
    expect(out.vram).toBeNull()
    expect(out.gpu_model).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/parse.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/parse.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/parse.mjs`**

```js
const GPU_RE = /\b(RTX|GTX|RX|Arc)\s?-?\s?(\d{3,4}\s?(?:Ti|XT|Super)?)\b/i
const VRAM_RE = /(\d{1,2})\s?GB\s?(?:GDDR\d?|VRAM|video)/i
const RAM_RE = /(\d{1,3})\s?GB\s?(?:DDR\d\s?)?RAM\b/i
const LAPTOP_RE = /\b(laptop|notebook|thinkpad|macbook|ideapad|legion(?!\s*tower))\b/i

export function parseTitle(title = "") {
  const t = String(title)
  const gpu = t.match(GPU_RE)
  const vram = t.match(VRAM_RE)
  const ram = t.match(RAM_RE)
  return {
    type: LAPTOP_RE.test(t) ? "Laptop" : "Desktop",
    gpu_model: gpu ? `${gpu[1].toUpperCase()} ${gpu[2].replace(/\s+/g, " ").trim()}` : null,
    vram: vram ? Number(vram[1]) : null,
    ram: ram ? Number(ram[1]) : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/parse.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/parse.mjs tests/lib/parse.test.mjs
git commit -m "feat(canvass): parseTitle regex spec extraction (no AI)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 3 — `filter.mjs`: price/distance filter + dedup + cap `[P1]`

The council's anti-runaway requirements: dedup on canonical `ebay_item_id`, cap enforced at insert, distance honored (null distance = ships/unknown → dropped).

**Files:**
- Create: `scripts/lib/filter.mjs`
- Test: `tests/lib/filter.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/filter.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { applyWindow, dedup, capInserts } from "../../scripts/lib/filter.mjs"

const mk = (id, price, dist) => ({ ebay_item_id: id, price, distance_mi: dist })

describe("applyWindow", () => {
  it("keeps only price in [min,max] AND distance <= radius (null distance dropped)", () => {
    const win = { price_min: 200, price_max: 1000, radius_mi: 100 }
    const items = [mk("1", 150, 10), mk("2", 500, 50), mk("3", 500, 150), mk("4", 800, null)]
    expect(applyWindow(items, win).map((i) => i.ebay_item_id)).toEqual(["2"])
  })
})

describe("dedup", () => {
  it("removes items whose ebay_item_id already exists", () => {
    const existing = new Set(["2"])
    expect(dedup([mk("2", 1, 1), mk("3", 1, 1)], existing).map((i) => i.ebay_item_id)).toEqual(["3"])
  })
})

describe("capInserts", () => {
  it("inserts only up to MAX - currentCount, reporting capReached", () => {
    const r = capInserts([mk("a"), mk("b"), mk("c")], { currentCount: 148, max: 150 })
    expect(r.toInsert).toHaveLength(2)
    expect(r.capReached).toBe(true)
  })
  it("inserts all when under cap", () => {
    const r = capInserts([mk("a")], { currentCount: 0, max: 150 })
    expect(r.toInsert).toHaveLength(1)
    expect(r.capReached).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/filter.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/filter.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/filter.mjs`**

```js
export function applyWindow(items, win) {
  return items.filter(
    (i) =>
      typeof i.price === "number" &&
      i.price >= win.price_min &&
      i.price <= win.price_max &&
      typeof i.distance_mi === "number" &&
      i.distance_mi <= win.radius_mi,
  )
}

export function dedup(items, existingIds) {
  return items.filter((i) => !existingIds.has(String(i.ebay_item_id)))
}

export function capInserts(items, { currentCount, max }) {
  const room = Math.max(0, max - currentCount)
  const toInsert = items.slice(0, room)
  return { toInsert, capReached: items.length > room }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/filter.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/filter.mjs tests/lib/filter.test.mjs
git commit -m "feat(canvass): applyWindow/dedup/capInserts (cap enforced at insert) [P1]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 4 — `pacific.mjs`: DST-safe date/hour guards

Cron fires at two UTC hours; the script no-ops unless the real Pacific hour matches and it has not already run today. Uses `Intl` so DST is exact (no hardcoded offsets). Digest cadence uses elapsed Pacific calendar days (not calendar parity).

**Files:**
- Create: `scripts/lib/pacific.mjs`
- Test: `tests/lib/pacific.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/pacific.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { pacificDateString, pacificHour, alreadyRanToday, daysSince } from "../../scripts/lib/pacific.mjs"

describe("pacific helpers", () => {
  it("formats a UTC instant as the Pacific calendar date (DST aware)", () => {
    // 2026-07-01T06:30:00Z = 2026-06-30 23:30 PDT (UTC-7)
    expect(pacificDateString(new Date("2026-07-01T06:30:00Z"))).toBe("2026-06-30")
    // 2026-12-01T06:30:00Z = 2026-11-30 22:30 PST (UTC-8)
    expect(pacificDateString(new Date("2026-12-01T06:30:00Z"))).toBe("2026-11-30")
  })
  it("returns the Pacific hour 0-23 across DST", () => {
    expect(pacificHour(new Date("2026-07-01T10:00:00Z"))).toBe(3) // PDT
    expect(pacificHour(new Date("2026-12-01T11:00:00Z"))).toBe(3) // PST
  })
  it("alreadyRanToday compares stored date to today's Pacific date", () => {
    const now = new Date("2026-07-01T10:00:00Z")
    expect(alreadyRanToday("2026-06-30", now)).toBe(true)
    expect(alreadyRanToday("2026-06-29", now)).toBe(false)
    expect(alreadyRanToday("", now)).toBe(false)
  })
  it("daysSince counts elapsed Pacific calendar days across year boundaries", () => {
    const now = new Date("2027-01-01T10:00:00Z") // 2026-12-31 PST
    expect(daysSince("2026-12-29", now)).toBe(2)
    expect(daysSince("", now)).toBe(Infinity)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/pacific.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/pacific.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/pacific.mjs`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/pacific.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pacific.mjs tests/lib/pacific.test.mjs
git commit -m "feat(canvass): DST-safe Pacific date/hour + elapsed-days guards via Intl" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 5 — `control.mjs`: search-window read + defaults

Canvass and `/api/settings` both rely on the Control window; defaults `200/1000/98052/100` apply when blank.

**Files:**
- Create: `scripts/lib/control.mjs`
- Test: `tests/lib/control.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/control.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { resolveWindow, DEFAULT_WINDOW } from "../../scripts/lib/control.mjs"

describe("DEFAULT_WINDOW", () => {
  it("matches the global constraint defaults", () => {
    expect(DEFAULT_WINDOW).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})

describe("resolveWindow", () => {
  it("fills blank fields with defaults", () => {
    expect(resolveWindow({})).toEqual(DEFAULT_WINDOW)
    expect(resolveWindow({ price_max: 1500 })).toEqual({ ...DEFAULT_WINDOW, price_max: 1500 })
  })
  it("coerces numeric strings and keeps zipcode as a string", () => {
    const w = resolveWindow({ price_min: "300", radius_mi: "50", zipcode: "98101" })
    expect(w.price_min).toBe(300)
    expect(w.radius_mi).toBe(50)
    expect(w.zipcode).toBe("98101")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/control.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/control.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/control.mjs`**

```js
export const DEFAULT_WINDOW = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

const numOr = (v, d) => {
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : d
}

export function resolveWindow(fields = {}) {
  return {
    price_min: numOr(fields.price_min, DEFAULT_WINDOW.price_min),
    price_max: numOr(fields.price_max, DEFAULT_WINDOW.price_max),
    zipcode: fields.zipcode ? String(fields.zipcode) : DEFAULT_WINDOW.zipcode,
    radius_mi: numOr(fields.radius_mi, DEFAULT_WINDOW.radius_mi),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/control.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/control.mjs tests/lib/control.test.mjs
git commit -m "feat(canvass): resolveWindow with default search window (200/1000/98052/100)" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 6 — `condition.mjs` + `ebay.mjs`: Browse client, local-pickup, token cache `[P0-6]`

Inject `fetch`/`now` for testability. Enforces `[P0-6]` (local-pickup delivery option + pickup postal/radius), `EBAY_US` header, ~2h token cache (refresh 5 min early), 429 backoff, and derived-field output only (eBay redistribution ToS, `[P1]`).

**BLOCKER fix folded in here:** `normalize` must emit a `condition` that is **already legal** against the live `condition` singleSelect (`{New, Refurbished, Used}`), because `airtable.create` sends NO `typecast`. eBay returns free-form condition strings that would 422 the whole batch. A tiny pure module `condition.mjs` (`mapCondition`) maps eBay's strings to one of the 3 choices or `null` (omit), and `normalize` applies it so every downstream candidate carries a write-legal value.

**Files:**
- Create: `scripts/lib/condition.mjs`
- Create: `scripts/lib/ebay.mjs`
- Test: `tests/lib/condition.test.mjs`
- Test: `tests/lib/ebay.test.mjs`

- [ ] **Step 0a: Write the failing test — `tests/lib/condition.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { mapCondition, ALLOWED_CONDITIONS } from "../../scripts/lib/condition.mjs"

describe("mapCondition", () => {
  it("exposes exactly the live singleSelect choices", () => {
    expect(ALLOWED_CONDITIONS).toEqual(["New", "Refurbished", "Used"])
  })
  it("passes through the 3 legal values (case-insensitive)", () => {
    expect(mapCondition("New")).toBe("New")
    expect(mapCondition("used")).toBe("Used")
    expect(mapCondition("REFURBISHED")).toBe("Refurbished")
  })
  it("maps eBay refurbished variants to Refurbished", () => {
    expect(mapCondition("Seller refurbished")).toBe("Refurbished")
    expect(mapCondition("Manufacturer refurbished")).toBe("Refurbished")
    expect(mapCondition("Certified - Refurbished")).toBe("Refurbished")
  })
  it("maps used-ish / open-box / parts variants to Used", () => {
    expect(mapCondition("Open box")).toBe("Used")
    expect(mapCondition("Like New")).toBe("Used")
    expect(mapCondition("For parts or not working")).toBe("Used")
    expect(mapCondition("Pre-owned")).toBe("Used")
  })
  it("maps new-with-defects variants to New", () => {
    expect(mapCondition("New other (see details)")).toBe("New")
    expect(mapCondition("New with defects")).toBe("New")
  })
  it("returns null for blank/unknown so the field is OMITTED (never a 422)", () => {
    expect(mapCondition("")).toBeNull()
    expect(mapCondition(undefined)).toBeNull()
    expect(mapCondition("¯\\_(ツ)_/¯")).toBeNull()
  })
})
```

- [ ] **Step 0b: Run it to verify it fails** — `pnpm test tests/lib/condition.test.mjs` → `Cannot find module '.../scripts/lib/condition.mjs'`.

- [ ] **Step 0c: Minimal implementation — `scripts/lib/condition.mjs`**

```js
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
```

- [ ] **Step 0d: Run it to verify it passes** — `pnpm test tests/lib/condition.test.mjs` → PASS.

- [ ] **Step 1: Write the failing test — `tests/lib/ebay.test.mjs`**

```js
import { describe, it, expect, vi } from "vitest"
import { createEbayClient } from "../../scripts/lib/ebay.mjs"

function fakeFetch(responses) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts })
    const next = responses.shift()
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    }
  })
  fn.calls = calls
  return fn
}

describe("createEbayClient", () => {
  it("requests an OAuth token then sends the local-pickup search with required params/headers", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        body: {
          itemSummaries: [
            {
              itemId: "v1|123|0",
              legacyItemId: "123456789012",
              title: "Dell RTX 4060 8GB VRAM 32GB RAM",
              price: { value: "500.00" },
              itemWebUrl: "https://www.ebay.com/itm/123?campid=5338",
              condition: "Seller refurbished", // free-form eBay value — NOT a legal singleSelect choice
              distance: { value: "42.0", unit: "mi" },
              image: { imageUrl: "https://i.ebayimg.com/x.jpg" },
            },
          ],
        },
      },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    const items = await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })

    const tokenCall = fetch.calls[0]
    expect(tokenCall.url).toContain("/identity/v1/oauth2/token")

    const searchCall = fetch.calls[1]
    expect(searchCall.url).toContain("deliveryOptions=SELLER_ARRANGED_LOCAL_PICKUP")
    expect(searchCall.url).toContain("pickupPostalCode=98052")
    expect(searchCall.url).toContain("pickupRadius=100")
    expect(searchCall.url).toContain("price%3A%5B200..1000%5D") // price:[200..1000] encoded
    expect(searchCall.opts.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_US")
    expect(searchCall.opts.headers.Authorization).toBe("Bearer tok")

    expect(items[0]).toMatchObject({
      ebay_item_id: "123456789012",
      title: "Dell RTX 4060 8GB VRAM 32GB RAM",
      price: 500,
      distance_mi: 42,
      condition: "Refurbished", // normalized to a LEGAL singleSelect choice (no typecast needed)
    })
  })

  it("normalizes an unknown condition to null so the field is omitted (never a 422)", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        body: {
          itemSummaries: [
            { itemId: "v1|9|0", legacyItemId: "9", title: "PC", price: { value: "300.00" }, itemWebUrl: "https://ebay.com/itm/9", condition: "Weird", distance: { value: "5", unit: "mi" } },
          ],
        },
      },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    const items = await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    expect(items[0].condition).toBeNull()
  })

  it("reuses the cached token on a second search (no second token call)", async () => {
    const fetch = fakeFetch([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { itemSummaries: [] } },
      { body: { itemSummaries: [] } },
    ])
    const client = createEbayClient({ clientId: "id", clientSecret: "sec", fetchImpl: fetch })
    await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    await client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
    expect(fetch.calls.filter((c) => c.url.includes("/oauth2/token"))).toHaveLength(1)
  })

  it("throws loudly on a non-ok token response (no swallow)", async () => {
    const fetch = fakeFetch([{ ok: false, status: 401, body: { error: "invalid_client" } }])
    const client = createEbayClient({ clientId: "bad", clientSecret: "bad", fetchImpl: fetch })
    await expect(
      client.search({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }),
    ).rejects.toThrow(/eBay token 401/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/ebay.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/ebay.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/ebay.mjs`**

```js
import { mapCondition } from "./condition.mjs"

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
const SCOPE = "https://api.ebay.com/oauth/api_scope"

export function createEbayClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let cached = { token: null, expiresAt: 0 }

  async function getToken() {
    if (cached.token && now() < cached.expiresAt) return cached.token
    if (!clientId || !clientSecret) throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET")
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    })
    if (!res.ok) throw new Error(`eBay token ${res.status}: ${await res.text()}`)
    const data = await res.json()
    // cache ~2h, refresh 5 min early
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) - 300) * 1000 }
    return cached.token
  }

  async function search(win, { limit = 100, attempt = 0 } = {}) {
    const token = await getToken()
    const url = new URL(BROWSE_URL)
    url.searchParams.set("q", "computer")
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("filter", `price:[${win.price_min}..${win.price_max}],priceCurrency:USD`)
    url.searchParams.set("deliveryOptions", "SELLER_ARRANGED_LOCAL_PICKUP")
    url.searchParams.set("pickupPostalCode", String(win.zipcode))
    url.searchParams.set("pickupRadius", String(win.radius_mi))
    url.searchParams.set("pickupRadiusUnit", "mi")

    const res = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    })
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * 2 ** attempt)
      return search(win, { limit, attempt: attempt + 1 })
    }
    if (!res.ok) throw new Error(`eBay browse ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return (data.itemSummaries ?? []).map(normalize)
  }

  return { search, getToken }
}

function normalize(it) {
  const price = it.price?.value != null ? Number(it.price.value) : null
  const dist = it.distance?.value != null ? Number(it.distance.value) : null
  return {
    ebay_item_id: String(it.legacyItemId ?? it.itemId ?? ""),
    title: it.title ?? "",
    price: Number.isFinite(price) ? price : null,
    url: it.itemWebUrl ?? "",
    distance_mi: Number.isFinite(dist) ? dist : null,
    // map eBay's free-form condition → a LEGAL Hardware singleSelect choice or null (omit).
    // airtable.create sends NO typecast, so the raw eBay string would 422 the batch.
    condition: mapCondition(it.condition),
    image: it.image?.imageUrl ?? "",
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/ebay.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/condition.mjs scripts/lib/ebay.mjs tests/lib/condition.test.mjs tests/lib/ebay.test.mjs
git commit -m "feat(canvass): eBay Browse client + condition mapper (local pickup, token cache, 429 backoff, EBAY_US, write-legal condition) [P0-6]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 7 — `airtable.mjs`: list/create helper, strict allowlist, no typecast `[P0-4]`

Field allowlist + **never `typecast`** on untrusted input (the explicit contrast with the existing POST hole). Batches 10/req; pages reads.

**Files:**
- Create: `scripts/lib/airtable.mjs`
- Test: `tests/lib/airtable.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/airtable.test.mjs`**

```js
import { describe, it, expect, vi } from "vitest"
import { createAirtable, CANDIDATE_FIELDS } from "../../scripts/lib/airtable.mjs"

function fakeFetch(responses) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts, body: opts?.body ? JSON.parse(opts.body) : null })
    const next = responses.shift()
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body, text: async () => "" }
  })
  fn.calls = calls
  return fn
}

const at = (fetchImpl) =>
  createAirtable({ token: "t", baseId: "appLnCrA0kRqr9Di2", table: "Hardware", fetchImpl })

describe("airtable.listExistingIds", () => {
  it("pages and returns the set of ebay_item_id values", async () => {
    const fetch = fakeFetch([
      { body: { records: [{ fields: { ebay_item_id: "1" } }], offset: "o1" } },
      { body: { records: [{ fields: { ebay_item_id: "2" } }] } },
    ])
    const ids = await at(fetch).listExistingIds()
    expect([...ids].sort()).toEqual(["1", "2"])
  })
})

describe("airtable.create", () => {
  it("strips non-allowlisted fields, keeps owned:false (checkbox boolean), and NEVER sends typecast", async () => {
    const fetch = fakeFetch([{ body: { records: [{ id: "rec1" }] } }])
    await at(fetch).create([{ ebay_item_id: "123", title: "X", price: 500, evil: "DROP TABLE", owned: false }])
    const sent = fetch.calls[0].body
    expect(sent.typecast).toBeUndefined()
    expect(Object.keys(sent.records[0].fields)).toEqual(
      expect.arrayContaining(["ebay_item_id", "title", "price"]),
    )
    expect(sent.records[0].fields.evil).toBeUndefined()
    // owned is a checkbox/boolean: the falsy value false must NOT be dropped by the allowlist pick()
    expect(sent.records[0].fields.owned).toBe(false)
  })
  it("batches in chunks of 10", async () => {
    const fetch = fakeFetch([{ body: { records: [] } }, { body: { records: [] } }])
    const rows = Array.from({ length: 15 }, (_, i) => ({ ebay_item_id: String(i), title: "t", price: 300 }))
    await at(fetch).create(rows)
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[0].body.records).toHaveLength(10)
    expect(fetch.calls[1].body.records).toHaveLength(5)
  })
  it("CANDIDATE_FIELDS matches the v2 data model", () => {
    expect(CANDIDATE_FIELDS).toEqual([
      "name", "type", "condition", "owned", "source", "status", "found_date",
      "distance_mi", "listing_url", "ebay_item_id", "title", "price", "gpu_model", "vram", "ram", "z",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/airtable.test.mjs`

Expected: fails with `Cannot find module '.../scripts/lib/airtable.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/lib/airtable.mjs`**

```js
export const CANDIDATE_FIELDS = [
  "name", "type", "condition", "owned", "source", "status", "found_date",
  "distance_mi", "listing_url", "ebay_item_id", "title", "price", "gpu_model", "vram", "ram", "z",
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

  async function count() {
    return (await listExistingIds()).size
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

  return { listExistingIds, count, create }
}

function pick(row) {
  const out = {}
  // Keep allow-listed keys whose value is present. Use explicit undefined/null checks (NOT truthiness)
  // so the falsy-but-legal checkbox value `owned: false` is preserved, not silently dropped.
  for (const k of CANDIDATE_FIELDS) if (row[k] !== undefined && row[k] !== null) out[k] = row[k]
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/airtable.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/airtable.mjs tests/lib/airtable.test.mjs
git commit -m "feat(canvass): Airtable helper with strict allowlist, no typecast, 10/req batches [P0-4]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 8 — `bootstrap.mjs`: idempotent schema + Control seed `[P0-5]`

Creates the 6 new Hardware fields + `Control` table and seeds one row with `enabled=true` and the default window. Idempotent: skips anything already present (re-run = no-op). Uses Airtable Metadata API (PAT needs `schema.bases:write` once). The pure-logic core (`planSchema`) is unit-tested; the network shell is thin.

**Files:**
- Create: `scripts/bootstrap.mjs`
- Test: `tests/lib/bootstrap.plan.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/lib/bootstrap.plan.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { planSchema, NEW_FIELDS, CONTROL_FIELDS } from "../../scripts/bootstrap.mjs"

describe("planSchema (idempotent diff)", () => {
  it("requests only the missing Hardware fields", () => {
    const plan = planSchema({ fields: ["name", "source", "status"], tables: ["Hardware"] })
    const names = plan.fieldsToCreate.map((f) => f.name)
    expect(names).not.toContain("source")
    expect(names).toContain("ebay_item_id")
    expect(names).toContain("distance_mi")
  })
  it("creates the Control table only when absent", () => {
    expect(planSchema({ fields: [], tables: ["Hardware"] }).createControl).toBe(true)
    expect(planSchema({ fields: [], tables: ["Hardware", "Control"] }).createControl).toBe(false)
  })
  it("covers all 6 new Hardware fields and 7 Control fields", () => {
    expect(NEW_FIELDS.map((f) => f.name)).toEqual([
      "source", "status", "found_date", "distance_mi", "listing_url", "ebay_item_id",
    ])
    expect(CONTROL_FIELDS.map((f) => f.name)).toEqual([
      "enabled", "last_canvass_pacific_date", "last_digest_date",
      "price_min", "price_max", "zipcode", "radius_mi",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/bootstrap.plan.test.mjs`

Expected: fails with `Cannot find module '.../scripts/bootstrap.mjs'` (or missing export).

- [ ] **Step 3: Minimal implementation — `scripts/bootstrap.mjs`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/bootstrap.plan.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap.mjs tests/lib/bootstrap.plan.test.mjs
git commit -m "feat(canvass): idempotent schema bootstrap + Control seed [P0-5]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 9 — `health.mjs` + `canvass.mjs` orchestrator (fail-loud, zero-call no-op) `[P1]`

`health.mjs` is the fail-loud surface (open/update one "Canvasser health" issue on uncaught error or N consecutive zero-insert runs). `canvass.mjs` wires the lib together; the no-op branch (disabled / wrong Pacific hour / already-ran) makes **zero outbound calls** (asserted); top-level errors are routed to `reportHealth` and rethrown so Actions emails. The candidate-row builder emits only **write-legal** values for the live base (no `typecast`): `owned: false` (checkbox boolean), `condition` already mapped to a legal singleSelect choice or `undefined` (omitted), `type` from `{Laptop, Desktop}`.

**Files:**
- Create: `scripts/lib/health.mjs`
- Create: `scripts/canvass.mjs`
- Test: `tests/lib/health.test.mjs`
- Test: `tests/canvass.test.mjs`

- [ ] **Step 1: Write the failing tests**

`tests/lib/health.test.mjs`:

```js
import { describe, it, expect, vi } from "vitest"
import { reportHealth } from "../../scripts/lib/health.mjs"

function fakeGh(existing) {
  const calls = []
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body ? JSON.parse(opts.body) : null })
    if (String(url).includes("/issues?")) return { ok: true, json: async () => existing }
    return { ok: true, json: async () => ({ number: 7 }) }
  })
  fn.calls = calls
  return fn
}

describe("reportHealth", () => {
  it("creates a new issue when none is open with the marker label", async () => {
    const gh = fakeGh([])
    await reportHealth({ repo: "o/r", token: "t", body: "boom", fetchImpl: gh })
    const post = gh.calls.find((c) => c.method === "POST")
    expect(post.url).toContain("/repos/o/r/issues")
    expect(post.body.title).toContain("Canvasser health")
    expect(post.body.labels).toContain("canvasser-health")
  })
  it("comments on the existing open issue instead of duplicating", async () => {
    const gh = fakeGh([{ number: 42, title: "Canvasser health" }])
    await reportHealth({ repo: "o/r", token: "t", body: "again", fetchImpl: gh })
    const post = gh.calls.find((c) => c.method === "POST")
    expect(post.url).toContain("/issues/42/comments")
  })
})
```

`tests/canvass.test.mjs`:

```js
import { describe, it, expect, vi } from "vitest"
import { runCanvass } from "../scripts/canvass.mjs"

const win = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

function deps(overrides = {}) {
  return {
    control: {
      read: vi.fn(async () => ({ enabled: true, last_canvass_pacific_date: "", ...win })),
      markRan: vi.fn(async () => {}),
    },
    ebay: {
      // ebay.search returns ALREADY-NORMALIZED items: condition is a legal singleSelect choice or null.
      search: vi.fn(async () => [
        { ebay_item_id: "1", title: "PC RTX 4060 8GB VRAM 32GB RAM", price: 500, url: "https://ebay.com/itm/1?utm_source=x", distance_mi: 40, condition: "Refurbished" },
        { ebay_item_id: "2", title: "Cheap", price: 100, url: "https://ebay.com/itm/2", distance_mi: 10, condition: null },
      ]),
    },
    airtable: { listExistingIds: vi.fn(async () => new Set()), count: vi.fn(async () => 0), create: vi.fn(async () => 1) },
    health: vi.fn(async () => {}),
    now: new Date("2026-07-01T10:30:00Z"), // 03:30 PDT → hour matches target 3
    max: 150,
    pacificHourTarget: 3,
    enabledEnv: "true",
    ...overrides,
  }
}

describe("runCanvass", () => {
  it("inserts filtered+deduped candidates with stripped URL and marks the run", async () => {
    const d = deps()
    const r = await runCanvass(d)
    expect(d.ebay.search).toHaveBeenCalledWith(expect.objectContaining(win))
    const inserted = d.airtable.create.mock.calls[0][0]
    expect(inserted.map((x) => x.ebay_item_id)).toEqual(["1"]) // $100 filtered out
    expect(inserted[0].listing_url).toBe("https://ebay.com/itm/1") // tracking stripped
    expect(inserted[0].status).toBe("candidate")
    expect(inserted[0].source).toBe("eBay")
    expect(inserted[0].z).toBe(500)
    // write-legal contract vs the live base (no typecast): checkbox boolean + legal singleSelect choice
    expect(inserted[0].owned).toBe(false)
    expect(inserted[0].condition).toBe("Refurbished")
    expect(d.control.markRan).toHaveBeenCalled()
    expect(r.inserted).toBe(1)
  })

  it("NO-OPS with zero outbound calls when disabled", async () => {
    const d = deps({ control: { read: vi.fn(async () => ({ enabled: false, ...win })), markRan: vi.fn() } })
    const r = await runCanvass(d)
    expect(r.skipped).toBe("disabled")
    expect(d.ebay.search).not.toHaveBeenCalled()
    expect(d.airtable.listExistingIds).not.toHaveBeenCalled()
  })

  it("NO-OPS with zero outbound calls when the Pacific hour does not match", async () => {
    const d = deps({ now: new Date("2026-07-01T18:00:00Z") }) // 11:00 PDT ≠ 3
    const r = await runCanvass(d)
    expect(r.skipped).toBe("off-hour")
    expect(d.ebay.search).not.toHaveBeenCalled()
  })

  it("reports health and rethrows on eBay failure (fail loud)", async () => {
    const d = deps({ ebay: { search: vi.fn(async () => { throw new Error("eBay token 401") }) } })
    await expect(runCanvass(d)).rejects.toThrow(/eBay token 401/)
    expect(d.health).toHaveBeenCalledWith(expect.stringContaining("eBay token 401"))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/lib/health.test.mjs tests/canvass.test.mjs`

Expected: both fail with `Cannot find module` for `health.mjs` / `canvass.mjs`.

- [ ] **Step 3: Minimal implementations**

`scripts/lib/health.mjs`:

```js
const LABEL = "canvasser-health"
const API = "https://api.github.com"

export async function reportHealth({ repo, token, body, fetchImpl = fetch }) {
  if (!repo || !token) return { issue: null, action: "noop" }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
  const listRes = await fetchImpl(`${API}/repos/${repo}/issues?state=open&labels=${LABEL}`, { headers })
  const open = (await listRes.json()) ?? []

  if (Array.isArray(open) && open.length > 0) {
    const num = open[0].number
    await fetchImpl(`${API}/repos/${repo}/issues/${num}/comments`, {
      method: "POST", headers, body: JSON.stringify({ body }),
    })
    return { issue: num, action: "comment" }
  }
  const createRes = await fetchImpl(`${API}/repos/${repo}/issues`, {
    method: "POST", headers, body: JSON.stringify({ title: "Canvasser health", labels: [LABEL], body }),
  })
  const created = await createRes.json()
  return { issue: created.number, action: "create" }
}
```

`scripts/canvass.mjs`:

```js
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
    const existing = await airtable.listExistingIds()
    const fresh = dedup(windowed, existing)
    const { toInsert, capReached } = capInserts(fresh, { currentCount: existing.size, max })

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
        ebay_item_id: i.ebay_item_id,
        title: i.title,
        price: i.price,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/lib/health.test.mjs tests/canvass.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/health.mjs scripts/canvass.mjs tests/lib/health.test.mjs tests/canvass.test.mjs
git commit -m "feat(canvass): orchestrator with zero-call no-op guard + fail-loud health issue [P1]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 10 — `digest.mjs`: GitHub-issue digest + gated deep-links `[P0-7]`

Builds the issue body (new candidates with derived fields only + prebuilt human-loop search links for Craigslist/FB/OfferUp/EstateSales/HiBid — never scraped). Cadence gated on `last_digest_date` elapsed Pacific days. No-op branch makes zero outbound calls.

**Files:**
- Create: `scripts/digest.mjs`
- Test: `tests/digest.test.mjs`

- [ ] **Step 1: Write the failing test — `tests/digest.test.mjs`**

```js
import { describe, it, expect, vi } from "vitest"
import { buildDigestBody, gatedLinks, runDigest } from "../scripts/digest.mjs"

const win = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

describe("gatedLinks", () => {
  it("builds search deep-links for each gated source using the window+zip", () => {
    const urls = gatedLinks(win).map((l) => l.url).join(" ")
    expect(urls).toContain("craigslist.org")
    expect(urls).toContain("facebook.com/marketplace")
    expect(urls).toContain("offerup.com")
    expect(urls).toMatch(/estatesales|hibid/)
    expect(urls).toContain("200")
    expect(urls).toContain("1000")
  })
})

describe("buildDigestBody", () => {
  it("lists candidates with derived fields only and appends gated links", () => {
    const body = buildDigestBody({
      candidates: [{ ebay_item_id: "1", title: "Dell PC", price: 500, distance_mi: 40, listing_url: "https://ebay.com/itm/1" }],
      window: win,
      capReached: false,
    })
    expect(body).toContain("Dell PC")
    expect(body).toContain("$500")
    expect(body).toContain("40 mi")
    expect(body).toContain("Human-loop")
    expect(body).not.toMatch(/seller|email|phone/i) // no PII leak
  })
  it("notes cap reached when set", () => {
    expect(buildDigestBody({ candidates: [], window: win, capReached: true })).toContain("cap reached")
  })
})

describe("runDigest cadence", () => {
  it("no-ops with zero outbound calls when fewer than 2 Pacific days since last digest", async () => {
    const listCandidatesSince = vi.fn()
    const postIssue = vi.fn()
    const r = await runDigest({
      control: { read: vi.fn(async () => ({ enabled: true, last_digest_date: "2026-06-30", ...win })), markDigest: vi.fn() },
      airtable: { listCandidatesSince },
      postIssue,
      now: new Date("2026-07-01T18:00:00Z"), // 11:00 PDT ≠ target 10 → off-hour
      pacificHourTarget: 10,
      minDays: 2,
      enabledEnv: "true",
    })
    expect(r.skipped).toBe("off-hour")
    expect(postIssue).not.toHaveBeenCalled()
    expect(listCandidatesSince).not.toHaveBeenCalled()
  })

  it("posts an issue and marks the digest when due", async () => {
    const postIssue = vi.fn(async () => {})
    const markDigest = vi.fn(async () => {})
    const r = await runDigest({
      control: { read: vi.fn(async () => ({ enabled: true, last_digest_date: "2026-06-25", ...win })), markDigest },
      airtable: { listCandidatesSince: vi.fn(async () => ({ candidates: [{ ebay_item_id: "1", title: "Dell PC", price: 500, distance_mi: 40, listing_url: "https://ebay.com/itm/1" }], capReached: false })) },
      postIssue,
      now: new Date("2026-07-01T17:30:00Z"), // 10:30 PDT → target 10
      pacificHourTarget: 10,
      minDays: 2,
      enabledEnv: "true",
    })
    expect(postIssue).toHaveBeenCalledTimes(1)
    expect(markDigest).toHaveBeenCalled()
    expect(r.posted).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/digest.test.mjs`

Expected: fails with `Cannot find module '.../scripts/digest.mjs'`.

- [ ] **Step 3: Minimal implementation — `scripts/digest.mjs`**

```js
import { resolveWindow } from "./lib/control.mjs"
import { pacificHour, pacificDateString, daysSince } from "./lib/pacific.mjs"
import { reportHealth } from "./lib/health.mjs"

export function gatedLinks(win) {
  const q = encodeURIComponent("computer")
  return [
    { name: "Craigslist (Seattle)", url: `https://seattle.craigslist.org/search/sss?query=${q}&min_price=${win.price_min}&max_price=${win.price_max}&postal=${win.zipcode}&search_distance=${win.radius_mi}` },
    { name: "FB Marketplace", url: `https://www.facebook.com/marketplace/seattle/search/?query=${q}&minPrice=${win.price_min}&maxPrice=${win.price_max}&radius=${win.radius_mi}` },
    { name: "OfferUp", url: `https://offerup.com/search?q=${q}&price_min=${win.price_min}&price_max=${win.price_max}&radius=${win.radius_mi}` },
    { name: "EstateSales.NET", url: `https://www.estatesales.net/WA/Redmond/${win.zipcode}` },
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
        for (const f of ["name", "title", "price", "z", "distance_mi", "listing_url", "ebay_item_id", "found_date"]) url.searchParams.append("fields[]", f)
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

  const postIssue = async ({ title, body }) => {
    if (!repo || !ghToken) throw new Error("GITHUB_REPOSITORY/GITHUB_TOKEN required")
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels: ["canvasser", "digest"] }),
    })
    if (!res.ok) throw new Error(`digest issue ${res.status}: ${await res.text()}`)
  }

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/digest.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/digest.mjs tests/digest.test.mjs
git commit -m "feat(canvass): digest issue body + gated deep-links + 2-day cadence [P0-7]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 11 — Remove the unauthenticated POST on `/api/hardware` `[P0-3]`

The live write hole. After removal the route exports GET only; POST returns 405 automatically (Next route handlers).

**Files:**
- Modify: `app/api/hardware/route.ts`
- Test: `tests/api/hardware.route.test.ts`

- [ ] **Step 1: Write the failing test — `tests/api/hardware.route.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import * as route from "../../app/api/hardware/route"

describe("/api/hardware", () => {
  it("exports GET", () => {
    expect(typeof route.GET).toBe("function")
  })
  it("does NOT export POST (write hole removed) [P0-3]", () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/hardware.route.test.ts`

Expected: fails — `route.POST` is currently a function (POST still exported).

- [ ] **Step 3: Minimal implementation — edit `app/api/hardware/route.ts`**

- Change line 1 from `import { type NextRequest, NextResponse } from "next/server"` to:

```ts
import { NextResponse } from "next/server"
```

- Delete the entire `export async function POST(req: NextRequest) { ... }` block (current lines 142–188). The file ends after the existing `GET` function.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/api/hardware.route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/hardware/route.ts tests/api/hardware.route.test.ts
git commit -m "fix(security): remove unauthenticated POST on /api/hardware [P0-3]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 12 — `lib/settings/window.ts` + `validate.ts`: defaults + pure validator `[P0-3]`

`window.ts` is the single TS source of the defaults for the route handler (mirrors `scripts/lib/control.mjs` so the website never imports `.mjs`). `validate.ts` allow-lists exactly `{price_min, price_max, zipcode, radius_mi}`, rejects extras/bad formats, never typecasts.

**Files:**
- Create: `lib/settings/window.ts`
- Create: `lib/settings/validate.ts`
- Test: `tests/settings/validate.test.ts`

- [ ] **Step 1: Write the failing test — `tests/settings/validate.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { validateSettings } from "../../lib/settings/validate"
import { DEFAULT_WINDOW } from "../../lib/settings/window"

describe("DEFAULT_WINDOW", () => {
  it("matches the global constraint defaults", () => {
    expect(DEFAULT_WINDOW).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})

describe("validateSettings", () => {
  it("accepts a valid window and drops unknown keys", () => {
    const r = validateSettings({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100, owned: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
  it("rejects price_min > price_max", () => {
    expect(validateSettings({ price_min: 900, price_max: 200, zipcode: "98052", radius_mi: 50 }).ok).toBe(false)
  })
  it("rejects a 4-digit zip and a >500mi radius", () => {
    expect(validateSettings({ price_min: 1, price_max: 2, zipcode: "9805", radius_mi: 50 }).ok).toBe(false)
    expect(validateSettings({ price_min: 1, price_max: 2, zipcode: "98052", radius_mi: 9999 }).ok).toBe(false)
  })
  it("rejects negative / non-numeric prices", () => {
    expect(validateSettings({ price_min: -5, price_max: 100, zipcode: "98052", radius_mi: 10 }).ok).toBe(false)
    expect(validateSettings({ price_min: "x", price_max: 100, zipcode: "98052", radius_mi: 10 } as never).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/settings/validate.test.ts`

Expected: fails — cannot resolve `../../lib/settings/validate` / `window`.

- [ ] **Step 3: Minimal implementations**

`lib/settings/window.ts`:

```ts
export type SearchWindow = { price_min: number; price_max: number; zipcode: string; radius_mi: number }

export const DEFAULT_WINDOW: SearchWindow = { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 }

const numOr = (v: unknown, d: number): number => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : d
}

export function resolveWindow(fields: Record<string, unknown> = {}): SearchWindow {
  return {
    price_min: numOr(fields.price_min, DEFAULT_WINDOW.price_min),
    price_max: numOr(fields.price_max, DEFAULT_WINDOW.price_max),
    zipcode: fields.zipcode ? String(fields.zipcode) : DEFAULT_WINDOW.zipcode,
    radius_mi: numOr(fields.radius_mi, DEFAULT_WINDOW.radius_mi),
  }
}
```

`lib/settings/validate.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/settings/validate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/settings/window.ts lib/settings/validate.ts tests/settings/validate.test.ts
git commit -m "feat(settings): default window + pure allow-list validator (no typecast) [P0-3]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 13 — `lib/settings/ratelimit.ts`: per-IP token bucket `[P0-3]/[P1]`

Cost/abuse guard on the only write endpoint.

**Files:**
- Create: `lib/settings/ratelimit.ts`
- Test: `tests/settings/ratelimit.test.ts`

- [ ] **Step 1: Write the failing test — `tests/settings/ratelimit.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { createRateLimiter } from "../../lib/settings/ratelimit"

describe("createRateLimiter", () => {
  it("allows up to N then blocks within the window", () => {
    const t = 1000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t })
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(true)
    expect(rl.allow("1.2.3.4")).toBe(false)
  })
  it("refills after the window elapses", () => {
    let t = 0
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
    expect(rl.allow("a")).toBe(true)
    expect(rl.allow("a")).toBe(false)
    t = 1001
    expect(rl.allow("a")).toBe(true)
  })
  it("tracks IPs independently", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
    expect(rl.allow("a")).toBe(true)
    expect(rl.allow("b")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/settings/ratelimit.test.ts`

Expected: fails — cannot resolve `../../lib/settings/ratelimit`.

- [ ] **Step 3: Minimal implementation — `lib/settings/ratelimit.ts`**

```ts
type Bucket = { count: number; resetAt: number }

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: { limit: number; windowMs: number; now?: () => number }) {
  const buckets = new Map<string, Bucket>()
  return {
    allow(ip: string): boolean {
      const t = now()
      const b = buckets.get(ip)
      if (!b || t >= b.resetAt) {
        buckets.set(ip, { count: 1, resetAt: t + windowMs })
        return true
      }
      if (b.count >= limit) return false
      b.count += 1
      return true
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/settings/ratelimit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/settings/ratelimit.ts tests/settings/ratelimit.test.ts
git commit -m "feat(settings): per-IP token-bucket rate limiter [P1]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 14 — `app/api/settings/route.ts`: the one authenticated writer `[P0-3]`

`GET` returns the Control window. `PUT` requires `x-settings-secret == SETTINGS_SECRET`, validates+allow-lists, rate-limits, never `typecast`, and writes only the 4 fields to Control.

**Files:**
- Create: `app/api/settings/route.ts`
- Test: `tests/api/settings.route.test.ts`

- [ ] **Step 1: Write the failing test — `tests/api/settings.route.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)
process.env.SETTINGS_SECRET = "pin1234"
process.env.AIRTABLE_TOKEN = "tok"
process.env.AIRTABLE_BASE_ID = "appLnCrA0kRqr9Di2"

import { GET, PUT } from "../../app/api/settings/route"

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => fetchMock.mockReset())

describe("/api/settings PUT", () => {
  const valid = { price_min: 300, price_max: 1500, zipcode: "98101", radius_mi: 75 }

  it("401 on missing/wrong PIN [P0-3]", async () => {
    const r = await PUT(req(valid))
    expect(r.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("400 on invalid body", async () => {
    const r = await PUT(req({ price_min: 9, price_max: 1, zipcode: "x", radius_mi: 0 }, { "x-settings-secret": "pin1234" }))
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("200 writes ONLY the 4 fields with no typecast", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ records: [{ id: "recCtl" }] }) }) // find row
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "recCtl", fields: valid }) }) // patch
    const r = await PUT(req({ ...valid, owned: true, evil: "x" }, { "x-settings-secret": "pin1234" }))
    expect(r.status).toBe(200)
    const patchCall = fetchMock.mock.calls[1]
    const sent = JSON.parse(patchCall[1].body)
    expect(sent.typecast).toBeUndefined()
    expect(sent.fields).toEqual(valid)
    expect(sent.fields.owned).toBeUndefined()
  })
})

describe("/api/settings GET", () => {
  it("returns the current window", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ records: [{ id: "r", fields: { price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 } }] }) })
    const r = await GET()
    const j = await r.json()
    expect(j).toMatchObject({ price_min: 200, price_max: 1000, zipcode: "98052", radius_mi: 100 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/settings.route.test.ts`

Expected: fails — `app/api/settings/route.ts` does not exist.

- [ ] **Step 3: Minimal implementation — `app/api/settings/route.ts`**

```ts
import { NextResponse } from "next/server"
import { validateSettings } from "@/lib/settings/validate"
import { createRateLimiter } from "@/lib/settings/ratelimit"
import { resolveWindow } from "@/lib/settings/window"

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE_ID = process.env.AIRTABLE_BASE_ID
const SECRET = process.env.SETTINGS_SECRET
const CONTROL = "Control"

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

function controlUrl(suffix = "") {
  return `https://api.airtable.com/v0/${BASE_ID}/${CONTROL}${suffix}`
}
function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
}

export async function GET() {
  if (!TOKEN || !BASE_ID) return NextResponse.json(resolveWindow({}), { status: 200 })
  const res = await fetch(`${controlUrl()}?maxRecords=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) return NextResponse.json(resolveWindow({}), { status: 200 })
  const data = await res.json()
  return NextResponse.json(resolveWindow(data.records?.[0]?.fields ?? {}))
}

export async function PUT(req: Request) {
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
  const findRes = await fetch(`${controlUrl()}?maxRecords=1`, { headers: auth, cache: "no-store" })
  if (!findRes.ok) return NextResponse.json({ error: "control read failed" }, { status: 502 })
  const id = (await findRes.json()).records?.[0]?.id
  if (!id) return NextResponse.json({ error: "control row missing (run bootstrap)" }, { status: 409 })

  const patch = await fetch(`${controlUrl(`/${id}`)}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ fields: result.value }), // NO typecast  [P0-3]
  })
  if (!patch.ok) return NextResponse.json({ error: "control write failed" }, { status: 502 })
  return NextResponse.json({ ok: true, value: result.value })
}
```

- [ ] **Step 4: Run test to verify it passes; confirm the build compiles**

Run: `pnpm test tests/api/settings.route.test.ts` → PASS
Run: `pnpm build` → Next build succeeds (route + `@/lib/settings/*` imports resolve).

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/route.ts tests/api/settings.route.test.ts
git commit -m "feat(settings): authenticated PUT (PIN+allowlist+ratelimit, no typecast) + GET window [P0-3]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 15 — `public/index.html`: Search-settings panel + PIN (localStorage)

Adds a "Search settings" panel that GETs current values and PUTs with the PIN header; PIN persists only in `localStorage`. A static test asserts the markup/JS landed; the round-trip is verified manually.

**Files:**
- Modify: `public/index.html`
- Test: `tests/static/wiring.test.mjs` (HTML assertions section — workflow/vercel assertions are added in Task 17)

- [ ] **Step 1: Write the failing test — create `tests/static/wiring.test.mjs`**

```js
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (p) => readFileSync(root + p, "utf8")

describe("index.html search-settings panel", () => {
  const html = read("public/index.html")
  it("has the four window inputs + PIN input + save button", () => {
    for (const id of ["s-price-min", "s-price-max", "s-zip", "s-radius", "s-pin", "s-save"]) {
      expect(html).toContain(`id="${id}"`)
    }
  })
  it("reads PIN from localStorage and never hardcodes a PIN value", () => {
    expect(html).toContain("localStorage.getItem('settings_pin')")
    expect(html).toContain("localStorage.setItem('settings_pin'")
  })
  it("GETs and PUTs /api/settings with the secret header", () => {
    expect(html).toContain("fetch('/api/settings')")
    expect(html).toContain("'x-settings-secret'")
    expect(html).toContain("method: 'PUT'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/static/wiring.test.mjs`

Expected: fails — `id="s-price-min"` not found.

- [ ] **Step 3: Minimal implementation — edit `public/index.html`**

Insert the panel markup immediately after `</header>` (current line 374), before the next section:

```html
    <section class="panel rounded-2xl overflow-hidden mt-4" id="settings-panel">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--border-soft)]">
            <h3 class="text-sm font-semibold tracking-tight">Search settings (nightly canvasser)</h3>
            <span id="settings-status" class="text-[11px] mono text-[color:var(--muted)]">Loading</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 px-5 py-4">
            <label class="text-[11px] mono text-[color:var(--muted)]">Min $
                <input id="s-price-min" type="number" min="0" step="25" class="w-full mt-1 bg-[color:var(--panel-2)] border border-[color:var(--border)] rounded-lg px-3 py-2 text-[13px] mono text-[color:var(--text)]"></label>
            <label class="text-[11px] mono text-[color:var(--muted)]">Max $
                <input id="s-price-max" type="number" min="0" step="25" class="w-full mt-1 bg-[color:var(--panel-2)] border border-[color:var(--border)] rounded-lg px-3 py-2 text-[13px] mono text-[color:var(--text)]"></label>
            <label class="text-[11px] mono text-[color:var(--muted)]">Zip
                <input id="s-zip" type="text" inputmode="numeric" maxlength="5" class="w-full mt-1 bg-[color:var(--panel-2)] border border-[color:var(--border)] rounded-lg px-3 py-2 text-[13px] mono text-[color:var(--text)]"></label>
            <label class="text-[11px] mono text-[color:var(--muted)]">Radius mi
                <input id="s-radius" type="number" min="1" max="500" step="5" class="w-full mt-1 bg-[color:var(--panel-2)] border border-[color:var(--border)] rounded-lg px-3 py-2 text-[13px] mono text-[color:var(--text)]"></label>
            <label class="text-[11px] mono text-[color:var(--muted)]">PIN (kept in browser)
                <input id="s-pin" type="password" autocomplete="off" class="w-full mt-1 bg-[color:var(--panel-2)] border border-[color:var(--border)] rounded-lg px-3 py-2 text-[13px] mono text-[color:var(--text)]"></label>
        </div>
        <div class="px-5 pb-4">
            <button id="s-save" type="button" class="px-4 py-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-2)] text-[color:var(--text)] text-[12px] font-semibold transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]">Save search window</button>
        </div>
    </section>
```

Inside the existing `<script>` (line 534), change `loadData();` (current line 1295) to:

```js
        settingsPanel();
        loadData();
```

and add the `settingsPanel` function definition just before that call:

```js
        // --- Search settings panel (writes to /api/settings; PIN stays in localStorage) ---
        function settingsPanel() {
            const el = (id) => document.getElementById(id);
            const status = el('settings-status');
            el('s-pin').value = localStorage.getItem('settings_pin') || '';

            fetch('/api/settings').then((r) => r.json()).then((w) => {
                if (w && typeof w.price_min === 'number') {
                    el('s-price-min').value = w.price_min;
                    el('s-price-max').value = w.price_max;
                    el('s-zip').value = w.zipcode;
                    el('s-radius').value = w.radius_mi;
                    status.innerText = 'Loaded';
                }
            }).catch(() => { status.innerText = 'settings unavailable'; });

            el('s-save').addEventListener('click', async () => {
                const pin = el('s-pin').value.trim();
                localStorage.setItem('settings_pin', pin); // never committed, never in bundle
                const payload = {
                    price_min: Number(el('s-price-min').value),
                    price_max: Number(el('s-price-max').value),
                    zipcode: el('s-zip').value.trim(),
                    radius_mi: Number(el('s-radius').value),
                };
                status.innerText = 'saving...';
                try {
                    const res = await fetch('/api/settings', {
                        method: 'PUT',
                        headers: { 'content-type': 'application/json', 'x-settings-secret': pin },
                        body: JSON.stringify(payload),
                    });
                    status.innerText = res.ok ? 'saved' : (res.status === 401 ? 'wrong PIN' : 'error ' + res.status);
                } catch {
                    status.innerText = 'network error';
                }
            });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/static/wiring.test.mjs`

Expected: PASS (HTML section).

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/static/wiring.test.mjs
git commit -m "feat(ui): search-settings panel writing /api/settings, PIN in localStorage only" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 16 — `vercel-ignore.mjs` + `vercel.json`: skip redeploy for keepalive/non-app commits `[P1]`

Keepalive `[skip ci]` commits and data-only commits must not trigger Vercel build storms. A small script (cleaner and testable vs an inline shell one-liner) decides; `vercel.json` calls it.

**Files:**
- Create: `scripts/vercel-ignore.mjs`
- Modify: `vercel.json`
- Test: extend `tests/static/wiring.test.mjs`

- [ ] **Step 1: Extend the failing test — append to `tests/static/wiring.test.mjs`**

```js
describe("vercel ignored-build wiring", () => {
  it("vercel.json runs the ignore script", () => {
    const vercel = read("vercel.json")
    expect(vercel).toContain("ignoreCommand")
    expect(vercel).toContain("scripts/vercel-ignore.mjs")
  })
  it("the ignore script only skips when every changed file is non-app (e.g. .github/last-run)", () => {
    const script = read("scripts/vercel-ignore.mjs")
    expect(script).toContain(".github/last-run")
    expect(script).toContain("VERCEL_GIT_PREVIOUS_SHA")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/static/wiring.test.mjs`

Expected: the new `vercel` block fails — `scripts/vercel-ignore.mjs` missing and `vercel.json` has no `ignoreCommand`.

- [ ] **Step 3: Minimal implementation**

`scripts/vercel-ignore.mjs` (exit 0 = skip build, exit 1 = build):

```js
import { execFileSync } from "node:child_process"

const APP_PREFIXES = ["app/", "lib/", "components/", "public/", "next.config.mjs", "package.json", "tsconfig.json"]

function changedFiles() {
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA
  const current = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD"
  if (!previous) return null // first deploy / unknown range → build
  const out = execFileSync("git", ["diff", "--name-only", previous, current], { encoding: "utf8" })
  return out.split("\n").map((s) => s.trim()).filter(Boolean)
}

const files = changedFiles()
// Build (exit 1) when range unknown or any app-relevant file changed.
// Skip (exit 0) only when there ARE changes and NONE touch an app path (keepalive / data-only commits).
const skip = Array.isArray(files) && files.length > 0 && files.every((f) => !APP_PREFIXES.some((p) => f === p || f.startsWith(p)))
process.exit(skip ? 0 : 1)
```

Replace `vercel.json` with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "ignoreCommand": "node scripts/vercel-ignore.mjs"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/static/wiring.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/vercel-ignore.mjs vercel.json tests/static/wiring.test.mjs
git commit -m "chore(vercel): skip redeploy for keepalive/non-app commits via ignore script [P1]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 17 — Keepalive file + workflows (keepalive-first, SHA-pinned, least-priv) `[P0-2]/[P0-4]`

The anti-deadlock keystone. Keepalive runs **first, unconditionally**, before the `enabled` gate — the repo never hits GitHub's 60-day inactivity cron-disable. Actions are SHA-pinned (resolved commit SHAs below), permissions are least-privilege.

**Files:**
- Create: `.github/last-run`
- Create: `.github/workflows/canvass.yml`
- Create: `.github/workflows/digest.yml`
- Create: `.github/workflows/ci.yml`
- Test: extend `tests/static/wiring.test.mjs`

- [ ] **Step 1: Extend the failing test — append to `tests/static/wiring.test.mjs`**

```js
describe("workflows: keepalive-first, SHA-pinned, least-priv", () => {
  for (const f of ["canvass", "digest"]) {
    const yml = read(`.github/workflows/${f}.yml`)
    it(`${f}: keepalive commits .github/last-run BEFORE the script step`, () => {
      const keepaliveAt = yml.indexOf(".github/last-run")
      const scriptAt = yml.indexOf(`scripts/${f}.mjs`)
      expect(keepaliveAt).toBeGreaterThan(-1)
      expect(scriptAt).toBeGreaterThan(keepaliveAt)
      expect(yml).toContain("[skip ci]")
      expect(yml).toContain("git pull --rebase")
    })
    it(`${f}: least-priv permissions + concurrency`, () => {
      expect(yml).toMatch(/permissions:\s*\n\s*contents: write\s*\n\s*issues: write/)
      expect(yml).toContain("concurrency:")
      expect(yml).toContain("cancel-in-progress: false")
    })
    it(`${f}: third-party actions are SHA-pinned`, () => {
      expect(yml).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683")
      expect(yml).toContain("pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d")
      expect(yml).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020")
    })
  }
  it("canvass cron = 0 10,11; digest cron = 0 17,18", () => {
    expect(read(".github/workflows/canvass.yml")).toContain('cron: "0 10,11 * * *"')
    expect(read(".github/workflows/digest.yml")).toContain('cron: "0 17,18 * * *"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/static/wiring.test.mjs`

Expected: fails — workflow files do not exist.

- [ ] **Step 3: Minimal implementation**

`.github/last-run`:

```
never
```

`.github/workflows/canvass.yml`:

```yaml
name: Canvass

on:
  schedule:
    - cron: "0 10,11 * * *"   # 3am PT DST-safe (10:00 & 11:00 UTC)
  workflow_dispatch:

permissions:
  contents: write   # keepalive commit  [P0-2]
  issues: write     # health issue  [P1]

concurrency:
  group: canvasser
  cancel-in-progress: false

jobs:
  canvass:
    runs-on: ubuntu-latest
    steps:
      # [P0-2] keepalive FIRST, unconditional — repo never goes inactive
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 2
          persist-credentials: true

      - name: Keep cron alive
        run: |
          date -u +"%Y-%m-%dT%H:%M:%SZ" > .github/last-run
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/last-run
          git commit -m "chore: keep canvasser cron alive [skip ci]" || exit 0
          git pull --rebase --autostash origin "${GITHUB_REF_NAME}" || (git rebase --abort || true; git pull --rebase --autostash origin "${GITHUB_REF_NAME}")
          git push

      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d # v4.0.0
        with:
          version: 10

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.1.0
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm test:scripts
      - name: canvass
        env:
          AIRTABLE_CI_TOKEN: ${{ secrets.AIRTABLE_CI_TOKEN }}
          AIRTABLE_BASE_ID: ${{ vars.AIRTABLE_BASE_ID }}
          AIRTABLE_TABLE: Hardware
          EBAY_CLIENT_ID: ${{ secrets.EBAY_CLIENT_ID }}
          EBAY_CLIENT_SECRET: ${{ secrets.EBAY_CLIENT_SECRET }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MAX_CANDIDATES: ${{ vars.MAX_CANDIDATES }}
          CANVASSER_ENABLED: ${{ vars.CANVASSER_ENABLED }}
        run: node scripts/canvass.mjs
```

`.github/workflows/digest.yml`:

```yaml
name: Digest

on:
  schedule:
    - cron: "0 17,18 * * *"   # 10am PT DST-safe (17:00 & 18:00 UTC)
  workflow_dispatch:

permissions:
  contents: write
  issues: write

concurrency:
  group: canvasser-digest
  cancel-in-progress: false

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 2
          persist-credentials: true

      - name: Keep cron alive
        run: |
          date -u +"%Y-%m-%dT%H:%M:%SZ" > .github/last-run
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/last-run
          git commit -m "chore: keep digest cron alive [skip ci]" || exit 0
          git pull --rebase --autostash origin "${GITHUB_REF_NAME}" || (git rebase --abort || true; git pull --rebase --autostash origin "${GITHUB_REF_NAME}")
          git push

      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d # v4.0.0
        with:
          version: 10

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.1.0
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm test:scripts
      - name: digest
        env:
          AIRTABLE_CI_TOKEN: ${{ secrets.AIRTABLE_CI_TOKEN }}
          AIRTABLE_BASE_ID: ${{ vars.AIRTABLE_BASE_ID }}
          AIRTABLE_TABLE: Hardware
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MAX_CANDIDATES: ${{ vars.MAX_CANDIDATES }}
          CANVASSER_ENABLED: ${{ vars.CANVASSER_ENABLED }}
        run: node scripts/digest.mjs
```

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request: {}
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d # v4.0.0
        with:
          version: 10
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.1.0
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 4: Run test to verify it passes; confirm YAML parses**

Run: `pnpm test tests/static/wiring.test.mjs` → PASS

Run (sanity-parse the YAML files):

```bash
node -e "const fs=require('fs');for(const f of ['canvass','digest','ci']){const s=fs.readFileSync('.github/workflows/'+f+'.yml','utf8');if(!/^permissions:/m.test(s))throw new Error(f+' missing permissions');console.log(f,'ok')}"
```

Expected: prints `canvass ok`, `digest ok`, `ci ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/last-run .github/workflows/canvass.yml .github/workflows/digest.yml .github/workflows/ci.yml tests/static/wiring.test.mjs
git commit -m "ci: keepalive-first canvass/digest workflows + CI, SHA-pinned, least-priv [P0-2][P0-4]" -m "Co-Authored-By: claude-flow <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_01KA5N73PAt7WS5Va9QoNyLk"
```

---

## Task 18 — Full green, build, and manual end-to-end verification

**Files:**
- No new files unless verification surfaces a defect; fix only defects introduced by this plan.

- [ ] **Step 1: Run the full suite + build**

Run:

```bash
pnpm test
pnpm build
```

Expected: all tests green; Next build succeeds (routes compile; `/api/hardware` POST gone; `@/lib/settings/*` resolve).

- [ ] **Step 2: One-time schema bootstrap `[P0-5]`** (token must temporarily include `schema.bases:write`)

```bash
AIRTABLE_CI_TOKEN=*** AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2 node scripts/bootstrap.mjs
AIRTABLE_CI_TOKEN=*** AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2 node scripts/bootstrap.mjs
```

Expected: first run creates the 6 Hardware fields + `Control` table + seed row (200/1000/98052/100, enabled=true); second run prints no `+ field`/`+ table`/`+ seeded` lines (idempotent no-op). Re-verify via the Airtable MCP `list_tables_for_base appLnCrA0kRqr9Di2`.

- [ ] **Step 3: Security checks `[P0-3]`** (`pnpm dev` running)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/hardware            # expect 405
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:3000/api/settings -H 'content-type: application/json' -d '{"price_min":200,"price_max":1000,"zipcode":"98052","radius_mi":100}'   # expect 401 (no PIN)
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:3000/api/settings -H 'content-type: application/json' -H "x-settings-secret: $SETTINGS_SECRET" -d '{"price_min":200,"price_max":1000,"zipcode":"98052","radius_mi":100,"owned":true}'   # expect 200; extra key dropped
```

Expected: 405, 401, 200. Confirm the Control row updated to only the 4 fields (no `owned`).

- [ ] **Step 4: Canvass dispatch `[P0-6]`** — run the `Canvass` workflow via `workflow_dispatch`.

Expected: a `chore: keep canvasser cron alive [skip ci]` commit lands first; Vercel shows **no deploy** (Task 16); candidates appear with `status=candidate`, `source=eBay`, `price∈[200,1000]`, `distance_mi≤100`, stable `ebay_item_id`; a second dispatch inserts 0 (dedup); at `MAX_CANDIDATES` inserts stop. Off-hour/disabled dispatch returns `{"skipped":...}` with no eBay/Airtable list calls.

- [ ] **Step 5: Digest dispatch `[P0-7]`** — run the `Digest` workflow via `workflow_dispatch`.

Expected: keepalive commit lands; a digest Issue is created with candidate summaries (derived fields only — no seller/email/phone/raw export) + working Craigslist/FB/OfferUp/EstateSales/HiBid deep-links; cadence honors `last_digest_date`.

  Also verify the `found_date` filter resolves correctly against the LIVE field type: `found_date` was created by bootstrap as a **date** field and canvass writes a `YYYY-MM-DD` string, which Airtable stores as a date. `listCandidatesSince` filters with `IS_AFTER({found_date}, '<YYYY-MM-DD>')`. Confirm the digest only lists candidates whose `found_date` is strictly after `last_digest_date` (not all candidates). If the live `found_date` were instead a plain-text field, `IS_AFTER` would silently match nothing — so this manual check is the guard. Quick check against the real base:

```bash
# returns ONLY rows found after 2026-06-30 — confirms found_date is a real date the formula can compare
curl -s "https://api.airtable.com/v0/appLnCrA0kRqr9Di2/Hardware?filterByFormula=$(node -e "process.stdout.write(encodeURIComponent(\"AND({status}='candidate', IS_AFTER({found_date}, '2026-06-30'))\"))")&fields%5B%5D=found_date" \
  -H "Authorization: Bearer $AIRTABLE_CI_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).records||[];console.log(r.length,'rows', r.map(x=>x.fields.found_date))})"
```

If this returns rows whose `found_date` is on/before `2026-06-30`, the field is not a date — re-create `found_date` as a `date` field (bootstrap NEW_FIELDS already specifies `type:"date"`; this only matters if the field pre-existed as text) and re-run.

- [ ] **Step 6: Fail-loud check `[P1]`** — temporarily clear `EBAY_CLIENT_SECRET` and dispatch `Canvass`.

Expected: the job fails red (non-zero exit; GitHub emails) AND a single "Canvasser health" issue opens/updates — never green.

- [ ] **Step 7: Settings round-trip** — in the UI, change price/zip/radius and Save with the PIN.

Expected: values land in Control (`GET /api/settings` reflects them); the next `Canvass` dispatch searches the new window; the PIN persists across reload via `localStorage` and never appears in any committed file (`git grep "settings_pin" public/index.html` shows only the key name, never a value).

- [ ] **Step 8: Open the PR** (do not merge until repo secrets/vars + Vercel envs are set and `pnpm bootstrap` has run once)

```bash
git push -u origin feat/deal-canvasser-v1
gh pr create --title "feat: nightly deal canvasser v1 (lean)" --body "$(cat <<'EOF'
Implements the lean v1 canvasser per docs/superpowers/specs/2026-06-18-deal-canvasser-design.md.

Honors all council P0/P1: unauthenticated /api/hardware POST removed; scoped split tokens +
SHA-pinned least-priv workflows; idempotent schema bootstrap + Control seed; eBay LOCAL_PICKUP
radius (pickupPostalCode/pickupRadius + EBAY_US header + ~2h token cache); keepalive-before-gate
anti-60-day-disable; dedup on ebay_item_id + tracking-param stripping; cap-at-insert; fail-loud
health issue; UI-settable window via authenticated, rate-limited, allow-listed /api/settings (no
typecast) + index.html panel; DST-safe Pacific guards; Vercel ignored-build for non-app commits.
No reaper/eviction/archive/AI/Craigslist-scraping (Phase 2).

Pre-merge checklist:
- Repo secrets: AIRTABLE_CI_TOKEN, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
- Repo vars: AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2, MAX_CANDIDATES=150, CANVASSER_ENABLED=true
- Vercel envs: AIRTABLE_TOKEN (base read+write), AIRTABLE_BASE_ID, SETTINGS_SECRET
- Run `pnpm bootstrap` once with a schema.bases:write token, then drop that scope.

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

---

## Test Strategy Notes

- All network clients (eBay, Airtable, GitHub) take an injected `fetchImpl` (and eBay also `now`/`sleep`); unit tests never touch live services.
- Route-handler tests import the real `GET`/`PUT` and stub global `fetch`; they assert status codes, the field allow-list, and the absence of `typecast`.
- Static `tests/static/wiring.test.mjs` asserts the load-bearing facts that cannot be unit-run cheaply (keepalive-before-gate ordering, SHA-pinned actions, cron strings, HTML panel wiring, Vercel ignore wiring). Real cron/keepalive behavior is verified via `workflow_dispatch` after merge.
- Live calls happen only in the manual verification steps (Task 18): `bootstrap.mjs`, the `curl` security checks, and the two `workflow_dispatch` runs.

## Residual Risk

- **eBay response shape:** local-pickup `distance` field naming/units can vary by Browse response; `normalize` handles the documented `distance.value` and `legacyItemId`, but the first manual dispatch (Task 18 Step 4) must inspect real returned items and adjust `normalize`/`pickupRadiusUnit` if eBay returns a different shape.
- **Keepalive needs `contents: write`** — broader than read-only but required for the anti-deadlock commit; constrained to repo contents and paired with SHA-pinned actions and `[skip ci]` + Vercel ignore so it cannot trigger deploys.
- **In-memory rate limiter resets on serverless instance churn** — useful against casual abuse, not a distributed limiter; the PIN remains the primary auth gate.
- **Airtable PAT scopes are base-level, not per-table** — so the code-side field allow-list in `/api/settings` and `airtable.mjs` is the real enforcement boundary; this is intentional and documented in the spec security model.
- **Concurrent keepalive pushes** between canvass and digest are serialized by separate `concurrency` groups and `git pull --rebase --autostash` retry, but a rare push race is possible; the retry handles the common case and a failed push does not fail the data step.
