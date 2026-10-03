import { describe, expect, it } from "vitest";
import { requiredConnection } from "@/core/engine/connection-rules";
import { runSearch } from "@/core/search/run-search";
import { toEpochMs } from "@/core/time";
import { t } from "@/i18n";
import type { TransportProvider } from "@/core/providers/types";
import { HubCatalog } from "@/core/location/hubs";
import { LocationResolver } from "@/core/location/resolver";
import { createRegistry, offlineProviders } from "@/core/search/default-providers";
import { mockDeps, params, silentLogger } from "./helpers";

/** Exemple de test réel du cahier des charges (§36), sur providers fictifs. */
const skemaManacor = params({
  origin: { text: "SKEMA Business School Sophia Antipolis" },
  destination: { text: "Manacor, Mallorca" },
  earliestDeparture: "2026-10-16T15:00",
  latestArrival: "2026-10-17T02:00",
  objective: "cheapest",
  departureFlexibility: "hard",
});

describe("scénario SKEMA Sophia Antipolis → Manacor (16/10/2026 15:00, arrivée ≤ 02:00)", async () => {
  const r = await runSearch(skemaManacor, mockDeps());

  it("trouve des itinéraires multimodaux via un aéroport et Palma", () => {
    expect(r.journeys.length).toBeGreaterThan(0);
    for (const j of r.journeys) {
      expect(j.modes).toContain("flight");
      expect(j.segments.some((s) => s.destination.id === "hub:PMI")).toBe(true);
    }
  });

  it("toutes les contraintes dures sont respectées (fenêtre, correspondances minimales)", () => {
    const earliest = toEpochMs("2026-10-16T13:00:00Z");
    const latest = toEpochMs("2026-10-17T00:00:00Z"); // 02:00 Europe/Madrid
    for (const j of [...r.journeys, ...r.alternatives.filter((a) => a.violatesConstraints.length === 0).map((a) => a.journey)]) {
      expect(toEpochMs(j.departureTime)).toBeGreaterThanOrEqual(earliest);
      expect(toEpochMs(j.arrivalTime)).toBeLessThanOrEqual(latest);
      for (let i = 1; i < j.segments.length; i++) {
        const req = requiredConnection(j.segments[i - 1]!, j.segments[i]!, { luggage: "cabin" }).minutes;
        expect(j.connections[i - 1]!.waitMinutes).toBeGreaterThanOrEqual(req);
        expect(j.segments[i - 1]!.destination.id).toBe(j.segments[i]!.origin.id);
      }
    }
  });

  it("le prix total est la somme exacte des segments", () => {
    for (const j of r.journeys) {
      expect(j.totalPrice.amountMinor).toBe(j.segments.reduce((a, s) => a + (s.price?.amountMinor ?? 0), 0));
    }
  });

  it("les données fictives sont signalées partout", () => {
    expect(r.containsMockData).toBe(true);
    for (const j of r.journeys) {
      expect(j.containsMockData).toBe(j.segments.some((s) => s.isMock));
      for (const s of j.segments) if (s.accessMethod === "MOCK") expect(s.isMock).toBe(true);
      for (const s of j.segments) if (s.isMock) expect(s.bookingUrl).toBeNull();
    }
  });

  it("la trace est factuelle : hubs testés, sources ✓ uniquement si réellement interrogées", () => {
    const tr = r.trace;
    const used = tr.hubs.filter((h) => h.usage === "primary").map((h) => h.place.id);
    expect(used).toEqual(expect.arrayContaining(["hub:NCE", "hub:cannes", "hub:antibes", "hub:nice-ville", "hub:PMI"]));
    for (const p of tr.providers) {
      const queried = tr.queries.filter((q) => q.providerId === p.providerId && (q.status === "success" || q.status === "cache_hit"));
      if (p.status === "success") expect(queried.length).toBeGreaterThan(0);
    }
    // Les plateformes non intégrées ne sont jamais présentées comme recherchées.
    for (const d of tr.declaredSources) expect(["not_integrated", "pending_access", "disabled"]).toContain(d.status);
    expect(tr.declaredSources.find((d) => d.id === "skyscanner")!.status).toBe("not_integrated");
    expect(tr.declaredSources.find((d) => d.id === "ferries")).toBeDefined();
    expect(tr.routePatternsTested.some((p) => p.includes("Nice Côte d'Azur") && p.includes("Palma"))).toBe(true);
    expect(tr.earliestDepartureUtc).toBe("2026-10-16T13:00:00Z");
  });

  it("alternatives : ≤ 6 recherches, ≤ 3 affichées, Marseille testé comme hub alternatif", () => {
    const executed = r.trace.alternativeSearches.filter((a) => a.status !== "skipped_budget");
    expect(executed.length).toBeLessThanOrEqual(6);
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
    expect(r.trace.alternativeSearches.some((a) => a.variant.type === "alt_origin_hub" && String(a.variant.reasonParams.hub).includes("Marseille"))).toBe(true);
    expect(r.trace.alternativeSearches.some((a) => a.variant.type === "departure_earlier")).toBe(false); // départ ferme (fin des cours)
    for (const a of r.alternatives) expect(t(a.explanation.key, a.explanation.params)).not.toContain("alt.");
  });

  it("toutes les clés i18n produites existent dans le catalogue", () => {
    const keys = [
      ...r.ranking.map((e) => e.explanation.key),
      ...r.trace.providers.map((p) => p.reason).filter((x): x is string => !!x),
      ...r.trace.declaredSources.map((d) => d.reasonKey),
      ...r.trace.hubs.map((h) => h.reasonKey),
      ...Object.keys(r.trace.rejectionCounts).map((k) => `rejection.${k}`),
      ...r.journeys.flatMap((j) => j.connections.flatMap((c) => c.notes)),
      ...r.journeys.flatMap((j) => j.segments.flatMap((s) => s.notes ?? [])),
    ];
    for (const k of keys) expect(t(k)).not.toBe(k);
  });

  it("reste rapide (< 3 s sur providers fictifs)", () => {
    expect(r.trace.totalDurationMs).toBeLessThan(3000);
  });
});

