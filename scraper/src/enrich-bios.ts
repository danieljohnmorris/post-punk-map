import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(__dirname, "../../data")
const OUTPUT_DIR = resolve(DATA_ROOT, "enriched")
const OUTPUT_PATH = resolve(OUTPUT_DIR, "artists.json")

// ── Types ────────────────────────────────────────────────────────────────────

interface EnrichedArtist {
  name: string
  bio: string | null
  tags: string[]
  country: string | null
  beginYear: number | null
  listeners: number | null
  sources: string[]
  urls: Record<string, string>
}

interface BandcampItem {
  artist: string
  url: string
  bandUrl: string
  location: string | null
  tags: string[]
  [key: string]: unknown
}

interface MusicBrainzItem {
  name: string
  mbid: string
  country: string | null
  beginYear: number | null
  tags: string[]
  [key: string]: unknown
}

interface LastfmItem {
  name: string
  mbid: string
  listeners: number
  tags: string[]
  url: string
  [key: string]: unknown
}

interface WikipediaItem {
  name: string
  genres: string[]
  wikiUrl: string
  country: string | null
}

interface DiscogsItem {
  name: string
  labels: string[]
  discogsUrl: string
}

interface WebItem {
  name: string
  similarTo: string[]
  sources: string[]
  genres: string[]
  mentions: number
}

interface LastfmArtistInfoResponse {
  artist?: {
    name?: string
    bio?: {
      summary?: string
      content?: string
    }
    tags?: {
      tag?: Array<{ name: string }>
    }
    stats?: {
      listeners?: string
      playcount?: string
    }
    url?: string
  }
  error?: number
  message?: string
}

// ── Config ───────────────────────────────────────────────────────────────────

const API_KEY = "b25b959554ed76058ac220b7b2e0a026"
const BASE_URL = "https://ws.audioscrobbler.com/2.0/"
const DELAY_MS = 300

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

function artistKey(name: string): string {
  return name.toLowerCase().trim()
}

function stripHtml(html: string): string {
  return html
    .replace(/<a\b[^>]*>.*?<\/a>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Last.fm API ──────────────────────────────────────────────────────────────

async function fetchArtistInfo(artistName: string): Promise<LastfmArtistInfoResponse | null> {
  const url = new URL(BASE_URL)
  url.searchParams.set("method", "artist.getinfo")
  url.searchParams.set("artist", artistName)
  url.searchParams.set("api_key", API_KEY)
  url.searchParams.set("format", "json")

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "PostPunkMapScraper/1.0" },
      })

      if (res.status === 429) {
        const wait = attempt * 10000
        console.log(`    Rate limited, waiting ${wait / 1000}s...`)
        await sleep(wait)
        continue
      }

      if (!res.ok) {
        if (attempt < 3) {
          await sleep(2000)
          continue
        }
        return null
      }

      return (await res.json()) as LastfmArtistInfoResponse
    } catch {
      if (attempt < 3) {
        await sleep(2000)
        continue
      }
      return null
    }
  }

  return null
}

// ── Load all sources ─────────────────────────────────────────────────────────

interface SourceData {
  name: string
  source: string
  tags: string[]
  country: string | null
  beginYear: number | null
  listeners: number | null
  url: string | null
}

