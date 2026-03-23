/**
 * Web discovery scraper — finds bands via web search results.
 *
 * Uses WebSearch/WebFetch to search "bands like X" and extract
 * band names from Reddit, blogs, forums, Music-Map, etc.
 *
 * Runs as a standalone script. Reads seed bands from existing
 * scraped data, then spiders outward through similarity.
 *
 * Usage: npx tsx src/scrape-web.ts [--seeds 50] [--depth 3]
 *
 * NOTE: This script is designed to be run by a Claude subagent
 * that has access to WebSearch and WebFetch tools. It generates
 * the search queries and manages state; the agent does the searching.
 *
 * Run it via: "scrape bands from the web using the web discovery scraper"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/web")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const SEARCHED_PATH = resolve(DATA_DIR, "searched.json")
const QUEUE_PATH = resolve(DATA_DIR, "queue.json")

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// ── Types ────────────────────────────────────────────────────────────────────

export interface WebArtist {
  name: string
  similarTo: string[]     // bands they were found similar to
  sources: string[]       // where we found them (reddit, blog, etc)
  genres: string[]        // any genre info extracted
  mentions: number        // how many times they were mentioned
}

// ── State management ─────────────────────────────────────────────────────────

export function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function saveJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export function loadState() {
  return {
    artists: loadJson<Record<string, WebArtist>>(ARTISTS_PATH, {}),
    searched: new Set(loadJson<string[]>(SEARCHED_PATH, [])),
    queue: loadJson<string[]>(QUEUE_PATH, []),
  }
}

export function saveState(
  artists: Record<string, WebArtist>,
  searched: Set<string>,
  queue: string[]
) {
  saveJson(ARTISTS_PATH, artists)
  saveJson(SEARCHED_PATH, [...searched])
  saveJson(QUEUE_PATH, queue)
}

// ── Seed generation ──────────────────────────────────────────────────────────

function getSeedBands(count: number): string[] {
  const seeds: string[] = []

  // Load from all scraped sources
  const sources = [
    resolve(__dirname, "../../data/bandcamp/artists.json"),
    resolve(__dirname, "../../data/musicbrainz/artists.json"),
    resolve(__dirname, "../../data/metalarchives/artists.json"),
  ]

  for (const src of sources) {
    if (!existsSync(src)) continue
    try {
      const data = JSON.parse(readFileSync(src, "utf-8"))
      for (const a of data) {
        const name = a.name || a.artist
        if (name && !seeds.includes(name)) seeds.push(name)
      }
    } catch { /* skip */ }
  }

  // Shuffle and take requested count
  const shuffled = seeds.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// ── Search query generation ──────────────────────────────────────────────────

export const SEARCH_TEMPLATES = [
  "bands like {band}",
  "bands similar to {band}",
  "if you like {band} you'll love",
  "{band} similar artists recommendations",
  "bands like {band} reddit",
]

export function getSearchQueries(bandName: string): string[] {
  return SEARCH_TEMPLATES.map(t => t.replace("{band}", bandName))
}

// ── Band name extraction patterns ────────────────────────────────────────────

// Common words that are NOT band names
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "must", "shall", "can",
  "need", "dare", "ought", "used", "if", "then", "else", "when", "up",
  "so", "no", "not", "only", "very", "also", "just", "more", "most",
  "other", "some", "such", "than", "too", "much", "many", "few",
  "bands", "band", "like", "similar", "music", "genre", "sound",
  "listen", "check", "out", "try", "recommend", "recommendation",
  "reddit", "post", "comment", "thread", "discussion", "here",
  "good", "great", "best", "top", "new", "old", "modern", "classic",
  "rock", "metal", "punk", "goth", "gothic", "dark", "wave",
  "album", "song", "track", "release", "ep", "lp", "vinyl",
  "read", "more", "show", "click", "view", "see",
])

export function isLikelyBandName(text: string): boolean {
  const clean = text.trim()
  if (clean.length < 2 || clean.length > 60) return false
  if (/^\d+$/.test(clean)) return false
  if (/^(https?:|www\.)/.test(clean)) return false
  if (clean.split(" ").length > 6) return false

  const lower = clean.toLowerCase()
  if (STOP_WORDS.has(lower)) return false

  // Must start with uppercase or be a known stylization
  if (!/^[A-Z]/.test(clean) && !/^[a-z]/.test(clean)) return false

  return true
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const seedCount = parseInt(args.find(a => a.startsWith("--seeds="))?.split("=")[1] || "50", 10)

  const state = loadState()

  if (state.queue.length === 0) {
    // Generate initial queue from seed bands
    const seeds = getSeedBands(seedCount)
    state.queue = seeds.filter(s => !state.searched.has(s.toLowerCase()))
    saveState(state.artists, state.searched, state.queue)
    console.log(`Generated ${state.queue.length} seed bands for search queue`)
  }

  console.log(`State: ${Object.keys(state.artists).length} artists, ${state.searched.size} searched, ${state.queue.length} in queue`)
  console.log(`\nQueue preview: ${state.queue.slice(0, 10).join(", ")}...`)
  console.log(`\nThis script manages state. Run the web-discovery agent to do the actual searching.`)
  console.log(`The agent should:`)
  console.log(`  1. Read queue from ${QUEUE_PATH}`)
  console.log(`  2. For each band, WebSearch "bands like {name}"`)
  console.log(`  3. Extract band names from results`)
  console.log(`  4. Add new bands to artists.json and queue`)
  console.log(`  5. Mark searched bands in searched.json`)
}

main()
