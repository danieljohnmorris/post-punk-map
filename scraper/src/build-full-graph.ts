import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "../../data");

// --- Tag filtering ---
// These are not genres/styles — they're locations, labels, decades, moods, meta
const BLOCKED_TAGS = new Set([
  // Meta/generic
  "all", "seen live", "favorites", "favourite", "favorite", "under 2000 listeners",
  "my music", "check out", "cool", "awesome", "good", "love", "fun",
  "beautiful", "dark", "epic", "heavy", "fast", "slow", "loud", "soft",
  "unknown", "other", "misc", "various", "compilation", "soundtrack",
  "cover", "remix", "live", "demo", "single", "album", "vinyl",
  // Decades
  "00s", "10s", "20s", "30s", "40s", "50s", "60s", "70s", "80s", "90s",
  "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s",
  // Gender/vocals (not genres)
  "female vocalists", "male vocalists", "female vocalist", "male vocalist",
  "female", "male", "female fronted", "female fronted metal",
  // Religion/ideology (not genres unless part of compound like "christian rock")
  "christian", "satanism", "satanic", "pagan", "occult", "mysticism",
  "ancient", "mythology", "norse mythology",
  // Moods/descriptors
  "death", "darkness", "violence", "evil", "melancholy", "melancholic",
  "sad", "happy", "aggressive", "atmospheric", "melodic", "brutal",
  "raw", "progressive", "classic", "modern", "old school", "new",
  "underground", "mainstream", "popular", "mellow", "chill", "relaxing",
  "eclectic", "love", "space", "nature", "politics", "war", "poggers",
  // Countries/regions/nationalities
  "american", "british", "canadian", "australian", "german", "french",
  "swedish", "norwegian", "finnish", "japanese", "brazilian", "italian",
  "spanish", "dutch", "belgian", "polish", "russian", "irish", "scottish",
  "welsh", "austrian", "swiss", "danish", "icelandic", "czech", "hungarian",
  "portuguese", "greek", "turkish", "mexican", "argentinian", "chilean",
  "colombian", "peruvian", "korean", "chinese", "taiwanese", "indonesian",
  "thai", "indian", "israeli", "south african", "new zealand",
  "usa", "uk", "canada", "australia", "germany", "france", "sweden",
  "norway", "finland", "japan", "brazil", "italy", "spain", "netherlands",
  "belgium", "poland", "russia", "ireland", "scotland", "austria",
  "switzerland", "denmark", "iceland", "czech republic", "hungary",
  "portugal", "greece", "turkey", "mexico", "argentina", "chile",
  "colombia", "peru", "south korea", "china", "taiwan", "indonesia",
  "thailand", "india", "israel", "south africa", "new-zealand",
  "buenos-aires", "aotearoa", "scandinave", "scandinavie",
  "français", "latin", "latin pop",
  // Labels (common ones that sneak in)
  "Ipecac Recordings", "Relapse Records", "Nuclear Blast", "Metal Blade Records",
  "Century Media Records", "Earache Records", "Roadrunner Records",
  "Epitaph Records", "Fat Wreck Chords", "Dischord Records",
  "Sub Pop", "Matador Records", "4AD", "Rough Trade", "Warp Records",
  "warp",
  // Too generic single words
  "rock", "pop", "metal", "jazz", "blues", "folk", "soul", "funk",
  "country", "classical", "reggae", "hip-hop", "hip hop", "rap",
  "r&b", "rnb", "gospel", "opera",
  // Instruments/tech
  "guitar", "piano", "synth", "synthesizer", "drum machine", "bass",
  "vocalist", "singer-songwriter",
]);

// Pattern-based filters
function isBlockedTag(tag: string): boolean {
  const t = tag.toLowerCase().trim();
  if (BLOCKED_TAGS.has(t)) return true;
  if (BLOCKED_TAGS.has(tag)) return true; // case-sensitive check for labels

  // Pure numbers
  if (/^\d+$/.test(t)) return true;
  // Year-like
  if (/^(19|20)\d{2}$/.test(t)) return true;
  // Single character
  if (t.length <= 2) return true;
  // "seen live" variants
  if (t.includes("seen live") || t.includes("check out")) return true;

  return false;
}

