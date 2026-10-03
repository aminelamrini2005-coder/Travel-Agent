import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { GTFS_FEEDS, type GtfsFeedConfig } from "./feeds";
import { buildGtfsIndex, type GtfsIndex } from "./gtfs-index";
import { GtfsProvider, type GtfsFeedHandle } from "./gtfs-provider";

const NEEDED = new Set(["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt", "feed_info.txt"]);

/** Entrée du manifeste écrit par `npm run gtfs:sync`. */
export interface GtfsManifestEntry {
  feedId: string;
  file: string;
  sourceUsed: string;
  sourceKind: "official" | "mirror";
  /** Date de mise à jour de la source (en-tête Last-Modified ou métadonnée du miroir). */
  sourceUpdatedAt: string;
  downloadedAt: string;
  sha256: string;
  validity: { start: number; end: number };
}

export function loadGtfsZip(file: string): GtfsIndex {
  const files = unzipSync(readFileSync(file), { filter: (f) => NEEDED.has(path.basename(f.name)) });
  const decoder = new TextDecoder("utf-8");
  const map = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) map.set(path.basename(name), decoder.decode(data));
  return buildGtfsIndex(map);
}

export function readManifest(dir: string): GtfsManifestEntry[] {
  const p = path.join(dir, "manifest.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as GtfsManifestEntry[];
}

/**
 * Providers GTFS à partir des fichiers téléchargés. Un flux absent du disque donne un provider
 * « désactivé » (visible dans la trace), jamais de données inventées.
 */
export function createGtfsProviders(dir: string, feeds: GtfsFeedConfig[] = GTFS_FEEDS): GtfsProvider[] {
  const manifest = readManifest(dir);
  return feeds.map((feed) => {
    const m = manifest.find((e) => e.feedId === feed.id);
    const file = m ? path.join(dir, m.file) : null;
    const handle: GtfsFeedHandle | null =
      m && file && existsSync(file)
        ? { load: async () => loadGtfsZip(file), dataAsOf: m.sourceUpdatedAt, sourceUsed: m.sourceUsed, validity: m.validity }
        : null;
    return new GtfsProvider(feed, handle);
  });
}
