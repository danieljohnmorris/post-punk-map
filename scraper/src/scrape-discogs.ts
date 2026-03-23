import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../data/discogs")
const ARTISTS_PATH = resolve(DATA_DIR, "artists.json")
const LABELS_PATH = resolve(DATA_DIR, "labels.json")

// ── Types ────────────────────────────────────────────────────────────────────

interface Artist {
  name: string
  labels: string[]
  discogsUrl: string
}

interface LabelInfo {
  name: string
  discogsId: number | null
  scraped: boolean
  artistCount: number
}

interface DiscogsSearchResult {
  id: number
  title: string
  resource_url: string
  uri: string
}

interface DiscogsRelease {
  id: number
  artist: string
  title: string
  status: string
}

// ── Config ───────────────────────────────────────────────────────────────────

const DELAY_MS = 2500 // 25 req/min = 2.4s minimum
const USER_AGENT = "PostPunkMapScraper/1.0"
const API_BASE = "https://api.discogs.com"

const SEED_LABELS = [
  "Sacred Bones Records",
  "Dais Records",
  "Felte Records",
  "Sargent House",
  "Deathwish Inc",
  "Southern Lord",
  "Profound Lore Records",
  "20 Buck Spin",
  "Relapse Records",
  "Nuclear Blast",
  "Century Media",
  "Season of Mist",
  "Dark Entries Records",
  "Minimal Wave Records",
  "Mannequin Records",
  "Medical Records",
  "Cleopatra Records",
  "4AD",
  "Mute Records",
  "Factory Records",
  "Rough Trade Records",
  "Touch and Go Records",
  "Dischord Records",
  "SST Records",
  "Alternative Tentacles",
  "Ipecac Recordings",
  "Hydra Head Records",
  "Neurot Recordings",
  "Thrill Jockey Records",
  "Drag City",
  "Sub Pop",
  "Matador Records",
  "Merge Records",
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

function saveJson(path: string, data: unknown): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

async function fetchWithRetry(
  url: string,
  retries = 3
): Promise<Response | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      })

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10)
        console.log(`  Rate limited. Waiting ${retryAfter}s...`)
        await sleep(retryAfter * 1000)
        continue
      }

      if (res.status === 401 || res.status === 403) {
        console.log(`  Auth error (${res.status}) for ${url}`)
        return null
      }

      if (!res.ok) {
        console.log(`  HTTP ${res.status} for ${url}`)
        if (attempt < retries) {
          await sleep(DELAY_MS * attempt)
          continue
        }
        return null
      }

      return res
    } catch (err) {
      console.log(
        `  Fetch error (attempt ${attempt}): ${err instanceof Error ? err.message : err}`
      )
      if (attempt < retries) await sleep(DELAY_MS * attempt)
    }
  }
  return null
}

// ── API methods ──────────────────────────────────────────────────────────────

async function searchLabelId(labelName: string): Promise<number | null> {
  const url = `${API_BASE}/database/search?q=${encodeURIComponent(labelName)}&type=label&per_page=5`
  const res = await fetchWithRetry(url)
  if (!res) return null

  const data = (await res.json()) as { results: DiscogsSearchResult[] }
  if (!data.results || data.results.length === 0) return null

  // Try exact match first
  const exact = data.results.find(
    (r) => r.title.toLowerCase() === labelName.toLowerCase()
  )
  if (exact) return exact.id

  // Fall back to first result
  return data.results[0].id
}

async function fetchLabelReleasesApi(
  labelId: number
): Promise<{ artist: string; discogsUrl: string }[]> {
  const artists: { artist: string; discogsUrl: string }[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url = `${API_BASE}/labels/${labelId}/releases?per_page=100&page=${page}`
    const res = await fetchWithRetry(url)
    if (!res) break

    const data = (await res.json()) as {
      pagination: { pages: number }
      releases: DiscogsRelease[]
    }

    totalPages = Math.min(data.pagination?.pages || 1, 10) // Cap at 10 pages (1000 releases)

    for (const release of data.releases || []) {
      if (release.artist && release.artist !== "Various") {
        // Clean artist name: remove trailing " (n)" numbering discogs uses
        const cleanName = release.artist.replace(/\s*\(\d+\)\s*$/, "").trim()
        if (cleanName) {
          artists.push({
            artist: cleanName,
            discogsUrl: `https://www.discogs.com/artist/${encodeURIComponent(cleanName.replace(/ /g, "-"))}`,
          })
        }
      }
    }

    console.log(
      `    Page ${page}/${totalPages}: ${data.releases?.length || 0} releases`
    )
    page++

    if (page <= totalPages) await sleep(DELAY_MS)
  }

  return artists
}

// ── Fallback: scrape website with cheerio ────────────────────────────────────

