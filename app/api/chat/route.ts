import { streamText, type ModelMessage } from "ai"

export const maxDuration = 30

type IncomingMessage = { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  let body: { messages?: IncomingMessage[]; dataset?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const dataset = Array.isArray(body.dataset) ? body.dataset : []

  if (messages.length === 0) {
    return new Response("No messages provided", { status: 400 })
  }

  // Keep only the fields that matter for answering questions, and cap the size.
  const compact = dataset.slice(0, 200).map((r) => {
    const d = r as Record<string, unknown>
    return {
      name: d.name,
      type: d.type,
      condition: d.condition,
      owned: d.owned,
      cpu: d.cpu,
      gpu: d.gpu,
      gpu_model: d.gpu_model,
      vram: d.vram,
      ram: d.ram,
      storage: d.storage,
      agents: d.agents,
      fps: d.fps,
      price: d.z,
      survivability: d.survivability,
      mem_per_dollar: d.mem_per_dollar,
    }
  })

  const system = [
    "You are the Fleet Matrix data assistant, an analyst embedded in a hardware fleet dashboard.",
    "Answer questions strictly using the JSON dataset provided below. Each record is one computer system.",
    "Field meanings: price (z) is retail USD; agents = concurrent AI agents the system can run; fps = rendering frames per second; survivability is a 1-5 durability score; mem_per_dollar is combined RAM+VRAM per dollar (higher is better value); owned indicates whether it is already in the fleet.",
    "Be concise and specific. Cite exact system names and numbers. When comparing or ranking, show the relevant figures.",
    "If the dataset does not contain the answer, say so plainly. Do not invent systems, specs, or prices.",
    "Format numbers cleanly (e.g. $1,199). Use short markdown lists for multi-item answers.",
    "",
    `DATASET (${compact.length} systems):`,
    JSON.stringify(compact),
  ].join("\n")

  const modelMessages: ModelMessage[] = messages
    .filter((m) => m && typeof m.content === "string")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }))

  const result = streamText({
    model: "openai/gpt-5.4-mini",
    system,
    messages: modelMessages,
  })

  return result.toTextStreamResponse({
    onError: (error) => {
      console.error("[v0] chat stream error:", error)
      const msg = error instanceof Error ? error.message : "The data service is unavailable."
      return `Sorry, I couldn't generate an answer. ${msg}`
    },
  })
}