describe("résultats incomplets et pannes", () => {
  it("un provider en panne est signalé ⚠ et n'empêche pas les résultats des autres", async () => {
    const catalog = new HubCatalog();
    const broken: TransportProvider = {
      ...offlineProviders(catalog)[0]!,
      id: "broken-flights",
      displayName: "Vols (en panne)",
      availability: () => ({ enabled: true }),
      supports: () => true,
      search: async () => {
        throw new Error("HTTP 500");
      },
      modes: ["flight"],
      maxCallsPerSearch: 100,
      cacheTtlSeconds: 0,
      timeoutMs: 500,
      maxConcurrency: 10,
      accessMethod: "API",
      isMock: false,
    };
    const deps = mockDeps({ registry: createRegistry([...offlineProviders(catalog), broken]), resolver: new LocationResolver(catalog), catalog, logger: silentLogger, disableAlternatives: true });
    const r = await runSearch(skemaManacor, deps);
    expect(r.journeys.length).toBeGreaterThan(0);
    expect(r.trace.providers.find((p) => p.providerId === "broken-flights")!.status).toBe("error");
  });

  it("sans aucune donnée exploitable, la raison est factuelle", async () => {
    const r = await runSearch(params({ origin: { text: "Vallauris" }, destination: { text: "Manacor" }, earliestDeparture: "2026-10-16T15:00", excludedModes: ["flight"] }), mockDeps({ disableAlternatives: true }));
    expect(r.journeys).toHaveLength(0);
    expect(r.emptyReasonKey).toBeDefined();
    expect(t(r.emptyReasonKey!)).not.toBe(r.emptyReasonKey);
  });

  it("Marseille Airport 18:30 → Cannes avant minuit (même jour)", async () => {
    const r = await runSearch(
      params({ origin: { text: "Marseille Airport" }, destination: { text: "Cannes" }, earliestDeparture: "2026-10-16T18:30", latestArrival: "2026-10-17T00:00", departureFlexibility: "hard" }),
      mockDeps(),
    );
    expect(r.journeys.length).toBeGreaterThan(0);
    for (const j of r.journeys) expect(toEpochMs(j.arrivalTime)).toBeLessThanOrEqual(toEpochMs("2026-10-16T22:00:00Z"));
  });
});
