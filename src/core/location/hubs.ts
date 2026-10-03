import type { Place } from "../types";
import { HUB_SEEDS, PLACE_SEEDS, type HubServices } from "./catalog-data";
import { estimateGroundMinutes, haversineKm, normalizeText, sameLandmass } from "./geo";

export interface Hub extends Place {
  importance: number;
  services: HubServices;
}

export interface CatalogEntry {
  place: Place;
  hub?: Hub;
  aliases: string[];
}

export class HubCatalog {
  private readonly hubs: Hub[];
  private readonly byId = new Map<string, Hub>();
  private readonly entries: CatalogEntry[] = [];

  constructor(hubSeeds = HUB_SEEDS, placeSeeds = PLACE_SEEDS) {
    this.hubs = hubSeeds.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      lat: s.lat,
      lon: s.lon,
      timezone: s.timezone,
      countryCode: s.countryCode,
      codes: s.iata ? { iata: s.iata } : undefined,
      importance: s.importance,
      services: s.services,
    }));
    for (const h of this.hubs) {
      this.byId.set(h.id, h);
      const seed = hubSeeds.find((s) => s.id === h.id)!;
      this.entries.push({ place: stripHub(h), hub: h, aliases: [normalizeText(h.name), ...seed.aliases.map(normalizeText)] });
    }
    for (const p of placeSeeds) {
      const place: Place = { id: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, timezone: p.timezone, countryCode: p.countryCode };
      this.entries.push({ place, aliases: [normalizeText(p.name), ...p.aliases.map(normalizeText)] });
    }
  }

  allHubs(): readonly Hub[] {
    return this.hubs;
  }

  getHub(id: string): Hub | undefined {
    return this.byId.get(id);
  }

  /**
   * Recherche textuelle : correspondance exacte d'alias, sinon l'alias le plus long contenu dans la requête
   * (« Marseille Airport » préfère l'aéroport à la ville).
   */
  findByText(text: string): CatalogEntry | undefined {
    const q = normalizeText(text);
    if (!q) return undefined;
    let best: { entry: CatalogEntry; len: number } | undefined;
    for (const e of this.entries) {
      for (const a of e.aliases) {
        if (!a) continue;
        if (a === q) return e;
        if (` ${q} `.includes(` ${a} `) && (!best || a.length > best.len)) best = { entry: e, len: a.length };
      }
    }
    return best?.entry;
  }
}

export function stripHub(h: Hub): Place {
  const { importance: _i, services: _s, ...place } = h;
  void _i;
  void _s;
  return place;
}

export interface HubCandidate {
  hub: Hub;
  distanceKm: number;
  /** Estimation hors-ligne du temps d'accès terrestre (présélection uniquement). */
  accessMinutes: number;
  score: number;
}

export interface HubSelectionConfig {
  /** Rayon « local » (minutes de trajet terrestre estimé) pour la recherche principale. */
  localMaxMinutes: number;
  /** Rayon des hubs de positionnement (testés en alternatives). */
  positioningMaxMinutes: number;
  maxPerKind: Partial<Record<Hub["kind"], number>>;
  maxPositioningHubs: number;
  minPositioningImportance: number;
}

export const DEFAULT_HUB_SELECTION: HubSelectionConfig = {
  localMaxMinutes: 90,
  positioningMaxMinutes: 210,
  maxPerKind: { airport: 2, station: 3, bus_station: 1, port: 1 },
  maxPositioningHubs: 6,
  minPositioningImportance: 0.6,
};

/** Tous les hubs atteignables par voie terrestre en moins de `maxGroundMinutes` (estimation). */
export function reachableHubs(place: Place, catalog: HubCatalog, maxGroundMinutes: number): HubCandidate[] {
  const out: HubCandidate[] = [];
  for (const hub of catalog.allHubs()) {
    if (!sameLandmass(place, hub)) continue;
    const distanceKm = haversineKm(place, hub);
    const accessMinutes = hub.id === place.id || distanceKm < 0.3 ? 0 : estimateGroundMinutes(distanceKm);
    if (accessMinutes > maxGroundMinutes) continue;
    out.push({ hub, distanceKm, accessMinutes, score: hub.importance / (1 + accessMinutes / 30) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface HubSelection {
  /** Hubs utilisés par la recherche principale. */
  primary: HubCandidate[];
  /** Hubs plus lointains mais importants : candidats des alternatives « autre hub ». */
  positioning: HubCandidate[];
  /** Hubs atteignables non retenus (pour la trace). */
  discarded: HubCandidate[];
}

export function selectHubs(place: Place, catalog: HubCatalog, cfg: HubSelectionConfig = DEFAULT_HUB_SELECTION): HubSelection {
  const all = reachableHubs(place, catalog, cfg.positioningMaxMinutes);
  const primary: HubCandidate[] = [];
  const counts: Record<string, number> = {};
  for (const c of all) {
    if (c.accessMinutes > cfg.localMaxMinutes) continue;
    const isSelf = c.accessMinutes === 0;
    const n = counts[c.hub.kind] ?? 0;
    if (isSelf || n < (cfg.maxPerKind[c.hub.kind] ?? 0)) {
      primary.push(c);
      counts[c.hub.kind] = n + 1;
    }
  }
  const primaryIds = new Set(primary.map((c) => c.hub.id));
  const positioning = all
    .filter((c) => !primaryIds.has(c.hub.id) && c.hub.importance >= cfg.minPositioningImportance)
    .sort((a, b) => b.hub.importance - a.hub.importance || a.accessMinutes - b.accessMinutes)
    .slice(0, cfg.maxPositioningHubs);
  const positioningIds = new Set(positioning.map((c) => c.hub.id));
  const discarded = all.filter((c) => !primaryIds.has(c.hub.id) && !positioningIds.has(c.hub.id));
  return { primary, positioning, discarded };
}
