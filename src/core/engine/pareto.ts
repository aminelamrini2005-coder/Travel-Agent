import { toEpochMs } from "../time";
import type { Journey } from "../types";

/**
 * a domine b si a est au moins aussi bon sur prix, durée, correspondances et heure d'arrivée,
 * et strictement meilleur sur au moins un critère.
 * Un trajet dont un prix est inconnu ne peut jamais dominer un trajet entièrement chiffré.
 */
export function journeyDominates(a: Journey, b: Journey): boolean {
  if (a.unknownPriceSegments > b.unknownPriceSegments) return false;
  const pa = a.totalPrice.amountMinor;
  const pb = b.totalPrice.amountMinor;
  const arrA = toEpochMs(a.arrivalTime);
  const arrB = toEpochMs(b.arrivalTime);
  const le = pa <= pb && a.totalDurationMinutes <= b.totalDurationMinutes && a.transfers <= b.transfers && arrA <= arrB;
  if (!le) return false;
  return (
    pa < pb ||
    a.totalDurationMinutes < b.totalDurationMinutes ||
    a.transfers < b.transfers ||
    arrA < arrB ||
    a.unknownPriceSegments < b.unknownPriceSegments
  );
}

/** Front de Pareto (prix × durée × correspondances × arrivée). Conserve l'ordre d'entrée. */
export function paretoFront(journeys: Journey[]): Journey[] {
  return journeys.filter((j, i) => !journeys.some((k, x) => x !== i && journeyDominates(k, j)));
}

/** Déduplication par signature (mêmes services, mêmes horaires) : on garde la meilleure confiance de prix puis le moins cher. */
export function dedupeJourneys(journeys: Journey[]): Journey[] {
  const map = new Map<string, Journey>();
  for (const j of journeys) {
    const cur = map.get(j.signature);
    if (!cur || j.totalPrice.amountMinor < cur.totalPrice.amountMinor) map.set(j.signature, j);
  }
  return [...map.values()];
}
