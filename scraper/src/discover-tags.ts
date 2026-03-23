import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = resolve(__dirname, "../../data/bandcamp/artists.json")
const TAGS_PATH = resolve(__dirname, "../../data/bandcamp/discovered-tags.json")

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
  }>
}

// Tags we've already scraped (from scrape.ts DEFAULT_TAGS)
const KNOWN_TAGS = new Set([
  "post-punk", "darkwave", "coldwave", "gothic-rock", "goth", "deathrock",
  "minimal-wave", "minimal-synth", "synth-punk", "no-wave", "new-wave", "batcave",
  "noise", "noise-rock", "noise-pop", "power-electronics", "industrial",
  "industrial-rock", "ebm", "dark-electro", "dark-ambient", "harsh-noise",
  "harsh-noise-wall", "japanoise", "neofolk", "martial-industrial",
  "punk", "hardcore", "hardcore-punk", "post-hardcore", "anarcho-punk", "oi",
  "street-punk", "crust-punk", "d-beat", "grindcore", "powerviolence", "screamo",
  "skramz", "emo", "midwest-emo", "pop-punk", "ska-punk",
  "black-metal", "death-metal", "doom-metal", "sludge", "sludge-metal",
  "stoner-metal", "stoner-rock", "thrash-metal", "speed-metal", "heavy-metal",
  "drone-metal", "atmospheric-black-metal", "depressive-black-metal",
  "funeral-doom", "progressive-metal", "metalcore", "deathcore", "mathcore",
  "grind", "war-metal", "raw-black-metal",
  "shoegaze", "dream-pop", "ethereal-wave", "blackgaze", "slowcore", "sadcore",
  "alternative", "indie-rock", "indie-pop", "lo-fi", "experimental", "art-punk",
  "art-rock", "garage-rock", "garage-punk", "psychedelic", "psych-rock",
  "krautrock", "math-rock", "post-rock", "post-metal", "space-rock",
  "surf-rock", "surf-punk", "witch-house", "synthwave", "synthpop",
  "electropunk", "protopunk", "jangle-pop", "c86", "twee", "riot-grrrl",
  "queercore", "afropunk", "dub", "ska",
])

// Skip location tags and overly generic ones
const SKIP_PATTERNS = [
  // Locations will be lowercase city/country names — skip any single word
  // that doesn't contain a genre-like keyword
  /^(united|states|kingdom|uk|usa|us|canada|australia|germany|france|japan|brazil|mexico|spain|italy|sweden|norway|finland|russia|poland|netherlands|belgium|austria|switzerland|czech|denmark|portugal|argentina|chile|colombia|indonesia|malaysia|philippines|thailand|vietnam|india|china|korea|taiwan|new zealand)$/i,
]

// Only keep tags that look like genre/style tags
function isGenreTag(tag: string): boolean {
  // Skip if it's a known location (cities get caught by the discover URL pattern)
  if (tag.length < 3) return false
  if (/^\d+$/.test(tag)) return false
  for (const p of SKIP_PATTERNS) {
    if (p.test(tag)) return false
  }
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Step 1: Discover tags from album pages ───────────────────────────────────

async function extractTagsFromAlbum(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  })
  if (!res.ok) return []

  const html = await res.text()
  const $ = cheerio.load(html)
  const tags: string[] = []

  // Tags are links to bandcamp.com/discover/<tag-slug>
  $('a[href*="bandcamp.com/discover/"]').each((_, el) => {
    const href = $(el).attr("href") || ""
    const match = href.match(/\/discover\/([^?]+)/)
    if (match) {
      tags.push(match[1].toLowerCase())
    }
  })

  // Also check for tag links in the format /tag/<slug>
  $('a[href*="bandcamp.com/tag/"]').each((_, el) => {
    const href = $(el).attr("href") || ""
    const match = href.match(/\/tag\/([^?]+)/)
    if (match) {
      tags.push(match[1].toLowerCase())
    }
  })

  return [...new Set(tags)]
}

async function discoverNewTags(
  items: BandcampItem[],
  sampleSize: number
): Promise<string[]> {
  // Shuffle and sample
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  const sample = shuffled.slice(0, sampleSize)

  const allTags = new Set<string>()
  let fetched = 0

  for (const item of sample) {
    fetched++
    process.stdout.write(`\r  Sampling album pages: ${fetched}/${sample.length}`)
    try {
      const tags = await extractTagsFromAlbum(item.url)
      for (const t of tags) {
        if (!KNOWN_TAGS.has(t) && isGenreTag(t)) {
          allTags.add(t)
        }
      }
      await sleep(400)
    } catch {
      // skip failures
    }
  }
  console.log()

  return [...allTags].sort()
}

// ── Step 2: Scrape new tags via API ──────────────────────────────────────────

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

async function scrapeNewTags(
  newTags: string[],
  pages: number
): Promise<BandcampItem[]> {
  const allItems: BandcampItem[] = []

  for (const tag of newTags) {
    console.log(`  [${tag}]`)
    for (let p = 1; p <= pages; p++) {
      let retries = 3
      while (retries > 0) {
        try {
          const items = await fetchTagPage(tag, p)
          allItems.push(...items)
          console.log(`    page ${p}: ${items.length} items`)
          if (items.length === 0) { retries = 0; break }
          await sleep(800)
          break
        } catch (err) {
          if (String(err).includes("429")) {
            retries--
            const wait = (4 - retries) * 5000
            console.log(`    ⏳ rate limited, waiting ${wait / 1000}s`)
            await sleep(wait)
          } else {
            console.error(`    ✗ ${err}`)
            retries = 0
          }
        }
      }
    }
  }

  return allItems
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SAMPLE_SIZE = parseInt(process.env.SAMPLE || "200", 10)
  const PAGES = parseInt(process.env.PAGES || "2", 10)
  const ROUNDS = parseInt(process.env.ROUNDS || "2", 10)

  let existing: BandcampItem[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"))
  console.log(`Loaded ${existing.length} existing artists\n`)

  const allDiscoveredTags: string[] = []

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`═══ Round ${round}/${ROUNDS} ═══`)

    // Discover new tags
    console.log(`\nStep 1: Discovering tags from ${SAMPLE_SIZE} random album pages...`)
    const newTags = await discoverNewTags(existing, SAMPLE_SIZE)
    console.log(`  Found ${newTags.length} new tags: ${newTags.join(", ")}\n`)

    if (newTags.length === 0) {
      console.log("No new tags to scrape — done!")
      break
    }

    allDiscoveredTags.push(...newTags)

    // Add new tags to known set so next round doesn't re-discover them
    for (const t of newTags) KNOWN_TAGS.add(t)

    // Scrape new tags
    console.log(`Step 2: Scraping ${newTags.length} new tags (${PAGES} pages each)...`)
    const newItems = await scrapeNewTags(newTags, PAGES)
    console.log(`  Got ${newItems.length} new items\n`)

    // Merge
    existing = dedup([...existing, ...newItems])
    console.log(`  Total unique artists: ${existing.length}\n`)
  }

  // Save
  writeFileSync(DATA_PATH, JSON.stringify(existing, null, 2))
  console.log(`Written ${existing.length} artists to ${DATA_PATH}`)

  writeFileSync(TAGS_PATH, JSON.stringify(allDiscoveredTags.sort(), null, 2))
  console.log(`Discovered tags saved to ${TAGS_PATH}`)
}

main().catch(console.error)
