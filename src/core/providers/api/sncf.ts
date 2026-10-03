import { DateTime } from "luxon";
import { toEpochMs, toIsoUtc } from "../../time";
import type { Money, Place, TransportMode, TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";
import { fetchJson, FRANCE_BBOX, inBox } from "./http";

/** Sous-ensemble de la réponse Navitia GET /v1/coverage/sncf/journeys. */
export interface NavitiaPlace {
  id: string;
  name: string;
  embedded_type?: string;
  stop_point?: { id: string; name: string; coord: { lat: string; lon: string } };
  stop_area?: { id: string; name: string; coord: { lat: string; lon: string } };
  address?: { coord: { lat: string; lon: string } };
}
export interface NavitiaSection {
  id: string;
  type: "public_transport" | "street_network" | "transfer" | "waiting" | "crow_fly" | string;
  mode?: string;
  from?: NavitiaPlace;
  to?: NavitiaPlace;
  departure_date_time: string;
  arrival_date_time: string;
  duration: number;
  data_freshness?: "base_schedule" | "adapted_schedule" | "realtime";
  display_informations?: {
    commercial_mode?: string;
    physical_mode?: string;
    network?: string;
    code?: string;
    headsign?: string;
    trip_short_name?: string;
    label?: string;
  };
}
export interface NavitiaJourneysResponse {
  journeys?: { sections: NavitiaSection[]; fare?: { found: boolean; total?: { value: string; currency: string } } }[];
  context?: { timezone?: string };
  error?: { id: string; message: string };
}

/** Modes commerciaux / physiques SNCF → nos modes. */
export function navitiaMode(info: NavitiaSection["display_informations"]): TransportMode {
  const s = `${info?.commercial_mode ?? ""} ${info?.physical_mode ?? ""}`.toLowerCase();
  if (/tgv|ouigo|inoui|lyria|eurostar|frecciarossa|\bave\b|grande vitesse|high speed/.test(s)) return "high_speed_train";
  if (/\b(autocar|car|coach)\b/.test(s)) return "coach";
  if (/\bter\b|transilien|\brer\b|régional|regional|\blio\b/.test(s)) return "regional_train";
  if (/intercit|train/.test(s)) return "train";
  if (/tram/.test(s)) return "tram";
  if (/métro|metro/.test(s)) return "metro";
  if (/bus/.test(s)) return "bus";
  if (/bateau|ferry|navette fluviale/.test(s)) return "ferry";
  return "train";
}

function coordOf(p: NavitiaPlace): { lat: number; lon: number } | null {
  const c = p.stop_point?.coord ?? p.stop_area?.coord ?? p.address?.coord;
  return c ? { lat: Number(c.lat), lon: Number(c.lon) } : null;
}

function navitiaDateToUtc(s: string, tz: string): string {
  // Format Navitia : 20261016T151200 (heure locale de la couverture).
  const local = DateTime.fromFormat(s, "yyyyLLdd'T'HHmmss", { zone: tz });
  if (!local.isValid) throw new Error(`Date Navitia invalide : ${s}`);
  return toIsoUtc(local.toMillis());
}

export interface SncfOptions {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * API SNCF (Navitia) : horaires théoriques et temps réel des trains SNCF.
 * Prix : la plateforme ne fournit pas de prix de vente dynamiques. Si un tarif de référence est renvoyé
 * pour un trajet à un seul segment ferroviaire, il est affiché en RANGE (« tarif de référence ») ;
 * sinon UNKNOWN.
 */
export class SncfProvider implements TransportProvider {
  readonly id = "sncf";
  readonly displayName = "API SNCF (Navitia) — horaires trains";
  readonly accessMethod = "API" as const;
  readonly isMock = false;
  readonly attribution = "Données SNCF — api.sncf.com (Navitia)";
  readonly modes: TransportMode[] = ["train", "regional_train", "high_speed_train", "coach"];
  readonly cacheTtlSeconds = 900;
  readonly realtimeCapable = true;
  readonly timeoutMs = 12_000;
  readonly maxCallsPerSearch = 15;
  readonly maxConcurrency = 4;

  constructor(private readonly o: SncfOptions) {}

  availability(): ProviderAvailability {
    return this.o.token ? { enabled: true } : { enabled: false, reasonKey: "provider.disabled.apiKeyMissing" };
  }

  supports(q: SegmentQuery): boolean {
    return inBox(q.origin, FRANCE_BBOX) && inBox(q.destination, FRANCE_BBOX) && q.origin.id !== q.destination.id;
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const tz = "Europe/Paris";
    const dt = DateTime.fromMillis(toEpochMs(q.windowStart), { zone: tz }).toFormat("yyyyLLdd'T'HHmmss");
    const params = new URLSearchParams({
      from: `${q.origin.lon};${q.origin.lat}`,
      to: `${q.destination.lon};${q.destination.lat}`,
      datetime: dt,
      datetime_represents: "departure",
      count: "6",
      data_freshness: "realtime",
    });
    const data = await fetchJson<NavitiaJourneysResponse>(
      this.o.fetchImpl ?? fetch,
      `${this.o.baseUrl ?? "https://api.sncf.com/v1/coverage/sncf"}/journeys?${params}`,
      { headers: { Authorization: `Basic ${Buffer.from(`${this.o.token}:`).toString("base64")}`, Accept: "application/json" }, signal: ctx.signal },
      this.id,
    );
    if (data.error && data.error.id !== "no_solution") throw new Error(`sncf : ${data.error.id} ${data.error.message}`);
    return navitiaToSegments(data, q, ctx.now().toISOString(), this.attribution);
  }
}

export function navitiaToSegments(data: NavitiaJourneysResponse, q: SegmentQuery, checkedAt: string, attribution: string): TransportSegment[] {
  const tz = data.context?.timezone ?? "Europe/Paris";
  const out: TransportSegment[] = [];
  for (const j of data.journeys ?? []) {
    const pt = j.sections.filter((s) => s.type === "public_transport");
    let fare: Money | null = null;
    if (j.fare?.found && j.fare.total && pt.length === 1) {
      const v = Number(j.fare.total.value);
      const cur = j.fare.total.currency.toLowerCase();
      if (Number.isFinite(v) && v > 0) fare = { amountMinor: Math.round(cur === "centime" ? v : v * 100), currency: "EUR" };
    }
    for (const s of j.sections) {
      if (!s.from || !s.to) continue;
      const isPt = s.type === "public_transport";
      const isWalk = s.type === "street_network" || s.type === "transfer" || s.type === "crow_fly";
      if (!isPt && !isWalk) continue;
      const a = coordOf(s.from);
      const b = coordOf(s.to);
      if (!a || !b) continue;
      const place = (p: NavitiaPlace, c: { lat: number; lon: number }): Place => ({
        id: p.stop_point ? `sncf:${p.stop_point.id}` : `geo:${c.lat.toFixed(5)},${c.lon.toFixed(5)}`,
        name: p.stop_point?.name ?? p.name,
        kind: p.stop_point ? "station" : "address",
        lat: c.lat,
        lon: c.lon,
        timezone: tz,
      });
      const dep = navitiaDateToUtc(s.departure_date_time, tz);
      const arr = navitiaDateToUtc(s.arrival_date_time, tz);
      const info = s.display_informations;
      out.push({
        id: `sncf:${s.id}`,
        provider: "sncf",
        accessMethod: "API",
        operator: info?.network ?? (isPt ? "SNCF" : undefined),
        mode: isPt ? navitiaMode(info) : "walk",
        origin: place(s.from, a),
        destination: place(s.to, b),
        departureTime: dep,
        arrivalTime: arr,
        flexibleDeparture: isWalk,
        durationMinutes: Math.max(isWalk ? 1 : 0, Math.round(s.duration / 60)),
        price: isWalk ? { amountMinor: 0, currency: q.currency } : fare,
        priceRange: !isWalk && fare ? { min: fare, max: fare } : undefined,
        priceConfidence: isWalk ? "REAL" : fare ? "RANGE" : "UNKNOWN",
        bookingUrl: isPt ? "https://www.sncf-connect.com/" : null,
        realtime: s.data_freshness === "realtime" || s.data_freshness === "adapted_schedule",
        availability: "unknown",
        isMock: false,
        checkedAt,
        dataAsOf: checkedAt,
        attribution,
        serviceNumber: [info?.commercial_mode, info?.trip_short_name ?? info?.headsign].filter(Boolean).join(" ") || undefined,
        notes: isWalk ? ["segment.note.walkEstimate"] : fare ? ["segment.note.sncfReferenceFare"] : ["segment.note.priceUnknownApi"],
      });
    }
  }
  return out;
}
