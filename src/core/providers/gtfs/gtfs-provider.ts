import { DateTime } from "luxon";
import { localDatesInWindow, toEpochMs, toIsoUtc } from "../../time";
import type { Place, TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";
import type { GtfsFeedConfig } from "./feeds";
import { serviceActive, stopsNear, type GtfsIndex } from "./gtfs-index";

export interface GtfsFeedHandle {
  /** Chargement paresseux (le fichier est lu à la première requête). */
  load(): Promise<GtfsIndex>;
  /** Date de publication / récupération de la donnée source (fraîcheur). */
  dataAsOf: string;
  /** Provenance réellement utilisée (URL officielle ou miroir). */
  sourceUsed: string;
  /** Période de validité connue sans charger le flux (manifest), YYYYMMDD. */
  validity?: { start: number; end: number };
}

const ymd = (iso: string) => Number(iso.replaceAll("-", ""));

/**
 * OpenDataProvider GTFS : horaires théoriques RÉELS issus d'un flux officiel, prix INCONNUS
 * (les GTFS ne donnent pas de tarifs fiables pour ces réseaux). Aucune requête réseau à l'exécution.
 */
export class GtfsProvider implements TransportProvider {
  readonly accessMethod = "OPEN_DATA" as const;
  readonly isMock = false;
  /** Un GTFS est TOUJOURS un horaire théorique, même valide à la date recherchée. */
  readonly realtimeCapable = false;
  readonly cacheTtlSeconds = 0; // calcul local, pas de cache nécessaire
  readonly timeoutMs = 20_000; // le premier appel charge le flux en mémoire
  readonly maxCallsPerSearch = 2000;
  readonly maxConcurrency = 1000;
  readonly id: string;
  readonly displayName: string;
  readonly modes: GtfsFeedConfig["modes"];
  readonly attribution: string;
  private index: GtfsIndex | null = null;
  private loading: Promise<GtfsIndex> | null = null;

  constructor(
    private readonly feed: GtfsFeedConfig,
    private readonly handle: GtfsFeedHandle | null,
  ) {
    this.id = `gtfs-${feed.id}`;
    this.displayName = feed.displayName;
    this.modes = feed.modes;
    this.attribution = feed.attribution;
  }

  availability(): ProviderAvailability {
    return this.handle ? { enabled: true } : { enabled: false, reasonKey: "provider.disabled.feedNotDownloaded" };
  }

  private async getIndex(): Promise<GtfsIndex> {
    if (this.index) return this.index;
    this.loading ??= this.handle!.load().then((i) => (this.index = i));
    return this.loading;
  }

  /** Couverture : flux valide sur la fenêtre et arrêts proches des deux extrémités. */
  supports(q: SegmentQuery): boolean {
    if (!this.handle) return false;
    const v = this.index?.validity ?? this.handle.validity;
    if (v) {
      const start = ymd(q.windowStart.slice(0, 10));
      const end = ymd(q.windowEnd.slice(0, 10));
      if (end < v.start || start > v.end) return false;
    }
    if (!this.index) return true; // pas encore chargé : on laisse search() trancher
    const r = this.feed.stopRadiusKm;
    return stopsNear(this.index, q.origin.lat, q.origin.lon, r, 1).length > 0 && stopsNear(this.index, q.destination.lat, q.destination.lon, r, 1).length > 0;
  }

  private place(idx: GtfsIndex, s: number, routeType: number): Place {
    const st = idx.stops[s]!;
    return {
      id: `gtfs:${this.feed.id}:${st.id}`,
      name: st.name,
      kind: routeType === 2 || routeType === 1 || (routeType >= 100 && routeType < 500) ? "station" : "bus_station",
      lat: st.lat,
      lon: st.lon,
      timezone: st.tz ?? idx.agencyTimezone,
    };
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const idx = await this.getIndex();
    const r = this.feed.stopRadiusKm;
    const from = stopsNear(idx, q.origin.lat, q.origin.lon, r, 12);
    const to = stopsNear(idx, q.destination.lat, q.destination.lon, r, 12);
    if (from.length === 0 || to.length === 0) return [];
    const destSet = new Set(to.map((x) => x.stop));
    const ws = toEpochMs(q.windowStart);
    const we = toEpochMs(q.windowEnd);
    const tz = idx.agencyTimezone;
    const checkedAt = ctx.now().toISOString();

    // Dates de service : jours locaux de la fenêtre + la veille (horaires GTFS > 24:00).
    const dates = localDatesInWindow(q.windowStart, q.windowEnd, tz);
    const first = DateTime.fromISO(dates[0]!, { zone: tz }).minus({ days: 1 }).toISODate()!;
    const serviceDays = [first, ...dates].map((d) => {
      const dt = DateTime.fromISO(d, { zone: tz });
      // Référence GTFS : « midi moins 12 h » (correct les jours de changement d'heure).
      return { ymd: ymd(d), weekday: dt.weekday, base: dt.set({ hour: 12 }).minus({ hours: 12 }).toMillis() };
    });

    const best = new Map<string, { k: number; j: number; base: number; ymd: number }>();
    for (const day of serviceDays) {
      for (const { stop } of from) {
        for (let o = idx.occStart[stop]!; o < idx.occStart[stop + 1]!; o++) {
          const k = idx.occ[o]!;
          if (idx.stFlags[k]! & 1) continue; // montée interdite
          const t = idx.stTrip[k]!;
          const dep = day.base + idx.stDep[k]! * 1000;
          if (dep < ws || dep > we || idx.stDep[k]! < 0) continue;
          if (!serviceActive(idx.services[idx.tripService[t]!]!, day.ymd, day.weekday)) continue;
          const route = idx.routes[idx.tripRoute[t]!]!;
          if (!q.modes.includes(this.feed.mapMode(route))) continue;
          for (let j = k + 1; j < idx.tripStart[t + 1]!; j++) {
            if (!destSet.has(idx.stStop[j]!) || idx.stFlags[j]! & 2) continue;
            if (idx.stStop[j] === stop) break;
            const key = `${t}:${day.ymd}`;
            const prev = best.get(key);
            // Un même voyage : on garde la montée la plus tardive et la descente la plus précoce.
            if (!prev || idx.stDep[k]! > idx.stDep[prev.k]! || (idx.stDep[k] === idx.stDep[prev.k] && idx.stArr[j]! < idx.stArr[prev.j]!)) {
              best.set(key, { k, j, base: day.base, ymd: day.ymd });
            }
            break;
          }
        }
      }
    }

    const out: TransportSegment[] = [];
    for (const { k, j, base, ymd: d } of best.values()) {
      const t = idx.stTrip[k]!;
      const route = idx.routes[idx.tripRoute[t]!]!;
      const agency = idx.agencies.get(route.agencyId);
      const dep = base + idx.stDep[k]! * 1000;
      const arr = base + idx.stArr[j]! * 1000;
      const mode = this.feed.mapMode(route);
      const service = [route.shortName, idx.tripShortName[t]].filter(Boolean).join(" ") || route.longName;
      out.push({
        id: `${this.id}:${idx.tripIds[t]}:${d}:${idx.stops[idx.stStop[k]!]!.id}>${idx.stops[idx.stStop[j]!]!.id}`,
        provider: this.id,
        accessMethod: "OPEN_DATA",
        operator: agency?.name || this.feed.operator,
        mode,
        origin: this.place(idx, idx.stStop[k]!, route.type),
        destination: this.place(idx, idx.stStop[j]!, route.type),
        departureTime: toIsoUtc(dep),
        arrivalTime: toIsoUtc(arr),
        flexibleDeparture: false,
        durationMinutes: Math.round((arr - dep) / 60000),
        price: null,
        priceConfidence: "UNKNOWN",
        bookingUrl: this.feed.officialSite ?? null,
        sourceUrl: route.url ?? this.feed.datasetPage,
        realtime: false,
        availability: "unknown",
        isMock: false,
        checkedAt,
        dataAsOf: this.handle!.dataAsOf,
        attribution: this.feed.attribution,
        serviceNumber: service.slice(0, 40),
        notes: ["segment.note.gtfsSchedule", "segment.note.priceUnknownOpenData"],
      });
    }
    return out;
  }
}
