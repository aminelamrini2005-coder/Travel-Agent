/**
 * ⚠️ PROVIDERS FICTIFS — données générées de façon déterministe pour développer et tester le moteur.
 * Chaque segment porte `isMock: true` et `accessMethod: "MOCK"`, aucun lien de réservation, et l'interface
 * affiche un bandeau « données de démonstration ». Les opérateurs sont volontairement fictifs (« Démo … »).
 */
import { haversineKm, sameLandmass } from "../../location/geo";
import type { HubCatalog } from "../../location/hubs";
import { localDateTimeToUtc, localDatesInWindow, toEpochMs, addMinutesIso } from "../../time";
import type { Place, TransportMode, TransportSegment } from "../../types";
import type { ProviderAvailability, ProviderContext, SegmentQuery, TransportProvider } from "../types";

/** PRNG déterministe (FNV-1a + mulberry32). */
export function seededRandom(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Departure {
  /** "HH:mm" local à l'origine. */
  time: string;
  durationMinutes: number;
  priceEur: number;
  mode: TransportMode;
  operator: string;
  serviceNumber: string;
  seatsLeft?: number;
}

abstract class MockProvider implements TransportProvider {
  readonly accessMethod = "MOCK" as const;
  readonly isMock = true;
  readonly cacheTtlSeconds = 300;
  readonly timeoutMs = 2_000;
  readonly maxCallsPerSearch = 400;
  readonly maxConcurrency = 50;
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly modes: readonly TransportMode[];

  constructor(protected readonly catalog: HubCatalog) {}

  availability(): ProviderAvailability {
    return { enabled: true };
  }

  abstract supports(q: SegmentQuery): boolean;
  protected abstract dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[];

  protected hubServices(p: Place) {
    return this.catalog.getHub(p.id)?.services ?? {};
  }

  async search(q: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    const km = haversineKm(q.origin, q.destination);
    const checkedAt = ctx.now().toISOString();
    const out: TransportSegment[] = [];
    const ws = toEpochMs(q.windowStart);
    const we = toEpochMs(q.windowEnd);
    for (const date of localDatesInWindow(q.windowStart, q.windowEnd, q.origin.timezone)) {
      const rng = seededRandom(`${this.id}|${q.origin.id}|${q.destination.id}|${date}`);
      for (const d of this.dailyDepartures(q, date, rng, km)) {
        if (!q.modes.includes(d.mode)) continue;
        const dep = localDateTimeToUtc(date, d.time, q.origin.timezone);
        const depMs = toEpochMs(dep);
        if (depMs < ws || depMs > we) continue;
        const price = Math.max(1, Math.round(d.priceEur * 100)) * q.passengers;
        out.push({
          id: `${this.id}:${q.origin.id}>${q.destination.id}:${dep}:${d.serviceNumber}`,
          provider: this.id,
          accessMethod: "MOCK",
          operator: d.operator,
          mode: d.mode,
          origin: q.origin,
          destination: q.destination,
          departureTime: dep,
          arrivalTime: addMinutesIso(dep, d.durationMinutes),
          flexibleDeparture: false,
          durationMinutes: d.durationMinutes,
          price: { amountMinor: price, currency: "EUR" },
          priceConfidence: "REAL",
          bookingUrl: null,
          realtime: false,
          availability: d.seatsLeft !== undefined && d.seatsLeft < 4 ? "limited" : "available",
          seatsLeft: d.seatsLeft,
          isMock: true,
          checkedAt,
          serviceNumber: d.serviceNumber,
          notes: ["segment.note.mock"],
        });
      }
    }
    return out;
  }
}

function hhmm(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Vols fictifs entre aéroports distants d'au moins 150 km. */
export class MockFlightProvider extends MockProvider {
  readonly id = "mock-flights";
  readonly displayName = "Vols — DÉMO (données fictives)";
  readonly modes = ["flight"] as const;

  supports(q: SegmentQuery): boolean {
    return q.origin.kind === "airport" && q.destination.kind === "airport" && haversineKm(q.origin, q.destination) >= 150;
  }

  protected dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[] {
    const n = 2 + Math.floor(rng() * 3);
    const out: Departure[] = [];
    for (let i = 0; i < n; i++) {
      // Vols répartis sur la journée (06:30 → 21:30 environ).
      const start = 6 * 60 + 30 + Math.floor((i * 15 * 60) / (n - 1)) - Math.floor(rng() * 60);
      const duration = Math.round((km / 720) * 60 + 35);
      const base = 22 + km * 0.07;
      out.push({
        time: hhmm(Math.round(start / 5) * 5),
        durationMinutes: Math.round(duration / 5) * 5,
        priceEur: Math.round(base * (0.6 + rng() * 1.8)),
        mode: "flight",
        operator: "Démo Air",
        serviceNumber: `DA${100 + Math.floor(rng() * 899)}`,
        seatsLeft: Math.floor(rng() * 30),
      });
    }
    return out;
  }
}

/** Trains fictifs entre gares (TER fréquents en courte distance, grande vitesse au-delà). */
export class MockRailProvider extends MockProvider {
  readonly id = "mock-rail";
  readonly displayName = "Trains — DÉMO (données fictives)";
  readonly modes = ["regional_train", "train", "high_speed_train"] as const;

  supports(q: SegmentQuery): boolean {
    const km = haversineKm(q.origin, q.destination);
    return !!this.hubServices(q.origin).rail && !!this.hubServices(q.destination).rail && sameLandmass(q.origin, q.destination) && km >= 3 && km <= 1100;
  }

  protected dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[] {
    const out: Departure[] = [];
    if (km < 180) {
      const headway = 30 + Math.floor(rng() * 3) * 15;
      const offset = Math.floor(rng() * headway);
      const duration = Math.round(((km * 1.2) / 65) * 60 + 4);
      for (let t = 5 * 60 + 30 + offset; t <= 22 * 60 + 30; t += headway) {
        out.push({
          time: hhmm(t),
          durationMinutes: duration,
          priceEur: Math.round((1.5 + km * 0.11) * 10) / 10,
          mode: "regional_train",
          operator: "Démo Rail régional",
          serviceNumber: `R${8000 + Math.floor(rng() * 999)}`,
        });
      }
    } else {
      const n = 4 + Math.floor(rng() * 5);
      const duration = Math.round(((km * 1.25) / 150) * 60 + 10);
      for (let i = 0; i < n; i++) {
        out.push({
          time: hhmm(6 * 60 + Math.floor((i * 14 * 60) / n) + Math.floor(rng() * 40)),
          durationMinutes: duration,
          priceEur: Math.round(20 + km * 0.09 * (0.6 + rng() * 1.5)),
          mode: "high_speed_train",
          operator: "Démo Rail grande vitesse",
          serviceNumber: `G${6000 + Math.floor(rng() * 999)}`,
          seatsLeft: Math.floor(rng() * 80),
        });
      }
    }
    return out;
  }
}

/** Cars longue distance fictifs entre gares routières / gares desservies par car. */
export class MockCoachProvider extends MockProvider {
  readonly id = "mock-coach";
  readonly displayName = "Cars — DÉMO (données fictives)";
  readonly modes = ["coach"] as const;

  supports(q: SegmentQuery): boolean {
    const km = haversineKm(q.origin, q.destination);
    return !!this.hubServices(q.origin).coach && !!this.hubServices(q.destination).coach && sameLandmass(q.origin, q.destination) && km >= 25 && km <= 1500;
  }

  protected dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[] {
    const n = 2 + Math.floor(rng() * 5);
    const duration = Math.round(((km * 1.3) / 68) * 60 + 10);
    const out: Departure[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        time: hhmm(6 * 60 + Math.floor((i * 16 * 60) / n) + Math.floor(rng() * 50)),
        durationMinutes: duration,
        priceEur: Math.round(Math.max(4, km * 0.045 * (0.6 + rng() * 1.3))),
        mode: "coach",
        operator: "Démo Car",
        serviceNumber: `C${100 + Math.floor(rng() * 899)}`,
        seatsLeft: Math.floor(rng() * 40),
      });
    }
    return out;
  }
}

