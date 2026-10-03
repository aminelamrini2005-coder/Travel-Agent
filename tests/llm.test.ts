import { describe, expect, it } from "vitest";
import { FallbackIntentExtractor, intentToPatch, LlmIntentSchema, type IntentExtractor, type LlmIntent } from "@/server/llm/intent";

const empty: LlmIntent = {
  origin: null,
  destination: null,
  earliestDeparture: null,
  departureIsHardConstraint: null,
  latestArrival: null,
  shiftDepartureMinutes: null,
  objective: null,
  maxBudget: null,
  clearMaxBudget: false,
  maxTransfers: null,
  includedModes: null,
  addExcludedModes: [],
  removeExcludedModes: [],
  luggage: null,
  valueOfTimePerHour: null,
  minConnectionBufferMinutes: null,
  isNewSearch: false,
};
const ctx = { now: new Date("2026-10-03T10:00:00Z"), timezone: "Europe/Paris" };

describe("couche LLM (compréhension uniquement)", () => {
  it("le schéma LLM ne contient aucun champ d'horaire de transport, de prix de billet ou de trajet", () => {
    const keys = Object.keys(LlmIntentSchema.shape);
    expect(keys.some((k) => /segment|journey|flight|arrivalTime|ticket|operator|price$/i.test(k))).toBe(false);
  });

  it("convertit une intention en patch minimal", () => {
    expect(intentToPatch({ ...empty, origin: "Nice", destination: "Barcelone", maxBudget: 100, objective: "fastest", isNewSearch: true })).toEqual({
      reset: true,
      origin: { text: "Nice" },
      destination: { text: "Barcelone" },
      maxBudget: 100,
      objective: "fastest",
    });
    expect(intentToPatch({ ...empty, addExcludedModes: ["bus", "coach"] })).toEqual({ addExcludedModes: ["bus", "coach"] });
  });

  it("repli automatique sur l'analyseur local si le LLM échoue", async () => {
    const failing: IntentExtractor = {
      id: "llm",
      extract: async () => {
        throw new Error("timeout");
      },
    };
    const errors: unknown[] = [];
    const ex = new FallbackIntentExtractor(failing, undefined, (e) => errors.push(e));
    expect(await ex.extract("Pas de taxi", ctx)).toEqual({ addExcludedModes: ["taxi", "vtc"] });
    expect(errors).toHaveLength(1);
  });

  it("le LLM prime sur les règles, les règles complètent", async () => {
    const llm: IntentExtractor = { id: "llm", extract: async () => ({ objective: "cheapest" }) };
    const ex = new FallbackIntentExtractor(llm);
    expect(await ex.extract("le plus rapide, moins de 80 €", ctx)).toEqual({ objective: "cheapest", maxBudget: 80 });
  });
});