async function fetchLabelReleasesWeb(
  labelId: number
): Promise<{ artist: string; discogsUrl: string }[]> {
  const artists: { artist: string; discogsUrl: string }[] = []
  let page = 1
  const maxPages = 10

  while (page <= maxPages) {
    const url = `https://www.discogs.com/label/${labelId}?page=${page}&limit=100`
    const res = await fetchWithRetry(url)
    if (!res) break

    const html = await res.text()
    const $ = cheerio.load(html)

    let found = 0

    // Parse release table rows
    $("table.table_block tr td a").each((_, el) => {
      const href = $(el).attr("href") || ""
      const text = $(el).text().trim()

      // Artist links typically match /artist/ID-Name
      if (href.startsWith("/artist/") && text) {
        const cleanName = text.replace(/\s*\(\d+\)\s*$/, "").trim()
        if (cleanName && cleanName !== "Various") {
          artists.push({
            artist: cleanName,
            discogsUrl: `https://www.discogs.com${href}`,
          })
          found++
        }
      }
    })

    // Also try the card-based layout
    if (found === 0) {
      $('a[href^="/artist/"]').each((_, el) => {
        const href = $(el).attr("href") || ""
        const text = $(el).text().trim()
        const cleanName = text.replace(/\s*\(\d+\)\s*$/, "").trim()
        if (cleanName && cleanName !== "Various" && cleanName.length > 0) {
          artists.push({
            artist: cleanName,
            discogsUrl: `https://www.discogs.com${href}`,
          })
          found++
        }
      })
    }

    console.log(`    Web page ${page}: found ${found} artist links`)

    if (found === 0) break // No more content

    page++
    if (page <= maxPages) await sleep(DELAY_MS)
  }

  return artists
}

// ── Dedup & merge ────────────────────────────────────────────────────────────

function mergeArtists(
  existing: Artist[],
  newEntries: { artist: string; discogsUrl: string }[],
  labelName: string
): Artist[] {
  const byKey = new Map<string, Artist>()

  for (const a of existing) {
    byKey.set(a.name.toLowerCase(), a)
  }

  for (const entry of newEntries) {
    const key = entry.artist.toLowerCase()
    const found = byKey.get(key)

    if (found) {
      if (!found.labels.includes(labelName)) {
        found.labels.push(labelName)
      }
      // Keep the more specific URL
      if (
        entry.discogsUrl.includes("/artist/") &&
        !found.discogsUrl.includes("/artist/")
      ) {
        found.discogsUrl = entry.discogsUrl
      }
    } else {
      byKey.set(key, {
        name: entry.artist,
        labels: [labelName],
        discogsUrl: entry.discogsUrl,
      })
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Discogs Label Scraper ===\n")

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  let artists = loadJson<Artist[]>(ARTISTS_PATH, [])
  const labels = loadJson<LabelInfo[]>(LABELS_PATH, [])

  // Build label state map
  const labelMap = new Map<string, LabelInfo>()
  for (const l of labels) labelMap.set(l.name, l)

  let totalNew = 0

  for (const labelName of SEED_LABELS) {
    const existing = labelMap.get(labelName)
    if (existing?.scraped) {
      console.log(`[SKIP] ${labelName} (already scraped, ${existing.artistCount} artists)`)
      continue
    }

    console.log(`\n[LABEL] ${labelName}`)

    // Step 1: Find label ID
    let labelId = existing?.discogsId ?? null

    if (!labelId) {
      console.log("  Searching for label ID...")
      labelId = await searchLabelId(labelName)
      await sleep(DELAY_MS)

      if (!labelId) {
        console.log("  Could not find label on Discogs. Skipping.")
        labelMap.set(labelName, {
          name: labelName,
          discogsId: null,
          scraped: false,
          artistCount: 0,
        })
        saveJson(LABELS_PATH, Array.from(labelMap.values()))
        continue
      }

      console.log(`  Found label ID: ${labelId}`)
    }

    // Step 2: Fetch releases (try API first, fall back to web scraping)
    console.log("  Fetching releases via API...")
    let rawArtists = await fetchLabelReleasesApi(labelId)
    await sleep(DELAY_MS)

    if (rawArtists.length === 0) {
      console.log("  API returned no results, trying web scrape...")
      rawArtists = await fetchLabelReleasesWeb(labelId)
      await sleep(DELAY_MS)
    }

    // Dedup within this label
    const seen = new Set<string>()
    const uniqueRaw = rawArtists.filter((a) => {
      const key = a.artist.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    console.log(`  Found ${uniqueRaw.length} unique artists`)

    // Merge into global list
    const prevCount = artists.length
    artists = mergeArtists(artists, uniqueRaw, labelName)
    const addedCount = artists.length - prevCount
    totalNew += addedCount

    console.log(
      `  Added ${addedCount} new artists (total: ${artists.length})`
    )

    // Save progress after each label
    labelMap.set(labelName, {
      name: labelName,
      discogsId: labelId,
      scraped: true,
      artistCount: uniqueRaw.length,
    })

    saveJson(ARTISTS_PATH, artists)
    saveJson(LABELS_PATH, Array.from(labelMap.values()))
  }

  console.log(`\n=== Done ===`)
  console.log(`Total artists: ${artists.length}`)
  console.log(`New artists this run: ${totalNew}`)
  console.log(`Labels scraped: ${Array.from(labelMap.values()).filter((l) => l.scraped).length}/${SEED_LABELS.length}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
