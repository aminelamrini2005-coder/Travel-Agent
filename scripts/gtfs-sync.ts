/**
 * Télécharge les flux GTFS configurés (src/core/providers/gtfs/feeds.ts) dans data/gtfs/raw
 * et écrit data/gtfs/manifest.json (provenance, date de la source, période de validité, empreinte).
 *
 * Ordre : URL officielle d'abord, puis copie de la Mobility Database si l'officielle est injoignable.
 * Usage : npm run gtfs:sync           (tous les flux)
 *         npm run gtfs:sync -- tib-mallorca
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GTFS_FEEDS } from "../src/core/providers/gtfs/feeds";
import { loadGtfsZip, readManifest, type GtfsManifestEntry } from "../src/core/providers/gtfs/gtfs-loader";

const DIR = path.resolve("data/gtfs");
const RAW = path.join(DIR, "raw");
const UA = "TravelAgentAI/0.2 (gtfs-sync; open data import)";

async function tryDownload(url: string): Promise<{ data: Buffer; updatedAt: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      console.warn(`  ✗ ${url} → HTTP ${res.status}`);
      return null;
    }
    const data = Buffer.from(await res.arrayBuffer());
    let updatedAt = res.headers.get("last-modified") ? new Date(res.headers.get("last-modified")!).toISOString() : new Date().toISOString();
    // Miroir Mobility Database : la date de mise à jour est dans les métadonnées de l'objet.
    if (url.includes("storage.googleapis.com/storage/v1/")) {
      const meta = await fetch(url.replace(/\?alt=media$/, ""), { headers: { "User-Agent": UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (meta && typeof meta.updated === "string") updatedAt = meta.updated;
    }
    return { data, updatedAt };
  } catch (err) {
    console.warn(`  ✗ ${url} → ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const only = process.argv.slice(2);
  const manifest = readManifest(DIR);
  for (const feed of GTFS_FEEDS.filter((f) => only.length === 0 || only.includes(f.id))) {
    console.log(`→ ${feed.id}`);
    let got = await tryDownload(feed.officialUrl);
    let kind: GtfsManifestEntry["sourceKind"] = "official";
    let used = feed.officialUrl;
    if (!got && feed.mirrorUrl) {
      got = await tryDownload(feed.mirrorUrl);
      kind = "mirror";
      used = feed.mirrorUrl;
    }
    const file = `${feed.id}.zip`;
    if (!got) {
      if (existsSync(path.join(RAW, file))) console.warn("  (fichier existant conservé)");
      continue;
    }
    writeFileSync(path.join(RAW, file), got.data);
    const idx = loadGtfsZip(path.join(RAW, file));
    const entry: GtfsManifestEntry = {
      feedId: feed.id,
      file: `raw/${file}`,
      sourceUsed: used,
      sourceKind: kind,
      sourceUpdatedAt: got.updatedAt,
      downloadedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(got.data).digest("hex"),
      validity: idx.validity,
    };
    const i = manifest.findIndex((e) => e.feedId === feed.id);
    if (i >= 0) manifest[i] = entry;
    else manifest.push(entry);
    console.log(`  ✓ ${kind} — ${idx.stops.length} arrêts, ${idx.tripIds.length} voyages, valide ${idx.validity.start} → ${idx.validity.end}`);
  }
  writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// Permet aussi l'import d'un fichier déjà présent (sans réseau) : GTFS_LOCAL=<feedId>=<chemin>
if (process.env.GTFS_LOCAL) {
  const [feedId, file] = process.env.GTFS_LOCAL.split("=");
  console.log(`import local ${feedId} ← ${file}`);
  void (async () => {
    mkdirSync(RAW, { recursive: true });
    const data = readFileSync(file!);
    writeFileSync(path.join(RAW, `${feedId}.zip`), data);
    const idx = loadGtfsZip(path.join(RAW, `${feedId}.zip`));
    const manifest = readManifest(DIR).filter((e) => e.feedId !== feedId);
    manifest.push({ feedId: feedId!, file: `raw/${feedId}.zip`, sourceUsed: `file:${path.basename(file!)}`, sourceKind: "official", sourceUpdatedAt: process.env.GTFS_LOCAL_UPDATED ?? new Date().toISOString(), downloadedAt: new Date().toISOString(), sha256: createHash("sha256").update(data).digest("hex"), validity: idx.validity });
    writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  })();
} else {
  void main();
}
