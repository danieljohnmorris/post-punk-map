/**
 * Wikipedia band list scraper.
 *
 * Fetches "List of ..." pages and Wikipedia category pages, extracts band
 * names, deduplicates by lowercase name (merging genres), and writes output
 * to data/wikipedia/artists.json.
 *
 * Two source types are supported:
 *  - "list" pages: HTML "List of ... bands/artists" pages (scraped with cheerio)
 *  - "category" pages: Wikipedia categories (fetched via the MediaWiki API)
 *
 * Usage:  npx tsx src/scrape-wikipedia.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/wikipedia")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const PAGES_PATH = resolve(DATA_DIR, "pages.json")

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// ── Types ──────────────────────────────────────────────────────────────────

interface Artist {
  name: string
  genres: string[]
  wikiUrl: string | null
  country: string | null
}

interface PageStatus {
  page: string
  scraped: boolean
  artistCount: number
  scrapedAt: string | null
}

// ── Config ─────────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 1000

interface WikiSource {
  page: string
  genre: string
  type: "list" | "category"
}

const WIKI_SOURCES: WikiSource[] = [
  // ── List pages (HTML scraping) ──────────────────────────────────────────
  { page: "List_of_post-punk_bands", genre: "post-punk", type: "list" },
  { page: "List_of_gothic_rock_artists", genre: "gothic rock", type: "list" },
  { page: "List_of_industrial_music_bands", genre: "industrial", type: "list" },
  { page: "List_of_noise_rock_bands", genre: "noise rock", type: "list" },
  { page: "List_of_shoegaze_bands", genre: "shoegaze", type: "list" },
  { page: "List_of_dream_pop_artists", genre: "dream pop", type: "list" },
  { page: "List_of_synthpop_artists", genre: "synthpop", type: "list" },
  { page: "List_of_new_wave_artists", genre: "new wave", type: "list" },
  { page: "List_of_punk_rock_bands", genre: "punk rock", type: "list" },
  { page: "List_of_hardcore_punk_bands", genre: "hardcore punk", type: "list" },
  { page: "List_of_post-hardcore_bands", genre: "post-hardcore", type: "list" },
  { page: "List_of_emo_artists", genre: "emo", type: "list" },
  { page: "List_of_screamo_bands", genre: "screamo", type: "list" },
  { page: "List_of_mathcore_groups", genre: "mathcore", type: "list" },
  { page: "List_of_grindcore_bands", genre: "grindcore", type: "list" },
  { page: "List_of_black_metal_bands", genre: "black metal", type: "list" },
  { page: "List_of_death_metal_bands", genre: "death metal", type: "list" },
  { page: "List_of_doom_metal_bands", genre: "doom metal", type: "list" },
  { page: "List_of_thrash_metal_bands", genre: "thrash metal", type: "list" },
  { page: "List_of_sludge_metal_bands", genre: "sludge metal", type: "list" },
  { page: "List_of_stoner_rock_bands", genre: "stoner rock", type: "list" },
  { page: "List_of_progressive_rock_artists", genre: "progressive rock", type: "list" },
  { page: "List_of_art_rock_bands", genre: "art rock", type: "list" },
  { page: "List_of_psychedelic_rock_artists", genre: "psychedelic rock", type: "list" },
  { page: "List_of_math_rock_groups", genre: "math rock", type: "list" },
  { page: "List_of_post-rock_bands", genre: "post-rock", type: "list" },
  { page: "List_of_metalcore_bands", genre: "metalcore", type: "list" },
  { page: "List_of_deathcore_artists", genre: "deathcore", type: "list" },
  { page: "List_of_folk_metal_bands", genre: "folk metal", type: "list" },
  { page: "List_of_power_metal_bands", genre: "power metal", type: "list" },
  { page: "List_of_symphonic_metal_bands", genre: "symphonic metal", type: "list" },

  // ── Category pages (MediaWiki API) ──────────────────────────────────────
  // These genres have no "List of..." article, so we pull from categories.
  { page: "Category:Dark_wave_musical_groups", genre: "darkwave", type: "category" },
  { page: "Category:Krautrock_musical_groups", genre: "krautrock", type: "category" },
  { page: "Category:Space_rock_musical_groups", genre: "space rock", type: "category" },
  { page: "Category:No_wave_groups", genre: "no wave", type: "category" },
  { page: "Category:Electronic_body_music_groups", genre: "EBM", type: "category" },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

function saveJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "PostPunkMapScraper/1.0 (https://github.com; educational project)",
      Accept: "text/html",
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

// ── Category API ────────────────────────────────────────────────────────────

interface CategoryMember {
  pageid: number
  ns: number
  title: string
}

/**
 * Fetch all page members (and members of subcategories, one level deep)
 * from a Wikipedia category using the MediaWiki API.
 */
