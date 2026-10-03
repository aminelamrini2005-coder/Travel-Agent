import { DEFAULT_CONNECTION_RULES, type ConnectionRulesConfig } from "../../config/connection-rules";
import { MODE_CATEGORY, type Luggage, type ModeCategory, type RiskLevel, type TransportSegment } from "../types";

export interface ConnectionContext {
  luggage: Luggage;
  /** Plancher utilisateur (« je veux au moins 30 min de marge »), appliqué aux correspondances entre véhicules. */
  userMinBufferMinutes?: number;
}

export interface RequiredConnection {
  minutes: number;
  separateTickets: boolean;
  notes: string[];
}

/** Deux segments sont-ils sur un même billet ? (même groupe de billet déclaré par la source) */
export function sameTicket(a: TransportSegment, b: TransportSegment): boolean {
  return !!a.ticketGroupId && a.ticketGroupId === b.ticketGroupId && a.provider === b.provider;
}

/**
 * Marge minimale entre l'arrivée de `prev` et le départ de `next`.
 * `prev === null` : début du trajet (l'utilisateur est sur place à l'heure de départ).
 */
export function requiredConnection(
  prev: TransportSegment | null,
  next: TransportSegment,
  ctx: ConnectionContext,
  rules: ConnectionRulesConfig = DEFAULT_CONNECTION_RULES,
): RequiredConnection {
  const to = MODE_CATEGORY[next.mode];
  if (!prev) {
    return { minutes: rules.fromStart[to] ?? 0, separateTickets: false, notes: [] };
  }
  const from = MODE_CATEGORY[prev.mode];
  const notes: string[] = [];
  const separate = !sameTicket(prev, next);
  let minutes = rules.matrix[from][to];

  if (from === "RAIL" && to === "RAIL" && !separate) minutes = Math.min(minutes, rules.sameTicketRail);
  if (from === "FLIGHT" && ctx.luggage === "checked") {
    minutes += rules.checkedBaggageAfterFlight;
    notes.push("connection.note.baggageClaim");
  }
  if (to === "FLIGHT") {
    if (ctx.luggage === "backpack") {
      minutes = Math.max(rules.minimumToFlight, minutes - rules.backpackReductionToFlight);
      notes.push("connection.note.backpackReduced");
    } else if (ctx.luggage === "checked") {
      notes.push("connection.note.baggageDrop");
    }
  }
  const vehicleToVehicle = from !== "FLEX" && to !== "FLEX";
  if (vehicleToVehicle && ctx.userMinBufferMinutes !== undefined) {
    minutes = Math.max(minutes, ctx.userMinBufferMinutes);
  }
  if (separate && vehicleToVehicle) notes.push("connection.note.separateTickets");
  return { minutes, separateTickets: separate && vehicleToVehicle, notes };
}

/** Probabilité de base de rater une correspondance à marge nulle, selon le segment suivant. */
const BASE_MISS_TO: Record<ModeCategory, number> = {
  FLIGHT: 0.04, // un vol raté = billet perdu
  FERRY: 0.04,
  RAIL: 0.02,
  COACH: 0.03,
  RIDESHARE: 0.03,
  LOCAL: 0.008, // service fréquent : rater un bus local coûte quelques minutes
  FLEX: 0.002,
};
/** Supplément selon le segment précédent (incertitude de son heure d'arrivée). */
const EXTRA_MISS_FROM: Record<ModeCategory, number> = {
  FLIGHT: 0.02, // retards aériens
  RIDESHARE: 0.02, // horaires de covoiturage moins fiables
  COACH: 0.01, // trafic routier
  LOCAL: 0.01,
  RAIL: 0.005,
  FERRY: 0.01,
  FLEX: 0,
};

/**
 * Probabilité (modèle simple et documenté) de rater une correspondance.
 * p = (base[suivant] + supplément[précédent]) × 1,3 si billets séparés, divisé par (1 + 3 × marge relative),
 * avec marge relative = (attente − minimum) / minimum. Ce n'est PAS une garantie : c'est un indicateur de risque,
 * à remplacer par des historiques de retard quand ils seront disponibles.
 */
export function missProbability(prev: TransportSegment, next: TransportSegment, waitMinutes: number, required: RequiredConnection): number {
  const from = MODE_CATEGORY[prev.mode];
  const to = MODE_CATEGORY[next.mode];
  if (to === "FLEX") return BASE_MISS_TO.FLEX;
  // Depuis la marche : l'utilisateur maîtrise son heure de départ, seule une petite incertitude demeure.
  const extra = prev.mode === "walk" ? 0 : from === "FLEX" ? 0.005 : EXTRA_MISS_FROM[from];
  const slack = Math.max(0, waitMinutes - required.minutes);
  const ratio = required.minutes > 0 ? slack / required.minutes : 2;
  let p = BASE_MISS_TO[to] + extra;
  if (required.separateTickets) p *= 1.3;
  return Math.min(0.9, p / (1 + 3 * ratio));
}

export function connectionRisk(waitMinutes: number, requiredMinutes: number): RiskLevel {
  const slack = waitMinutes - requiredMinutes;
  const ratio = requiredMinutes > 0 ? slack / requiredMinutes : 10;
  if (ratio < 0.5 && slack < 30) return "high";
  if (ratio < 1 && slack < 60) return "medium";
  return "low";
}
