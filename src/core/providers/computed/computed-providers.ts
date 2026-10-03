/**
 * Providers « calculés » : pas de source commerciale, une estimation à partir de la distance.
 * accessMethod = "COMPUTED". Les durées et les prix sont toujours marqués ESTIMATED (sauf la marche, gratuite).
 */
import { haversineKm, sameLandmass } from "../../location/geo";
import { addMinutesIso } from "../../time";
import type { TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";

abstract class ComputedProvider implements TransportProvider {
  readonly accessMethod = "COMPUTED" as const;
  readonly isMock = false;
  readonly cacheTtlSeconds = 0;
  readonly timeoutMs = 1_000;
  readonly maxCallsPerSearch = 1000;
  readonly maxConcurrency = 100;
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly modes: readonly TransportSegment["mode"][];
  availability(): ProviderAvailability {
    return { enabled: true };
  }
  abstract supports(q: SegmentQuery): boolean;
  abstract search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]>;
}

export class WalkProvider extends ComputedProvider {
  readonly id = "walk";
  readonly displayName = "Marche (estimation)";
  readonly modes = ["walk"] as const;

  constructor(private readonly maxKm = 2.0) {
    super();
  }

  supports(q: SegmentQuery): boolean {
    return sameLandmass(q.origin, q.destination) && haversineKm(q.origin, q.destination) <= this.maxKm;
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const km = haversineKm(q.origin, q.destination) * 1.3;
    const minutes = Math.max(1, Math.round((km / 4.5) * 60));
    return [
      {
        id: `walk:${q.origin.id}>${q.destination.id}`,
        provider: this.id,
        accessMethod: "COMPUTED",
        mode: "walk",
        origin: q.origin,
        destination: q.destination,
        departureTime: q.windowStart,
        arrivalTime: addMinutesIso(q.windowStart, minutes),
        flexibleDeparture: true,
        durationMinutes: minutes,
        price: { amountMinor: 0, currency: q.currency },
        priceConfidence: "REAL",
        bookingUrl: null,
        realtime: false,
        availability: "available",
        isMock: false,
        checkedAt: ctx.now().toISOString(),
        notes: ["segment.note.walkEstimate"],
      },
    ];
  }
}

/**
 * Barème taxi indicatif par pays. ⚠️ Valeurs NON VÉRIFIÉES (ordre de grandeur) : à remplacer par les arrêtés
 * tarifaires officiels (en France : arrêté préfectoral du département). Le provider l'indique dans chaque segment.
 */
export interface TaxiTariff {
  pickupEur: number;
  perKmEur: number;
  minimumEur: number;
  verified: boolean;
}

export const DEFAULT_TAXI_TARIFFS: Record<string, TaxiTariff> = {
  continent: { pickupEur: 4.5, perKmEur: 2.2, minimumEur: 8, verified: false },
  mallorca: { pickupEur: 4, perKmEur: 1.3, minimumEur: 8, verified: false },
};

export class TaxiEstimateProvider extends ComputedProvider {
  readonly id = "taxi-estimate";
  readonly displayName = "Taxi (estimation calculée)";
  readonly modes = ["taxi"] as const;

  constructor(
    private readonly tariffs: Record<string, TaxiTariff> = DEFAULT_TAXI_TARIFFS,
    private readonly minKm = 1.5,
    private readonly maxKm = 70,
  ) {
    super();
  }

  supports(q: SegmentQuery): boolean {
    const km = haversineKm(q.origin, q.destination);
    return sameLandmass(q.origin, q.destination) && km >= this.minKm && km <= this.maxKm;
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const roadKm = haversineKm(q.origin, q.destination) * 1.3;
    const minutes = Math.round((roadKm / (roadKm < 15 ? 28 : 55)) * 60 + 5);
    const island = q.origin.lat > 39.25 && q.origin.lat < 40 && q.origin.lon > 2.3 && q.origin.lon < 3.5 ? "mallorca" : "continent";
    const t = this.tariffs[island] ?? this.tariffs.continent!;
    const eur = Math.max(t.minimumEur, t.pickupEur + roadKm * t.perKmEur);
    const low = Math.round(eur * 0.9 * 100);
    const high = Math.round(eur * 1.25 * 100);
    return [
      {
        id: `taxi:${q.origin.id}>${q.destination.id}`,
        provider: this.id,
        accessMethod: "COMPUTED",
        mode: "taxi",
        origin: q.origin,
        destination: q.destination,
        departureTime: q.windowStart,
        arrivalTime: addMinutesIso(q.windowStart, minutes),
        flexibleDeparture: true,
        durationMinutes: minutes,
        price: { amountMinor: low, currency: q.currency },
        priceRange: { min: { amountMinor: low, currency: q.currency }, max: { amountMinor: high, currency: q.currency } },
        priceConfidence: "ESTIMATED",
        bookingUrl: null,
        realtime: false,
        availability: "unknown",
        isMock: false,
        checkedAt: ctx.now().toISOString(),
        notes: t.verified ? ["segment.note.taxiEstimate"] : ["segment.note.taxiEstimate", "segment.note.tariffUnverified"],
      },
    ];
  }
}
