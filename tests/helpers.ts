import { HubCatalog } from "@/core/location/hubs";
import { LocationResolver } from "@/core/location/resolver";
import type { ProviderLogger } from "@/core/providers/types";
import { createRegistry, phase1Providers } from "@/core/search/default-providers";
import type { SearchDeps } from "@/core/search/run-search";
import { SearchParamsSchema, type SearchParamsInput } from "@/core/types";

export const silentLogger: ProviderLogger = { info() {}, warn() {}, error() {} };

export function mockDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  const catalog = new HubCatalog();
  return {
    catalog,
    resolver: new LocationResolver(catalog),
    registry: createRegistry(phase1Providers(catalog)),
    logger: silentLogger,
    now: () => new Date("2026-10-03T10:00:00Z"),
    ...overrides,
  };
}

export const params = (p: SearchParamsInput) => SearchParamsSchema.parse(p);

import type { Place, TransportMode, TransportSegment } from "@/core/types";
import { diffMinutes } from "@/core/time";

export function place(id: string, kind: Place["kind"] = "station", tz = "Europe/Paris", lat = 43.5, lon = 7): Place {
  return { id, name: id, kind, lat, lon, timezone: tz };
}

let n = 0;
/** Segment synthétique (instants ISO avec offset explicite). */
export function seg(p: {
  mode: TransportMode;
  from: Place;
  to: Place;
  dep: string;
  arr: string;
  price?: number | null;
  flexible?: boolean;
  confidence?: TransportSegment["priceConfidence"];
  operator?: string;
  service?: string;
  provider?: string;
  isMock?: boolean;
}): TransportSegment {
  const dep = new Date(p.dep).toISOString().replace(".000Z", "Z");
  const arr = new Date(p.arr).toISOString().replace(".000Z", "Z");
  return {
    id: `s${++n}`,
    provider: p.provider ?? "test",
    accessMethod: "API",
    operator: p.operator ?? "Op",
    mode: p.mode,
    origin: p.from,
    destination: p.to,
    departureTime: dep,
    arrivalTime: arr,
    flexibleDeparture: p.flexible ?? false,
    durationMinutes: diffMinutes(dep, arr),
    price: p.price === null ? null : { amountMinor: Math.round((p.price ?? 10) * 100), currency: "EUR" },
    priceConfidence: p.price === null ? "UNKNOWN" : (p.confidence ?? "REAL"),
    bookingUrl: null,
    realtime: false,
    availability: "available",
    isMock: p.isMock ?? false,
    checkedAt: "2026-10-03T10:00:00Z",
    serviceNumber: p.service ?? `X${n}`,
  };
}
