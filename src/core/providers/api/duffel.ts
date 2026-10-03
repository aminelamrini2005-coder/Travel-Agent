import { DateTime } from "luxon";
import { haversineKm } from "../../location/geo";
import { localDatesInWindow, toEpochMs, toIsoUtc } from "../../time";
import type { Place, TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";
import { fetchJson } from "./http";

/** Sous-ensemble de la réponse Duffel POST /air/offer_requests?return_offers=true (API v2). */
export interface DuffelAirport {
  iata_code: string;
  name: string;
  time_zone: string;
  latitude?: number;
  longitude?: number;
}
export interface DuffelSegment {
  id: string;
  departing_at: string; // heure locale de l'aéroport de départ, sans fuseau
  arriving_at: string;
  origin: DuffelAirport;
  destination: DuffelAirport;
  marketing_carrier: { name: string; iata_code: string };
  marketing_carrier_flight_number: string;
  operating_carrier?: { name: string };
}
export interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at?: string;
  owner: { name: string; iata_code: string };
  slices: { segments: DuffelSegment[] }[];
}
export interface DuffelOfferRequestResponse {
  data: { id: string; offers: DuffelOffer[] };
}

export interface DuffelOptions {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxOffersPerQuery?: number;
}

/**
 * Duffel — offres de vols avec prix réels (mode live).
 * ⚠ Un jeton de TEST (duffel_test_…) renvoie des offres fictives (« Duffel Airways ») :
 * le provider se déclare alors MOCK, et l'interface l'affiche comme démonstration.
 * Pas de réservation intégrée (MVP sans paiement) : aucun lien de réservation n'est inventé.
 */
export class DuffelProvider implements TransportProvider {
  readonly id = "duffel";
  readonly displayName: string;
  readonly accessMethod: "API" | "MOCK";
  readonly isMock: boolean;
  readonly attribution = "Offres de vols — Duffel API";
  readonly modes = ["flight"] as const;
  readonly cacheTtlSeconds = 600;
  readonly timeoutMs = 30_000;
  readonly maxCallsPerSearch = 6;
  readonly maxConcurrency = 2;

  constructor(private readonly o: DuffelOptions) {
    this.isMock = !!o.token?.startsWith("duffel_test_");
    this.accessMethod = this.isMock ? "MOCK" : "API";
    this.displayName = this.isMock ? "Duffel — MODE TEST (offres fictives)" : "Duffel — vols (prix réels)";
  }

  availability(): ProviderAvailability {
    return this.o.token ? { enabled: true } : { enabled: false, reasonKey: "provider.disabled.apiKeyMissing" };
  }

  supports(q: SegmentQuery): boolean {
    return !!q.origin.codes?.iata && !!q.destination.codes?.iata && q.origin.codes.iata !== q.destination.codes.iata && haversineKm(q.origin, q.destination) >= 100;
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const dates = localDatesInWindow(q.windowStart, q.windowEnd, q.origin.timezone).slice(0, 2);
    const out: TransportSegment[] = [];
    for (const date of dates) {
      const body = {
        data: {
          slices: [{ origin: q.origin.codes!.iata, destination: q.destination.codes!.iata, departure_date: date }],
          passengers: Array.from({ length: q.passengers }, () => ({ type: "adult" })),
          cabin_class: "economy",
          max_connections: 1,
        },
      };
      const data = await fetchJson<DuffelOfferRequestResponse>(
        this.o.fetchImpl ?? fetch,
        `${this.o.baseUrl ?? "https://api.duffel.com"}/air/offer_requests?return_offers=true&supplier_timeout=20000`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.o.token}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctx.signal,
        },
        this.id,
      );
      out.push(...duffelToSegments(data, q, ctx.now().toISOString(), this.isMock, this.o.maxOffersPerQuery ?? 25));
    }
    return out;
  }
}

function airportPlace(a: DuffelAirport, q: SegmentQuery): Place {
  if (a.iata_code === q.origin.codes?.iata) return q.origin;
  if (a.iata_code === q.destination.codes?.iata) return q.destination;
  return { id: `hub:${a.iata_code}`, name: a.name, kind: "airport", lat: a.latitude ?? 0, lon: a.longitude ?? 0, timezone: a.time_zone, codes: { iata: a.iata_code } };
}

const localToUtc = (s: string, tz: string) => toIsoUtc(DateTime.fromISO(s, { zone: tz }).toMillis());

/**
 * Une offre = un billet (un prix total). Le prix est porté par le premier vol ; les vols suivants de la même
 * offre sont à 0 € (« inclus dans le billet ») et partagent un ticketGroupId (correspondance protégée).
 * On garde l'offre la moins chère par combinaison de vols.
 */
export function duffelToSegments(data: DuffelOfferRequestResponse, q: SegmentQuery, checkedAt: string, isMock: boolean, maxOffers: number): TransportSegment[] {
  const best = new Map<string, DuffelOffer>();
  for (const o of data.data.offers ?? []) {
    const segs = o.slices[0]?.segments ?? [];
    if (segs.length === 0) continue;
    const key = segs.map((s) => `${s.marketing_carrier.iata_code}${s.marketing_carrier_flight_number}@${s.departing_at}`).join(">");
    const cur = best.get(key);
    if (!cur || Number(o.total_amount) < Number(cur.total_amount)) best.set(key, o);
  }
  const offers = [...best.values()].sort((a, b) => Number(a.total_amount) - Number(b.total_amount)).slice(0, maxOffers);
  const out: TransportSegment[] = [];
  for (const o of offers) {
    const segs = o.slices[0]!.segments;
    segs.forEach((s, i) => {
      const dep = localToUtc(s.departing_at, s.origin.time_zone);
      const arr = localToUtc(s.arriving_at, s.destination.time_zone);
      const amount = Math.round(Number(o.total_amount) * 100);
      out.push({
        id: `duffel:${o.id}:${s.id}`,
        provider: "duffel",
        accessMethod: isMock ? "MOCK" : "API",
        operator: s.operating_carrier?.name ?? s.marketing_carrier.name,
        mode: "flight",
        origin: airportPlace(s.origin, q),
        destination: airportPlace(s.destination, q),
        departureTime: dep,
        arrivalTime: arr,
        flexibleDeparture: false,
        durationMinutes: Math.round((toEpochMs(arr) - toEpochMs(dep)) / 60000),
        price: { amountMinor: i === 0 ? amount : 0, currency: o.total_currency },
        priceConfidence: "REAL",
        bookingUrl: null,
        realtime: false,
        availability: "available",
        isMock,
        checkedAt,
        dataAsOf: checkedAt,
        attribution: "Duffel API",
        ticketGroupId: segs.length > 1 ? o.id : undefined,
        serviceNumber: `${s.marketing_carrier.iata_code}${s.marketing_carrier_flight_number}`,
        notes: [...(i > 0 ? ["segment.note.includedInTicket"] : []), "segment.note.duffelNoBooking", ...(o.expires_at ? ["segment.note.offerExpires"] : [])],
      });
    });
  }
  return out;
}
