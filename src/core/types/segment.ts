import { z } from "zod";
import { AccessMethodSchema, IsoInstantSchema, PriceConfidenceSchema, TransportModeSchema } from "./common";
import { MoneySchema } from "./money";
import { PlaceSchema } from "./place";

/**
 * Format normalisé commun renvoyé par TOUS les providers.
 * Les horaires sont des instants UTC ; le fuseau d'affichage vient de `origin.timezone` / `destination.timezone`.
 */
export const TransportSegmentSchema = z.object({
  id: z.string().min(1),
  /** Identifiant du provider qui a fourni la donnée. */
  provider: z.string().min(1),
  /** Méthode d'accès réelle (API, OPEN_DATA, BROWSER, COMPUTED, MOCK). */
  accessMethod: AccessMethodSchema,
  operator: z.string().optional(),
  mode: TransportModeSchema,
  origin: PlaceSchema,
  destination: PlaceSchema,
  departureTime: IsoInstantSchema,
  arrivalTime: IsoInstantSchema,
  /** true pour marche / taxi : on peut partir à n'importe quel moment, la durée est fixe. */
  flexibleDeparture: z.boolean(),
  durationMinutes: z.number().int().nonnegative(),
  /** Prix (pour RANGE : borne basse). null si inconnu. */
  price: MoneySchema.nullable(),
  priceRange: z.object({ min: MoneySchema, max: MoneySchema }).optional(),
  priceConfidence: PriceConfidenceSchema,
  bookingUrl: z.url().nullable(),
  /** URL de la page source lorsque la donnée vient d'un BrowserProvider (ou page de résultats officielle). */
  sourceUrl: z.url().optional(),
  realtime: z.boolean(),
  availability: z.enum(["available", "limited", "sold_out", "unknown"]),
  seatsLeft: z.number().int().nonnegative().optional(),
  isMock: z.boolean(),
  /** Instant de récupération auprès de la source (UTC). */
  checkedAt: IsoInstantSchema,
  /**
   * Fraîcheur de la donnée source : date de publication / téléchargement du jeu de données
   * (GTFS) ou instant de la réponse (API temps réel). Distinct de `checkedAt` pour l'open data.
   */
  dataAsOf: IsoInstantSchema.optional(),
  /** Mention de source / licence à afficher (ex. « FlixBus GTFS — ODbL »). */
  attribution: z.string().optional(),
  /** Segments partageant ce groupe sont vendus sur un même billet (correspondance protégée). */
  ticketGroupId: z.string().optional(),
  serviceNumber: z.string().optional(),
  notes: z.array(z.string()).optional(),
});
export type TransportSegment = z.infer<typeof TransportSegmentSchema>;