// --- Load data ---
const sources = [
  { path: "wikipedia/artists.json", nameKey: "name", tagsKey: "genres" },
  { path: "discogs/artists.json", nameKey: "name", tagsKey: "labels" },
  { path: "web/artists.json", nameKey: null as string | null, tagsKey: "genres" },
  { path: "bandcamp/artists.json", nameKey: "artist", tagsKey: "tags" },
  { path: "musicbrainz/artists.json", nameKey: "name", tagsKey: "tags" },
  { path: "metalarchives/artists.json", nameKey: "name", tagsKey: "tags" },
  { path: "lastfm/artists.json", nameKey: "name", tagsKey: "tags" },
];

const seen = new Map<string, { artist: string; tags: string[] }>();

for (const src of sources) {
  const filePath = join(DATA_DIR, src.path);
  if (!existsSync(filePath)) {
    console.log(`Skipping ${src.path} (not found)`);
    continue;
  }
  console.log(`Loading ${src.path}...`);
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const items: any[] = Array.isArray(raw) ? raw : Object.values(raw);

  let added = 0;
  for (const item of items) {
    const name = src.nameKey ? item[src.nameKey] : item.name;
    if (!name) continue;
    const key = name.toLowerCase().trim();
    const t: string[] = item[src.tagsKey] || item.tags || item.genres || [];
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      for (const tag of t) {
        if (!existing.tags.includes(tag)) existing.tags.push(tag);
      }
    } else {
      seen.set(key, { artist: name, tags: Array.isArray(t) ? [...t] : [] });
      added++;
    }
  }
  console.log(`  ${items.length} items, ${added} new, ${seen.size} total`);
}

const artists = Array.from(seen.values());
console.log(`\nTotal: ${artists.length} unique artists`);

// Source count for band ranking
const sourceCount = new Map<string, number>();
for (const src of sources) {
  const filePath = join(DATA_DIR, src.path);
  if (!existsSync(filePath)) continue;
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const items: any[] = Array.isArray(raw) ? raw : Object.values(raw);
  const seenInSource = new Set<string>();
  for (const item of items) {
    const name = src.nameKey ? item[src.nameKey] : item.name;
    if (!name) continue;
    seenInSource.add(name.toLowerCase().trim());
  }
  for (const key of seenInSource) {
    sourceCount.set(key, (sourceCount.get(key) || 0) + 1);
  }
}

// --- Build full tag index (filtered) ---
const tagCounts: Record<string, number> = {};
for (const a of artists) {
  for (const t of a.tags) {
    if (!isBlockedTag(t)) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
}

const MIN_COUNT = 10;
const allTags = Object.entries(tagCounts)
  .filter(([, count]) => count >= MIN_COUNT)
  .sort((a, b) => b[1] - a[1]);

console.log(`\nFiltered tags (count >= ${MIN_COUNT}): ${allTags.length}`);
console.log(`Top 20: ${allTags.slice(0, 20).map(([t, c]) => `${t}(${c})`).join(", ")}`);

// Assign tiers based on count
// Tier 0: top 50 (always visible)
// Tier 1: top 200
// Tier 2: top 800
// Tier 3: all remaining
const TIER_CUTS = [50, 200, 800];
function getTier(rank: number): number {
  for (let i = 0; i < TIER_CUTS.length; i++) {
    if (rank < TIER_CUTS[i]) return i;
  }
  return TIER_CUTS.length;
}

const tagSet = new Set(allTags.map(([t]) => t));

// --- Co-occurrence ---
console.log("Computing co-occurrence...");
const cooc = new Map<string, number>();
for (const a of artists) {
  const relevant = a.tags.filter(t => tagSet.has(t));
  if (relevant.length < 2) continue;
  const limit = Math.min(relevant.length, 8);
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      const pair = [relevant[i], relevant[j]].sort().join("||");
      cooc.set(pair, (cooc.get(pair) || 0) + 1);
    }
  }
}
console.log(`Co-occurrence pairs: ${cooc.size}`);

// Keep links with minimum weight (scales with tag count)
const MIN_LINK_WEIGHT = 3;
const links: { source: string; target: string; weight: number }[] = [];
for (const [pair, weight] of cooc) {
  if (weight < MIN_LINK_WEIGHT) continue;
  const [a, b] = pair.split("||");
  links.push({ source: a, target: b, weight });
}
links.sort((a, b) => b.weight - a.weight);
console.log(`Links (weight >= ${MIN_LINK_WEIGHT}): ${links.length}`);

// Remove disconnected tags
const connectedTags = new Set<string>();
for (const l of links) {
  connectedTags.add(l.source);
  connectedTags.add(l.target);
}
const connectedAllTags = allTags.filter(([t]) => connectedTags.has(t));
const removedCount = allTags.length - connectedAllTags.length;
console.log(`Removed ${removedCount} disconnected tags, ${connectedAllTags.length} remain`);

