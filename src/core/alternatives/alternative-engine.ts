/**
 * ALTERNATIVE ENGINE — répond à la question : « une légère modification de la demande donnerait-elle
 * une option nettement meilleure ? ».
 *
 * 1. Génère des variantes candidates (autre hub, départ plus tôt, budget, heure d'arrivée, modes, lendemain)
 *    uniquement lorsqu'elles sont compatibles avec la demande (ex. pas de « partir plus tôt » si le départ est ferme).
 * 2. Les classe par potentiel et n'en exécute que `maxAlternativeSearches` (6 par défaut).
 * 3. Chaque variante est une VRAIE recherche (providers ou données déjà récupérées), jamais une supposition.
 * 4. Compare au résultat principal : seules les différences significatives sont gardées (alternative_score).
 * 5. Garde au plus `maxAlternativesShown` (3) alternatives, de types différents.
 * Les explications sont calculées ici (clés i18n + valeurs) ; le LLM ne fait au mieux que reformuler.
 */
import { DEFAULT_ALTERNATIVE_THRESHOLDS, DEFAULT_RANKING_WEIGHTS, type AlternativeThresholds, type RankingWeights } from "../../config/ranking";
import type { HubCandidate } from "../location/hubs";
import { toEpochMs, utcToLocal, shiftLocal } from "../time";
import {
  MODE_CATEGORY,
  type Alternative,
  type AlternativeSearchTrace,
  type Journey,
  type Place,
  type RejectionReason,
  type SearchParams,
  type SearchVariant,
} from "../types";
import { bestScore } from "../ranking/rank";

export interface AlternativeContext {
  params: SearchParams;
  origin: Place;
  destination: Place;
  earliestDepartureUtc: string;
  latestArrivalUtc?: string;
  /** Trajet de référence (meilleur résultat principal), null si aucun résultat. */
  reference: Journey | null;
  /** Signatures des trajets déjà affichés (pour ne pas les reproposer). */
  shownSignatures: Set<string>;
  originPositioning: HubCandidate[];
  destinationPositioning: HubCandidate[];
  rejectionCounts: Partial<Record<RejectionReason, number>>;
}

export interface VariantRunResult {
  journeys: Journey[];
  providerCalls: number;
}

export type VariantRunner = (variant: SearchVariant) => Promise<VariantRunResult>;

let seq = 0;
const vid = (t: string) => `v_${t}_${++seq}`;