async function fetchCategoryMembers(
  category: string
): Promise<{ name: string; wikiUrl: string | null }[]> {
  const results: { name: string; wikiUrl: string | null }[] = []
  const seen = new Set<string>()

  // Collect pages from the top-level category and its direct subcategories
  const categoriesToScrape = [category]

  // First, discover subcategories
  let cmcontinue: string | undefined
  do {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmlimit: "500",
      cmtype: "subcat",
      format: "json",
    })
    if (cmcontinue) params.set("cmcontinue", cmcontinue)

    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?${params}`,
      {
        headers: {
          "User-Agent":
            "PostPunkMapScraper/1.0 (https://github.com; educational project)",
        },
      }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching subcategories`)
    const data = await res.json()
    const members: CategoryMember[] = data.query?.categorymembers ?? []
    for (const m of members) {
      categoriesToScrape.push(m.title)
    }
    cmcontinue = data.continue?.cmcontinue
  } while (cmcontinue)

  // Now fetch pages from each category
  for (const cat of categoriesToScrape) {
    let pageContinue: string | undefined
    do {
      const params = new URLSearchParams({
        action: "query",
        list: "categorymembers",
        cmtitle: cat,
        cmlimit: "500",
        cmtype: "page",
        format: "json",
      })
      if (pageContinue) params.set("cmcontinue", pageContinue)

      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?${params}`,
        {
          headers: {
            "User-Agent":
              "PostPunkMapScraper/1.0 (https://github.com; educational project)",
          },
        }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching category ${cat}`)
      const data = await res.json()
      const members: CategoryMember[] = data.query?.categorymembers ?? []

      for (const m of members) {
        if (m.ns !== 0) continue // only article namespace
        // Clean up band name: remove disambiguation suffixes like " (band)"
        const name = m.title.replace(/\s*\((?:band|musical group|group|artist|musician)\)$/i, "")
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const slug = encodeURIComponent(m.title.replace(/ /g, "_"))
        results.push({
          name,
          wikiUrl: `https://en.wikipedia.org/wiki/${slug}`,
        })
      }
      pageContinue = data.continue?.cmcontinue
    } while (pageContinue)

    await sleep(RATE_LIMIT_MS)
  }

  return results
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Extract band entries from a Wikipedia "List of ... bands/artists" page.
 *
 * Most of these pages use simple <ul><li> lists with band names as <a> links.
 * Some use tables or definition lists. We handle the common patterns:
 *  - <li> with a direct <a> child (most common)
 *  - <li> starting with text before any dash/comma (for entries like "Band Name – description")
 *  - table rows with band name in first cell
 */