/** Covoiturages fictifs (départ à heure fixe, entre lieux quelconques d'une même masse terrestre). */
export class MockRideshareProvider extends MockProvider {
  readonly id = "mock-rideshare";
  readonly displayName = "Covoiturage — DÉMO (données fictives)";
  readonly modes = ["rideshare"] as const;

  supports(q: SegmentQuery): boolean {
    const km = haversineKm(q.origin, q.destination);
    return sameLandmass(q.origin, q.destination) && km >= 30 && km <= 900;
  }

  protected dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[] {
    const n = Math.floor(rng() * 4);
    const duration = Math.round(((km * 1.25) / 85) * 60 + 10);
    const out: Departure[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        time: hhmm(Math.round((7 * 60 + rng() * 13 * 60) / 15) * 15),
        durationMinutes: duration,
        priceEur: Math.round(2 + km * 0.065 * (0.8 + rng() * 0.5)),
        mode: "rideshare",
        operator: "Démo Covoiturage",
        serviceNumber: `RS${1000 + Math.floor(rng() * 8999)}`,
        seatsLeft: 1 + Math.floor(rng() * 3),
      });
    }
    return out;
  }
}

/** Transports locaux fictifs (bus / tram) sur courte distance, fréquents. */
export class MockLocalTransitProvider extends MockProvider {
  readonly id = "mock-transit";
  readonly displayName = "Transports locaux — DÉMO (données fictives)";
  readonly modes = ["bus", "tram"] as const;

  supports(q: SegmentQuery): boolean {
    const km = haversineKm(q.origin, q.destination);
    return sameLandmass(q.origin, q.destination) && km >= 0.8 && km <= 60;
  }

  protected dailyDepartures(q: SegmentQuery, date: string, rng: () => number, km: number): Departure[] {
    const mode: TransportMode = km < 12 && rng() < 0.4 ? "tram" : "bus";
    const headway = km < 20 ? 20 : 30 + Math.floor(rng() * 2) * 30;
    const offset = Math.floor(rng() * headway);
    const duration = Math.round(((km * 1.4) / (km < 20 ? 22 : 38)) * 60 + 5);
    const price = km < 25 ? 1.7 + Math.floor(rng() * 3) * 0.5 : 3 + Math.round(km * 0.08);
    const out: Departure[] = [];
    for (let t = 5 * 60 + 30 + offset; t <= 23 * 60; t += headway) {
      out.push({
        time: hhmm(t),
        durationMinutes: duration,
        priceEur: price,
        mode,
        operator: "Démo Bus local",
        serviceNumber: `L${1 + Math.floor(rng() * 99)}`,
      });
    }
    return out;
  }
}