export function generateVariants(ctx: AlternativeContext): SearchVariant[] {
  const { params } = ctx;
  const out: SearchVariant[] = [];

  ctx.originPositioning.slice(0, 3).forEach((c, i) => {
    out.push({
      id: vid("ohub"),
      type: "alt_origin_hub",
      modifiedConstraints: {},
      extraOriginHubIds: [c.hub.id],
      reasonKey: "variant.reason.altOriginHub",
      reasonParams: { hub: c.hub.name, access: c.accessMinutes },
      expectedPotential: c.hub.importance * (1 - c.accessMinutes / 300) * (c.hub.kind === "airport" ? 1 : 0.85) - i * 0.05,
      requiresProviderCalls: true,
    });
  });
  ctx.destinationPositioning.slice(0, 2).forEach((c, i) => {
    out.push({
      id: vid("dhub"),
      type: "alt_destination_hub",
      modifiedConstraints: {},
      extraDestinationHubIds: [c.hub.id],
      reasonKey: "variant.reason.altDestinationHub",
      reasonParams: { hub: c.hub.name, access: c.accessMinutes },
      expectedPotential: c.hub.importance * (1 - c.accessMinutes / 300) * 0.8 - i * 0.05,
      requiresProviderCalls: true,
    });
  });
  if (params.departureFlexibility === "soft") {
    out.push({
      id: vid("early"),
      type: "departure_earlier",
      modifiedConstraints: { shiftDepartureMinutes: -120, departureFlexibility: "soft" },
      reasonKey: "variant.reason.departureEarlier",
      reasonParams: { minutes: 120 },
      expectedPotential: 0.55,
      requiresProviderCalls: true,
    });
  }
  if (params.maxBudget !== undefined && (ctx.rejectionCounts.over_budget ?? 0) > 0) {
    out.push({
      id: vid("budget"),
      type: "budget_relax",
      modifiedConstraints: { maxBudget: Math.round(params.maxBudget * (1 + DEFAULT_ALTERNATIVE_THRESHOLDS.budgetRelaxRatio)) },
      reasonKey: "variant.reason.budgetRelax",
      reasonParams: { budget: params.maxBudget },
      expectedPotential: 0.7,
      requiresProviderCalls: false,
    });
  }
  if (params.latestArrival && (ctx.rejectionCounts.arrives_too_late ?? 0) > 0) {
    out.push({
      id: vid("arrival"),
      type: "arrival_relax",
      modifiedConstraints: { clearLatestArrival: true },
      reasonKey: "variant.reason.arrivalRelax",
      reasonParams: {},
      expectedPotential: 0.45,
      requiresProviderCalls: false,
    });
  }
  if (params.includedModes) {
    out.push({
      id: vid("modes"),
      type: "mode_relax",
      modifiedConstraints: { clearIncludedModes: true },
      reasonKey: "variant.reason.modeRelax",
      reasonParams: {},
      expectedPotential: 0.6,
      requiresProviderCalls: true,
    });
  }
  if (!ctx.reference || params.objective === "cheapest") {
    const nextMorning = shiftLocal(params.earliestDeparture.slice(0, 10) + "T07:00", 24 * 60, "UTC");
    out.push({
      id: vid("nextday"),
      type: "next_day",
      modifiedConstraints: { earliestDeparture: nextMorning, clearLatestArrival: true, departureFlexibility: "hard" },
      reasonKey: "variant.reason.nextDay",
      reasonParams: {},
      expectedPotential: ctx.reference ? 0.25 : 0.95,
      requiresProviderCalls: true,
    });
  }
  return out.sort((a, b) => b.expectedPotential - a.expectedPotential);
}

/** Ne garde, parmi les résultats d'une variante, que les trajets réellement « nouveaux » pour cette variante. */
function relevantJourneys(v: SearchVariant, journeys: Journey[], ctx: AlternativeContext): Journey[] {
  return journeys.filter((j) => {
    if (ctx.shownSignatures.has(j.signature)) return false;
    const touches = (ids?: string[]) => !!ids && j.segments.some((s) => ids.includes(s.origin.id) || ids.includes(s.destination.id));
    switch (v.type) {
      case "alt_origin_hub":
        return touches(v.extraOriginHubIds);
      case "alt_destination_hub":
        return touches(v.extraDestinationHubIds);
      case "departure_earlier":
        return toEpochMs(j.departureTime) < toEpochMs(ctx.earliestDepartureUtc);
      case "budget_relax":
        return ctx.params.maxBudget !== undefined && j.totalPrice.amountMinor > ctx.params.maxBudget * 100;
      case "arrival_relax":
        return !!ctx.latestArrivalUtc && toEpochMs(j.arrivalTime) > toEpochMs(ctx.latestArrivalUtc);
      case "mode_relax":
        return j.modes.some((m) => !ctx.params.includedModes!.includes(m) && MODE_CATEGORY[m] !== "LOCAL" && MODE_CATEGORY[m] !== "FLEX");
      case "next_day":
        return true;
    }
  });
}

export interface ScoredCandidate {
  journey: Journey;
  score: number;
  saving: number;
  timeGain: number;
  transfersSaved: number;
}

/**
 * alternative_score : gain net valorisé (€ économisés + valeur du temps gagné + correspondances évitées),
 * à condition que le gain soit SIGNIFICATIF (seuils configurables). 59 € / 6 h 10 face à 60 € / 6 h → écarté.
 */
