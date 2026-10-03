/**
 * Télécharge les flux GTFS configurés (src/core/providers/gtfs/feeds.ts) dans data/gtfs/raw
 * et écrit data/gtfs/manifest.json (provenance, date de la source, période de validité, empreinte).
 *
 * La source officielle est toujours essayée en premier ; la copie Mobility Database n'est qu'un repli.
 * Usage : npm run gtfs:sync           (tous les flux)
 *         npm run gtfs:sync -- tib-mallorca
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GTFS_FEEDS } from "../src/core/providers/gtfs/feeds";
import { loadGtfsZip, readManifest, type GtfsManifestEntry } from "../src/core/providers/gtfs/gtfs-loader";
import { downloadFeed } from "../src/core/providers/gtfs/gtfs-sync";

const DIR = path.resolve(process.env.GTFS_DIR ?? "data/gtfs");
const RAW = path.join(DIR, "raw");

async function main() {
  mkdirSync(RAW, { recursive: true });
  const only = process.argv.slice(2);
  const manifest = readManifest(DIR);
  for (const feed of GTFS_FEEDS.filter((f) => only.length === 0 || only.includes(f.id))) {
    console.log(`→ ${feed.id}`);
    const got = await downloadFeed(feed, fetch, undefined, (m) => console.warn(m));
    if (!got) {
      console.warn("  aucune source joignable — fichier existant conservé s'il y en a un");
      continue;
    }
    const file = `${feed.id}.zip`;
    writeFileSync(path.join(RAW, file), got.data);
    const idx = loadGtfsZip(path.join(RAW, file));
    const entry: GtfsManifestEntry = {
      feedId: feed.id,
      file: `raw/${file}`,
      sourceUsed: got.sourceUsed,
      sourceKind: got.sourceKind,
      sourceUpdatedAt: got.sourceUpdatedAt,
      downloadedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(got.data).digest("hex"),
      validity: idx.validity,
    };
    const i = manifest.findIndex((e) => e.feedId === feed.id);
    if (i >= 0) manifest[i] = entry;
    else manifest.push(entry);
    console.log(`  ✓ ${got.sourceKind} — ${idx.stops.length} arrêts, ${idx.tripIds.length} voyages, valide ${idx.validity.start} → ${idx.validity.end}, source du ${got.sourceUpdatedAt.slice(0, 10)}`);
  }
  writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

void main();
