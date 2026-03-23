import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/bandcamp")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const TAGS_PATH = resolve(DATA_DIR, "tags.json")

// ── Types ────────────────────────────────────────────────────────────────────

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
    subdomain?: string
  }>
}

// ── Config ───────────────────────────────────────────────────────────────────

const DELAY_MS = 2000
const MAX_PAGES = 30
const SORT_MODES = ["pop", "date"]
const DISCOVERY_SAMPLE_SIZE = 300 // album pages to sample for new tags per round
const DISCOVERY_DELAY_MS = 300

// Seed tags — the starting point. Everything else is discovered.
const SEED_TAGS = [
  "post-punk", "darkwave", "coldwave", "gothic-rock", "goth", "deathrock",
  "minimal-wave", "synth-punk", "no-wave", "new-wave",
  "noise", "noise-rock", "noise-pop", "industrial", "ebm", "dark-ambient",
  "punk", "hardcore", "hardcore-punk", "post-hardcore", "anarcho-punk",
  "crust-punk", "d-beat", "grindcore", "powerviolence", "screamo", "emo",
  "black-metal", "death-metal", "doom-metal", "sludge-metal", "thrash-metal",
  "heavy-metal", "stoner-metal",
  "shoegaze", "dream-pop", "ethereal-wave",
  "alternative", "indie-rock", "indie-pop", "lo-fi", "experimental",
  "art-punk", "garage-rock", "psychedelic", "krautrock", "math-rock",
  "post-rock", "post-metal", "synthwave",
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8"))
}

function saveJson(path: string, data: unknown) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

// ── Bandcamp API ─────────────────────────────────────────────────────────────

async function fetchTagPage(
  tag: string,
  page: number,
  sort: string
): Promise<BandcampItem[]> {
  const res = await fetch("https://bandcamp.com/api/hub/2/dig_deeper", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: JSON.stringify({
      filters: { format: "all", location: 0, sort, tags: [tag] },
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

async function scrapeTag(tag: string): Promise<BandcampItem[]> {
  const all: BandcampItem[] = []
  for (const sort of SORT_MODES) {
    for (let p = 1; p <= MAX_PAGES; p++) {
      let retries = 3
      while (retries > 0) {
        try {
          const items = await fetchTagPage(tag, p, sort)
          all.push(...items)
          if (items.length === 0) { retries = 0; break }
          await sleep(DELAY_MS)
          break
        } catch (err) {
          if (String(err).includes("429")) {
            retries--
            const wait = (4 - retries) * 30000 // 30s, 60s, 90s
            console.log(`    ⏳ 429, waiting ${wait / 1000}s`)
            await sleep(wait)
          } else {
            retries = 0
          }
        }
      }
    }
  }
  return all
}

// ── Tag discovery from album pages ──────────────────────────────────────────

async function discoverTagsFromAlbum(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    })
    if (!res.ok) return []
    const html = await res.text()
    const $ = cheerio.load(html)
    const tags: string[] = []

    $('a[href*="bandcamp.com/discover/"]').each((_, el) => {
      const match = ($(el).attr("href") || "").match(/\/discover\/([^?]+)/)
      if (match) tags.push(decodeURIComponent(match[1]).toLowerCase())
    })
    $('a[href*="bandcamp.com/tag/"]').each((_, el) => {
      const match = ($(el).attr("href") || "").match(/\/tag\/([^?]+)/)
      if (match) tags.push(decodeURIComponent(match[1]).toLowerCase())
    })

    return [...new Set(tags)]
  } catch {
    return []
  }
}

async function discoverNewTags(
  items: BandcampItem[],
  knownTags: Set<string>,
  sampleSize: number
): Promise<string[]> {
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  const sample = shuffled.slice(0, sampleSize)
  const newTags = new Set<string>()
  let done = 0

  for (const item of sample) {
    done++
    if (done % 20 === 0) {
      process.stdout.write(`\r  Sampling: ${done}/${sample.length} (${newTags.size} new tags)`)
    }
    const tags = await discoverTagsFromAlbum(item.url)
    for (const t of tags) {
      if (!knownTags.has(t)) newTags.add(t)
    }
    await sleep(DISCOVERY_DELAY_MS)
  }
  console.log(`\r  Sampling: ${done}/${sample.length} (${newTags.size} new tags)`)

  return [...newTags].sort()
}

// ── Dedup ────────────────────────────────────────────────────────────────────

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

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  // Load existing state
  let allItems: BandcampItem[] = loadJson(ARTISTS_PATH, [])
  const scrapedTags: Set<string> = new Set(loadJson<string[]>(TAGS_PATH, []))

  console.log(`Loaded: ${allItems.length} artists, ${scrapedTags.size} scraped tags\n`)

  // Build initial tag queue: seed tags + any previously known but unscraped
  const tagQueue: string[] = []
  for (const t of SEED_TAGS) {
    if (!scrapedTags.has(t)) tagQueue.push(t)
  }

  let round = 0

  while (true) {
    round++

    // ── Scrape queued tags ──────────────────────────────────────────────
    if (tagQueue.length > 0) {
      console.log(`\n═══ Round ${round}: Scraping ${tagQueue.length} tags ═══\n`)

      for (let i = 0; i < tagQueue.length; i++) {
        const tag = tagQueue[i]
        console.log(`[${i + 1}/${tagQueue.length}] ${tag}`)
        const items = await scrapeTag(tag)
        allItems.push(...items)
        scrapedTags.add(tag)

        // Save progress every 5 tags
        if ((i + 1) % 5 === 0) {
          allItems = dedup(allItems)
          saveJson(ARTISTS_PATH, allItems)
          saveJson(TAGS_PATH, [...scrapedTags].sort())
          console.log(`  💾 saved: ${allItems.length} artists, ${scrapedTags.size} tags`)
        }
      }

      // Save after batch
      allItems = dedup(allItems)
      saveJson(ARTISTS_PATH, allItems)
      saveJson(TAGS_PATH, [...scrapedTags].sort())
      console.log(`\nBatch done: ${allItems.length} unique artists, ${scrapedTags.size} tags scraped`)
    }

    // ── Discover new tags ──────────────────────────────────────────────
    console.log(`\n═══ Discovering new tags (sampling ${DISCOVERY_SAMPLE_SIZE} albums) ═══\n`)
    const newTags = await discoverNewTags(allItems, scrapedTags, DISCOVERY_SAMPLE_SIZE)

    if (newTags.length === 0) {
      console.log("\nNo new tags found — scrape complete!")
      break
    }

    console.log(`\nDiscovered ${newTags.length} new tags:`)
    console.log(`  ${newTags.slice(0, 30).join(", ")}${newTags.length > 30 ? "..." : ""}`)

    // Queue new tags and loop
    tagQueue.length = 0
    tagQueue.push(...newTags)
  }

  // Final save
  allItems = dedup(allItems)
  saveJson(ARTISTS_PATH, allItems)
  saveJson(TAGS_PATH, [...scrapedTags].sort())
  console.log(`\n✓ Final: ${allItems.length} unique artists across ${scrapedTags.size} tags`)
}

main().catch(console.error)