export function scoreAgainstReference(
  j: Journey,
  ref: Journey | null,
  vot: number,
  th: AlternativeThresholds = DEFAULT_ALTERNATIVE_THRESHOLDS,
  w: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): ScoredCandidate | null {
  if (!ref) return { journey: j, score: 1000 - bestScore(j, w, vot), saving: 0, timeGain: 0, transfersSaved: 0 };
  // Prix incomplets d'un côté ou de l'autre : aucune économie n'est calculable, seuls l'horaire
  // et les correspondances comptent (jamais de comparaison de totaux partiels).
  const comparable = j.unknownPriceSegments === 0 && ref.unknownPriceSegments === 0;
  const saving = comparable ? ref.totalPrice.amountMinor - j.totalPrice.amountMinor : 0;
  const timeGain = Math.round((toEpochMs(ref.arrivalTime) - toEpochMs(j.arrivalTime)) / 60000);
  const transfersSaved = ref.transfers - j.transfers;
  const significantSaving = saving >= Math.max(th.minSavingEur * 100, th.minSavingRatio * ref.totalPrice.amountMinor);
  const significantTime = timeGain >= Math.max(th.minTimeGainMinutes, th.minTimeGainRatio * ref.totalDurationMinutes);
  const fewerTransfers = transfersSaved >= 1 && saving >= -500 && timeGain >= -30;
  if (!significantSaving && !significantTime && !fewerTransfers) return null;
  const value = saving / 100 + (vot * timeGain) / 60 + transfersSaved * w.transferPenalty;
  if (value <= 0) return null;
  return { journey: j, score: value, saving, timeGain, transfersSaved };
}

function explanation(v: SearchVariant, c: ScoredCandidate, ctx: AlternativeContext): Alternative["explanation"] {
  const params: Record<string, string | number> = { currency: ctx.params.currency, context: `alt.ctx.${v.type}` };
  if (v.reasonParams.hub) params.hub = v.reasonParams.hub;
  if (v.type === "departure_earlier") {
    params.shift = Math.max(5, Math.round((toEpochMs(ctx.earliestDepartureUtc) - toEpochMs(c.journey.departureTime)) / 300000) * 5);
  }
  if (!ctx.reference) return { key: "alt.found", params };
  const comparable = c.journey.unknownPriceSegments === 0 && ctx.reference.unknownPriceSegments === 0;
  if (!comparable) {
    if (c.timeGain > 0) return { key: "alt.fasterPriceUnknown", params: { ...params, earlier: c.timeGain } };
    return { key: "alt.fewerPriceUnknown", params: { ...params, transfersSaved: c.transfersSaved } };
  }
  if (c.saving > 0 && c.timeGain >= 5) return { key: "alt.better", params: { ...params, saving: c.saving, earlier: c.timeGain } };
  if (c.saving > 0 && c.timeGain > -5) return { key: "alt.cheaperSameTime", params: { ...params, saving: c.saving } };
  if (c.saving > 0) return { key: "alt.save", params: { ...params, saving: c.saving, later: -c.timeGain } };
  if (c.timeGain > 0) return { key: "alt.faster", params: { ...params, extra: -c.saving, earlier: c.timeGain } };
  return { key: "alt.fewer", params: { ...params, transfersSaved: c.transfersSaved, extra: -c.saving } };
}

function violations(v: SearchVariant, j: Journey, ctx: AlternativeContext): Alternative["violatesConstraints"] {
  const out: Alternative["violatesConstraints"] = [];
  if (ctx.params.maxBudget !== undefined && j.totalPrice.amountMinor > ctx.params.maxBudget * 100) out.push("over_budget");
  if (ctx.latestArrivalUtc && toEpochMs(j.arrivalTime) > toEpochMs(ctx.latestArrivalUtc)) out.push("arrives_too_late");
  if (toEpochMs(j.departureTime) < toEpochMs(ctx.earliestDepartureUtc)) out.push("departs_earlier");
  if (utcToLocal(j.departureTime, ctx.origin.timezone).slice(0, 10) !== ctx.params.earliestDeparture.slice(0, 10)) out.push("other_day");
  if (v.type === "mode_relax") out.push("uses_extra_modes");
  return out;
}