function extractArtists(
  html: string,
  genre: string
): { name: string; wikiUrl: string | null }[] {
  const $ = cheerio.load(html)
  const results: { name: string; wikiUrl: string | null }[] = []
  const seen = new Set<string>()

  // Remove reference markers, navboxes, and other noise
  $("sup.reference, .navbox, .mw-editsection, .toc, .mbox-small").remove()

  // Strategy 1: Lists (most common format)
  // Target list items inside the main content area, skip navboxes/sidebars
  const contentArea = $(".mw-parser-output")

  contentArea.find("ul > li, ol > li").each((_i, el) => {
    const $li = $(el)

    // Skip items inside navboxes, reference lists, sidebar boxes
    if ($li.closest(".navbox, .reflist, .sidebar, .infobox, .metadata, .noprint, .mw-references-wrap").length > 0) {
      return
    }

    // The band name is typically the first <a> that links to a wiki article
    const $firstLink = $li.find("a").first()
    if ($firstLink.length === 0) {
      // No link — try raw text (first part before dash/comma)
      const rawText = $li.clone().children("ul, ol").remove().end().text().trim()
      const name = rawText.split(/\s*[–—\-,]\s*/)[0].trim()
      if (name && name.length > 0 && name.length < 100) {
        const key = name.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ name, wikiUrl: null })
        }
      }
      return
    }

    const href = $firstLink.attr("href") || ""

    // Skip external links, anchors, red links (non-existent pages), and category/file links
    if (
      href.startsWith("#") ||
      href.startsWith("http") ||
      href.includes("action=edit") ||
      href.startsWith("/wiki/Category:") ||
      href.startsWith("/wiki/File:") ||
      href.startsWith("/wiki/Wikipedia:") ||
      href.startsWith("/wiki/Help:") ||
      href.startsWith("/wiki/Template:")
    ) {
      // Still try to get band name from text
      const rawText = $li.clone().children("ul, ol").remove().end().text().trim()
      const name = rawText.split(/\s*[–—\-,]\s*/)[0].trim()
      if (name && name.length > 0 && name.length < 100) {
        const key = name.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ name, wikiUrl: null })
        }
      }
      return
    }

    const name = $firstLink.text().trim()
    if (!name || name.length === 0 || name.length > 100) return

    // Skip section-style links (letters, "see also", etc.)
    if (/^[A-Z]$/.test(name) || /^(see also|references|external links|notes|bibliography)$/i.test(name)) {
      return
    }

    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    const wikiUrl = href.startsWith("/wiki/")
      ? `https://en.wikipedia.org${href}`
      : null

    results.push({ name, wikiUrl })
  })

  // Strategy 2: Tables (some pages use tables instead of lists)
  contentArea.find("table.wikitable tbody tr").each((_i, el) => {
    const $row = $(el)
    const $firstCell = $row.find("td:first-child")
    if ($firstCell.length === 0) return

    const $link = $firstCell.find("a").first()
    const name = $link.length > 0 ? $link.text().trim() : $firstCell.text().trim()
    if (!name || name.length === 0 || name.length > 100) return

    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    const href = $link.attr("href") || ""
    const wikiUrl =
      href.startsWith("/wiki/") && !href.includes("action=edit")
        ? `https://en.wikipedia.org${href}`
        : null

    results.push({ name, wikiUrl })
  })

  return results
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Wikipedia band list scraper`)
  console.log(`Sources to scrape: ${WIKI_SOURCES.length}`)
  console.log(`Output: ${ARTISTS_PATH}\n`)

  // Load resume state
  const pageStatuses = loadJson<PageStatus[]>(PAGES_PATH, [])
  const scrapedSet = new Set(
    pageStatuses.filter((p) => p.scraped).map((p) => p.page)
  )

  // Accumulator: lowercase name → Artist
  const artistMap = new Map<string, Artist>()

  // Load existing artists for resume
  const existing = loadJson<Artist[]>(ARTISTS_PATH, [])
  for (const a of existing) {
    artistMap.set(a.name.toLowerCase(), a)
  }

  let scraped = 0
  let skipped = 0

  for (const { page, genre, type } of WIKI_SOURCES) {
    if (scrapedSet.has(page)) {
      skipped++
      continue
    }

    console.log(`[${scraped + skipped + 1}/${WIKI_SOURCES.length}] ${page}`)

    try {
      let entries: { name: string; wikiUrl: string | null }[]

      if (type === "category") {
        entries = await fetchCategoryMembers(page)
      } else {
        const url = `https://en.wikipedia.org/wiki/${page}`
        const html = await fetchPage(url)
        entries = extractArtists(html, genre)
      }

      console.log(`  → ${entries.length} artists found`)

      for (const entry of entries) {
        const key = entry.name.toLowerCase()
        const existing = artistMap.get(key)
        if (existing) {
          // Merge genres
          if (!existing.genres.includes(genre)) {
            existing.genres.push(genre)
          }
          // Update wikiUrl if we didn't have one
          if (!existing.wikiUrl && entry.wikiUrl) {
            existing.wikiUrl = entry.wikiUrl
          }
        } else {
          artistMap.set(key, {
            name: entry.name,
            genres: [genre],
            wikiUrl: entry.wikiUrl,
            country: null,
          })
        }
      }

      // Update page status
      const statusEntry: PageStatus = {
        page,
        scraped: true,
        artistCount: entries.length,
        scrapedAt: new Date().toISOString(),
      }
      const idx = pageStatuses.findIndex((p) => p.page === page)
      if (idx >= 0) pageStatuses[idx] = statusEntry
      else pageStatuses.push(statusEntry)

      // Save progress after each page
      const artists = Array.from(artistMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      saveJson(ARTISTS_PATH, artists)
      saveJson(PAGES_PATH, pageStatuses)

      scraped++
    } catch (err) {
      console.error(`  ✗ Failed: ${(err as Error).message}`)
      // Mark as not scraped so it can be retried
      const statusEntry: PageStatus = {
        page,
        scraped: false,
        artistCount: 0,
        scrapedAt: null,
      }
      const idx = pageStatuses.findIndex((p) => p.page === page)
      if (idx >= 0) pageStatuses[idx] = statusEntry
      else pageStatuses.push(statusEntry)
      saveJson(PAGES_PATH, pageStatuses)
    }

    // Rate limit (category sources handle their own internal rate limiting)
    if (type === "list") await sleep(RATE_LIMIT_MS)
  }

  const artists = Array.from(artistMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  saveJson(ARTISTS_PATH, artists)
  saveJson(PAGES_PATH, pageStatuses)

  console.log(`\nDone.`)
  console.log(`  Scraped: ${scraped} sources (${skipped} skipped/resumed)`)
  console.log(`  Total unique artists: ${artists.length}`)
  console.log(`  Output: ${ARTISTS_PATH}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
