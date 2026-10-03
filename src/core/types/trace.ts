import type { AccessMethod, TransportMode } from "./common";
import type { Journey } from "./journey";
import type { Money } from "./money";
import type { Place } from "./place";
import type { SearchParams, SearchParamsPatch } from "./search";

export type ProviderStatus =
  /** Au moins un appel a réussi. */
  | "success"
  /** Tous les appels ont échoué (erreur réseau, réponse invalide…). */
  | "error"
  | "timeout"
  /** Anti-bot / CAPTCHA détecté : arrêt immédiat, aucun contournement. */
  | "blocked"
  /** Provider disponible mais non appelé (aucune paire couverte, mode exclu, budget d'appels…). */
  | "skipped"
  /** Provider présent dans le code mais désactivé (clé manquante, BrowserProvider non autorisé…). */
  | "disabled";

export interface ProviderTraceEntry {
  providerId: string;
  displayName: string;
  accessMethod: AccessMethod;
  isMock: boolean;
  modes: TransportMode[];
  status: ProviderStatus;
  calls: number;
  cacheHits: number;
  resultCount: number;
  totalDurationMs: number;
  errors: string[];
  /** Raison factuelle (skipped / disabled). */
  reason?: string;
}

export interface QueryTraceEntry {
  providerId: string;
  accessMethod: AccessMethod;
  modes: TransportMode[];
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  windowStart: string;
  windowEnd: string;
  status: "success" | "error" | "timeout" | "blocked" | "cache_hit" | "skipped_budget";
  resultCount: number;
  durationMs: number;
  error?: string;
  /** Recherche principale ou variante d'alternative. */
  phase: "primary" | `alternative:${string}`;
}

/** Plateforme connue mais non intégrée : toujours affichée « ✗ non recherché ». */
export interface DeclaredSourceTraceEntry {
  id: string;
  name: string;
  modes: TransportMode[];
  status: "not_integrated" | "pending_access" | "disabled";
  reasonKey: string;
}

export interface HubConsideration {
  place: Place;
  side: "origin" | "destination";
  accessMinutesEstimate: number;
  distanceKm: number;
  selected: boolean;
  /** "primary" : utilisé dans la recherche principale ; "alternative" : testé dans une variante. */
  usage: "primary" | "alternative" | "not_used";
  reasonKey: string;
}

export const REJECTION_REASONS = [
  "connection_too_short",
  "over_budget",
  "too_many_transfers",
  "arrives_too_late",
  "excluded_mode",
  "dominated",
  "sold_out",
  "beam_pruned",
  "too_long_wait",
  "too_many_legs",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface RejectionSample {
  reason: RejectionReason;
  /** Description factuelle, ex. "Train Cannes→Marseille arr. 17:30 → Vol MRS→PMI dép. 18:00 (marge 30 min < 90 min)". */
  detail: string;
}

export type VariantType =
  | "alt_origin_hub"
  | "alt_destination_hub"
  | "departure_earlier"
  | "departure_later"
  | "budget_relax"
  | "arrival_relax"
  | "mode_relax"
  | "next_day";

export interface SearchVariant {
  id: string;
  type: VariantType;
  modifiedConstraints: SearchParamsPatch;
  /** Hubs supplémentaires testés par cette variante. */
  extraOriginHubIds?: string[];
  extraDestinationHubIds?: string[];
  /** Clé i18n + paramètres factuels expliquant pourquoi la variante a été testée. */
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  expectedPotential: number;
  /** true si la variante nécessite de nouveaux appels providers ; false si elle réutilise les données déjà récupérées. */
  requiresProviderCalls: boolean;
}

export interface AlternativeSearchTrace {
  variant: SearchVariant;
  status: "executed" | "skipped_budget" | "no_result" | "not_significant" | "selected" | "error";
  providerCalls: number;
  resultCount: number;
  bestScore?: number;
}

export interface SearchTrace {
  searchId: string;
  startedAt: string;
  completedAt: string;
  interpretedParams: SearchParams;
  resolvedOrigin: Place;
  resolvedDestination: Place;
  earliestDepartureUtc: string;
  latestArrivalUtc?: string;
  hubs: HubConsideration[];
  providers: ProviderTraceEntry[];
  declaredSources: DeclaredSourceTraceEntry[];
  queries: QueryTraceEntry[];
  /** Patrons de route effectivement interrogés (paires de hubs requêtées). */
  routePatternsTested: string[];
  modesSearched: TransportMode[];
  modesExcludedByUser: TransportMode[];
  rejectionCounts: Partial<Record<RejectionReason, number>>;
  rejectionSamples: RejectionSample[];
  segmentsCollected: number;
  labelsExplored: number;
  journeysGenerated: number;
  paretoSize: number;
  alternativeSearches: AlternativeSearchTrace[];
  engineDurationMs: number;
  totalDurationMs: number;
}

export interface Explanation {
  key: string;
  params: Record<string, string | number>;
}

export type RankingProfile = "best" | "cheapest" | "fastest" | "comfort";

export interface RankedEntry {
  profile: RankingProfile;
  journeyId: string;
  explanation: Explanation;
}

export interface Alternative {
  id: string;
  variant: SearchVariant;
  journey: Journey;
  referenceJourneyId: string;
  deltaPrice: Money;
  deltaArrivalMinutes: number;
  deltaDurationMinutes: number;
  deltaTransfers: number;
  alternativeScore: number;
  explanation: Explanation;
  /** Contraintes initiales que l'alternative ne respecte pas (affichées clairement). */
  violatesConstraints: ("over_budget" | "arrives_too_late" | "departs_earlier" | "other_day" | "uses_extra_modes")[];
}

export interface SearchResult {
  searchId: string;
  createdAt: string;
  params: SearchParams;
  origin: Place;
  destination: Place;
  journeys: Journey[];
  ranking: RankedEntry[];
  alternatives: Alternative[];
  trace: SearchTrace;
  containsMockData: boolean;
  /** Si aucun résultat : raison factuelle (clé i18n). */
  emptyReasonKey?: string;
}
