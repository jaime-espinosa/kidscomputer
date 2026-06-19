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
