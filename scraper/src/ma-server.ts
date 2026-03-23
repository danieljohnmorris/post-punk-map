/**
 * Metal Archives scraper — runs a local server that:
 * 1. Serves a page with a script that fetches from Metal Archives API
 * 2. The script opens MA in an iframe? No — just runs fetch from the page context
 *
 * Actually: serves an HTML page. You open it in the Playwright browser
 * that already has MA cookies. The page fetches from MA API and posts
 * results back to this server.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:http"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/metalarchives")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const GENRES_PATH = resolve(DATA_DIR, "genres.json")

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

interface MArtist {
  name: string
  maId: string
  url: string
  country: string
  genres: string
  tags: string[]
}

const GENRES = [
  "black metal", "death metal", "doom metal", "thrash metal", "speed metal",
  "heavy metal", "power metal", "progressive metal", "sludge metal",
  "stoner metal", "drone metal", "gothic metal", "symphonic metal",
  "folk metal", "viking metal", "pagan metal",
  "atmospheric black metal", "melodic black metal", "raw black metal",
  "depressive black metal", "post-black metal",
  "melodic death metal", "brutal death metal", "technical death metal",
  "blackened death metal",
  "funeral doom", "grindcore", "goregrind", "deathgrind", "war metal",
  "industrial metal", "nu metal", "metalcore", "deathcore", "mathcore",
  "post-metal", "djent", "avant-garde metal", "experimental metal",
  "crust punk", "d-beat", "hardcore punk", "powerviolence", "noise rock",
  "sludge", "stoner rock", "psychedelic doom",
]

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8"))
}

function saveJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function normalizeGenreTags(genreText: string): string[] {
  return genreText
    .toLowerCase()
    .split(/[/,]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/\s+/g, "-"))
    .filter((v, i, a) => a.indexOf(v) === i)
}

function parseBandLink(html: string): { name: string; url: string; maId: string } | null {
  const $ = cheerio.load(html)
  const a = $("a").first()
  const href = a.attr("href")
  const name = a.text().trim()
  if (!href || !name) return null
  const idMatch = href.match(/\/(\d+)$/)
  return { name, url: href, maId: idMatch ? idMatch[1] : "" }
}

function dedup(items: MArtist[]): MArtist[] {
  const map = new Map<string, MArtist>()
  for (const item of items) {
    const key = item.maId || item.name.toLowerCase()
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

let allArtists: MArtist[] = loadJson(ARTISTS_PATH, [])
const scrapedGenres: Set<string> = new Set(loadJson<string[]>(GENRES_PATH, []))
const genresToScrape = GENRES.filter((g) => !scrapedGenres.has(g))

console.log(`Loaded: ${allArtists.length} artists, ${scrapedGenres.size} scraped genres`)
console.log(`Genres to scrape: ${genresToScrape.length}`)

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method === "GET" && req.url === "/genres") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(genresToScrape))
    return
  }

  if (req.method === "POST" && req.url === "/batch") {
    let body = ""
    req.on("data", (chunk: Buffer) => { body += chunk.toString() })
    req.on("end", () => {
      try {
        const { genre, rows } = JSON.parse(body) as { genre: string; rows: string[][] }

        const artists: MArtist[] = []
        for (const row of rows) {
          const band = parseBandLink(row[0])
          if (!band) continue
          artists.push({
            name: band.name,
            maId: band.maId,
            url: band.url,
            country: row[2] || "",
            genres: row[1] || "",
            tags: normalizeGenreTags(row[1] || ""),
          })
        }

        allArtists.push(...artists)
        scrapedGenres.add(genre)
        console.log(`[${genre}] +${artists.length} artists (total: ${allArtists.length})`)

        if (scrapedGenres.size % 3 === 0) {
          allArtists = dedup(allArtists)
          saveJson(ARTISTS_PATH, allArtists)
          saveJson(GENRES_PATH, [...scrapedGenres].sort())
          console.log(`  Saved: ${allArtists.length} unique artists`)
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, total: allArtists.length }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  if (req.method === "GET" && req.url === "/done") {
    allArtists = dedup(allArtists)
    saveJson(ARTISTS_PATH, allArtists)
    saveJson(GENRES_PATH, [...scrapedGenres].sort())
    console.log(`\nFinal: ${allArtists.length} unique artists across ${scrapedGenres.size} genres`)
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ total: allArtists.length, genres: scrapedGenres.size }))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(9876, () => {
  console.log("\nServer on http://localhost:9876")
  console.log("Now run the Playwright evaluate script from metal-archives.com\n")
})
