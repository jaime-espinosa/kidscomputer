## Deal-Canvasser v1 — Manual End-to-End Verification Checklist

**Branch:** `feat/deal-canvasser-v1`
**Base ID:** `appLnCrA0kRqr9Di2`
**Prerequisites:** Repo secrets + Vercel envs set (see Step 0), schema bootstrapped (Step 1).

---

### Step 0: Pre-merge secrets/vars setup (one-time)

**GitHub repository secrets** (Settings → Secrets and variables → Actions → Secrets):
- `AIRTABLE_CI_TOKEN` — PAT with `data.records:read`, `data.records:write`, `schema.bases:read` on base `appLnCrA0kRqr9Di2` (add `schema.bases:write` temporarily for bootstrap run only, then revoke)
- `EBAY_CLIENT_ID` — eBay Browse API client ID
- `EBAY_CLIENT_SECRET` — eBay Browse API client secret

**GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):
- `AIRTABLE_BASE_ID` = `appLnCrA0kRqr9Di2`
- `MAX_CANDIDATES` = `150`
- `CANVASSER_ENABLED` = `true`

**Vercel environment variables** (Vercel project settings → Environment Variables):
- `AIRTABLE_TOKEN` — separate PAT with `data.records:read`, `data.records:write` on base `appLnCrA0kRqr9Di2` (no `schema` scope; narrower than CI token)
- `AIRTABLE_BASE_ID` = `appLnCrA0kRqr9Di2`
- `SETTINGS_SECRET` — random strong secret (e.g., `openssl rand -hex 32`); PIN is entered by the user in the UI and stored in `localStorage` only

---

### Step 1: Schema bootstrap [P0-5]

**Requires:** `AIRTABLE_CI_TOKEN` with `schema.bases:write` temporarily added.

```bash
# First run: creates fields, Control table, seed row
AIRTABLE_CI_TOKEN=<token> AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2 node scripts/bootstrap.mjs
```

Expected first-run output lines:
- `+ field status` (and 5 more Hardware fields)
- `+ table Control`
- `+ seeded Control row (200/1000/98052/100, enabled=true)`

```bash
# Second run: idempotent — no + lines
AIRTABLE_CI_TOKEN=<token> AIRTABLE_BASE_ID=appLnCrA0kRqr9Di2 node scripts/bootstrap.mjs
```

Expected second-run output: no `+ field`, `+ table`, or `+ seeded` lines.

**Verify via Airtable MCP:**
```
list_tables_for_base appLnCrA0kRqr9Di2
```
Expected: `Hardware` table with fields `status`, `source`, `ebay_item_id`, `price`, `distance_mi`, `found_date`; plus `Control` table with fields `price_min`, `price_max`, `zipcode`, `radius_mi`, `enabled`, `last_digest_date`.

**After bootstrap:** revoke `schema.bases:write` scope from `AIRTABLE_CI_TOKEN` (rotate to a narrower token if needed).

---

### Step 2: Security checks [P0-3]

**Requires:** `pnpm dev` running locally with `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SETTINGS_SECRET` in `.env.local`.

```bash
# POST to /api/hardware must return 405 (route only exports GET)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/hardware
# expect: 405

# PUT /api/settings without correct PIN must return 401
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:3000/api/settings \
  -H 'content-type: application/json' \
  -d '{"price_min":200,"price_max":1000,"zipcode":"98052","radius_mi":100}'
# expect: 401

# PUT /api/settings with correct SETTINGS_SECRET header must return 200
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:3000/api/settings \
  -H 'content-type: application/json' \
  -H "x-settings-secret: $SETTINGS_SECRET" \
  -d '{"price_min":200,"price_max":1000,"zipcode":"98052","radius_mi":100,"owned":true}'
# expect: 200

# Confirm no extra field persisted (owned not in allow-list)
curl -s http://localhost:3000/api/settings | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s), null, 2)))"
# expect: price_min=200, price_max=1000, zipcode="98052", radius_mi=100; no "owned" field
```

**Confirm Control row:** check Airtable base that Control row was updated to exactly `price_min=200, price_max=1000, zipcode=98052, radius_mi=100` — no `owned` column.

---

### Step 3: Canvass workflow dispatch [P0-6]

1. In GitHub Actions UI → Workflows → **Canvass** → **Run workflow** (branch: `feat/deal-canvasser-v1`).

Expected sequence:
- A `chore: keep canvasser cron alive [skip ci]` commit is pushed to the branch before the canvass step runs.
- Vercel shows **no new deploy** triggered by that commit (vercel-ignore script returns exit 1 for `[skip ci]` commits and non-app-file changes).
- The canvass step logs show eBay token fetched, items searched with `pickupPostalCode=98052&pickupRadius=100&pickupRadiusUnit=mi`.
- Candidates inserted with `status=candidate`, `source=eBay`, `price` within `[200, 1000]`, `distance_mi <= 100`, and a stable `ebay_item_id` (no tracking params).

