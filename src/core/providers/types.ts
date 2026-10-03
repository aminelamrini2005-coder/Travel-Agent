import type { AccessMethod, Place, TransportMode, TransportSegment } from "../types";

/** Requête élémentaire envoyée à un provider : une paire de lieux sur une fenêtre de départ. */
export interface SegmentQuery {
  origin: Place;
  destination: Place;
  /** Fenêtre de départ (instants UTC ISO). */
  windowStart: string;
  windowEnd: string;
  /** Modes autorisés pour cette requête (après exclusions utilisateur). */
  modes: TransportMode[];
  passengers: number;
  currency: string;
}

export interface ProviderLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface ProviderContext {
  signal: AbortSignal;
  logger: ProviderLogger;
  /** Horloge injectable (tests). */
  now: () => Date;
}

export interface ProviderAvailability {
  enabled: boolean;
  /** Clé i18n de la raison si désactivé (clé API absente, BrowserProvider non autorisé…). */
  reasonKey?: string;
}

/**
 * Contrat commun de TOUS les providers, quelle que soit la méthode d'accès.
 * Un provider renvoie uniquement des segments réellement obtenus de sa source (ou calculés / mock, et marqués comme tels).
 */
export interface TransportProvider {
  readonly id: string;
  readonly displayName: string;
  readonly accessMethod: AccessMethod;
  readonly modes: readonly TransportMode[];
  readonly isMock: boolean;
  /** Mention de source / licence (affichée dans la trace). */
  readonly attribution?: string;
  /** Durée de cache des résultats (s). 0 = pas de cache. */
  readonly cacheTtlSeconds: number;
  readonly timeoutMs: number;
  /** Nombre max d'appels par recherche (contrôle des coûts/quotas). */
  readonly maxCallsPerSearch: number;
  /** Nombre max d'appels simultanés. */
  readonly maxConcurrency: number;
  availability(): ProviderAvailability;
  /** La paire est-elle couverte par cette source ? (aucun appel réseau) */
  supports(query: SegmentQuery): boolean;
  search(query: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]>;
}

/** Erreur levée lorsqu'une protection (CAPTCHA, anti-bot, rate limit) est détectée : on s'arrête, sans contournement. */
export class ProviderBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderBlockedError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(providerId: string, ms: number) {
    super(`${providerId} : délai dépassé (${ms} ms)`);
    this.name = "ProviderTimeoutError";
  }
}
