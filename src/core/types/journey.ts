import type { PriceConfidence, TransportMode } from "./common";
import type { Money } from "./money";
import type { TransportSegment } from "./segment";

export type RiskLevel = "low" | "medium" | "high";

/** Correspondance entre deux segments consécutifs. */
export interface Connection {
  fromSegmentId: string;
  toSegmentId: string;
  waitMinutes: number;
  /** Marge minimale exigée par les règles de correspondance. */
  requiredMinutes: number;
  slackMinutes: number;
  separateTickets: boolean;
  /** Probabilité estimée de rater la correspondance (modèle simple, pas une garantie). */
  missProbability: number;
  risk: RiskLevel;
  /** Clés i18n factuelles : "connection.note.separateTickets", "connection.note.baggage"… */
  notes: string[];
}

/**
 * Couverture en données réelles d'un trajet, calculée de façon déterministe par le backend.
 * Les segments de marche ne sont pas comptés (ce sont des estimations triviales).
 */
export interface DataQuality {
  /** Segments issus d'une source réelle (API, open data, navigateur), hors marche. */
  verifiedSegments: number;
  /** Segments fictifs (providers de démonstration). */
  mockSegments: number;
  /** Segments estimés par calcul (taxi…). */
  estimatedSegments: number;
  /** Total compté = vérifiés + fictifs + estimés. */
  countedSegments: number;
  /** round(100 × vérifiés / comptés). */
  realCoveragePercent: number;
  /** Segments dont le prix provient d'une source (REAL ou RANGE). */
  pricedSegments: number;
  status: "verified" | "partial" | "demo" | "estimated";
}

export interface Journey {
  id: string;
  segments: TransportSegment[];
  connections: Connection[];
  /** Somme des prix connus (borne basse pour les segments RANGE). */
  totalPrice: Money;
  /** Somme des bornes hautes si au moins un segment est en RANGE. */
  totalPriceMax?: Money;
  /** Nombre de segments payants dont le prix est inconnu. */
  unknownPriceSegments: number;
  /** Confiance la plus faible parmi les segments. */
  totalPriceConfidence: PriceConfidence;
  departureTime: string;
  arrivalTime: string;
  totalDurationMinutes: number;
  /** Nombre de correspondances entre véhicules (la marche ne compte pas). */
  transfers: number;
  walkingMinutes: number;
  waitingMinutes: number;
  /** 0..1 — estimation, jamais une garantie. */
  reliabilityScore: number;
  riskLevel: RiskLevel;
  bookingLinks: { segmentId: string; url: string; provider: string }[];
  containsMockData: boolean;
  dataQuality: DataQuality;
  modes: TransportMode[];
  /** Ensemble des providers et méthodes d'accès ayant fourni les segments. */
  sources: { provider: string; accessMethod: TransportSegment["accessMethod"] }[];
  /** Signature stable pour la déduplication. */
  signature: string;
}
