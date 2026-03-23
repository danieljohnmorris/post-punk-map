import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as cheerio from "cheerio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = resolve(__dirname, "../../data/bandcamp/artists.json")

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
  bandImageUrl?: string | null
  albumArtLarge?: string | null
  bio?: string | null
  albumTags?: string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Scrape album page: album art (large), band image, album tags ─────────────

async function scrapeAlbumPage(
  albumUrl: string
): Promise<{
  bandImage: string | null
  albumArt: string | null
  albumTags: string[]
}> {
  const res = await fetch(albumUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  })
  if (!res.ok) return { bandImage: null, albumArt: null, albumTags: [] }

  const html = await res.text()
  const $ = cheerio.load(html)

  let bandImage: string | null = null
  let albumArt: string | null = null
  const albumTags: string[] = []

  // JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "")

      if (data.image) {
        const img = Array.isArray(data.image) ? data.image[0] : data.image
        if (typeof img === "string") albumArt = img
      }

      const publisher = data.publisher || data.byArtist
      if (publisher?.image) {
        const img = Array.isArray(publisher.image)
          ? publisher.image[0]
          : publisher.image
        if (typeof img === "string") bandImage = img
      }
    } catch {
      // skip
    }
  })

  if (!albumArt) {
    albumArt = $('meta[property="og:image"]').attr("content") || null
  }

  // Extract tags from discover links
  $('a[href*="bandcamp.com/discover/"]').each((_, el) => {
    const href = $(el).attr("href") || ""
    const match = href.match(/\/discover\/([^?]+)/)
    if (match) albumTags.push(decodeURIComponent(match[1]).toLowerCase())
  })
  $('a[href*="bandcamp.com/tag/"]').each((_, el) => {
    const href = $(el).attr("href") || ""
    const match = href.match(/\/tag\/([^?]+)/)
    if (match) albumTags.push(decodeURIComponent(match[1]).toLowerCase())
  })

  return { bandImage, albumArt, albumTags: [...new Set(albumTags)] }
}

// ── Scrape artist page: bio, location, profile image ─────────────────────────

async function scrapeArtistPage(
  bandUrl: string
): Promise<{ bio: string | null; artistImage: string | null; location: string | null }> {
  const res = await fetch(bandUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    redirect: "follow",
  })
  if (!res.ok) return { bio: null, artistImage: null, location: null }

  const html = await res.text()
  const $ = cheerio.load(html)

  // Bio from meta description or bio section
  let bio =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    null

  // Clean up bio
  if (bio) {
    bio = bio.trim()
    if (bio.length < 5) bio = null
  }

  // Artist image from og:image or structured data
  let artistImage =
    $('meta[property="og:image"]').attr("content") || null

  // Also try to find higher-res version from about section
  const aboutImg = $('img[alt$="image"]').attr("src")
  if (aboutImg && aboutImg.includes("bcbits.com")) {
    // Get the _10 (large) version
    artistImage = aboutImg.replace(/_\d+\.jpg$/, "_10.jpg")
  }

  // Location
  const location = $(".location").text().trim() || null

  return { bio, artistImage, location }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const items: BandcampItem[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"))
  console.log(`Loaded ${items.length} artists`)

  const toEnrich = items.filter((i) => !i.bandImageUrl)
  console.log(`${toEnrich.length} need enrichment\n`)

  const BATCH = parseInt(process.env.BATCH || "0", 10) || toEnrich.length
  const batch = toEnrich.slice(0, BATCH)

  let done = 0
  let bandImages = 0
  let bios = 0

  for (const item of batch) {
    done++
    if (done % 10 === 0 || done === batch.length) {
      process.stdout.write(
        `\r  ${done}/${batch.length} | ${bandImages} images, ${bios} bios`
      )
    }

    try {
      // Scrape album page
      const album = await scrapeAlbumPage(item.url)
      if (album.albumArt) item.albumArtLarge = album.albumArt
      if (album.bandImage) item.bandImageUrl = album.bandImage
      if (album.albumTags.length > 0) {
        const merged = new Set([...item.tags, ...album.albumTags])
        item.albumTags = [...merged]
      }
      await sleep(300)

      // Scrape artist page
      if (item.bandUrl) {
        const artist = await scrapeArtistPage(item.bandUrl)
        if (artist.bio) {
          item.bio = artist.bio
          bios++
        }
        if (artist.artistImage && !item.bandImageUrl) {
          item.bandImageUrl = artist.artistImage
        }
        if (artist.location && !item.location) {
          item.location = artist.location
        }
        if (item.bandImageUrl) bandImages++
        await sleep(300)
      }
    } catch {
      // skip failures
    }

    // Save periodically
    if (done % 100 === 0) {
      writeFileSync(DATA_PATH, JSON.stringify(items, null, 2))
    }
  }

  console.log(`\n\nDone. ${bandImages} band images, ${bios} bios.`)
  writeFileSync(DATA_PATH, JSON.stringify(items, null, 2))
  console.log(`Written to ${DATA_PATH}`)
}

main().catch(console.error)