function loadAllSources(): SourceData[] {
  const all: SourceData[] = []

  // Bandcamp
  const bandcamp = loadJson<BandcampItem[]>(resolve(DATA_ROOT, "bandcamp/artists.json"), [])
  for (const item of bandcamp) {
    all.push({
      name: item.artist,
      source: "bandcamp",
      tags: item.tags || [],
      country: null,
      beginYear: null,
      listeners: null,
      url: item.bandUrl || item.url,
    })
  }
  console.log(`  bandcamp: ${bandcamp.length} items`)

  // MusicBrainz
  const musicbrainz = loadJson<MusicBrainzItem[]>(resolve(DATA_ROOT, "musicbrainz/artists.json"), [])
  for (const item of musicbrainz) {
    all.push({
      name: item.name,
      source: "musicbrainz",
      tags: item.tags || [],
      country: item.country || null,
      beginYear: item.beginYear || null,
      listeners: null,
      url: null,
    })
  }
  console.log(`  musicbrainz: ${musicbrainz.length} items`)

  // Last.fm
  const lastfm = loadJson<LastfmItem[]>(resolve(DATA_ROOT, "lastfm/artists.json"), [])
  for (const item of lastfm) {
    all.push({
      name: item.name,
      source: "lastfm",
      tags: item.tags || [],
      country: null,
      beginYear: null,
      listeners: item.listeners || null,
      url: item.url || null,
    })
  }
  console.log(`  lastfm: ${lastfm.length} items`)

  // Wikipedia
  const wikipedia = loadJson<WikipediaItem[]>(resolve(DATA_ROOT, "wikipedia/artists.json"), [])
  for (const item of wikipedia) {
    all.push({
      name: item.name,
      source: "wikipedia",
      tags: item.genres || [],
      country: item.country || null,
      beginYear: null,
      listeners: null,
      url: item.wikiUrl || null,
    })
  }
  console.log(`  wikipedia: ${wikipedia.length} items`)

  // Discogs
  const discogs = loadJson<DiscogsItem[]>(resolve(DATA_ROOT, "discogs/artists.json"), [])
  for (const item of discogs) {
    all.push({
      name: item.name,
      source: "discogs",
      tags: [],
      country: null,
      beginYear: null,
      listeners: null,
      url: item.discogsUrl || null,
    })
  }
  console.log(`  discogs: ${discogs.length} items`)

  // Web (object keyed by lowercase name)
  const web = loadJson<Record<string, WebItem>>(resolve(DATA_ROOT, "web/artists.json"), {})
  for (const item of Object.values(web)) {
    all.push({
      name: item.name,
      source: "web",
      tags: item.genres || [],
      country: null,
      beginYear: null,
      listeners: null,
      url: null,
    })
  }
  console.log(`  web: ${Object.keys(web).length} items`)

  return all
}

// ── Dedup & merge into unified list ──────────────────────────────────────────

