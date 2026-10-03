import { describe, expect, it } from "vitest";
import { buildGtfsIndex, parseCsv, serviceActive, stopsNear } from "@/core/providers/gtfs/gtfs-index";
import { GtfsProvider } from "@/core/providers/gtfs/gtfs-provider";
import type { GtfsFeedConfig } from "@/core/providers/gtfs/feeds";
import type { SegmentQuery, TransportProvider } from "@/core/providers/types";
import { place, silentLogger } from "./helpers";

/** Mini-flux GTFS synthétique : A (Palma) → B → C (Manacor), un voyage après minuit, une montée interdite. */
const files = new Map<string, string>([
  ["agency.txt", "agency_id,agency_name,agency_url,agency_timezone\nAG,Test Bus,https://example.org,Europe/Madrid\n"],
  [
    "stops.txt",
    "stop_id,stop_name,stop_lat,stop_lon,location_type\nA,\"Palma, Estació\",39.5762,2.6555,0\nB,Algaida,39.56,2.89,0\nC,Manacor Estació,39.5705,3.2029,0\nP,Gare parente,39.57,2.65,1\n",
  ],
  ["routes.txt", "route_id,agency_id,route_short_name,route_long_name,route_type\nR1,AG,501,Palma - Manacor,3\n"],
  ["calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,0,0,20261001,20261231\n"],
  ["calendar_dates.txt", "service_id,date,exception_type\nWD,20261012,2\n"],
  ["trips.txt", "route_id,service_id,trip_id,trip_headsign\nR1,WD,T1,Manacor\nR1,WD,T2,Manacor\nR1,WD,T3,Manacor\n"],
  [
    "stop_times.txt",
    [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type",
      "T1,18:00:00,18:00:00,A,1,0,0",
      "T1,18:25:00,18:26:00,B,2,0,0",
      "T1,18:50:00,18:50:00,C,3,0,0",
      "T2,23:40:00,23:40:00,A,1,0,0",
      "T2,24:30:00,24:30:00,C,2,0,0",
      "T3,19:00:00,19:00:00,A,1,1,0", // montée interdite à A
      "T3,19:45:00,19:45:00,C,2,0,0",
    ].join("\n"),
  ],
  ["feed_info.txt", "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date\nTest,https://example.org,es,20261001,20261130\n"],
]);

const feed: GtfsFeedConfig = {
  id: "test",
  displayName: "Test GTFS",
  operator: "Test Bus",
  officialUrl: "https://example.org/gtfs.zip",
  datasetPage: "https://example.org/dataset",
  license: "CC-BY-4.0",
  attribution: "Test — CC BY",
  stopRadiusKm: 1,
  modes: ["coach"],
  mapMode: () => "coach",
  enabledByDefault: true,
};

const idx = buildGtfsIndex(files);
const provider = new GtfsProvider(feed, { load: async () => idx, dataAsOf: "2026-06-04T01:15:05Z", sourceUsed: "test", validity: idx.validity });
const palma = place("place:palma", "city", "Europe/Madrid", 39.5762, 2.6555);
const manacor = place("place:manacor", "city", "Europe/Madrid", 39.5696, 3.2096);
const ctx = { signal: new AbortController().signal, logger: silentLogger, now: () => new Date("2026-10-03T10:00:00Z") };
const q = (start: string, end: string): SegmentQuery => ({ origin: palma, destination: manacor, windowStart: start, windowEnd: end, modes: ["coach"], passengers: 1, currency: "EUR" });

