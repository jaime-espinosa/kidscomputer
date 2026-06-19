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
