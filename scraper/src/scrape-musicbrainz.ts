import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/musicbrainz")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const TAGS_PATH = resolve(DATA_DIR, "tags.json")

// ── Types ────────────────────────────────────────────────────────────────────

interface MBSearchArtist {
  id: string
  name: string
  country?: string
  type?: string
  disambiguation?: string
  "life-span"?: {
    begin?: string
    end?: string
    ended?: boolean
  }
  tags?: Array<{ name: string; count: number }>
}

interface MBSearchResponse {
  created: string
  count: number
  offset: number
  artists: MBSearchArtist[]
}

interface MBArtistTagResponse {
  id: string
  name: string
  tags?: Array<{ name: string; count: number }>
}

interface Artist {
  name: string
  mbid: string
  country: string | null
  type: string | null
  beginYear: number | null
  endYear: number | null
  tags: string[]
  disambiguation: string | null
}

// ── Config ───────────────────────────────────────────────────────────────────

const DELAY_MS = 1200
const USER_AGENT = "PostPunkMap/1.0 (danieljohnmorris@gmail.com)"
const DISCOVERY_SAMPLE_SIZE = 200

const SEED_TAGS = [
  // Post-punk & adjacent
  "post-punk", "darkwave", "coldwave", "gothic rock", "goth", "deathrock",
  "minimal wave", "synth-punk", "no wave", "new wave", "batcave",
  "positive punk", "dark cabaret",

  // Noise & industrial
  "noise", "noise rock", "noise pop", "industrial", "industrial rock",
  "industrial metal", "ebm", "dark ambient", "dark electro", "harsh noise",
  "power electronics", "neofolk", "martial industrial", "death industrial",

  // Punk & hardcore
  "punk", "punk rock", "hardcore punk", "post-hardcore", "anarcho-punk",
  "crust punk", "d-beat", "grindcore", "powerviolence", "screamo",
  "emo", "midwest emo", "pop punk", "ska punk", "street punk",
  "oi", "garage punk", "art punk", "protopunk", "riot grrrl",
  "queercore", "afropunk", "folk punk", "horror punk", "psychobilly",
  "cowpunk",

  // Metal
  "black metal", "death metal", "doom metal", "sludge metal", "thrash metal",
  "heavy metal", "stoner metal", "stoner rock", "drone metal",
  "atmospheric black metal", "depressive black metal", "funeral doom",
  "progressive metal", "metalcore", "deathcore", "mathcore",
  "raw black metal", "post-metal", "blackgaze", "war metal",
  "speed metal", "grindcore", "goregrind", "pornogrind",
  "symphonic black metal", "melodic death metal", "technical death metal",
  "avant-garde metal", "nwobhm",

  // Shoegaze & dream
  "shoegaze", "dream pop", "ethereal wave", "slowcore", "sadcore",
  "space rock",

  // Indie & alternative
  "alternative rock", "indie rock", "indie pop", "lo-fi", "experimental",
  "art rock", "garage rock", "psychedelic rock", "krautrock", "math rock",
  "post-rock", "jangle pop", "c86", "twee pop", "noise pop",
  "experimental rock", "progressive rock",

  // Electronic adjacent
  "synthwave", "synthpop", "electropunk", "witch house", "aggrotech",
  "futurepop", "electronic body music",

  // Other
  "dub", "ska", "surf rock", "swamp rock", "gothic metal",
  "neo-psychedelia", "acid rock", "blues rock", "desert rock",
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

function parseYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4})/)
  return match ? parseInt(match[1], 10) : null
}

function mapArtist(a: MBSearchArtist): Artist {
  return {
    name: a.name,
    mbid: a.id,
    country: a.country || null,
    type: a.type || null,
    beginYear: parseYear(a["life-span"]?.begin),
    endYear: parseYear(a["life-span"]?.end),
    tags: (a.tags || []).map((t) => t.name),
    disambiguation: a.disambiguation || null,
  }
}

// ── MusicBrainz API ─────────────────────────────────────────────────────────

async function mbFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  })
  if (res.status === 503 || res.status === 429) {
    throw new Error(`rate-limited:${res.status}`)
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  }
  return res
}

async function fetchArtistsByTag(
  tag: string,
  offset: number
): Promise<{ artists: MBSearchArtist[]; total: number }> {
  const url = `https://musicbrainz.org/ws/2/artist?query=tag:${encodeURIComponent(tag)}&fmt=json&limit=100&offset=${offset}`
  const res = await mbFetch(url)
  const data = (await res.json()) as MBSearchResponse
  return { artists: data.artists || [], total: data.count || 0 }
}