function buildUnifiedList(sources: SourceData[]): Map<string, EnrichedArtist> {
  const map = new Map<string, EnrichedArtist>()

  for (const s of sources) {
    if (!s.name || s.name.trim().length === 0) continue

    const key = artistKey(s.name)
    const existing = map.get(key)

    if (existing) {
      // Prefer MusicBrainz or Last.fm capitalization
      if (s.source === "musicbrainz" || (s.source === "lastfm" && !existing.sources.includes("musicbrainz"))) {
        existing.name = s.name
      }

      // Merge tags
      const tagSet = new Set([...existing.tags, ...s.tags.map((t) => t.toLowerCase().trim())])
      existing.tags = [...tagSet].filter((t) => t.length > 0)

      // Country: prefer MusicBrainz
      if (s.country) {
        if (s.source === "musicbrainz" || !existing.country) {
          existing.country = s.country
        }
      }

      // Begin year: from MusicBrainz
      if (s.beginYear && (s.source === "musicbrainz" || !existing.beginYear)) {
        existing.beginYear = s.beginYear
      }

      // Listeners: from Last.fm (take higher)
      if (s.listeners && (!existing.listeners || s.listeners > existing.listeners)) {
        existing.listeners = s.listeners
      }

      // Sources
      if (!existing.sources.includes(s.source)) {
        existing.sources.push(s.source)
      }

      // URLs
      if (s.url) {
        existing.urls[s.source] = s.url
      }
    } else {
      map.set(key, {
        name: s.name,
        bio: null,
        tags: s.tags.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 0),
        country: s.country,
        beginYear: s.beginYear,
        listeners: s.listeners,
        sources: [s.source],
        urls: s.url ? { [s.source]: s.url } : {},
      })
    }
  }

  return map
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading artists from all sources...\n")
  const sources = loadAllSources()
  console.log(`\nTotal source records: ${sources.length}`)

  const artistMap = buildUnifiedList(sources)
  console.log(`Unified unique artists: ${artistMap.size}\n`)

  // Load existing enriched data to resume
  const existingEnriched = loadJson<EnrichedArtist[]>(OUTPUT_PATH, [])
  const enrichedMap = new Map<string, EnrichedArtist>()
  for (const a of existingEnriched) {
    enrichedMap.set(artistKey(a.name), a)
  }
  console.log(`Already enriched: ${enrichedMap.size}`)

  // Merge existing enriched data back (preserve bios already fetched)
  for (const [key, existing] of enrichedMap) {
    const unified = artistMap.get(key)
    if (unified && existing.bio) {
      unified.bio = existing.bio
      // Also preserve any lastfm URL and listeners from previous enrichment
      if (existing.urls.lastfm) unified.urls.lastfm = existing.urls.lastfm
      if (existing.listeners) unified.listeners = existing.listeners
    }
  }

  // Build list of artists that still need bio enrichment
  const allArtists = [...artistMap.values()]
  const needsBio = allArtists.filter((a) => !a.bio)
  console.log(`Need bio enrichment: ${needsBio.length}\n`)

  const BATCH = parseInt(process.env.BATCH || "0", 10) || needsBio.length
  const batch = needsBio.slice(0, BATCH)
  console.log(`Processing batch of ${batch.length} artists\n`)

  let done = 0
  let biosFetched = 0
  let errors = 0

  for (const artist of batch) {
    done++

    if (done % 10 === 0 || done === 1) {
      process.stdout.write(
        `\r  ${done}/${batch.length} | ${biosFetched} bios fetched, ${errors} errors`
      )
    }

    try {
      const info = await fetchArtistInfo(artist.name)
      await sleep(DELAY_MS)

      if (!info || info.error) {
        errors++
        continue
      }

      const a = info.artist
      if (!a) continue

      // Bio: use summary, strip HTML
      if (a.bio?.summary) {
        const cleaned = stripHtml(a.bio.summary)
        if (cleaned.length > 10) {
          artist.bio = cleaned
          biosFetched++
        }
      }

      // Prefer Last.fm capitalization if we don't already have MusicBrainz
      if (a.name && !artist.sources.includes("musicbrainz")) {
        artist.name = a.name
      }

      // Merge tags from artist.getinfo
      if (a.tags?.tag) {
        const newTags = a.tags.tag.map((t) => t.name.toLowerCase().trim())
        const tagSet = new Set([...artist.tags, ...newTags])
        artist.tags = [...tagSet].filter((t) => t.length > 0)
      }

      // Listeners from stats
      if (a.stats?.listeners) {
        const listeners = parseInt(a.stats.listeners, 10)
        if (listeners > 0) {
          artist.listeners = listeners
        }
      }

      // Last.fm URL
      if (a.url) {
        artist.urls.lastfm = a.url
      }

      if (!artist.sources.includes("lastfm")) {
        artist.sources.push("lastfm")
      }
    } catch {
      errors++
    }

    // Save progress every 100 artists
    if (done % 100 === 0) {
      saveJson(OUTPUT_PATH, allArtists)
      console.log(`\n  Saved progress (${done}/${batch.length})`)
    }
  }

  console.log(`\n\nDone. ${biosFetched} bios fetched, ${errors} errors.`)

  // Sort by listeners descending (null last)
  allArtists.sort((a, b) => (b.listeners || 0) - (a.listeners || 0))

  saveJson(OUTPUT_PATH, allArtists)
  console.log(`Written ${allArtists.length} artists to ${OUTPUT_PATH}`)
}

main().catch(console.error)
