/**
 * Tests sur les VRAIS flux open data téléchargés (npm run gtfs:sync). Ignorés si les fichiers sont absents.
 * Ils vérifient la provenance et l'honnêteté, pas des horaires précis (les flux évoluent).
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HubCatalog } from "@/core/location/hubs";
import { LocationResolver } from "@/core/location/resolver";
import { createGtfsProviders } from "@/core/providers/gtfs/gtfs-loader";
import { createRegistry, offlineProviders } from "@/core/search/default-providers";
import { runSearch } from "@/core/search/run-search";
import { toEpochMs } from "@/core/time";
import { params, silentLogger } from "./helpers";

const hasData = existsSync("data/gtfs/manifest.json") && existsSync("data/gtfs/raw/tib-mallorca.zip") && existsSync("data/gtfs/raw/flixbus-eu.zip");

function deps(policy: "off" | "fallback") {
  const catalog = new HubCatalog();
  const providers = [...createGtfsProviders("data/gtfs"), ...offlineProviders(catalog)];
  return { catalog, resolver: new LocationResolver(catalog), registry: createRegistry(providers, undefined, undefined, policy), logger: silentLogger, now: () => new Date("2026-10-03T12:00:00Z") };
}

describe.skipIf(!hasData)("données réelles (GTFS TIB + FlixBus)", () => {
  it("Aéroport de Palma → Manacor (16/10/2026 19:30) : bus TIB réels, aucun mock", async () => {
    const r = await runSearch(params({ origin: { text: "Aéroport de Palma" }, destination: { text: "Manacor" }, earliestDeparture: "2026-10-16T19:30", departureFlexibility: "hard" }), deps("off"));
    expect(r.containsMockData).toBe(false);
    const real = r.journeys.filter((j) => j.dataQuality.verifiedSegments > 0);
    expect(real.length).toBeGreaterThan(0);
    for (const j of real) {
      const bus = j.segments.find((s) => s.accessMethod === "OPEN_DATA")!;
      expect(bus.provider).toBe("gtfs-tib-mallorca");
      expect(bus.priceConfidence).toBe("UNKNOWN");
      expect(bus.price).toBeNull();
      expect(bus.dataAsOf).toBeDefined();
      expect(j.dataQuality.status).toBe("verified");
      expect(toEpochMs(bus.departureTime)).toBeGreaterThanOrEqual(toEpochMs("2026-10-16T17:30:00Z"));
    }
    const tib = r.trace.providers.find((p) => p.providerId === "gtfs-tib-mallorca")!;
    expect(tib.status).toBe("success");
    expect(tib.accessMethod).toBe("OPEN_DATA");
    expect(tib.pricedResults).toBe(0);
  });

  it("Nice → Marseille : cars FlixBus réels, segments marqués OPEN_DATA, prix inconnus jamais comparés", async () => {
    const r = await runSearch(params({ origin: { text: "Nice" }, destination: { text: "Marseille" }, earliestDeparture: "2026-10-16T14:00" }), deps("off"));
    expect(r.journeys.some((j) => j.segments.some((s) => s.provider === "gtfs-flixbus-eu" && s.mode === "coach"))).toBe(true);
    for (const e of r.ranking) expect(e.explanation.key).not.toMatch(/vsCheapest|vsFastest/);
  });

  it("SKEMA → Manacor en mode fallback : segments réels (TIB) + segments de démonstration clairement séparés", async () => {
    const r = await runSearch(
      params({ origin: { text: "SKEMA Sophia Antipolis" }, destination: { text: "Manacor" }, earliestDeparture: "2026-10-16T15:00", latestArrival: "2026-10-17T02:00", departureFlexibility: "hard" }),
      deps("fallback"),
    );
    const mixed = r.journeys.find((j) => j.dataQuality.verifiedSegments > 0 && j.dataQuality.mockSegments > 0);
    expect(mixed).toBeDefined();
    expect(mixed!.dataQuality.status).toBe("partial");
    expect(mixed!.dataQuality.realCoveragePercent).toBeLessThan(100);
    expect(mixed!.segments.filter((s) => s.isMock).every((s) => s.accessMethod === "MOCK" && s.bookingUrl === null)).toBe(true);
    // Les mocks de bus/car n'ont pas été appelés là où TIB avait des données.
    expect(r.trace.providers.find((p) => p.providerId === "mock-transit")!.suppressedByRealData).toBeGreaterThan(0);
  });
});