2. Run **Canvass** workflow a second time:
   - Expected: 0 new rows inserted (dedup on `ebay_item_id` prevents re-insert of same items).

3. With `MAX_CANDIDATES` rows already at cap: dispatch again.
   - Expected: workflow exits early without inserting, logs cap reached.

4. Set repo var `CANVASSER_ENABLED=false`, then dispatch during off-hours.
   - Expected: workflow returns `{"skipped": "..."}` — no eBay API calls, no Airtable list calls.

**Manual shape check (residual risk):** Inspect the raw eBay response for `distance` field shape.
- Expected shape: `distance.value` (numeric, in miles) and `legacyItemId` for dedup.
- If eBay returns a different structure, adjust `normalize()` in `scripts/lib/ebay.mjs` and `pickupRadiusUnit` and re-run.

---

### Step 4: Digest workflow dispatch [P0-7]

1. In GitHub Actions UI → Workflows → **Digest** → **Run workflow**.

Expected:
- A `chore: keep digest cron alive [skip ci]` commit lands first.
- A GitHub issue is created (or existing "Canvasser Digest" issue updated) with candidate summaries.
- Issue body contains only derived fields: name, price, distance, found_date, condition. No seller contact info, email, phone, or raw export data.
- Issue body includes working deep-links: Craigslist, Facebook Marketplace, OfferUp, EstateSales.net, HiBid.
- `last_digest_date` in Control row is updated to today's date after the run.

2. Run **Digest** a second time on the same day:
   - Expected: skipped due to cadence (digest only runs if `last_digest_date` is more than 2 days ago).

**Verify `found_date` filter (critical date-field check):**

```bash
# Must return ONLY rows where found_date is strictly after 2026-06-30
# If this returns rows from on/before that date, found_date is a plain-text field (not a date field)
# and must be recreated as type:date via bootstrap
curl -s "https://api.airtable.com/v0/appLnCrA0kRqr9Di2/Hardware?filterByFormula=$(node -e "process.stdout.write(encodeURIComponent(\"AND({status}='candidate', IS_AFTER({found_date}, '2026-06-30'))\"))")&fields%5B%5D=found_date" \
  -H "Authorization: Bearer $AIRTABLE_CI_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).records||[];console.log(r.length,'rows', r.map(x=>x.fields.found_date))})"
```

If the query returns rows with `found_date` on/before `2026-06-30`: the field was created as a text field (pre-existing), not a date. Re-create it using `bootstrap.mjs` (drop + recreate with `type:"date"`) and re-run canvass to repopulate.

---

### Step 5: Fail-loud health check [P1]

1. Temporarily clear/corrupt `EBAY_CLIENT_SECRET` in repo secrets.
2. Dispatch **Canvass** workflow.

Expected:
- Workflow exits with non-zero status (red X in GitHub Actions UI).
- GitHub sends failure notification email.
- A GitHub issue titled "Canvasser health" is opened (or updated if already exists) reporting the failure.
- Workflow is NEVER marked green when eBay auth fails.

3. Restore the correct `EBAY_CLIENT_SECRET`.

---

### Step 6: Settings UI round-trip

1. Open the deployed app URL (after PR merges to main and Vercel deploys).
2. Open the settings panel in the UI.
3. Enter the PIN (must match `SETTINGS_SECRET` env var).
4. Change `price_min`, `price_max`, `zipcode`, and/or `radius_mi`.
5. Click Save.

Expected:
- `GET /api/settings` returns the new values.
- The Control row in Airtable reflects the updated values.
- The next `Canvass` dispatch searches the new window (verify by inspecting workflow logs for new `pickupPostalCode` and price filter).
- On page reload, the PIN is pre-filled from `localStorage` (user convenience).

**Security check — PIN never in committed files:**
```bash
git grep "settings_pin" public/index.html
# expect: only the key name string (the input's id/name attribute), never a value
git grep -i "SETTINGS_SECRET" .
# expect: no matches (the secret value is never committed)
```

---

### Step 7: Open the PR

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
- Run bootstrap.mjs once with a schema.bases:write token, then drop that scope.

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

**Do not merge** until:
- [ ] All repo secrets/vars set (Step 0)
- [ ] All Vercel envs set (Step 0)
- [ ] `bootstrap.mjs` run once successfully (Step 1)
- [ ] Security checks pass (Step 2)
- [ ] At least one successful `Canvass` dispatch with real candidates (Step 3)
- [ ] At least one successful `Digest` dispatch with a real issue (Step 4)

---

### DEFERRED steps (require live secrets — not provisioned at plan time)

Steps 1–7 above are the live verification steps. They are DEFERRED pending:
1. eBay Browse API credentials (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`)
2. Airtable PAT with appropriate scopes (`AIRTABLE_CI_TOKEN`, `AIRTABLE_TOKEN`)
3. `SETTINGS_SECRET` set in Vercel environment
4. GitHub Actions `workflow_dispatch` access on the branch

No live API calls were made during automated testing (Tasks 0–18). All network clients accept an injected `fetchImpl` for unit testing; live calls happen only in these manual steps.