describe("index GTFS", () => {
  it("lit le CSV avec guillemets et ignore les stations parentes", () => {
    expect(parseCsv('a,b\n"x, y",2\n').rows[0]).toEqual(["x, y", "2"]);
    expect(idx.stops.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(idx.stops[0]!.name).toBe("Palma, Estació");
  });
  it("calcule la validité (feed_info restreint les calendriers)", () => {
    expect(idx.validity).toEqual({ start: 20261001, end: 20261130 });
  });
  it("services : jours de semaine et exceptions", () => {
    const s = idx.services[0]!;
    expect(serviceActive(s, 20261016, 5)).toBe(true); // vendredi
    expect(serviceActive(s, 20261017, 6)).toBe(false); // samedi
    expect(serviceActive(s, 20261012, 1)).toBe(false); // exception (supprimé)
  });
  it("recherche spatiale des arrêts", () => {
    expect(stopsNear(idx, 39.5705, 3.2029, 0.5).map((x) => idx.stops[x.stop]!.id)).toEqual(["C"]);
  });
});

describe("GtfsProvider (OpenDataProvider)", () => {
  it("renvoie de vrais horaires, prix UNKNOWN, provenance et fraîcheur", async () => {
    const segs = await provider.search(q("2026-10-16T14:00:00Z", "2026-10-16T20:00:00Z"), ctx);
    expect(segs).toHaveLength(1);
    const s = segs[0]!;
    expect(s.departureTime).toBe("2026-10-16T16:00:00Z"); // 18:00 Europe/Madrid (UTC+2)
    expect(s.arrivalTime).toBe("2026-10-16T16:50:00Z");
    expect(s.price).toBeNull();
    expect(s.priceConfidence).toBe("UNKNOWN");
    expect(s.accessMethod).toBe("OPEN_DATA");
    expect(s.isMock).toBe(false);
    expect(s.dataAsOf).toBe("2026-06-04T01:15:05Z");
    expect(s.origin.id).toBe("gtfs:test:A");
    expect(s.serviceNumber).toBe("501");
  });

  it("respecte pickup_type = 1 (montée interdite)", async () => {
    const segs = await provider.search(q("2026-10-16T16:30:00Z", "2026-10-16T17:30:00Z"), ctx);
    expect(segs).toHaveLength(0); // T3 part de A à 19:00 mais la montée y est interdite
  });

  it("gère les horaires après minuit (24:30 → 00:30 le lendemain)", async () => {
    const segs = await provider.search(q("2026-10-16T21:00:00Z", "2026-10-16T23:00:00Z"), ctx);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.arrivalTime).toBe("2026-10-16T22:30:00Z"); // 00:30 le 17/10 heure de Madrid
  });

  it("aucun service le week-end ni les jours supprimés", async () => {
    expect(await provider.search(q("2026-10-17T14:00:00Z", "2026-10-17T20:00:00Z"), ctx)).toHaveLength(0);
    expect(await provider.search(q("2026-10-12T14:00:00Z", "2026-10-12T20:00:00Z"), ctx)).toHaveLength(0);
  });

  it("ne couvre pas une date hors de la période de validité du flux", () => {
    expect(provider.supports(q("2027-01-15T14:00:00Z", "2027-01-15T20:00:00Z"))).toBe(false);
  });

  it("désactivé si le flux n'est pas téléchargé (jamais de données inventées)", () => {
    const p = new GtfsProvider(feed, null);
    expect(p.availability()).toEqual({ enabled: false, reasonKey: "provider.disabled.feedNotDownloaded" });
  });
});

describe("synchronisation GTFS : source officielle prioritaire", () => {
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
  const feedWithMirror = { ...feed, mirrorUrl: "https://storage.googleapis.com/storage/v1/b/mdb-latest/o/x.zip?alt=media" };

  it("utilise l'URL officielle dès qu'elle répond, sans interroger le miroir", async () => {
    const { downloadFeed } = await import("@/core/providers/gtfs/gtfs-sync");
    const urls: string[] = [];
    const f = (async (u: string) => (urls.push(u), new Response(zip, { headers: { "last-modified": "Mon, 28 Sep 2026 10:00:00 GMT" } }))) as unknown as typeof fetch;
    const r = await downloadFeed(feedWithMirror, f);
    expect(r?.sourceKind).toBe("official");
    expect(r?.sourceUpdatedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(urls).toEqual([feed.officialUrl]);
  });

  it("ne se replie sur la copie Mobility Database que si l'officielle est injoignable", async () => {
    const { downloadFeed } = await import("@/core/providers/gtfs/gtfs-sync");
    const f = (async (u: string) => {
      if (u === feed.officialUrl) return new Response("", { status: 403 });
      if (u.endsWith("?alt=media")) return new Response(zip);
      return new Response(JSON.stringify({ updated: "2026-06-04T01:15:05.830Z" }));
    }) as unknown as typeof fetch;
    const r = await downloadFeed(feedWithMirror, f);
    expect(r?.sourceKind).toBe("mirror");
    expect(r?.sourceUpdatedAt).toBe("2026-06-04T01:15:05.830Z");
  });

  it("refuse une réponse qui n'est pas un ZIP (page d'erreur, portail captif…)", async () => {
    const { downloadFeed } = await import("@/core/providers/gtfs/gtfs-sync");
    const f = (async () => new Response("<html>login</html>")) as unknown as typeof fetch;
    expect(await downloadFeed(feed, f)).toBeNull();
  });

  it("le registre force realtime=false pour un GTFS (horaire théorique)", async () => {
    const { ProviderRegistry } = await import("@/core/providers/registry");
    const real = await provider.search(q("2026-10-16T14:00:00Z", "2026-10-16T20:00:00Z"), ctx);
    const lying: TransportProvider = {
      id: provider.id,
      displayName: provider.displayName,
      accessMethod: "OPEN_DATA",
      modes: provider.modes,
      isMock: false,
      realtimeCapable: false,
      cacheTtlSeconds: 0,
      timeoutMs: 1000,
      maxCallsPerSearch: 10,
      maxConcurrency: 1,
      availability: () => ({ enabled: true }),
      supports: () => true,
      search: async () => real.map((s) => ({ ...s, realtime: true })), // une source qui prétendrait au temps réel
    };
    const out = await new ProviderRegistry([lying]).execute([q("2026-10-16T14:00:00Z", "2026-10-16T20:00:00Z")], { phase: "primary", logger: silentLogger });
    expect(out.segments.length).toBeGreaterThan(0);
    expect(out.segments.every((s) => s.realtime === false)).toBe(true);
  });
});
