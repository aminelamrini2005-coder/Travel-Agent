import type { ModeCategory } from "../core/types";

/**
 * Marges minimales de correspondance (minutes), configurables.
 * `matrix[from][to]` : de la catégorie du segment d'arrivée vers la catégorie du segment suivant.
 * Ces marges supposent des billets SÉPARÉS (cas le plus fréquent en multimodal).
 */
export interface ConnectionRulesConfig {
  matrix: Record<ModeCategory, Record<ModeCategory, number>>;
  /** Marge exigée au tout début du trajet si le premier segment est de cette catégorie (ex. être à l'aéroport). */
  fromStart: Partial<Record<ModeCategory, number>>;
  /** Supplément après un vol si bagage en soute (récupération bagage). */
  checkedBaggageAfterFlight: number;
  /** Réduction des marges vers un vol avec un simple sac à dos (pas de dépôt bagage). */
  backpackReductionToFlight: number;
  /** Plancher absolu vers un vol, même avec sac à dos. */
  minimumToFlight: number;
  /** Train → train sur un même billet (correspondance garantie). */
  sameTicketRail: number;
  /** Changement de lieu (gare ≠ arrêt) : ajouté si les deux segments ne partagent pas le même lieu. Géré par le graphe (segment de transfert). */
}

const c = (FLIGHT: number, RAIL: number, COACH: number, LOCAL: number, RIDESHARE: number, FERRY: number, FLEX: number) => ({
  FLIGHT,
  RAIL,
  COACH,
  LOCAL,
  RIDESHARE,
  FERRY,
  FLEX,
});

export const DEFAULT_CONNECTION_RULES: ConnectionRulesConfig = {
  // colonnes : vers FLIGHT, RAIL, COACH, LOCAL, RIDESHARE, FERRY, FLEX
  matrix: {
    FLIGHT: c(180, 45, 45, 30, 45, 90, 30), // depuis un vol : débarquement inclus
    RAIL: c(90, 15, 20, 5, 20, 60, 5),
    COACH: c(120, 20, 20, 10, 20, 60, 5),
    LOCAL: c(90, 10, 15, 5, 15, 60, 5),
    RIDESHARE: c(120, 30, 30, 15, 30, 75, 10),
    FERRY: c(150, 30, 30, 20, 30, 120, 20),
    FLEX: c(90, 5, 10, 5, 10, 45, 0),
  },
  fromStart: { FLIGHT: 45, FERRY: 30 },
  checkedBaggageAfterFlight: 25,
  backpackReductionToFlight: 25,
  minimumToFlight: 60,
  sameTicketRail: 10,
};
