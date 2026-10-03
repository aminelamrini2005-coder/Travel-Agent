import { describe, expect, it } from "vitest";
import { DuffelProvider, duffelToSegments, type DuffelOfferRequestResponse } from "@/core/providers/api/duffel";
import { navitiaMode, navitiaToSegments, SncfProvider, type NavitiaJourneysResponse } from "@/core/providers/api/sncf";
import { motisToSegments, TransitousProvider, type MotisPlanResponse } from "@/core/providers/api/transitous";
import { CurrencyConverter, EcbRateSource } from "@/core/money";
import { ProviderBlockedError, type SegmentQuery } from "@/core/providers/types";
import type { Place } from "@/core/types";
import { place, silentLogger } from "./helpers";

const ctx = { signal: new AbortController().signal, logger: silentLogger, now: () => new Date("2026-10-03T10:00:00Z") };
const nice = { ...place("hub:NCE", "airport", "Europe/Paris", 43.6584, 7.2159), codes: { iata: "NCE" } };
const palma = { ...place("hub:PMI", "airport", "Europe/Madrid", 39.5517, 2.7388), codes: { iata: "PMI" } };
const q = (o: Place = nice, d: Place = palma): SegmentQuery => ({ origin: o, destination: d, windowStart: "2026-10-16T13:00:00Z", windowEnd: "2026-10-16T22:00:00Z", modes: ["flight", "train", "regional_train", "high_speed_train", "coach", "bus"], passengers: 1, currency: "EUR" });

const duffelFixture: DuffelOfferRequestResponse = {
  data: {
    id: "orq_1",
    offers: [
      { id: "off_1", total_amount: "64.20", total_currency: "EUR", owner: { name: "Example Air", iata_code: "XA" }, slices: [{ segments: [{ id: "seg_1", departing_at: "2026-10-16T18:00:00", arriving_at: "2026-10-16T19:25:00", origin: { iata_code: "NCE", name: "Nice", time_zone: "Europe/Paris" }, destination: { iata_code: "PMI", name: "Palma", time_zone: "Europe/Madrid" }, marketing_carrier: { name: "Example Air", iata_code: "XA" }, marketing_carrier_flight_number: "123" }] }] },
      { id: "off_2", total_amount: "80.00", total_currency: "EUR", owner: { name: "Example Air", iata_code: "XA" }, slices: [{ segments: [{ id: "seg_2", departing_at: "2026-10-16T18:00:00", arriving_at: "2026-10-16T19:25:00", origin: { iata_code: "NCE", name: "Nice", time_zone: "Europe/Paris" }, destination: { iata_code: "PMI", name: "Palma", time_zone: "Europe/Madrid" }, marketing_carrier: { name: "Example Air", iata_code: "XA" }, marketing_carrier_flight_number: "123" }] }] },
      {
        id: "off_3",
        total_amount: "55.00",
        total_currency: "EUR",
        owner: { name: "Other", iata_code: "OT" },
        slices: [
          {
            segments: [
              { id: "s3a", departing_at: "2026-10-16T15:00:00", arriving_at: "2026-10-16T16:30:00", origin: { iata_code: "NCE", name: "Nice", time_zone: "Europe/Paris" }, destination: { iata_code: "BCN", name: "Barcelona", time_zone: "Europe/Madrid", latitude: 41.29, longitude: 2.08 }, marketing_carrier: { name: "Other", iata_code: "OT" }, marketing_carrier_flight_number: "10" },
              { id: "s3b", departing_at: "2026-10-16T17:30:00", arriving_at: "2026-10-16T18:20:00", origin: { iata_code: "BCN", name: "Barcelona", time_zone: "Europe/Madrid", latitude: 41.29, longitude: 2.08 }, destination: { iata_code: "PMI", name: "Palma", time_zone: "Europe/Madrid" }, marketing_carrier: { name: "Other", iata_code: "OT" }, marketing_carrier_flight_number: "20" },
            ],
          },
        ],
      },
    ],
  },
};

