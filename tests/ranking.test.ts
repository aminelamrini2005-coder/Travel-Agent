import { describe, expect, it } from "vitest";
import { buildJourney } from "@/core/engine/journey-builder";
import { bestScore, rankJourneys, sortByProfile } from "@/core/ranking/rank";
import { t } from "@/i18n";
import { place, seg } from "./helpers";

const A = place("A", "city");
const B = place("B", "city");
const ST = place("ST");
const c = { luggage: "cabin" as const };
const mk = (segs: ReturnType<typeof seg>[]) => buildJourney(segs, c, "EUR");

const cheapSlow = mk([seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T21:00:00Z", price: 50 })]);
const mid = mk([seg({ mode: "train", from: A, to: B, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T18:00:00Z", price: 67 })]);
const fastPricey = mk([
  seg({ mode: "taxi", from: A, to: ST, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T13:30:00Z", price: 30, flexible: true }),
  seg({ mode: "flight", from: ST, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T16:30:00Z", price: 89 }),
]);
const all = [cheapSlow, mid, fastPricey];

describe("classement", () => {
  it("CHEAPEST = prix total le plus bas", () => {
    expect(sortByProfile(all, "cheapest")[0]).toBe(cheapSlow);
  });
  it("FASTEST = arrivée la plus tôt", () => {
    expect(sortByProfile(all, "fastest")[0]).toBe(fastPricey);
  });
  it("COMFORT = moins de correspondances d'abord", () => {
    expect(sortByProfile(all, "comfort")[0]!.transfers).toBe(0);
  });
  it("BEST = coût généralisé (prix + valeur du temps + pénalités)", () => {
    // 12 €/h : 50 + 8×12 = 146 ; 67 + 5×12 = 127 ; 119 + 3.5×12 + correspondance + risque > 160
    expect(sortByProfile(all, "best")[0]).toBe(mid);
    expect(bestScore(mid)).toBeCloseTo(127, 0);
  });
  it("la valeur du temps utilisateur modifie BEST (« 20 € de plus pour 2 h » → 10 €/h)", () => {
    expect(sortByProfile(all, "best", undefined, 0)[0]).toBe(cheapSlow);
    expect(sortByProfile(all, "best", undefined, 60)[0]).toBe(fastPricey);
  });
  it("produit des explications calculées, rendues par le catalogue i18n", () => {
    const r = rankJourneys(all, "best", "EUR");
    expect(r.entries[0]!.profile).toBe("best");
    const best = r.entries.find((e) => e.profile === "best")!;
    expect(best.explanation.key).toBe("explain.best.vsCheapest");
    expect(best.explanation.params).toMatchObject({ extra: 1700, earlier: 180 });
    expect(t(best.explanation.key, best.explanation.params)).toMatch(/17\s€ plus cher que l'option la moins chère, mais arrivée 3 h 00 plus tôt/);
    const cheapest = r.entries.find((e) => e.profile === "cheapest")!;
    expect(t(cheapest.explanation.key, cheapest.explanation.params)).toMatch(/économise 69\s€/);
  });
  it("met le profil demandé par l'utilisateur en premier", () => {
    expect(rankJourneys(all, "cheapest", "EUR").entries[0]!.profile).toBe("cheapest");
  });
});
