import { DEFAULT_RANKING_WEIGHTS, type RankingWeights } from "../../config/ranking";
import { toEpochMs } from "../time";
import type { Explanation, Journey, RankedEntry, RankingProfile } from "../types";

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

/** Coût généralisé (en euros équivalents) du profil BEST. Plus bas = meilleur. */
export function bestScore(j: Journey, w: RankingWeights = DEFAULT_RANKING_WEIGHTS, valueOfTimePerHour = w.valueOfTimePerHour): number {
  const price = j.totalPrice.amountMinor / 100;
  const time = (j.totalDurationMinutes / 60) * valueOfTimePerHour;
  const transfers = j.transfers * w.transferPenalty;
  const walk = Math.max(0, j.walkingMinutes - w.walkToleranceMinutes) * w.walkPenaltyPerMinute;
  const wait = Math.max(0, j.waitingMinutes - 60) / 60 * w.waitPenaltyPerHour;
  const risk = (1 - j.reliabilityScore) * w.riskPenalty;
  const unknown = j.unknownPriceSegments * w.unknownPricePenalty;
  const estimated = j.totalPriceConfidence === "ESTIMATED" ? w.estimatedPricePenalty : 0;
  return price + time + transfers + walk + wait + risk + unknown + estimated;
}

const byArrival = (a: Journey, b: Journey) => toEpochMs(a.arrivalTime) - toEpochMs(b.arrivalTime);
const byPrice = (a: Journey, b: Journey) => a.unknownPriceSegments - b.unknownPriceSegments || a.totalPrice.amountMinor - b.totalPrice.amountMinor;

export function sortByProfile(journeys: Journey[], profile: RankingProfile, w: RankingWeights = DEFAULT_RANKING_WEIGHTS, vot?: number): Journey[] {
  const list = [...journeys];
  switch (profile) {
    case "cheapest":
      return list.sort((a, b) => byPrice(a, b) || byArrival(a, b));
    case "fastest":
      return list.sort((a, b) => byArrival(a, b) || a.totalDurationMinutes - b.totalDurationMinutes || byPrice(a, b));
    case "comfort":
      return list.sort(
        (a, b) =>
          a.transfers - b.transfers ||
          RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel] ||
          a.walkingMinutes - b.walkingMinutes ||
          b.reliabilityScore - a.reliabilityScore ||
          bestScore(a, w, vot) - bestScore(b, w, vot),
      );
    case "best":
      return list.sort((a, b) => bestScore(a, w, vot) - bestScore(b, w, vot));
  }
}

const minutesBetween = (a: string, b: string) => Math.round((toEpochMs(b) - toEpochMs(a)) / 60000);

/** Explication calculée par le backend (clé i18n + valeurs) : jamais générée par le LLM. */
function explain(profile: RankingProfile, j: Journey, cheapest: Journey, fastest: Journey, currency: string): Explanation {
  const base = { currency };
  switch (profile) {
    case "best": {
      if (j.id === cheapest.id && j.id === fastest.id) return { key: "explain.best.dominant", params: base };
      if (j.id === cheapest.id) return { key: "explain.best.isCheapest", params: base };
      const extra = j.totalPrice.amountMinor - cheapest.totalPrice.amountMinor;
      const earlier = minutesBetween(j.arrivalTime, cheapest.arrivalTime);
      if (extra > 0 && earlier > 0) return { key: "explain.best.vsCheapest", params: { ...base, extra, earlier } };
      if (extra <= 0) return { key: "explain.best.cheaperAndFaster", params: { ...base, saving: -extra } };
      return { key: "explain.best.compromise", params: base };
    }
    case "cheapest": {
      if (j.id === fastest.id) return { key: "explain.cheapest.alsoFastest", params: base };
      const saving = fastest.totalPrice.amountMinor - j.totalPrice.amountMinor;
      const longer = j.totalDurationMinutes - fastest.totalDurationMinutes;
      if (saving > 0 && longer > 0) return { key: "explain.cheapest.vsFastest", params: { ...base, saving, longer } };
      return { key: "explain.cheapest.lowest", params: base };
    }
    case "fastest": {
      if (j.id === cheapest.id) return { key: "explain.fastest.alsoCheapest", params: base };
      const extra = j.totalPrice.amountMinor - cheapest.totalPrice.amountMinor;
      const earlier = minutesBetween(j.arrivalTime, cheapest.arrivalTime);
      if (earlier > 0) return { key: "explain.fastest.vsCheapest", params: { ...base, extra: Math.max(0, extra), earlier } };
      return { key: "explain.fastest.earliest", params: base };
    }
    case "comfort":
      return { key: "explain.comfort", params: { ...base, transfers: j.transfers, walking: j.walkingMinutes } };
  }
}

export interface RankingOutput {
  entries: RankedEntry[];
  /** Ordre d'affichage complet (profil demandé par l'utilisateur). */
  ordered: Journey[];
}

export function rankJourneys(journeys: Journey[], objective: RankingProfile, currency: string, w: RankingWeights = DEFAULT_RANKING_WEIGHTS, vot?: number): RankingOutput {
  if (journeys.length === 0) return { entries: [], ordered: [] };
  const cheapest = sortByProfile(journeys, "cheapest", w, vot)[0]!;
  const fastest = sortByProfile(journeys, "fastest", w, vot)[0]!;
  const profiles: RankingProfile[] = [objective, ...(["best", "cheapest", "fastest", "comfort"] as const).filter((p) => p !== objective)];
  const entries: RankedEntry[] = profiles.map((profile) => {
    const top = sortByProfile(journeys, profile, w, vot)[0]!;
    return { profile, journeyId: top.id, explanation: explain(profile, top, cheapest, fastest, currency) };
  });
  return { entries, ordered: sortByProfile(journeys, objective, w, vot) };
}
