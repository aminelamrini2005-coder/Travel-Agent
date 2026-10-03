import { shiftLocal } from "../time";
import { SearchParamsSchema, type SearchParams, type SearchParamsPatch } from "../types";

export interface ApplyPatchResult {
  params: SearchParams | null;
  /** État partiel (conservé dans la conversation même si la recherche n'est pas encore lançable). */
  draft: Partial<SearchParams>;
  /** Informations indispensables manquantes pour lancer une recherche. */
  missing: ("origin" | "destination")[];
}

/**
 * Applique une modification conversationnelle à la recherche courante (fonction pure).
 * « Seulement < 70 € » → maxBudget ; « enlève les bus » → addExcludedModes ; « 2 h plus tôt » → shiftDepartureMinutes…
 * `defaultDeparture` : date-heure locale utilisée si aucune n'a jamais été donnée (en pratique : maintenant).
 */
export function applyPatch(prev: Partial<SearchParams> | null, patch: SearchParamsPatch, defaultDeparture: string): ApplyPatchResult {
  const base: Partial<SearchParams> = patch.reset || !prev ? {} : { ...prev };
  const next: Partial<SearchParams> = { ...base };

  if (patch.origin) next.origin = patch.origin;
  if (patch.destination) next.destination = patch.destination;
  if (patch.earliestDeparture) next.earliestDeparture = patch.earliestDeparture;
  if (!next.earliestDeparture) next.earliestDeparture = defaultDeparture;
  if (patch.departureFlexibility) next.departureFlexibility = patch.departureFlexibility;
  if (patch.shiftDepartureMinutes) {
    // Décalage en heure murale ; la conversion UTC se fait plus tard avec le fuseau de l'origine.
    next.earliestDeparture = shiftLocal(next.earliestDeparture, patch.shiftDepartureMinutes, "UTC");
    // Un utilisateur qui dit « je peux partir plus tôt » rend explicite sa nouvelle contrainte.
    if (patch.shiftDepartureMinutes < 0) next.departureFlexibility = patch.departureFlexibility ?? "hard";
  }
  if (patch.clearLatestArrival) delete next.latestArrival;
  if (patch.latestArrival) next.latestArrival = patch.latestArrival;
  if (patch.objective) next.objective = patch.objective;
  if (patch.clearMaxBudget) delete next.maxBudget;
  if (patch.maxBudget !== undefined) next.maxBudget = patch.maxBudget;
  if (patch.currency) next.currency = patch.currency;
  if (patch.clearMaxTransfers) delete next.maxTransfers;
  if (patch.maxTransfers !== undefined) next.maxTransfers = patch.maxTransfers;
  if (patch.clearIncludedModes) delete next.includedModes;
  if (patch.includedModes) next.includedModes = patch.includedModes;
  const excluded = new Set(next.excludedModes ?? []);
  for (const m of patch.addExcludedModes ?? []) excluded.add(m);
  for (const m of patch.removeExcludedModes ?? []) excluded.delete(m);
  next.excludedModes = [...excluded];
  if (next.includedModes) next.includedModes = next.includedModes.filter((m) => !excluded.has(m));
  if (next.includedModes?.length === 0) delete next.includedModes;
  if (patch.passengers) next.passengers = patch.passengers;
  if (patch.luggage) next.luggage = patch.luggage;
  if (patch.valueOfTimePerHour !== undefined) next.valueOfTimePerHour = patch.valueOfTimePerHour;
  if (patch.minConnectionBufferMinutes !== undefined) next.minConnectionBufferMinutes = patch.minConnectionBufferMinutes;

  const missing: ApplyPatchResult["missing"] = [];
  if (!next.origin) missing.push("origin");
  if (!next.destination) missing.push("destination");
  if (missing.length > 0) return { params: null, draft: next, missing };
  const params = SearchParamsSchema.parse(next);
  return { params, draft: params, missing };
}
