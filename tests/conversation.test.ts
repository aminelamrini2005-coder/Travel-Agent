import { describe, expect, it } from "vitest";
import { applyPatch } from "@/core/conversation/apply-patch";
import { parseMessage } from "@/core/conversation/rule-parser";
import type { SearchParams } from "@/core/types";

const ctx = (previous?: Partial<SearchParams> | null) => ({ now: new Date("2026-10-03T10:00:00Z"), timezone: "Europe/Paris", previous });

describe("analyseur de langage naturel (sans LLM)", () => {
  it("SKEMA → Manacor avec horaire, budget et objectif", () => {
    const p = parseMessage("Je termine mes cours à SKEMA Sophia Antipolis vendredi à 15h. Je dois aller à Manacor, Majorque. Je veux arriver le plus tôt possible pour moins de 150 €.", ctx());
    expect(p).toMatchObject({
      origin: { text: "SKEMA Sophia Antipolis" },
      destination: { text: "Manacor" },
      earliestDeparture: "2026-10-09T15:00",
      departureFlexibility: "hard",
      maxBudget: 150,
      objective: "fastest",
    });
  });

  it("Marseille Airport 18h30 → Cannes avant minuit", () => {
    const p = parseMessage("Je suis à Marseille Airport à 18h30 et je dois être à Cannes avant minuit", ctx());
    expect(p).toMatchObject({ origin: { text: "Marseille Airport" }, destination: { text: "Cannes" }, earliestDeparture: "2026-10-03T18:30", latestArrival: "2026-10-04T00:00" });
  });

  it("contraintes diverses", () => {
    expect(parseMessage("Vallauris → Paris demain, le moins cher possible", ctx())).toMatchObject({ origin: { text: "Vallauris" }, destination: { text: "Paris" }, objective: "cheapest" });
    expect(parseMessage("Pas de taxi", ctx())).toEqual({ addExcludedModes: ["taxi", "vtc"] });
    expect(parseMessage("Je veux maximum deux correspondances", ctx())).toEqual({ maxTransfers: 2 });
    expect(parseMessage("Je préfère payer 20 € de plus si ça me fait gagner au moins 2 heures", ctx())).toEqual({ valueOfTimePerHour: 10 });
    expect(parseMessage("Je voyage uniquement avec un sac à dos", ctx())).toEqual({ luggage: "backpack" });
    expect(parseMessage("Compare avion, train, bus et covoiturage", ctx()).includedModes).toEqual(expect.arrayContaining(["flight", "train", "bus", "coach", "rideshare"]));
    expect(parseMessage("Nice → Barcelone vendredi après 16h, max 100 €, je veux arriver le plus vite possible.", ctx())).toMatchObject({
      earliestDeparture: "2026-10-09T16:00",
      maxBudget: 100,
      objective: "fastest",
    });
  });
});

describe("conversation : les messages suivants modifient la recherche précédente", () => {
  it("Marseille → Paris, puis < 70 €, puis sans bus, puis 2 h plus tôt", () => {
    let state: Partial<SearchParams> | null = null;
    const say = (m: string) => {
      const r = applyPatch(state, parseMessage(m, ctx(state)), "2026-10-03T12:00");
      state = r.draft;
      return r;
    };
    const r1 = say("Trouve-moi Marseille → Paris demain.");
    expect(r1.params).toMatchObject({ origin: { text: "Marseille" }, destination: { text: "Paris" }, earliestDeparture: "2026-10-04T06:00" });
    const r2 = say("Seulement ceux à moins de 70 €.");
    expect(r2.params).toMatchObject({ origin: { text: "Marseille" }, maxBudget: 70 });
    const r3 = say("Et enlève les bus.");
    expect(r3.params).toMatchObject({ maxBudget: 70, excludedModes: ["bus", "coach"] });
    const r4 = say("Finalement je peux partir deux heures plus tôt.");
    expect(r4.params).toMatchObject({ earliestDeparture: "2026-10-04T04:00", maxBudget: 70, excludedModes: ["bus", "coach"] });
    const r5 = say("Remets les bus");
    expect(r5.params!.excludedModes).toEqual([]);
  });

  it("demande une précision si le départ ou la destination manquent", () => {
    const r = applyPatch(null, parseMessage("Je veux aller à Manacor", ctx()), "2026-10-03T12:00");
    expect(r.params).toBeNull();
    expect(r.missing).toEqual(["origin"]);
    expect(r.draft.destination).toEqual({ text: "Manacor" });
  });

  it("une nouvelle paire origine/destination réinitialise la recherche", () => {
    const prev = applyPatch(null, { origin: { text: "A" }, destination: { text: "B" }, maxBudget: 50 }, "2026-10-03T12:00").params!;
    const r = applyPatch(prev, parseMessage("Nice → Lyon demain", ctx(prev)), "2026-10-03T12:00");
    expect(r.params!.maxBudget).toBeUndefined();
  });
});
