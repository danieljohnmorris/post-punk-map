/**
 * Builds the web discovery queue from all scraped sources,
 * filtering to only bands with relevant alternative genre tags.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/web")
const QUEUE_PATH = resolve(DATA_DIR, "queue.json")
const SEARCHED_PATH = resolve(DATA_DIR, "searched.json")

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// Tags that indicate an artist is in our target space
const ALTERNATIVE_TAGS = new Set([
  // Post-punk & adjacent
  "post-punk", "post punk", "darkwave", "dark wave", "coldwave", "cold wave",
  "gothic rock", "gothic-rock", "goth", "goth rock", "deathrock", "death rock",
  "batcave", "minimal wave", "minimal-wave", "synth-punk", "no wave", "no-wave",
  "new wave", "new-wave", "positive punk",
  // Industrial & noise
  "industrial", "industrial rock", "industrial-rock", "ebm", "electronic body music",
  "dark electro", "dark-electro", "aggrotech", "power electronics",
  "noise", "noise rock", "noise-rock", "noise pop", "noise-pop",
  "harsh noise", "harsh-noise", "japanoise", "power-electronics",
  "dark ambient", "dark-ambient", "neofolk", "martial industrial", "martial-industrial",
  "death industrial", "death-industrial",
  // Punk & hardcore
  "punk", "punk rock", "hardcore", "hardcore punk", "hardcore-punk",
  "post-hardcore", "post hardcore", "anarcho-punk", "anarcho punk",
  "crust punk", "crust-punk", "d-beat", "grindcore", "powerviolence",
  "screamo", "skramz", "emo", "emocore", "midwest emo", "midwest-emo",
  "pop punk", "pop-punk", "street punk", "street-punk", "oi",
  "garage punk", "garage-punk", "art punk", "art-punk", "egg-punk",
  // Metal
  "black metal", "black-metal", "death metal", "death-metal",
  "doom metal", "doom-metal", "sludge metal", "sludge-metal", "sludge",
  "stoner metal", "stoner-metal", "stoner rock", "stoner-rock",
  "thrash metal", "thrash-metal", "speed metal", "speed-metal",
  "heavy metal", "heavy-metal", "drone metal", "drone-metal",
  "atmospheric black metal", "atmospheric-black-metal",
  "post-black metal", "post-black-metal", "blackgaze",
  "depressive black metal", "depressive-black-metal",
  "funeral doom", "funeral-doom", "gothic metal", "gothic-metal",
  "symphonic metal", "symphonic-metal", "folk metal", "folk-metal",
  "progressive metal", "progressive-metal", "metalcore", "deathcore",
  "mathcore", "post-metal", "post metal", "grind", "goregrind",
  "war metal", "war-metal", "raw black metal", "raw-black-metal",
  "melodic death metal", "melodic-death-metal",
  "brutal death metal", "brutal-death-metal",
  "technical death metal", "technical-death-metal",
  "industrial metal", "industrial-metal", "nu metal", "nu-metal",
  "djent", "avant-garde metal", "avant-garde-metal",
  // Shoegaze & dream
  "shoegaze", "dream pop", "dream-pop", "ethereal wave", "ethereal-wave",
  "slowcore", "sadcore", "blackgaze", "nugaze",
  // Other alternative
  "alternative", "alternative rock", "alternative-rock",
  "indie rock", "indie-rock", "indie pop", "indie-pop",
  "lo-fi", "lofi", "experimental", "experimental rock", "experimental-rock",
  "art rock", "art-rock", "garage rock", "garage-rock",
  "psychedelic", "psychedelic rock", "psychedelic-rock", "psych rock", "psych-rock",
  "krautrock", "math rock", "math-rock", "post-rock", "post rock",
  "space rock", "space-rock", "surf punk", "surf-punk",
  "witch house", "witch-house", "synthwave", "synthpop", "synth-pop",
  "electropunk", "protopunk", "proto-punk",
  "riot grrrl", "riot-grrrl", "queercore", "afropunk",
  "grunge", "grunge rock", "jangle pop", "jangle-pop",
  "twee", "c86", "indie", "underground",
  // Misc dark/alternative
  "dark", "dark rock", "occult rock", "occult-rock",
  "dungeon synth", "dungeon-synth", "vaporwave",
  "witch house", "hauntology",
])

function hasAlternativeTag(tags: string[]): boolean {
  return tags.some(t => ALTERNATIVE_TAGS.has(t.toLowerCase().trim()))
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8"))
}

// Collect all band names with alternative tags
const bands = new Set<string>()

const sources = [
  { path: resolve(__dirname, "../../data/bandcamp/artists.json"), nameKey: "artist", tagsKey: "tags" },
  { path: resolve(__dirname, "../../data/musicbrainz/artists.json"), nameKey: "name", tagsKey: "tags" },
  { path: resolve(__dirname, "../../data/lastfm/artists.json"), nameKey: "name", tagsKey: "tags" },
  { path: resolve(__dirname, "../../data/wikipedia/artists.json"), nameKey: "name", tagsKey: "genres" },
  { path: resolve(__dirname, "../../data/discogs/artists.json"), nameKey: "name", tagsKey: "labels" },
  { path: resolve(__dirname, "../../data/web/artists.json"), nameKey: "name", tagsKey: "genres" },
]

for (const src of sources) {
  if (!existsSync(src.path)) continue
  try {
    const data = JSON.parse(readFileSync(src.path, "utf-8"))
    const items = Array.isArray(data) ? data : Object.values(data) as Record<string, unknown>[]
    let matched = 0
    for (const item of items as Record<string, unknown>[]) {
      const name = item[src.nameKey] as string
      const tags = (item[src.tagsKey] || item["tags"] || item["genres"] || []) as string[]
      if (!name || name.length < 2) continue

      // Skip "Various Artists" type entries
      if (name.toLowerCase() === "various artists") continue

      if (Array.isArray(tags) && hasAlternativeTag(tags)) {
        bands.add(name)
        matched++
      }
    }
    console.log(`${src.path.split("/").pop()}: ${matched} bands with alternative tags`)
  } catch { /* skip */ }
}

// Load already-searched bands
const searched = new Set(loadJson<string[]>(SEARCHED_PATH, []).map(s => s.toLowerCase()))

// Filter out already-searched
const queue = [...bands].filter(b => !searched.has(b.toLowerCase()))

// Shuffle for variety
queue.sort(() => Math.random() - 0.5)

console.log(`\nTotal bands with alternative tags: ${bands.size}`)
console.log(`Already searched: ${searched.size}`)
console.log(`New queue size: ${queue.length}`)
console.log(`\nSample: ${queue.slice(0, 20).join(", ")}`)

writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2))
console.log(`\nWritten to ${QUEUE_PATH}`)