describe("Duffel (prêt, activé par DUFFEL_ACCESS_TOKEN)", () => {
  it("désactivé sans jeton", () => {
    expect(new DuffelProvider({}).availability()).toEqual({ enabled: false, reasonKey: "provider.disabled.apiKeyMissing" });
  });
  it("un jeton de TEST est déclaré MOCK (offres fictives Duffel Airways)", () => {
    const p = new DuffelProvider({ token: "duffel_test_abc" });
    expect(p.isMock).toBe(true);
    expect(p.accessMethod).toBe("MOCK");
    expect(new DuffelProvider({ token: "duffel_live_abc" }).isMock).toBe(false);
  });
  it("convertit les offres : heures locales → UTC, prix REAL, offre la moins chère par vol, billet unique pour les correspondances", () => {
    const segs = duffelToSegments(duffelFixture, q(), "2026-10-03T10:00:00Z", false, 25);
    const direct = segs.filter((s) => s.serviceNumber === "XA123");
    expect(direct).toHaveLength(1);
    expect(direct[0]!.price).toEqual({ amountMinor: 6420, currency: "EUR" });
    expect(direct[0]!.departureTime).toBe("2026-10-16T16:00:00Z");
    expect(direct[0]!.arrivalTime).toBe("2026-10-16T17:25:00Z");
    expect(direct[0]!.origin.id).toBe("hub:NCE");
    expect(direct[0]!.bookingUrl).toBeNull();
    const conn = segs.filter((s) => s.ticketGroupId === "off_3");
    expect(conn.map((s) => s.price!.amountMinor)).toEqual([5500, 0]);
    expect(conn[1]!.notes).toContain("segment.note.includedInTicket");
    expect(conn[0]!.destination.id).toBe("hub:BCN");
  });
  it("appelle l'API avec les bons en-têtes et s'arrête net sur HTTP 429", async () => {
    const seen: RequestInit[] = [];
    const ok = (async (_u: string, init: RequestInit) => (seen.push(init), new Response(JSON.stringify(duffelFixture)))) as unknown as typeof fetch;
    const p = new DuffelProvider({ token: "duffel_live_x", fetchImpl: ok });
    expect((await p.search(q(), ctx)).length).toBeGreaterThan(0);
    expect((seen[0]!.headers as Record<string, string>)["Duffel-Version"]).toBe("v2");
    const limited = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(new DuffelProvider({ token: "duffel_live_x", fetchImpl: limited }).search(q(), ctx)).rejects.toBeInstanceOf(ProviderBlockedError);
  });
});

const navitia: NavitiaJourneysResponse = {
  context: { timezone: "Europe/Paris" },
  journeys: [
    {
      fare: { found: true, total: { value: "1240.0", currency: "centime" } },
      sections: [
        { id: "w1", type: "street_network", mode: "walking", from: { id: "a", name: "Vallauris", address: { coord: { lat: "43.5784", lon: "7.0538" } } }, to: { id: "sp:1", name: "Golfe-Juan", stop_point: { id: "sp:1", name: "Golfe-Juan-Vallauris", coord: { lat: "43.5672", lon: "7.0753" } } }, departure_date_time: "20261016T150000", arrival_date_time: "20261016T152200", duration: 1320 },
        { id: "pt1", type: "public_transport", from: { id: "sp:1", name: "Golfe-Juan", stop_point: { id: "sp:1", name: "Golfe-Juan-Vallauris", coord: { lat: "43.5672", lon: "7.0753" } } }, to: { id: "sp:2", name: "Nice-Ville", stop_point: { id: "sp:2", name: "Nice-Ville", coord: { lat: "43.7046", lon: "7.2619" } } }, departure_date_time: "20261016T153000", arrival_date_time: "20261016T160500", duration: 2100, data_freshness: "realtime", display_informations: { commercial_mode: "TER", physical_mode: "Train régional", network: "TER Sud", trip_short_name: "86012" } },
      ],
    },
  ],
};

