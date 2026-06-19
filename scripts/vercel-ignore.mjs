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
// Example non-app files: .github/last-run, docs/**, data/**, .github/**
const skip = Array.isArray(files) && files.length > 0 && files.every((f) => !APP_PREFIXES.some((p) => f === p || f.startsWith(p)))
process.exit(skip ? 0 : 1)
