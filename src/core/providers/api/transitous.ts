import { addMinutesIso, toEpochMs, toIsoUtc } from "../../time";
import type { Place, TransportMode, TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";
import { EUROPE_BBOX, fetchJson, inBox } from "./http";

/** Sous-ensemble utile de la réponse MOTIS GET /api/v6/plan (openapi.yaml du projet motis). */
export interface MotisPlace {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
  tz?: string;
}
export interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  startTime: string;
  endTime: string;
  duration: number;
  realTime: boolean;
  routeShortName?: string;
  tripShortName?: string;
  displayName?: string;
  agencyName?: string;
  routeUrl?: string;
  tripId?: string;
}
export interface MotisPlanResponse {
  itineraries: { legs: MotisLeg[] }[];
}

const MODE_MAP: Record<string, TransportMode | undefined> = {
  WALK: "walk",
  BUS: "bus",
  COACH: "coach",
  TRAM: "tram",
  SUBWAY: "metro",
  METRO: "metro",
  FERRY: "ferry",
  AIRPLANE: "flight",
  HIGHSPEED_RAIL: "high_speed_train",
  LONG_DISTANCE: "train",
  NIGHT_RAIL: "train",
  RAIL: "train",
  REGIONAL_FAST_RAIL: "regional_train",
  REGIONAL_RAIL: "regional_train",
  SUBURBAN: "regional_train",
};

export interface TransitousOptions {
  enabled: boolean;
  /** Contact obligatoire dans le User-Agent (politique d'usage Transitous). */
  contact?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Volontairement bas tant que l'usage n'est pas convenu avec l'équipe Transitous. */
  maxCallsPerSearch?: number;
}

/**
 * Transitous (MOTIS) — routage transports publics européens à partir de GTFS ouverts.
 * Politique : projet non commercial, User-Agent avec contact, cache, contact préalable pour un usage
 * intensif du routage. Désactivé par défaut (TRANSITOUS_ENABLED=true + TRANSITOUS_CONTACT requis).
 */
export class TransitousProvider implements TransportProvider {
  readonly id = "transitous";
  readonly displayName = "Transitous (MOTIS) — transports publics européens";
  readonly accessMethod = "OPEN_DATA" as const;
  readonly isMock = false;
  readonly attribution = "Transitous (transitous.org) — sources : https://transitous.org/sources/";
  readonly modes: TransportMode[] = ["bus", "coach", "tram", "metro", "ferry", "train", "regional_train", "high_speed_train"];
  readonly cacheTtlSeconds = 3600;
  readonly realtimeCapable = true;
  readonly timeoutMs = 15_000;
  readonly maxConcurrency = 1;
  readonly maxCallsPerSearch: number;

  constructor(private readonly o: TransitousOptions) {
    this.maxCallsPerSearch = o.maxCallsPerSearch ?? 4;
  }

  availability(): ProviderAvailability {
    if (!this.o.enabled) return { enabled: false, reasonKey: "provider.disabled.transitousNotAgreed" };
    if (!this.o.contact) return { enabled: false, reasonKey: "provider.disabled.contactMissing" };
    return { enabled: true };
  }

  supports(q: SegmentQuery): boolean {
    return inBox(q.origin, EUROPE_BBOX) && inBox(q.destination, EUROPE_BBOX);
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const params = new URLSearchParams({
      fromPlace: `${q.origin.lat},${q.origin.lon}`,
      toPlace: `${q.destination.lat},${q.destination.lon}`,
      time: q.windowStart,
      arriveBy: "false",
      numItineraries: "5",
      searchWindow: String(Math.min(6 * 3600, Math.max(3600, (toEpochMs(q.windowEnd) - toEpochMs(q.windowStart)) / 1000))),
    });
    const data = await fetchJson<MotisPlanResponse>(
      this.o.fetchImpl ?? fetch,
      `${this.o.baseUrl ?? "https://api.transitous.org"}/api/v6/plan?${params}`,
      { headers: { "User-Agent": `TravelAgentAI/0.2 (${this.o.contact})`, Accept: "application/json" }, signal: ctx.signal },
      this.id,
    );
    return motisToSegments(data, q, ctx.now().toISOString(), this.id, this.attribution);
  }
}

function motisPlace(p: MotisPlace, q: SegmentQuery, fallbackTz: string): Place {
  return {
    id: p.stopId ? `motis:${p.stopId}` : `geo:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`,
    name: p.name,
    kind: p.stopId ? "station" : "coordinates",
    lat: p.lat,
    lon: p.lon,
    timezone: p.tz ?? fallbackTz ?? q.origin.timezone,
  };
}

/** Conversion des itinéraires MOTIS en segments (chaque étape devient un segment ; le moteur recombine). */
export function motisToSegments(data: MotisPlanResponse, q: SegmentQuery, checkedAt: string, provider: string, attribution: string): TransportSegment[] {
  const out: TransportSegment[] = [];
  for (const it of data.itineraries ?? []) {
    for (const leg of it.legs) {
      const mode = MODE_MAP[leg.mode];
      if (!mode) continue;
      const dep = toIsoUtc(toEpochMs(leg.startTime));
      const arr = toIsoUtc(toEpochMs(leg.endTime));
      const isWalk = mode === "walk";
      out.push({
        id: `${provider}:${leg.tripId ?? leg.mode}:${dep}:${leg.from.stopId ?? leg.from.name}>${leg.to.stopId ?? leg.to.name}`,
        provider,
        accessMethod: "OPEN_DATA",
        operator: leg.agencyName,
        mode,
        origin: motisPlace(leg.from, q, q.origin.timezone),
        destination: motisPlace(leg.to, q, q.destination.timezone),
        departureTime: dep,
        arrivalTime: isWalk ? addMinutesIso(dep, Math.max(1, Math.round(leg.duration / 60))) : arr,
        flexibleDeparture: isWalk,
        durationMinutes: Math.max(isWalk ? 1 : 0, Math.round(leg.duration / 60)),
        price: isWalk ? { amountMinor: 0, currency: q.currency } : null,
        priceConfidence: isWalk ? "REAL" : "UNKNOWN",
        bookingUrl: null,
        sourceUrl: leg.routeUrl || undefined,
        realtime: leg.realTime,
        availability: "unknown",
        isMock: false,
        checkedAt,
        dataAsOf: checkedAt,
        attribution,
        serviceNumber: leg.displayName ?? leg.routeShortName ?? leg.tripShortName,
        notes: isWalk ? ["segment.note.walkEstimate"] : ["segment.note.priceUnknownOpenData"],
      });
    }
  }
  return out;
}
