import { z } from "zod";
import { TransportModeSchema } from "./common";
import { LocationQuerySchema } from "./place";

/**
 * Date-heure LOCALE sans offset ("2026-10-16T15:00").
 * Interprétée dans le fuseau de l'origine (départ) ou de la destination (arrivée) une fois les lieux résolus.
 * C'est ce que l'utilisateur exprime naturellement (« vendredi 15h »).
 */
export const LocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Format attendu : YYYY-MM-DDTHH:mm");
export type LocalDateTime = z.infer<typeof LocalDateTimeSchema>;

export const ObjectiveSchema = z.enum(["best", "cheapest", "fastest", "comfort"]);
export type Objective = z.infer<typeof ObjectiveSchema>;

export const LuggageSchema = z.enum(["backpack", "cabin", "checked"]);
export type Luggage = z.infer<typeof LuggageSchema>;

export const SearchParamsSchema = z.object({
  origin: LocationQuerySchema,
  destination: LocationQuerySchema,
  earliestDeparture: LocalDateTimeSchema,
  /** "hard" : l'utilisateur ne peut pas partir plus tôt (ex. « je finis les cours à 15h »). */
  departureFlexibility: z.enum(["hard", "soft"]).default("soft"),
  latestArrival: LocalDateTimeSchema.optional(),
  objective: ObjectiveSchema.default("best"),
  /** Budget max total, en unités majeures de `currency` (ex. 100 = 100 €). */
  maxBudget: z.number().positive().optional(),
  currency: z.string().length(3).default("EUR"),
  maxTransfers: z.number().int().min(0).max(8).optional(),
  /** undefined = tous les modes. */
  includedModes: z.array(TransportModeSchema).min(1).optional(),
  excludedModes: z.array(TransportModeSchema).default([]),
  passengers: z.number().int().min(1).max(9).default(1),
  luggage: LuggageSchema.default("cabin"),
  /** Valeur du temps (€/h) : « je paie 20 € de plus pour gagner 2 h » → 10. */
  valueOfTimePerHour: z.number().nonnegative().optional(),
  minConnectionBufferMinutes: z.number().int().min(0).max(600).optional(),
});
export type SearchParams = z.infer<typeof SearchParamsSchema>;
export type SearchParamsInput = z.input<typeof SearchParamsSchema>;

/**
 * Modification incrémentale d'une recherche (conversation).
 * Le LLM ne produit QUE ce patch : jamais d'horaires, de prix ni de trajets.
 */
export const SearchParamsPatchSchema = z
  .object({
    reset: z.boolean().optional(),
    origin: LocationQuerySchema.optional(),
    destination: LocationQuerySchema.optional(),
    earliestDeparture: LocalDateTimeSchema.optional(),
    departureFlexibility: z.enum(["hard", "soft"]).optional(),
    latestArrival: LocalDateTimeSchema.optional(),
    clearLatestArrival: z.boolean().optional(),
    shiftDepartureMinutes: z.number().int().min(-2880).max(2880).optional(),
    objective: ObjectiveSchema.optional(),
    maxBudget: z.number().positive().optional(),
    clearMaxBudget: z.boolean().optional(),
    currency: z.string().length(3).optional(),
    maxTransfers: z.number().int().min(0).max(8).optional(),
    clearMaxTransfers: z.boolean().optional(),
    includedModes: z.array(TransportModeSchema).min(1).optional(),
    clearIncludedModes: z.boolean().optional(),
    addExcludedModes: z.array(TransportModeSchema).optional(),
    removeExcludedModes: z.array(TransportModeSchema).optional(),
    passengers: z.number().int().min(1).max(9).optional(),
    luggage: LuggageSchema.optional(),
    valueOfTimePerHour: z.number().nonnegative().optional(),
    minConnectionBufferMinutes: z.number().int().min(0).max(600).optional(),
  })
  .strict();
export type SearchParamsPatch = z.infer<typeof SearchParamsPatchSchema>;

/** Préférences persistantes de l'utilisateur (appliquées comme valeurs par défaut). */
export const UserPreferencesSchema = z.object({
  maxBudget: z.number().positive().optional(),
  maxTransfers: z.number().int().min(0).optional(),
  preferredModes: z.array(TransportModeSchema).default([]),
  excludedModes: z.array(TransportModeSchema).default([]),
  walkingToleranceMinutes: z.number().int().min(0).default(20),
  minimumConnectionBufferMinutes: z.number().int().min(0).optional(),
  hasCheckedBaggage: z.boolean().default(false),
  /** 0 = prix avant tout, 1 = confort avant tout. */
  comfortVsPrice: z.number().min(0).max(1).default(0.5),
  /** Valeur du temps en €/h. */
  valueOfTimePerHour: z.number().nonnegative().default(12),
  locale: z.string().default("fr"),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