describe("API SNCF / Navitia (prête, activée par SNCF_API_TOKEN)", () => {
  it("désactivée sans jeton", () => {
    expect(new SncfProvider({}).availability().enabled).toBe(false);
  });
  it("convertit les sections : heures locales Europe/Paris → UTC, TER → regional_train, tarif de référence en RANGE", () => {
    const segs = navitiaToSegments(navitia, q(place("geo:v", "city", "Europe/Paris", 43.5784, 7.0538), place("hub:nice-ville")), "2026-10-03T10:00:00Z", "SNCF");
    const ter = segs.find((s) => s.mode === "regional_train")!;
    expect(ter.departureTime).toBe("2026-10-16T13:30:00Z");
    expect(ter.realtime).toBe(true);
    expect(ter.price).toEqual({ amountMinor: 1240, currency: "EUR" });
    expect(ter.priceConfidence).toBe("RANGE");
    expect(ter.notes).toContain("segment.note.sncfReferenceFare");
    expect(segs.find((s) => s.mode === "walk")!.flexibleDeparture).toBe(true);
  });
  it("sans tarif trouvé : prix UNKNOWN (jamais inventé)", () => {
    const noFare = { ...navitia, journeys: [{ ...navitia.journeys![0]!, fare: { found: false } }] };
    const segs = navitiaToSegments(noFare, q(), "2026-10-03T10:00:00Z", "SNCF");
    expect(segs.find((s) => s.mode === "regional_train")!.priceConfidence).toBe("UNKNOWN");
  });
  it("modes commerciaux", () => {
    expect(navitiaMode({ commercial_mode: "TGV INOUI" })).toBe("high_speed_train");
    expect(navitiaMode({ commercial_mode: "OUIGO" })).toBe("high_speed_train");
    expect(navitiaMode({ commercial_mode: "Intercités" })).toBe("train");
    expect(navitiaMode({ commercial_mode: "Car TER" })).toBe("coach");
  });
});

const motis: MotisPlanResponse = {
  itineraries: [
    {
      legs: [
        { mode: "WALK", from: { name: "START", lat: 43.6584, lon: 7.2159 }, to: { name: "Arrêt", stopId: "s1", lat: 43.66, lon: 7.21 }, startTime: "2026-10-16T13:00:00Z", endTime: "2026-10-16T13:05:00Z", duration: 300, realTime: false },
        { mode: "REGIONAL_RAIL", from: { name: "Nice St-Augustin", stopId: "s1", lat: 43.66, lon: 7.21, tz: "Europe/Paris" }, to: { name: "Cannes", stopId: "s2", lat: 43.5535, lon: 7.0197, tz: "Europe/Paris" }, startTime: "2026-10-16T13:10:00Z", endTime: "2026-10-16T13:40:00Z", duration: 1800, realTime: true, routeShortName: "TER", agencyName: "SNCF" },
      ],
    },
  ],
};

describe("Transitous (préparé, désactivé par défaut)", () => {
  it("désactivé tant que l'accord / le contact ne sont pas réglés", () => {
    expect(new TransitousProvider({ enabled: false }).availability().reasonKey).toBe("provider.disabled.transitousNotAgreed");
    expect(new TransitousProvider({ enabled: true }).availability().reasonKey).toBe("provider.disabled.contactMissing");
    expect(new TransitousProvider({ enabled: true, contact: "a@b.c" }).maxCallsPerSearch).toBeLessThanOrEqual(4);
  });
  it("convertit les étapes MOTIS en segments réels (prix UNKNOWN)", () => {
    const segs = motisToSegments(motis, q(), "2026-10-03T10:00:00Z", "transitous", "Transitous");
    const rail = segs.find((s) => s.mode === "regional_train")!;
    expect(rail.origin.id).toBe("motis:s1");
    expect(rail.priceConfidence).toBe("UNKNOWN");
    expect(rail.realtime).toBe(true);
    expect(segs[0]!.mode).toBe("walk");
  });
  it("envoie un User-Agent avec contact", async () => {
    let ua = "";
    const f = (async (_u: string, init: RequestInit) => ((ua = (init.headers as Record<string, string>)["User-Agent"]!), new Response(JSON.stringify(motis)))) as unknown as typeof fetch;
    await new TransitousProvider({ enabled: true, contact: "contact@example.org", fetchImpl: f }).search(q(), ctx);
    expect(ua).toContain("contact@example.org");
  });
});

describe("taux BCE", () => {
  it("lit le XML de référence et convertit sans inventer", async () => {
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-10-02'><Cube currency='USD' rate='1.1000'/><Cube currency='GBP' rate='0.8500'/></Cube></Cube></gesmes:Envelope>`;
    const src = new EcbRateSource((async () => new Response(xml)) as unknown as typeof fetch);
    const conv = new CurrencyConverter(src);
    expect((await conv.convert({ amountMinor: 8500, currency: "GBP" }, "EUR"))?.amountMinor).toBe(10000);
    expect(await conv.convert({ amountMinor: 100, currency: "JPY" }, "EUR")).toBeNull();
    expect((await src.getRate("EUR", "USD"))?.asOf).toBe("2026-10-02");
  });
});
