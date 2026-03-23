import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = resolve(__dirname, "../../data/bandcamp/artists.json")

interface BandcampItem {
  title: string
  artist: string
  url: string
  bandUrl: string
  location: string | null
  tags: string[]
  genre: string
  bandcampGenre: string | null
  artUrl: string | null
}

interface DigDeeperResponse {
  items: Array<{
    title: string
    artist: string
    band_name: string
    tralbum_url: string
    band_url: string
    band_location?: string
    art_id?: number
    genre?: string
  }>
}

const FAILED_TAGS = [
  "mathcore", "grind", "war-metal", "raw-black-metal",
  "shoegaze", "dream-pop", "ethereal-wave", "blackgaze", "slowcore", "sadcore",
  "alternative", "indie-rock", "indie-pop", "lo-fi", "experimental",
  "art-punk", "art-rock", "garage-rock", "garage-punk",
  "psychedelic", "psych-rock", "krautrock", "math-rock",
  "post-rock", "post-metal", "space-rock", "surf-rock", "surf-punk",
  "witch-house", "synthwave", "synthpop", "electropunk", "protopunk",
  "jangle-pop", "c86", "twee", "riot-grrrl", "queercore", "afropunk",
  "dub", "ska",
]

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchTagPage(tag: string, page: number): Promise<BandcampItem[]> {
  const res = await fetch("https://bandcamp.com/api/hub/2/dig_deeper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: { format: "all", location: 0, sort: "date", tags: [tag] },
      page,
    }),
  })

  if (res.status === 429) throw new Error("429")
  if (!res.ok) throw new Error(`${res.status}`)

  const data = (await res.json()) as DigDeeperResponse
  if (!data.items) return []

  return data.items.map((item) => ({
    title: item.title,
    artist: item.artist || item.band_name,
    url: item.tralbum_url,
    bandUrl: item.band_url,
    location: item.band_location || null,
    tags: [tag],
    genre: tag,
    bandcampGenre: item.genre || null,
    artUrl: item.art_id ? `https://f4.bcbits.com/img/a${item.art_id}_2.jpg` : null,
  }))
}

function dedup(items: BandcampItem[]): BandcampItem[] {
  const map = new Map<string, BandcampItem>()
  for (const item of items) {
    const key = item.artist.toLowerCase().trim()
    const existing = map.get(key)
    if (existing) {
      const tagSet = new Set([...existing.tags, ...item.tags])
      existing.tags = [...tagSet]
    } else {
      map.set(key, { ...item })
    }
  }
  return [...map.values()]
}

async function main() {
  // Load existing data
  const existing: BandcampItem[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"))
  console.log(`Loaded ${existing.length} existing artists`)

  const newItems: BandcampItem[] = []
  const PAGES = 3

  for (const tag of FAILED_TAGS) {
    console.log(`[${tag}]`)
    for (let p = 1; p <= PAGES; p++) {
      let retries = 3
      while (retries > 0) {
        try {
          const items = await fetchTagPage(tag, p)
          newItems.push(...items)
          console.log(`  page ${p}: ${items.length} items`)
          if (items.length === 0) { retries = 0; break }
          await sleep(800)
          break
        } catch (err) {
          if (String(err).includes("429")) {
            retries--
            const wait = (4 - retries) * 5000
            console.log(`  ⏳ rate limited, waiting ${wait / 1000}s (${retries} retries left)`)
            await sleep(wait)
          } else {
            console.error(`  ✗ ${err}`)
            retries = 0
          }
        }
      }
    }
  }

  console.log(`\nNew items: ${newItems.length}`)
  const merged = dedup([...existing, ...newItems])
  console.log(`Merged: ${merged.length} unique artists`)

  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2))
  console.log(`Written to ${DATA_PATH}`)
}

main().catch(console.error)
