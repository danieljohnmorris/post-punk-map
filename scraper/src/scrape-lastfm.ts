import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/lastfm")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const TAGS_PATH = resolve(DATA_DIR, "tags.json")

// ── Types ────────────────────────────────────────────────────────────────────

interface LastfmArtist {
  name: string
  mbid: string
  listeners: number
  tags: string[]
  similarTo: string[]
  url: string
}

interface TagTopArtistsResponse {
  topartists?: {
    artist?: Array<{
      name: string
      mbid?: string
      url?: string
      listeners?: string
    }>
    "@attr"?: {
      total?: string
      totalPages?: string
      page?: string
    }
  }
  error?: number
  message?: string
}

interface ArtistTopTagsResponse {
  toptags?: {
    tag?: Array<{
      name: string
      count: number
    }>
  }
  error?: number
}

interface ArtistSimilarResponse {
  similarartists?: {
    artist?: Array<{
      name: string
      mbid?: string
      url?: string
    }>
  }
  error?: number
}

// ── Config ───────────────────────────────────────────────────────────────────

const API_KEY = "b25b959554ed76058ac220b7b2e0a026"
const BASE_URL = "https://ws.audioscrobbler.com/2.0/"
const DELAY_MS = 300
const PER_PAGE = 200
const SIMILAR_SAMPLE_SIZE = 200
const SIMILAR_LIMIT = 50

const SEED_TAGS = [
  "post-punk", "darkwave", "coldwave", "gothic rock", "goth", "deathrock",
  "industrial", "ebm", "noise", "noise rock", "shoegaze", "dream pop",
  "punk", "hardcore", "black metal", "death metal", "doom metal", "sludge",
  "experimental", "art punk", "garage rock", "post-rock", "math rock",
  "synthwave", "new wave", "minimal wave", "no wave", "krautrock",
  "psychedelic",
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

function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim()
}

function artistKey(name: string): string {
  return name.toLowerCase().trim()
}

// ── Last.fm API ──────────────────────────────────────────────────────────────

async function apiCall(params: Record<string, string>): Promise<unknown> {
  const url = new URL(BASE_URL)
  url.searchParams.set("api_key", API_KEY)
  url.searchParams.set("format", "json")
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "PostPunkMapScraper/1.0",
    },
  })

  if (res.status === 429) throw new Error("429")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  return res.json()
}

async function apiCallWithRetry(params: Record<string, string>, retries = 3): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await apiCall(params)
      await sleep(DELAY_MS)
      return result
    } catch (err) {
      if (String(err).includes("429") && attempt < retries) {
        const wait = attempt * 10000
        console.log(`    Rate limited, waiting ${wait / 1000}s...`)
        await sleep(wait)
        continue
      }
      if (attempt < retries) {
        await sleep(2000)
        continue
      }
      throw err
    }
  }
  throw new Error("Unreachable")
}

// ── Fetch tag top artists (all pages) ────────────────────────────────────────

async function fetchTagArtists(tag: string): Promise<Array<{ name: string; mbid: string; listeners: number; url: string }>> {
  const artists: Array<{ name: string; mbid: string; listeners: number; url: string }> = []
  let page = 1

  while (true) {
    const data = await apiCallWithRetry({
      method: "tag.gettopartists",
      tag,
      limit: String(PER_PAGE),
      page: String(page),
    }) as TagTopArtistsResponse

    if (data.error) {
      console.log(`    API error for tag "${tag}": ${data.message || data.error}`)
      break
    }

    const items = data.topartists?.artist
    if (!items || items.length === 0) break

    for (const a of items) {
      artists.push({
        name: a.name,
        mbid: a.mbid || "",
        listeners: parseInt(a.listeners || "0", 10),
        url: a.url || `https://www.last.fm/music/${encodeURIComponent(a.name)}`,
      })
    }

    const totalPages = parseInt(data.topartists?.["@attr"]?.totalPages || "1", 10)
    if (page >= totalPages) break
    page++
  }

  return artists
}

// ── Fetch artist top tags ────────────────────────────────────────────────────

async function fetchArtistTags(artistName: string): Promise<string[]> {
  try {
    const data = await apiCallWithRetry({
      method: "artist.gettoptags",
      artist: artistName,
    }) as ArtistTopTagsResponse

    if (data.error || !data.toptags?.tag) return []

    return data.toptags.tag
      .filter((t) => t.count >= 10)
      .map((t) => normalizeTag(t.name))
      .filter((t) => t.length > 1 && t.length < 60)
  } catch {
    return []
  }
}

// ── Fetch similar artists ────────────────────────────────────────────────────

async function fetchSimilarArtists(artistName: string): Promise<string[]> {
  try {
    const data = await apiCallWithRetry({
      method: "artist.getsimilar",
      artist: artistName,
      limit: String(SIMILAR_LIMIT),
    }) as ArtistSimilarResponse

    if (data.error || !data.similarartists?.artist) return []

    return data.similarartists.artist.map((a) => a.name)
  } catch {
    return []
  }
}

// ── Dedup & merge ────────────────────────────────────────────────────────────

