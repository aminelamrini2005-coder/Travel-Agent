import { describe, expect, it } from "vitest";
import { generateVariants, runAlternativeEngine, scoreAgainstReference, type AlternativeContext } from "@/core/alternatives/alternative-engine";
import { buildJourney } from "@/core/engine/journey-builder";
import { HubCatalog, selectHubs } from "@/core/location/hubs";
import { SearchParamsSchema, type Journey, type SearchVariant } from "@/core/types";
import { t } from "@/i18n";
import { place, seg } from "./helpers";

const A = place("A", "city");
const B = place("B", "city");
const c = { luggage: "cabin" as const };
const journey = (price: number, hours: number, startHour = 13): Journey =>
  buildJourney(
    [
      seg({
        mode: "coach",
        from: A,
        to: B,
        dep: `2026-10-16T${String(startHour).padStart(2, "0")}:00:00Z`,
        arr: new Date(Date.parse(`2026-10-16T${String(startHour).padStart(2, "0")}:00:00Z`) + hours * 3600_000).toISOString(),
        price,
        service: `S${price}-${hours}`,
      }),
    ],
    c,
    "EUR",
  );

describe("pertinence des alternatives (alternative_score)", () => {
  const ref = journey(60, 6);
  it("écarte une différence insignifiante (59 € / 6 h 10 face à 60 € / 6 h)", () => {
    expect(scoreAgainstReference(journey(59, 6 + 10 / 60), ref, 12)).toBeNull();
  });
  it("garde une économie importante (38 € / 7 h)", () => {
    const s = scoreAgainstReference(journey(38, 7), ref, 12);
    expect(s).not.toBeNull();
    expect(s!.saving).toBe(2200);
  });
  it("garde un gain de temps important (78 € / 3 h 45)", () => {
    const s = scoreAgainstReference(journey(78, 3.75), ref, 12);
    expect(s).not.toBeNull();
    expect(s!.timeGain).toBe(135);
  });
  it("écarte une option plus chère ET plus lente", () => {
    expect(scoreAgainstReference(journey(80, 7), ref, 12)).toBeNull();
  });
});

function ctx(over: Partial<AlternativeContext> = {}): AlternativeContext {
  const cat = new HubCatalog();
  const origin = cat.findByText("Vallauris")!.place;
  const destination = cat.findByText("Manacor")!.place;
  return {
    params: SearchParamsSchema.parse({ origin: { text: "Vallauris" }, destination: { text: "Manacor" }, earliestDeparture: "2026-10-16T15:00", maxBudget: 80 }),
    origin,
    destination,
    earliestDepartureUtc: "2026-10-16T13:00:00Z",
    reference: journey(67, 6),
    shownSignatures: new Set(),
    originPositioning: selectHubs(origin, cat).positioning,
    destinationPositioning: selectHubs(destination, cat).positioning,
    rejectionCounts: { over_budget: 3 },
    ...over,
  };
}

describe("AlternativeEngine", () => {
  it("génère des variantes réalistes (hubs voisins, horaire, budget) triées par potentiel", () => {
    const v = generateVariants(ctx());
    const types = v.map((x) => x.type);
    expect(types).toContain("alt_origin_hub");
    expect(types).toContain("departure_earlier");
    expect(types).toContain("budget_relax");
    expect(v.find((x) => x.type === "alt_origin_hub")!.reasonParams.hub).toMatch(/Marseille|Toulon|Gênes|Genova|Aix/);
  });

  it("ne propose pas de partir plus tôt si le départ est une contrainte ferme", () => {
    const base = ctx();
    const v = generateVariants({ ...base, params: { ...base.params, departureFlexibility: "hard" } });
    expect(v.some((x) => x.type === "departure_earlier")).toBe(false);
  });

  it("limite à 6 recherches et 3 alternatives, de types différents, issues uniquement des recherches exécutées", async () => {
    const executed: SearchVariant[] = [];
    const out = await runAlternativeEngine(ctx(), async (v) => {
      executed.push(v);
      // Chaque variante « trouve » un trajet nettement moins cher ; les hubs alternatifs doivent être touchés.
      const hubId = v.extraOriginHubIds?.[0] ?? v.extraDestinationHubIds?.[0];
      const j = journey(30 + executed.length, 6.5);
      if (hubId) j.segments[0] = { ...j.segments[0]!, destination: { ...j.segments[0]!.destination, id: hubId } };
      if (v.type === "departure_earlier") j.departureTime = "2026-10-16T12:00:00Z";
      if (v.type === "budget_relax") j.totalPrice = { amountMinor: 9000, currency: "EUR" };
      return { journeys: [j], providerCalls: v.requiresProviderCalls ? 5 : 0 };
    });
    expect(executed.length).toBeLessThanOrEqual(6);
    expect(out.alternatives.length).toBeLessThanOrEqual(3);
    expect(new Set(out.alternatives.map((a) => a.variant.type)).size).toBe(out.alternatives.length);
    for (const a of out.alternatives) {
      expect(executed.map((v) => v.id)).toContain(a.variant.id);
      expect(t(a.explanation.key, a.explanation.params)).not.toMatch(/alt\./);
    }
    const skipped = out.traces.filter((tr) => tr.status === "skipped_budget");
    expect(executed.length + skipped.length).toBe(generateVariants(ctx()).length);
  });

  it("calcule les écarts côté backend et signale le dépassement de budget", async () => {
    const out = await runAlternativeEngine(ctx({ originPositioning: [], destinationPositioning: [] }), async (v) => {
      if (v.type !== "budget_relax") return { journeys: [], providerCalls: 0 };
      return { journeys: [journey(91, 3)], providerCalls: 0 };
    });
    const a = out.alternatives.find((x) => x.variant.type === "budget_relax")!;
    expect(a.deltaPrice.amountMinor).toBe(2400);
    expect(a.deltaArrivalMinutes).toBe(-180);
    expect(a.violatesConstraints).toContain("over_budget");
    expect(t(a.explanation.key, a.explanation.params)).toMatch(/pour 24\s€ de plus, tu arrives 3 h 00 plus tôt/);
  });

  it("ne garde rien si aucune variante n'apporte de gain significatif", async () => {
    const out = await runAlternativeEngine(ctx(), async () => ({ journeys: [journey(66, 6.1)], providerCalls: 1 }));
    expect(out.alternatives).toHaveLength(0);
  });
});
