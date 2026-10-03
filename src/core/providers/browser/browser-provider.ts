import type { Place, TransportMode, TransportSegment } from "../../types";
import {
  ProviderBlockedError,
  type ProviderAvailability,
  type ProviderContext,
  type SegmentQuery,
  type TransportProvider,
} from "../types";

/**
 * Fiche de conformité OBLIGATOIRE pour tout BrowserProvider.
 * Elle documente la revue des CGU de la plateforme ; sans `automationAllowed: true`, le provider reste désactivé.
 */
export interface TosReview {
  platform: string;
  termsUrl: string;
  /** Date de la revue (YYYY-MM-DD). Une revue de plus de `TOS_REVIEW_MAX_AGE_DAYS` désactive le provider. */
  reviewedOn: string;
  /** La plateforme autorise-t-elle explicitement l'automatisation d'une session personnelle ? */
  automationAllowed: boolean;
  /** Référence de l'autorisation (clause des CGU, accord écrit…). */
  evidence: string;
}

export const TOS_REVIEW_MAX_AGE_DAYS = 180;

/**
 * Pilote de navigateur abstrait. L'implémentation concrète (ex. Playwright avec un profil utilisateur local)
 * est fournie côté serveur et n'est JAMAIS livrée avec des identifiants : la session est celle d'un profil
 * de navigateur stocké HORS du dépôt (BROWSER_PROFILE_DIR), où l'utilisateur s'est connecté lui-même.
 * Le pilote ne lit ni n'exporte de cookies et ne stocke aucun mot de passe.
 */
export interface BrowserDriver {
  /** Ouvre une URL dans la session existante et renvoie l'URL finale + le contenu utile. */
  open(url: string, signal: AbortSignal): Promise<{ finalUrl: string; html: string }>;
}

/** Signaux de protection : si l'un apparaît, on s'arrête immédiatement (aucun contournement). */
export const PROTECTION_PATTERNS: RegExp[] = [
  /captcha/i,
  /are you a robot|êtes-vous un robot|vous n'êtes pas un robot/i,
  /press (and|&) hold/i,
  /access denied|accès refusé/i,
  /too many requests|trop de requêtes/i,
  /datadome|perimeterx|px-captcha|cf-chl/i,
];

export function detectProtection(html: string): string | null {
  for (const p of PROTECTION_PATTERNS) if (p.test(html)) return p.source;
  return null;
}

export interface BrowserProviderGateInput {
  review: TosReview | null;
  optInEnv: string | undefined;
  hasDriver: boolean;
  today: Date;
}

/** Les trois conditions d'activation d'un BrowserProvider (cf. docs/PROVIDER_ACCESS_STUDY.md). */
export function evaluateBrowserGate(i: BrowserProviderGateInput): ProviderAvailability {
  if (!i.review) return { enabled: false, reasonKey: "provider.disabled.noTosReview" };
  if (!i.review.automationAllowed) return { enabled: false, reasonKey: "provider.disabled.tosForbids" };
  const ageDays = (i.today.getTime() - Date.parse(i.review.reviewedOn)) / 86_400_000;
  if (!(ageDays >= 0 && ageDays <= TOS_REVIEW_MAX_AGE_DAYS)) return { enabled: false, reasonKey: "provider.disabled.tosReviewExpired" };
  if (i.optInEnv !== "true") return { enabled: false, reasonKey: "provider.disabled.noOptIn" };
  if (!i.hasDriver) return { enabled: false, reasonKey: "provider.disabled.noBrowserSession" };
  return { enabled: true };
}

/**
 * Base des BrowserProviders. Une sous-classe fournit :
 *  - `buildSearchUrl` : l'URL de recherche officielle (la même qu'un humain utiliserait) ;
 *  - `parseResults` : l'extraction des résultats RÉELLEMENT affichés, normalisés en TransportSegment.
 * La base impose : garde-fous d'activation, détection de protection, provenance (sourceUrl, checkedAt).
 */
export abstract class BrowserProvider implements TransportProvider {
  readonly accessMethod = "BROWSER" as const;
  readonly isMock = false;
  readonly cacheTtlSeconds: number = 600;
  readonly timeoutMs: number = 30_000;
  /** Volontairement bas : un humain ne lance pas des centaines de recherches. */
  readonly maxCallsPerSearch: number = 4;
  readonly maxConcurrency: number = 1;
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly modes: readonly TransportMode[];

  constructor(
    protected readonly review: TosReview | null,
    protected readonly optInEnv: string | undefined,
    protected readonly driver: BrowserDriver | null,
    protected readonly today: () => Date = () => new Date(),
  ) {}

  availability(): ProviderAvailability {
    return evaluateBrowserGate({ review: this.review, optInEnv: this.optInEnv, hasDriver: this.driver !== null, today: this.today() });
  }

  abstract supports(query: SegmentQuery): boolean;
  protected abstract buildSearchUrl(query: SegmentQuery): string;
  protected abstract parseResults(html: string, ctx: { origin: Place; destination: Place; sourceUrl: string; checkedAt: string }): TransportSegment[];

  async search(query: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]> {
    if (!this.availability().enabled || !this.driver) return [];
    const url = this.buildSearchUrl(query);
    const page = await this.driver.open(url, ctx.signal);
    const protection = detectProtection(page.html);
    if (protection) {
      throw new ProviderBlockedError(`${this.id} : protection détectée (${protection}) — recherche interrompue, aucun contournement`);
    }
    const checkedAt = ctx.now().toISOString();
    return this.parseResults(page.html, { origin: query.origin, destination: query.destination, sourceUrl: page.finalUrl, checkedAt }).map((s) => ({
      ...s,
      accessMethod: "BROWSER" as const,
      sourceUrl: s.sourceUrl ?? page.finalUrl,
      checkedAt,
      isMock: false,
    }));
  }
}
