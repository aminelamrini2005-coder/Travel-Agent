/** Poids du score BEST (coût généralisé, en euros équivalents). Tous configurables. */
export interface RankingWeights {
  /** Valeur du temps par défaut (€/h) si l'utilisateur ne l'a pas exprimée. */
  valueOfTimePerHour: number;
  /** Pénalité par correspondance (€). */
  transferPenalty: number;
  /** Pénalité par minute de marche au-delà de la tolérance. */
  walkPenaltyPerMinute: number;
  walkToleranceMinutes: number;
  /** Pénalité par heure d'attente au-delà de 60 min cumulées. */
  waitPenaltyPerHour: number;
  /** Pénalité appliquée à (1 - fiabilité). 0.1 de fiabilité perdue × 150 = 15 €. */
  riskPenalty: number;
  /** Pénalité par segment au prix inconnu (évite de favoriser l'inconnu). */
  unknownPricePenalty: number;
  /** Pénalité pour un prix estimé (incertitude). */
  estimatedPricePenalty: number;
  /** Pénalité par segment fictif : à qualité égale, une donnée réelle passe devant une donnée de démonstration. */
  mockSegmentPenalty: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  valueOfTimePerHour: 12,
  transferPenalty: 6,
  walkPenaltyPerMinute: 0.2,
  walkToleranceMinutes: 20,
  waitPenaltyPerHour: 3,
  riskPenalty: 150,
  unknownPricePenalty: 8,
  estimatedPricePenalty: 3,
  mockSegmentPenalty: 12,
};

/** Seuils de pertinence des alternatives (cf. AlternativeEngine). */
export interface AlternativeThresholds {
  minSavingEur: number;
  minSavingRatio: number;
  minTimeGainMinutes: number;
  minTimeGainRatio: number;
  /** Nombre max de recherches de variantes (appels moteur/providers). */
  maxAlternativeSearches: number;
  /** Nombre max d'alternatives affichées. */
  maxAlternativesShown: number;
  /** Relâchement du budget testé par la variante budget (+30 %). */
  budgetRelaxRatio: number;
}

export const DEFAULT_ALTERNATIVE_THRESHOLDS: AlternativeThresholds = {
  minSavingEur: 10,
  minSavingRatio: 0.15,
  minTimeGainMinutes: 45,
  minTimeGainRatio: 0.15,
  maxAlternativeSearches: 6,
  maxAlternativesShown: 3,
  budgetRelaxRatio: 0.3,
};