function dedup(artists: LastfmArtist[]): LastfmArtist[] {
  const map = new Map<string, LastfmArtist>()

  for (const artist of artists) {
    const key = artistKey(artist.name)
    const existing = map.get(key)
    if (existing) {
      existing.tags = [...new Set([...existing.tags, ...artist.tags])]
      existing.similarTo = [...new Set([...existing.similarTo, ...artist.similarTo])]
      if (!existing.mbid && artist.mbid) existing.mbid = artist.mbid
      if (artist.listeners > existing.listeners) existing.listeners = artist.listeners
    } else {
      map.set(key, { ...artist, tags: [...artist.tags], similarTo: [...artist.similarTo] })
    }
  }

  return [...map.values()]
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let allArtists: LastfmArtist[] = loadJson(ARTISTS_PATH, [])
  const scrapedTags = new Set<string>(loadJson<string[]>(TAGS_PATH, []))

  console.log(`Loaded: ${allArtists.length} artists, ${scrapedTags.size} scraped tags\n`)

  const tagQueue: string[] = []
  for (const t of SEED_TAGS) {
    if (!scrapedTags.has(normalizeTag(t))) tagQueue.push(normalizeTag(t))
  }

  let round = 0

  while (true) {
    round++

    // ── Scrape queued tags ──────────────────────────────────────────────
    if (tagQueue.length > 0) {
      console.log(`\n=== Round ${round}: Scraping ${tagQueue.length} tags ===\n`)

      for (let i = 0; i < tagQueue.length; i++) {
        const tag = tagQueue[i]
        console.log(`[${i + 1}/${tagQueue.length}] ${tag}`)

        const tagArtists = await fetchTagArtists(tag)
        console.log(`  Found ${tagArtists.length} artists`)

        for (const a of tagArtists) {
          allArtists.push({
            name: a.name,
            mbid: a.mbid,
            listeners: a.listeners,
            tags: [tag],
            similarTo: [],
            url: a.url,
          })
        }

        scrapedTags.add(tag)

        // Save every 5 tags
        if ((i + 1) % 5 === 0) {
          allArtists = dedup(allArtists)
          saveJson(ARTISTS_PATH, allArtists)
          saveJson(TAGS_PATH, [...scrapedTags].sort())
          console.log(`  Saved: ${allArtists.length} artists, ${scrapedTags.size} tags`)
        }
      }

      // Save after batch
      allArtists = dedup(allArtists)
      saveJson(ARTISTS_PATH, allArtists)
      saveJson(TAGS_PATH, [...scrapedTags].sort())
      console.log(`\nBatch done: ${allArtists.length} unique artists, ${scrapedTags.size} tags scraped`)
    }

    // ── Discover new tags from artist top tags ─────────────────────────
    console.log(`\n=== Discovering new tags (sampling ${SIMILAR_SAMPLE_SIZE} artists) ===\n`)

    const shuffled = [...allArtists].sort(() => Math.random() - 0.5)
    const sample = shuffled.slice(0, SIMILAR_SAMPLE_SIZE)
    const newTags = new Set<string>()
    let sampled = 0

    for (const artist of sample) {
      sampled++
      if (sampled % 20 === 0) {
        process.stdout.write(`\r  Tag discovery: ${sampled}/${sample.length} (${newTags.size} new tags)`)
      }

      const tags = await fetchArtistTags(artist.name)
      for (const t of tags) {
        if (!scrapedTags.has(t) && !newTags.has(t)) {
          newTags.add(t)
        }
      }

      // Also merge discovered tags into the artist record
      const key = artistKey(artist.name)
      const existing = allArtists.find((a) => artistKey(a.name) === key)
      if (existing) {
        existing.tags = [...new Set([...existing.tags, ...tags])]
      }
    }
    console.log(`\r  Tag discovery: ${sampled}/${sample.length} (${newTags.size} new tags)`)

    // ── Fetch similar artists for a sample ─────────────────────────────
    console.log(`\n=== Fetching similar artists (sampling ${SIMILAR_SAMPLE_SIZE} artists) ===\n`)

    const similarSample = shuffled.slice(0, SIMILAR_SAMPLE_SIZE)
    let similarCount = 0
    let newFromSimilar = 0

    for (const artist of similarSample) {
      similarCount++
      if (similarCount % 20 === 0) {
        process.stdout.write(`\r  Similar: ${similarCount}/${similarSample.length} (${newFromSimilar} new artists)`)
      }

      const similar = await fetchSimilarArtists(artist.name)

      // Merge similarTo into existing record
      const key = artistKey(artist.name)
      const existing = allArtists.find((a) => artistKey(a.name) === key)
      if (existing) {
        existing.similarTo = [...new Set([...existing.similarTo, ...similar])]
      }

      // Add newly discovered artists
      for (const simName of similar) {
        const simKey = artistKey(simName)
        if (!allArtists.some((a) => artistKey(a.name) === simKey)) {
          allArtists.push({
            name: simName,
            mbid: "",
            listeners: 0,
            tags: [],
            similarTo: [],
            url: `https://www.last.fm/music/${encodeURIComponent(simName)}`,
          })
          newFromSimilar++
        }
      }
    }
    console.log(`\r  Similar: ${similarCount}/${similarSample.length} (${newFromSimilar} new artists)`)

    // Save after discovery
    allArtists = dedup(allArtists)
    saveJson(ARTISTS_PATH, allArtists)
    saveJson(TAGS_PATH, [...scrapedTags].sort())

    // ── Queue new tags ─────────────────────────────────────────────────
    if (newTags.size === 0) {
      console.log("\nNo new tags found -- scrape complete!")
      break
    }

    const newTagList = [...newTags].sort()
    console.log(`\nDiscovered ${newTagList.length} new tags:`)
    console.log(`  ${newTagList.slice(0, 30).join(", ")}${newTagList.length > 30 ? "..." : ""}`)

    tagQueue.length = 0
    tagQueue.push(...newTagList)
  }

  // Final save
  allArtists = dedup(allArtists)
  saveJson(ARTISTS_PATH, allArtists)
  saveJson(TAGS_PATH, [...scrapedTags].sort())
  console.log(`\nFinal: ${allArtists.length} unique artists across ${scrapedTags.size} tags`)
}

main().catch(console.error)
