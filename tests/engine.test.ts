import { describe, expect, it } from "vitest";
import { requiredConnection } from "@/core/engine/connection-rules";
import { buildJourney } from "@/core/engine/journey-builder";
import { runLabelSearch, dedupeSegments, type EngineConstraints } from "@/core/engine/label-search";
import { journeyDominates, paretoFront } from "@/core/engine/pareto";
import { toEpochMs } from "@/core/time";
import { place, seg } from "./helpers";

const A = place("A", "city");
const ST = place("ST", "station");
const AP = place("AP", "airport");
const PMI = place("PMI", "airport", "Europe/Madrid");
const B = place("B", "city", "Europe/Madrid");

function constraints(over: Partial<EngineConstraints> = {}): EngineConstraints {
  return {
    originId: "A",
    destinationId: "B",
    earliestDepartureMs: toEpochMs("2026-10-16T13:00:00Z"),
    excludedModes: new Set(),
    connection: { luggage: "cabin" },
    currency: "EUR",
    ...over,
  };
}

describe("règles de correspondance", () => {
  it("applique les marges par défaut", () => {
    const train = seg({ mode: "regional_train", from: A, to: AP, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T15:30:00Z" });
    const flight = seg({ mode: "flight", from: AP, to: PMI, dep: "2026-10-16T17:00:00Z", arr: "2026-10-16T18:15:00Z" });
    const bus = seg({ mode: "coach", from: A, to: AP, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T15:30:00Z" });
    const train2 = seg({ mode: "train", from: AP, to: B, dep: "2026-10-16T17:00:00Z", arr: "2026-10-16T18:15:00Z" });
    expect(requiredConnection(train, flight, { luggage: "cabin" }).minutes).toBe(90);
    expect(requiredConnection(bus, flight, { luggage: "cabin" }).minutes).toBe(120);
    expect(requiredConnection(bus, train2, { luggage: "cabin" }).minutes).toBe(20);
    expect(requiredConnection(train, train2, { luggage: "cabin" }).minutes).toBe(15);
  });

  it("réduit la marge vers un vol avec un sac à dos, sans passer sous le plancher", () => {
    const train = seg({ mode: "train", from: A, to: AP, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T15:30:00Z" });
    const flight = seg({ mode: "flight", from: AP, to: PMI, dep: "2026-10-16T17:00:00Z", arr: "2026-10-16T18:15:00Z" });
    expect(requiredConnection(train, flight, { luggage: "backpack" }).minutes).toBe(65);
    const r = requiredConnection(train, flight, { luggage: "backpack", userMinBufferMinutes: 100 });
    expect(r.minutes).toBe(100);
  });

  it("ajoute la récupération bagage après un vol avec bagage en soute", () => {
    const flight = seg({ mode: "flight", from: AP, to: PMI, dep: "2026-10-16T17:00:00Z", arr: "2026-10-16T18:15:00Z" });
    const bus = seg({ mode: "bus", from: PMI, to: B, dep: "2026-10-16T19:00:00Z", arr: "2026-10-16T20:00:00Z" });
    expect(requiredConnection(flight, bus, { luggage: "checked" }).minutes).toBe(30 + 25);
    expect(requiredConnection(flight, bus, { luggage: "checked" }).notes).toContain("connection.note.baggageClaim");
  });
});

describe("moteur multimodal", () => {
  it("CRITIQUE : rejette train arr. 17:30 → vol dép. 18:00 (minimum 90 min)", () => {
    const train = seg({ mode: "regional_train", from: A, to: AP, dep: "2026-10-16T16:30:00+02:00", arr: "2026-10-16T17:30:00+02:00" });
    const flight = seg({ mode: "flight", from: AP, to: B, dep: "2026-10-16T18:00:00+02:00", arr: "2026-10-16T19:15:00+02:00" });
    const r = runLabelSearch([train, flight], constraints());
    expect(r.journeys).toHaveLength(0);
    expect(r.rejectionCounts.connection_too_short).toBe(1);
    expect(r.rejectionSamples[0]!.detail).toMatch(/marge 30 min < 90 min/);
  });

  it("accepte la même correspondance avec 90 min de marge, mais la signale risquée", () => {
    const train = seg({ mode: "regional_train", from: A, to: AP, dep: "2026-10-16T15:30:00+02:00", arr: "2026-10-16T16:30:00+02:00" });
    const flight = seg({ mode: "flight", from: AP, to: B, dep: "2026-10-16T18:00:00+02:00", arr: "2026-10-16T19:15:00+02:00" });
    const r = runLabelSearch([train, flight], constraints());
    expect(r.journeys).toHaveLength(1);
    const j = r.journeys[0]!;
    expect(j.connections[0]!.waitMinutes).toBe(90);
    expect(j.connections[0]!.risk).toBe("high");
    expect(j.riskLevel).toBe("high");
  });

  it("correspondance confortable = risque faible", () => {
    const train = seg({ mode: "regional_train", from: A, to: AP, dep: "2026-10-16T13:00:00+02:00", arr: "2026-10-16T14:00:00+02:00" });
    const flight = seg({ mode: "flight", from: AP, to: B, dep: "2026-10-16T18:00:00+02:00", arr: "2026-10-16T19:15:00+02:00" });
    const j = runLabelSearch([train, flight], constraints({ earliestDepartureMs: toEpochMs("2026-10-16T10:00:00Z") })).journeys[0]!;
    expect(j.connections[0]!.risk).toBe("low");
  });

  it("calcule le prix total réel de tout le trajet (2 + 14 + 39 + 6 = 61 €)", () => {
    const s1 = seg({ mode: "bus", from: A, to: ST, dep: "2026-10-16T15:00:00+02:00", arr: "2026-10-16T15:20:00+02:00", price: 2 });
    const s2 = seg({ mode: "regional_train", from: ST, to: AP, dep: "2026-10-16T15:40:00+02:00", arr: "2026-10-16T16:20:00+02:00", price: 14 });
    const s3 = seg({ mode: "flight", from: AP, to: PMI, dep: "2026-10-16T18:00:00+02:00", arr: "2026-10-16T19:25:00+02:00", price: 39 });
    const s4 = seg({ mode: "bus", from: PMI, to: B, dep: "2026-10-16T20:15:00+02:00", arr: "2026-10-16T21:00:00+02:00", price: 6 });
    const r = runLabelSearch([s1, s2, s3, s4], constraints());
    expect(r.journeys).toHaveLength(1);
    const j = r.journeys[0]!;
    expect(j.totalPrice.amountMinor).toBe(6100);
    expect(j.transfers).toBe(3);
    expect(j.totalDurationMinutes).toBe(6 * 60);
    expect(j.departureTime).toBe("2026-10-16T13:00:00Z");
  });

  it("conserve les solutions Pareto-optimales (50 €/8 h, 65 €/5 h, 120 €/4 h) et élimine les dominées", () => {
    const optA = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T23:00:00Z", price: 50 });
    const optB = seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T20:00:00Z", price: 65 });
    const optC = seg({ mode: "flight", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T19:00:00Z", price: 120 });
    const dominated = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T23:30:00Z", price: 70 });
    const r = runLabelSearch([optA, optB, optC, dominated], constraints());
    const prices = r.journeys.map((j) => j.totalPrice.amountMinor / 100).sort((a, b) => a - b);
    expect(prices).toEqual([50, 65, 120]);
  });

  it("respecte le budget maximal", () => {
    const cheap = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T23:00:00Z", price: 50 });
    const pricey = seg({ mode: "flight", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T19:00:00Z", price: 120 });
    const r = runLabelSearch([cheap, pricey], constraints({ maxBudgetMinor: 10000 }));
    expect(r.journeys.map((j) => j.totalPrice.amountMinor)).toEqual([5000]);
    expect(r.rejectionCounts.over_budget).toBe(1);
  });

  it("respecte le nombre maximal de correspondances", () => {
    const direct = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T23:00:00Z", price: 80 });
    const l1 = seg({ mode: "train", from: A, to: ST, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T16:00:00Z", price: 10 });
    const l2 = seg({ mode: "train", from: ST, to: B, dep: "2026-10-16T16:30:00Z", arr: "2026-10-16T19:00:00Z", price: 10 });
    expect(runLabelSearch([direct, l1, l2], constraints()).journeys).toHaveLength(2);
    const r = runLabelSearch([direct, l1, l2], constraints({ maxTransfers: 0 }));
    expect(r.journeys).toHaveLength(1);
    expect(r.journeys[0]!.transfers).toBe(0);
  });

  it("respecte les modes exclus (« pas de taxi ») et l'heure d'arrivée max", () => {
    const taxi = seg({ mode: "taxi", from: A, to: B, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T14:00:00Z", price: 90, flexible: true });
    const late = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-17T01:00:00Z", price: 30 });
    const ok = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T14:00:00Z", arr: "2026-10-16T20:00:00Z", price: 40 });
    const r = runLabelSearch([taxi, late, ok], constraints({ excludedModes: new Set(["taxi"]), latestArrivalMs: toEpochMs("2026-10-16T22:00:00Z") }));
    expect(r.journeys.map((j) => j.segments[0]!.mode)).toEqual(["coach"]);
    expect(r.journeys[0]!.totalPrice.amountMinor).toBe(4000);
    expect(r.rejectionCounts.excluded_mode).toBe(1);
    expect(r.rejectionCounts.arrives_too_late).toBe(1);
  });

  it("aligne la marche d'accès juste avant le train (pas d'attente artificielle au départ)", () => {
    const walk = seg({ mode: "walk", from: A, to: ST, dep: "2026-10-16T13:00:00Z", arr: "2026-10-16T13:10:00Z", price: 0, flexible: true });
    const train = seg({ mode: "train", from: ST, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T17:00:00Z", price: 20 });
    const j = runLabelSearch([walk, train], constraints()).journeys[0]!;
    expect(j.segments[0]!.departureTime).toBe("2026-10-16T14:45:00Z");
    expect(j.segments[0]!.arrivalTime).toBe("2026-10-16T14:55:00Z");
    expect(j.transfers).toBe(0); // la marche n'est pas une correspondance
    expect(j.walkingMinutes).toBe(10);
  });

  it("gère des segments dans des fuseaux différents", () => {
    // Vol Paris 18:00 (UTC+2) → Palma 19:25 (UTC+2) puis bus Palma (Europe/Madrid)
    const flight = seg({ mode: "flight", from: A, to: PMI, dep: "2026-10-16T18:00:00+02:00", arr: "2026-10-16T19:25:00+02:00", price: 39 });
    const bus = seg({ mode: "bus", from: PMI, to: B, dep: "2026-10-16T20:00:00+02:00", arr: "2026-10-16T21:00:00+02:00", price: 6 });
    const j = runLabelSearch([flight, bus], constraints({ connection: { luggage: "cabin" } })).journeys[0]!;
    expect(j.connections[0]!.waitMinutes).toBe(35);
    expect(j.totalDurationMinutes).toBe(180);
  });

  it("un trajet au prix inconnu ne domine jamais un trajet chiffré", () => {
    const unknown = seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T18:00:00Z", price: null });
    const known = seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T19:00:00Z", price: 30 });
    const r = runLabelSearch([unknown, known], constraints());
    expect(r.journeys).toHaveLength(2);
    const u = r.journeys.find((j) => j.unknownPriceSegments === 1)!;
    expect(u.totalPriceConfidence).toBe("UNKNOWN");
  });

  it("déduplique un même service renvoyé par deux sources (meilleure confiance gardée)", () => {
    const a = seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T18:00:00Z", price: 30, confidence: "RANGE", operator: "SNCF", service: "TER1", provider: "p1" });
    const b = seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T18:00:00Z", price: 32, confidence: "REAL", operator: "SNCF", service: "TER1", provider: "p2" });
    const d = dedupeSegments([a, b]);
    expect(d).toHaveLength(1);
    expect(d[0]!.provider).toBe("p2");
  });

  it("ne réutilise pas un nœud deux fois (pas de boucle)", () => {
    const go = seg({ mode: "bus", from: A, to: ST, dep: "2026-10-16T13:10:00Z", arr: "2026-10-16T13:20:00Z", price: 1 });
    const back = seg({ mode: "bus", from: ST, to: A, dep: "2026-10-16T13:40:00Z", arr: "2026-10-16T13:50:00Z", price: 1 });
    const fin = seg({ mode: "bus", from: ST, to: B, dep: "2026-10-16T14:00:00Z", arr: "2026-10-16T15:00:00Z", price: 1 });
    const r = runLabelSearch([go, back, fin], constraints());
    expect(r.journeys).toHaveLength(1);
    expect(r.journeys[0]!.segments).toHaveLength(2);
  });
});

describe("front de Pareto (trajets complets)", () => {
  it("journeyDominates / paretoFront", () => {
    const c = { luggage: "cabin" as const };
    const a = buildJourney([seg({ mode: "coach", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T23:00:00Z", price: 50 })], c, "EUR");
    const b = buildJourney([seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T20:00:00Z", price: 65 })], c, "EUR");
    const worse = buildJourney([seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T21:00:00Z", price: 70 })], c, "EUR");
    expect(journeyDominates(a, b)).toBe(false);
    expect(journeyDominates(b, worse)).toBe(true);
    expect(paretoFront([a, b, worse]).map((j) => j.totalPrice.amountMinor)).toEqual([5000, 6500]);
  });
});
