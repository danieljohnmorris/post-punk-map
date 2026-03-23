/**
 * Metal Archives scraper — uses Playwright MCP to bypass Cloudflare.
 *
 * Run this AFTER opening Metal Archives in Playwright:
 *   1. Use Playwright MCP browser_navigate to https://www.metal-archives.com/
 *   2. Then run: npx tsx src/scrape-metalarchives.ts
 *
 * This script connects to the running Playwright browser via CDP and
 * uses page.evaluate(fetch(...)) to make requests through the authenticated session.
 *
 * Since we can't do that from a standalone script, this instead generates
 * a list of fetch commands to run via Playwright MCP, or we use a simpler
 * approach: fetch from within the browser and post results to a local server.
 *
 * ACTUAL APPROACH: We use the Playwright MCP tool interactively.
 * This file provides the genre list and parsing logic.
 * The actual scraping is done by calling Playwright MCP evaluate
 * with the fetch URLs generated here.
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

// ── Types ────────────────────────────────────────────────────────────────────

interface MArtist {
  name: string
  maId: string
  url: string
  country: string
  genres: string
  tags: string[]
  status: string
}

// ── Config ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 200
const SAVE_EVERY = 5

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const maId = idMatch ? idMatch[1] : ""

  return { name, url: href, maId }
}

function parseResults(data: { aaData: string[][] }): MArtist[] {
  const artists: MArtist[] = []
  for (const row of data.aaData) {
    const band = parseBandLink(row[0])
    if (!band) continue

    const genreText = row[1] || ""
    const country = row[2] || ""

    artists.push({
      name: band.name,
      maId: band.maId,
      url: band.url,
      country,
      genres: genreText,
      tags: normalizeGenreTags(genreText),
      status: "Unknown",
    })
  }
  return artists
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

// ── Local HTTP server that Playwright posts results to ──────────────────────

async function main() {
  let allArtists: MArtist[] = loadJson(ARTISTS_PATH, [])
  const scrapedGenres: Set<string> = new Set(loadJson<string[]>(GENRES_PATH, []))

  console.log(`Loaded: ${allArtists.length} artists, ${scrapedGenres.size} scraped genres`)

  const genresToScrape = GENRES.filter((g) => !scrapedGenres.has(g))
  if (genresToScrape.length === 0) {
    console.log("All genres already scraped!")
    return
  }

  console.log(`Genres to scrape: ${genresToScrape.length}`)
  console.log("\nStarting local server on port 9876...")
  console.log("Open Metal Archives in Playwright, then run the fetch script in browser.\n")

  // Queue of work items
  const queue: Array<{ genre: string; offset: number }> = []
  for (const genre of genresToScrape) {
    queue.push({ genre, offset: 0 })
  }

  let currentIdx = 0
  let currentGenreArtists: MArtist[] = []
  let currentGenre = ""
  let currentTotal = 0

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    // GET /next - get next URL to fetch
    if (req.method === "GET" && req.url === "/next") {
      if (currentIdx >= queue.length && currentGenreArtists.length === 0) {
        // All done
        allArtists = dedup(allArtists)
        saveJson(ARTISTS_PATH, allArtists)
        saveJson(GENRES_PATH, [...scrapedGenres].sort())
        console.log(`\nDone! ${allArtists.length} unique artists across ${scrapedGenres.size} genres`)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ done: true }))
        return
      }

      const item = queue[currentIdx]
      const genre = encodeURIComponent(item.genre)
      const url = `/search/ajax-advanced/searching/bands?bandName=&genre=${genre}&country=&yearCreationFrom=&yearCreationTo=&bandNotes=&status=&themes=&location=&bandLabelName=&sEcho=1&iDisplayStart=${item.offset}&iDisplayLength=${PAGE_SIZE}`

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ url, genre: item.genre, offset: item.offset }))
      return
    }

    // POST /result - receive fetched data
    if (req.method === "POST" && req.url === "/result") {
      let body = ""
      req.on("data", (chunk: Buffer) => { body += chunk.toString() })
      req.on("end", () => {
        try {
          const { genre, offset, data } = JSON.parse(body)

          if (genre !== currentGenre) {
            // New genre
            if (currentGenre && currentGenreArtists.length > 0) {
              allArtists.push(...currentGenreArtists)
              scrapedGenres.add(currentGenre)
              console.log(`  Total: ${currentGenreArtists.length} / ${currentTotal}`)

              if (scrapedGenres.size % SAVE_EVERY === 0) {
                allArtists = dedup(allArtists)
                saveJson(ARTISTS_PATH, allArtists)
                saveJson(GENRES_PATH, [...scrapedGenres].sort())
                console.log(`  Saved: ${allArtists.length} artists, ${scrapedGenres.size} genres`)
              }
            }
            currentGenre = genre
            currentGenreArtists = []
            currentTotal = data.iTotalRecords || 0
            console.log(`\n[${genre}] (${currentTotal} total)`)
          }

          const artists = parseResults(data)
          currentGenreArtists.push(...artists)
          console.log(`  offset ${offset}: ${artists.length} artists`)

          // Queue next page or move to next genre
          if (artists.length === PAGE_SIZE && offset + PAGE_SIZE < currentTotal) {
            queue[currentIdx] = { genre, offset: offset + PAGE_SIZE }
          } else {
            // Finalize this genre
            allArtists.push(...currentGenreArtists)
            scrapedGenres.add(genre)

            if (scrapedGenres.size % SAVE_EVERY === 0) {
              allArtists = dedup(allArtists)
              saveJson(ARTISTS_PATH, allArtists)
              saveJson(GENRES_PATH, [...scrapedGenres].sort())
              console.log(`  Saved: ${allArtists.length} artists, ${scrapedGenres.size} genres`)
            }

            currentGenreArtists = []
            currentGenre = ""
            currentIdx++
          }

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          console.error("Parse error:", e)
          res.writeHead(400)
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  server.listen(9876, () => {
    console.log("Server ready on http://localhost:9876")
    console.log("\nPaste this into Playwright browser_evaluate:\n")
    console.log(`async () => {
  const DELAY = 2000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  while (true) {
    const next = await (await fetch('http://localhost:9876/next')).json();
    if (next.done) { console.log('DONE'); return 'Done!'; }
    await sleep(DELAY);
    const data = await (await fetch(next.url)).json();
    await fetch('http://localhost:9876/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: next.genre, offset: next.offset, data })
    });
  }
}`)
  })
}

main().catch(console.error)
