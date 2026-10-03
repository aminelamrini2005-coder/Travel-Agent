import { describe, expect, it } from "vitest";
import { computeDataQuality } from "@/core/engine/journey-builder";
import { ProviderRegistry } from "@/core/providers/registry";
import type { SegmentQuery, TransportProvider } from "@/core/providers/types";
import { buildJourney } from "@/core/engine/journey-builder";
import { rankJourneys } from "@/core/ranking/rank";
import { scoreAgainstReference } from "@/core/alternatives/alternative-engine";
import { t } from "@/i18n";
import type { TransportSegment } from "@/core/types";
import { place, seg, silentLogger } from "./helpers";

const A = place("A");
const B = place("B");
const q: SegmentQuery = { origin: A, destination: B, windowStart: "2026-10-16T13:00:00Z", windowEnd: "2026-10-17T03:00:00Z", modes: ["coach", "bus", "flight"], passengers: 1, currency: "EUR" };

function prov(id: string, isMock: boolean, modes: TransportProvider["modes"], result: () => TransportSegment[]): TransportProvider & { calls: number } {
  const p: TransportProvider & { calls: number } = {
    id,
    displayName: id,
    accessMethod: isMock ? ("MOCK" as const) : ("OPEN_DATA" as const),
    modes,
    isMock,
    cacheTtlSeconds: 0,
    timeoutMs: 500,
    maxCallsPerSearch: 10,
    maxConcurrency: 2,
    calls: 0,
    availability: () => ({ enabled: true }),
    supports: () => true,
    search: async () => {
      p.calls++;
      return result();
    },
  };
  return p;
}

const realCoach = () => [{ ...seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T17:00:00Z", price: null }), accessMethod: "OPEN_DATA" as const }];
const mockCoach = () => [{ ...seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T16:00:00Z", arr: "2026-10-16T18:00:00Z", price: 9 }), isMock: true }];
const mockFlight = () => [{ ...seg({ mode: "flight", from: A, to: B, dep: "2026-10-16T16:00:00Z", arr: "2026-10-16T17:00:00Z", price: 40 }), isMock: true }];

describe("politique de repli des mocks", () => {
  it("fallback : le mock d'une famille couverte par des données réelles n'est pas appelé ; les autres familles restent", async () => {
    const real = prov("gtfs", false, ["coach"], realCoach);
    const mc = prov("mock-coach", true, ["coach"], mockCoach);
    const mf = prov("mock-flights", true, ["flight"], mockFlight);
    const out = await new ProviderRegistry([real, mc, mf]).execute([q], { phase: "primary", logger: silentLogger });
    expect(mc.calls).toBe(0);
    expect(mf.calls).toBe(1);
    expect(out.suppressedMock.get("mock-coach")).toBe(1);
    expect(out.segments.filter((s) => s.isMock).map((s) => s.mode)).toEqual(["flight"]);
  });

  it("fallback : si la source réelle ne trouve rien, le mock reste possible (et marqué)", async () => {
    const real = prov("gtfs", false, ["coach"], () => []);
    const mc = prov("mock-coach", true, ["coach"], mockCoach);
    const out = await new ProviderRegistry([real, mc]).execute([q], { phase: "primary", logger: silentLogger });
    expect(mc.calls).toBe(1);
    expect(out.segments.every((s) => s.isMock)).toBe(true);
  });

  it("off : aucun mock n'est jamais appelé", async () => {
    const mc = prov("mock-coach", true, ["coach"], mockCoach);
    const out = await new ProviderRegistry([mc], undefined, undefined, "off").execute([q], { phase: "primary", logger: silentLogger });
    expect(mc.calls).toBe(0);
    expect(out.segments).toHaveLength(0);
  });
});

describe("couverture en données réelles (déterministe)", () => {
  const c = { luggage: "cabin" as const };
  const P = place("P", "airport");
  const real1 = { ...seg({ mode: "bus", from: A, to: P, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T13:40:00Z", price: null }), accessMethod: "OPEN_DATA" as const };
  const fake = { ...seg({ mode: "flight", from: P, to: B, dep: "2026-10-16T16:00:00Z", arr: "2026-10-16T17:30:00Z", price: 39 }), isMock: true, accessMethod: "MOCK" as const };
  const walk = { ...seg({ mode: "walk", from: B, to: place("Z"), dep: "2026-10-16T17:40:00Z", arr: "2026-10-16T17:50:00Z", price: 0, flexible: true }), accessMethod: "COMPUTED" as const };
  const real2 = { ...seg({ mode: "coach", from: place("Z"), to: place("M"), dep: "2026-10-16T18:30:00Z", arr: "2026-10-16T19:20:00Z", price: null }), accessMethod: "OPEN_DATA" as const };

  it("2/3 segments vérifiés = 67 %, 1 segment de démonstration, la marche n'est pas comptée", () => {
    const q2 = computeDataQuality([real1, fake, walk, real2]);
    expect(q2).toEqual({
      verifiedSegments: 2,
      mockSegments: 1,
      estimatedSegments: 0,
      countedSegments: 3,
      realCoveragePercent: 67,
      pricedSegments: 0,
      status: "partial",
      uncoveredLegs: [{ from: "P", to: "B", mode: "flight", kind: "mock" }],
    });
    expect(t("quality.coverage", { percent: q2.realCoveragePercent })).toBe("Données réelles : 67 %");
  });

  it("un trajet avec au moins un segment fictif n'est jamais « vérifié »", () => {
    expect(computeDataQuality([real1, fake]).status).toBe("partial");
    expect(computeDataQuality([real1, real2]).status).toBe("verified");
    expect(computeDataQuality([fake]).status).toBe("demo");
  });

  it("le prix fictif d'un segment mock n'est pas compté comme prix connu", () => {
    expect(computeDataQuality([fake]).pricedSegments).toBe(0);
  });

  it("le total d'un trajet à prix inconnu n'est jamais comparé à un autre total", () => {
    const priced = buildJourney([seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T21:00:00Z", price: 30 })], c, "EUR");
    const partial = buildJourney([real1, { ...real2, origin: P }], c, "EUR");
    const r = rankJourneys([priced, partial], "fastest", "EUR");
    const fastest = r.entries.find((e) => e.profile === "fastest")!;
    expect(fastest.explanation.key).toMatch(/^explain\.priceIncomplete/);
    expect(t(fastest.explanation.key, fastest.explanation.params)).not.toMatch(/€/);
    // Alternatives : aucune « économie » calculée sur un total partiel.
    const s = scoreAgainstReference(partial, priced, 12);
    expect(s?.saving ?? 0).toBe(0);
  });
});