async function fetchArtistTags(mbid: string): Promise<string[]> {
  const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=tags&fmt=json`
  const res = await mbFetch(url)
  const data = (await res.json()) as MBArtistTagResponse
  return (data.tags || []).map((t) => t.name)
}

// ── Scrape a single tag (all pages) ─────────────────────────────────────────

async function scrapeTag(tag: string): Promise<Artist[]> {
  const all: Artist[] = []
  let offset = 0

  while (true) {
    let retries = 3
    let result: { artists: MBSearchArtist[]; total: number } | null = null

    while (retries > 0) {
      try {
        result = await fetchArtistsByTag(tag, offset)
        break
      } catch (err) {
        if (String(err).includes("rate-limited")) {
          retries--
          const wait = (4 - retries) * 10000
          console.log(`    rate limited, waiting ${wait / 1000}s (${retries} retries left)`)
          await sleep(wait)
        } else {
          console.error(`    error at offset ${offset}: ${err}`)
          retries = 0
        }
      }
    }

    if (!result || result.artists.length === 0) break

    const artists = result.artists.map(mapArtist)
    all.push(...artists)

    console.log(`    offset ${offset}: ${artists.length} artists (${all.length}/${result.total} total)`)

    offset += 100
    if (offset >= result.total) break

    await sleep(DELAY_MS)
  }

  return all
}

// ── Tag discovery from artist tags ──────────────────────────────────────────

async function discoverNewTags(
  artists: Artist[],
  knownTags: Set<string>,
  sampleSize: number
): Promise<string[]> {
  const shuffled = [...artists].sort(() => Math.random() - 0.5)
  const sample = shuffled.slice(0, sampleSize)
  const newTags = new Set<string>()
  let done = 0

  for (const artist of sample) {
    done++
    if (done % 10 === 0) {
      process.stdout.write(
        `\r  Sampling artist tags: ${done}/${sample.length} (${newTags.size} new tags found)`
      )
    }

    let retries = 2
    while (retries > 0) {
      try {
        const tags = await fetchArtistTags(artist.mbid)
        for (const t of tags) {
          const normalized = t.toLowerCase().trim()
          if (normalized && !knownTags.has(normalized)) {
            newTags.add(normalized)
          }
        }
        break
      } catch (err) {
        if (String(err).includes("rate-limited")) {
          retries--
          await sleep(10000)
        } else {
          retries = 0
        }
      }
    }

    await sleep(DELAY_MS)
  }

  console.log(
    `\r  Sampling artist tags: ${done}/${sample.length} (${newTags.size} new tags found)`
  )

  return [...newTags].sort()
}

// ── Dedup by mbid ───────────────────────────────────────────────────────────

function dedup(artists: Artist[]): Artist[] {
  const map = new Map<string, Artist>()
  for (const artist of artists) {
    const existing = map.get(artist.mbid)
    if (existing) {
      const tagSet = new Set([...existing.tags, ...artist.tags])
      existing.tags = [...tagSet]
    } else {
      map.set(artist.mbid, { ...artist })
    }
  }
  return [...map.values()]
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  // Ensure data dir exists
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // Load existing state
  let allArtists: Artist[] = loadJson(ARTISTS_PATH, [])
  const scrapedTags: Set<string> = new Set(loadJson<string[]>(TAGS_PATH, []))

  console.log(`Loaded: ${allArtists.length} artists, ${scrapedTags.size} scraped tags\n`)

  // Build initial tag queue from seeds (skip already scraped)
  const tagQueue: string[] = []
  for (const t of SEED_TAGS) {
    const normalized = t.toLowerCase().trim()
    if (!scrapedTags.has(normalized)) tagQueue.push(normalized)
  }

  let round = 0

  while (true) {
    round++

    // ── Scrape queued tags ──────────────────────────────────────────────
    if (tagQueue.length > 0) {
      console.log(`\n=== Round ${round}: Scraping ${tagQueue.length} tags ===\n`)

      for (let i = 0; i < tagQueue.length; i++) {
        const tag = tagQueue[i]
        console.log(`[${i + 1}/${tagQueue.length}] "${tag}"`)
        const artists = await scrapeTag(tag)
        allArtists.push(...artists)
        scrapedTags.add(tag)

        // Save progress every 5 tags
        if ((i + 1) % 5 === 0) {
          allArtists = dedup(allArtists)
          saveJson(ARTISTS_PATH, allArtists)
          saveJson(TAGS_PATH, [...scrapedTags].sort())
          console.log(`  saved: ${allArtists.length} artists, ${scrapedTags.size} tags`)
        }

        await sleep(DELAY_MS)
      }

      // Save after batch
      allArtists = dedup(allArtists)
      saveJson(ARTISTS_PATH, allArtists)
      saveJson(TAGS_PATH, [...scrapedTags].sort())
      console.log(`\nBatch done: ${allArtists.length} unique artists, ${scrapedTags.size} tags scraped`)
    }

    // ── Discover new tags ──────────────────────────────────────────────
    console.log(
      `\n=== Discovering new tags (sampling ${DISCOVERY_SAMPLE_SIZE} artists) ===\n`
    )
    const newTags = await discoverNewTags(allArtists, scrapedTags, DISCOVERY_SAMPLE_SIZE)

    if (newTags.length === 0) {
      console.log("\nNo new tags found -- scrape complete!")
      break
    }

    console.log(`\nDiscovered ${newTags.length} new tags:`)
    console.log(`  ${newTags.slice(0, 30).join(", ")}${newTags.length > 30 ? "..." : ""}`)

    // Queue new tags and loop
    tagQueue.length = 0
    tagQueue.push(...newTags)
  }

  // Final save
  allArtists = dedup(allArtists)
  saveJson(ARTISTS_PATH, allArtists)
  saveJson(TAGS_PATH, [...scrapedTags].sort())
  console.log(`\nFinal: ${allArtists.length} unique artists across ${scrapedTags.size} tags`)
}

main().catch(console.error)
