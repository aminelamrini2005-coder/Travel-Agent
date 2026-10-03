import type { Money } from "../types";

export function money(amountMajor: number, currency = "EUR"): Money {
  return { amountMinor: Math.round(amountMajor * 100), currency };
}

export function zero(currency = "EUR"): Money {
  return { amountMinor: 0, currency };
}

export function toMajor(m: Money): number {
  return m.amountMinor / 100;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Devises différentes : ${a} / ${b} — conversion requise`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), zero(currency));
}

/** Formatage localisé : 6070 EUR → "60,70 €" (fr). Les montants ronds n'affichent pas de décimales. */
export function formatMoney(m: Money, locale = "fr-FR"): string {
  const major = toMajor(m);
  const hasCents = m.amountMinor % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * Source de taux de change. Les taux ne sont JAMAIS inventés :
 * si une source ne connaît pas une paire, elle renvoie null et la conversion est refusée.
 */
export interface RateSource {
  readonly id: string;
  /** Taux tel que 1 `from` = rate `to`, avec la date de publication. */
  getRate(from: string, to: string): Promise<{ rate: number; asOf: string } | null>;
}

/** Aucune source configurée : seules les conversions identité sont possibles. */
export class NoRateSource implements RateSource {
  readonly id = "none";
  async getRate(from: string, to: string) {
    return from === to ? { rate: 1, asOf: new Date().toISOString() } : null;
  }
}

/**
 * Taux de référence de la BCE (publication quotidienne, gratuite).
 * https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml — base EUR.
 */
export class EcbRateSource implements RateSource {
  readonly id = "ecb";
  private cache: { fetchedAt: number; asOf: string; rates: Record<string, number> } | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 6 * 3600_000,
  ) {}

  private async load() {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.ttlMs) return this.cache;
    const res = await this.fetchImpl("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
    if (!res.ok) throw new Error(`BCE HTTP ${res.status}`);
    const xml = await res.text();
    const rates: Record<string, number> = { EUR: 1 };
    for (const m of xml.matchAll(/currency='([A-Z]{3})'\s+rate='([\d.]+)'/g)) {
      rates[m[1]!] = Number(m[2]);
    }
    const asOf = /time='(\d{4}-\d{2}-\d{2})'/.exec(xml)?.[1] ?? "unknown";
    this.cache = { fetchedAt: Date.now(), asOf, rates };
    return this.cache;
  }

  async getRate(from: string, to: string) {
    if (from === to) return { rate: 1, asOf: new Date().toISOString() };
    const { rates, asOf } = await this.load();
    const f = rates[from];
    const t = rates[to];
    if (!f || !t) return null;
    return { rate: t / f, asOf };
  }
}

export class CurrencyConverter {
  constructor(private readonly source: RateSource) {}

  /** Renvoie null si le taux n'est pas disponible (jamais d'approximation inventée). */
  async convert(m: Money, to: string): Promise<Money | null> {
    if (m.currency === to) return m;
    const r = await this.source.getRate(m.currency, to).catch(() => null);
    if (!r) return null;
    return { amountMinor: Math.round(m.amountMinor * r.rate), currency: to };
  }
}
