import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "../../data");

interface Artist {
  name?: string;
  artist?: string;
  tags?: string[];
  genres?: string[];
  labels?: string[];
}

interface GraphNode {
  id: string;
  name: string;
  type: "tag" | "band";
  count: number;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

// Load all sources
const sources = [
  { path: "wikipedia/artists.json", nameKey: "name", tagsKey: "genres" },
  { path: "discogs/artists.json", nameKey: "name", tagsKey: "labels" },
  { path: "web/artists.json", nameKey: null, tagsKey: "genres" },
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

// Count how many sources each artist appears in
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
console.log("Source counts computed");

// Build tag index
const tags: Record<string, number> = {};
for (const a of artists) {
  for (const t of a.tags) {
    tags[t] = (tags[t] || 0) + 1;
  }
}
console.log(`Tags: ${Object.keys(tags).length}`);

// Build graph for multiple sizes
for (const MAX_TAGS of [100, 300]) {
  const BANDS_PER_TAG = 8;

  const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
  const topTags = sorted.slice(0, MAX_TAGS);
  const tagSet = new Set(topTags.map(([t]) => t));

  const nodes: GraphNode[] = topTags.map(([tag, count]) => ({
    id: "tag:" + tag,
    name: tag,
    type: "tag" as const,
    count,
    val: 1,
  }));

  // Co-occurrence
  const cooc = new Map<string, number>();
  for (const a of artists) {
    const relevant = a.tags.filter(t => tagSet.has(t));
    if (relevant.length < 2) continue;
    const limit = Math.min(relevant.length, 6);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const pair = [relevant[i], relevant[j]].sort().join("||");
        cooc.set(pair, (cooc.get(pair) || 0) + 1);
      }
    }
  }

  const links: GraphLink[] = [...cooc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TAGS * 3)
    .map(([pair, weight]) => {
      const [a, b] = pair.split("||");
      return { source: "tag:" + a, target: "tag:" + b, weight };
    });

  // Remove tags with no edges (they form the disconnected outer ring)
  const connectedTags = new Set<string>();
  for (const l of links) {
    connectedTags.add(l.source.replace("tag:", ""));
    connectedTags.add(l.target.replace("tag:", ""));
  }
  const filteredNodes = nodes.filter(n => connectedTags.has(n.name));
  const removedCount = nodes.length - filteredNodes.length;
  if (removedCount > 0) console.log(`  Removed ${removedCount} disconnected tags`);
  nodes.length = 0;
  nodes.push(...filteredNodes);
  // Update tagSet
  for (const t of tagSet) {
    if (!connectedTags.has(t)) tagSet.delete(t);
  }

  // Top bands per tag
  const nodeIds = new Set(nodes.map(n => n.id));
  const bandScores = new Map<string, { name: string; tags: string[]; score: number }>();
  for (const a of artists) {
    const relevant = a.tags.filter(t => tagSet.has(t));
    if (relevant.length >= 2) {
      bandScores.set(a.artist, { name: a.artist, tags: relevant, score: relevant.length });
    }
  }

  const topBands = [...bandScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_TAGS * BANDS_PER_TAG);

  for (const [name, info] of topBands) {
    const id = "band:" + name;
    if (nodeIds.has(id)) continue;
    nodes.push({ id, name, type: "band", count: info.score, val: 0.3 });
    nodeIds.add(id);
    for (const t of info.tags) {
      links.push({ source: "tag:" + t, target: id, weight: 1 });
    }
  }

  // Per-tag band lists — sorted by source count (more sources = more well-known)
  const bandsByTag: Record<string, string[]> = {};
  for (const tag of tagSet) {
    bandsByTag[tag] = artists
      .filter(a => a.tags.includes(tag))
      .sort((a, b) => {
        const sa = sourceCount.get(a.artist.toLowerCase().trim()) || 0;
        const sb = sourceCount.get(b.artist.toLowerCase().trim()) || 0;
        return sb - sa;
      })
      .slice(0, 200)
      .map(a => a.artist);
  }

  const output = {
    nodes,
    links,
    bandsByTag,
    stats: {
      totalArtists: artists.length,
      totalTags: Object.keys(tags).length,
      graphTags: nodes.filter(n => n.type === "tag").length,
      graphBands: nodes.filter(n => n.type === "band").length,
      graphLinks: links.length,
    },
  };

  const outPath = join(DATA_DIR, `graph-${MAX_TAGS}.json`);
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`\nWrote ${outPath}`);
  console.log(`  ${output.stats.graphTags} tags, ${output.stats.graphBands} bands, ${output.stats.graphLinks} links`);
  console.log(`  ${(JSON.stringify(output).length / 1024).toFixed(0)}KB`);
}
