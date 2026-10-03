import { z } from "zod";

/**
 * Montant en unités mineures entières (centimes) pour éviter les erreurs de flottants.
 * `currency` est un code ISO 4217 (EUR, GBP, USD, CHF…).
 */
export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof MoneySchema>;