// Build nodes
interface SimNode {
  id: string;
  name: string;
  count: number;
  tier: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

const nodes: SimNode[] = connectedAllTags.map(([tag, count], rank) => ({
  id: tag,
  name: tag,
  count,
  tier: getTier(rank),
}));

const nodeMap = new Map(nodes.map(n => [n.id, n]));

// Build link objects for d3
const simLinks = links
  .filter(l => nodeMap.has(l.source) && nodeMap.has(l.target))
  .map(l => ({ ...l }));

console.log(`\nRunning force simulation on ${nodes.length} nodes, ${simLinks.length} links...`);

// --- d3-force simulation ---
const sim = forceSimulation(nodes as any)
  .force("link", forceLink(simLinks as any)
    .id((d: any) => d.id)
    .distance((l: any) => {
      const w = l.weight;
      // Stronger links = closer together, but more spread overall
      return 60 + 300 / (1 + Math.log(1 + w));
    })
    .strength((l: any) => {
      return 0.1 + 0.4 * Math.min(1, l.weight / 100);
    })
  )
  .force("charge", forceManyBody()
    .strength((d: any) => {
      // Uniform strong repulsion — don't scale heavily by count
      return -300 - Math.sqrt(d.count) * 0.5;
    })
    .distanceMax(1500)
  )
  .force("center", forceCenter(0, 0))
  .force("collide", forceCollide()
    .radius((d: any) => 15 + Math.pow(d.count, 0.4) * 0.8)
    .strength(0.8)
    .iterations(3)
  )
  .stop();

// Run simulation ticks
const TICKS = 300;
for (let i = 0; i < TICKS; i++) {
  sim.tick();
  if (i % 50 === 0) console.log(`  tick ${i}/${TICKS}, alpha=${sim.alpha().toFixed(4)}`);
}
console.log(`  done, alpha=${sim.alpha().toFixed(4)}`);

// --- Per-tag band lists ---
console.log("Building band lists per tag...");
const bandsByTag: Record<string, string[]> = {};
for (const [tag] of connectedAllTags) {
  bandsByTag[tag] = artists
    .filter(a => a.tags.includes(tag))
    .sort((a, b) => {
      const sa = sourceCount.get(a.artist.toLowerCase().trim()) || 0;
      const sb = sourceCount.get(b.artist.toLowerCase().trim()) || 0;
      return sb - sa;
    })
    .slice(0, 100)
    .map(a => a.artist);
}

// --- Output ---
// Compact format: arrays instead of objects to save space
// nodes: [id, x, y, count, tier]
// links: [sourceIdx, targetIdx, weight]
const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

const compactNodes = nodes.map(n => [
  n.id,
  Math.round(n.x! * 10) / 10,
  Math.round(n.y! * 10) / 10,
  n.count,
  n.tier,
]);

const compactLinks = simLinks
  .filter(l => {
    const src = typeof l.source === "object" ? (l.source as any).id : l.source;
    const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
    return nodeIndex.has(src) && nodeIndex.has(tgt);
  })
  .map(l => {
    const src = typeof l.source === "object" ? (l.source as any).id : l.source;
    const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
    return [nodeIndex.get(src)!, nodeIndex.get(tgt)!, l.weight];
  });

const output = {
  nodes: compactNodes,
  links: compactLinks,
  bandsByTag,
  tierCuts: TIER_CUTS,
  stats: {
    totalArtists: artists.length,
    totalTags: Object.keys(tagCounts).length,
    graphTags: nodes.length,
    graphLinks: compactLinks.length,
  },
};

const outPath = join(DATA_DIR, "graph-full.json");
writeFileSync(outPath, JSON.stringify(output));
const sizeKB = (JSON.stringify(output).length / 1024).toFixed(0);
console.log(`\nWrote ${outPath} (${sizeKB}KB)`);
console.log(`  ${output.stats.graphTags} tags, ${output.stats.graphLinks} links`);
console.log(`  Tiers: ${TIER_CUTS.map((c, i) => `T${i}(<${c})`).join(", ")}, T${TIER_CUTS.length}(rest)`);
console.log(`  T0: ${nodes.filter(n => n.tier === 0).length}, T1: ${nodes.filter(n => n.tier === 1).length}, T2: ${nodes.filter(n => n.tier === 2).length}, T3: ${nodes.filter(n => n.tier === 3).length}`);
