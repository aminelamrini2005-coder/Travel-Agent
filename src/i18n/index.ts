import { formatMoney } from "../core/money";
import { formatDuration } from "../core/time";
import { fr } from "./messages/fr";

export type Locale = "fr";
export type Messages = Record<string, string>;

/** Catalogues disponibles. Ajouter une langue = ajouter un fichier `messages/xx.ts` avec les mêmes clés. */
const CATALOGS: Record<Locale, Messages> = { fr };

export const DEFAULT_LOCALE: Locale = "fr";

const INTL_LOCALE: Record<Locale, string> = { fr: "fr-FR" };

export type Params = Record<string, string | number | undefined>;

/**
 * Traduction avec interpolation typée. Une clé absente renvoie la clé elle-même (visible, jamais silencieuse).
 */
export function t(key: string, params: Params = {}, locale: Locale = DEFAULT_LOCALE, depth = 0): string {
  const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)(?::(money|duration|msg))?\}/g, (_, name: string, type?: string) => {
    const v = params[name];
    if (v === undefined) return "";
    switch (type) {
      case "money":
        return formatMoney({ amountMinor: Number(v), currency: String(params.currency ?? "EUR") }, INTL_LOCALE[locale]);
      case "duration":
        return formatDuration(Number(v));
      case "msg":
        return depth < 3 ? t(String(v), params, locale, depth + 1) : "";
      default:
        return String(v);
    }
  });
}

export function intlLocale(locale: Locale = DEFAULT_LOCALE): string {
  return INTL_LOCALE[locale];
}