export interface AlternativeEngineOutput {
  alternatives: Alternative[];
  traces: AlternativeSearchTrace[];
}

export async function runAlternativeEngine(
  ctx: AlternativeContext,
  run: VariantRunner,
  th: AlternativeThresholds = DEFAULT_ALTERNATIVE_THRESHOLDS,
  w: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): Promise<AlternativeEngineOutput> {
  const vot = ctx.params.valueOfTimePerHour ?? w.valueOfTimePerHour;
  const candidates = generateVariants(ctx);
  const selected = candidates.slice(0, th.maxAlternativeSearches);
  const traces: AlternativeSearchTrace[] = candidates.slice(th.maxAlternativeSearches).map((variant) => ({
    variant,
    status: "skipped_budget",
    providerCalls: 0,
    resultCount: 0,
  }));

  const runs = await Promise.allSettled(selected.map((v) => run(v)));
  const scored: { v: SearchVariant; c: ScoredCandidate; trace: AlternativeSearchTrace }[] = [];
  selected.forEach((v, i) => {
    const r = runs[i]!;
    if (r.status === "rejected") {
      traces.push({ variant: v, status: "error", providerCalls: 0, resultCount: 0 });
      return;
    }
    const relevant = relevantJourneys(v, r.value.journeys, ctx);
    const trace: AlternativeSearchTrace = { variant: v, status: "no_result", providerCalls: r.value.providerCalls, resultCount: relevant.length };
    traces.push(trace);
    if (relevant.length === 0) return;
    let best: ScoredCandidate | null = null;
    for (const j of relevant) {
      const c = scoreAgainstReference(j, ctx.reference, vot, th, w);
      if (c && (!best || c.score > best.score)) best = c;
    }
    if (!best) {
      trace.status = "not_significant";
      return;
    }
    trace.status = "executed";
    trace.bestScore = Math.round(best.score * 10) / 10;
    scored.push({ v, c: best, trace });
  });

  scored.sort((a, b) => b.c.score - a.c.score);
  const alternatives: Alternative[] = [];
  const usedTypes = new Set<string>();
  const usedSignatures = new Set<string>();
  for (const { v, c, trace } of scored) {
    if (alternatives.length >= th.maxAlternativesShown) break;
    if (usedTypes.has(v.type) || usedSignatures.has(c.journey.signature)) continue;
    usedTypes.add(v.type);
    usedSignatures.add(c.journey.signature);
    trace.status = "selected";
    const ref = ctx.reference;
    alternatives.push({
      id: `alt_${v.id}`,
      variant: v,
      journey: c.journey,
      referenceJourneyId: ref?.id ?? "",
      deltaPrice: { amountMinor: ref ? c.journey.totalPrice.amountMinor - ref.totalPrice.amountMinor : 0, currency: ctx.params.currency },
      priceDeltaKnown: !!ref && c.journey.unknownPriceSegments === 0 && ref.unknownPriceSegments === 0,
      deltaArrivalMinutes: ref ? Math.round((toEpochMs(c.journey.arrivalTime) - toEpochMs(ref.arrivalTime)) / 60000) : 0,
      deltaDurationMinutes: ref ? c.journey.totalDurationMinutes - ref.totalDurationMinutes : 0,
      deltaTransfers: ref ? c.journey.transfers - ref.transfers : 0,
      alternativeScore: Math.round(c.score * 10) / 10,
      explanation: explanation(v, c, ctx),
      violatesConstraints: violations(v, c.journey, ctx),
    });
  }
  return { alternatives, traces };
}
