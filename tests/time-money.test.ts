import { describe, expect, it } from "vitest";
import { addMoney, CurrencyConverter, CurrencyMismatchError, formatMoney, money, NoRateSource, sumMoney, type RateSource } from "@/core/money";
import { dayOffset, diffMinutes, formatDuration, localToUtcIso, toEpochMs, utcToLocal } from "@/core/time";

describe("temps et fuseaux", () => {
  it("convertit une heure locale Europe/Paris en UTC (heure d'été et d'hiver)", () => {
    expect(localToUtcIso("2026-10-16T15:00", "Europe/Paris")).toBe("2026-10-16T13:00:00Z");
    expect(localToUtcIso("2026-12-16T15:00", "Europe/Paris")).toBe("2026-12-16T14:00:00Z");
  });

  it("calcule une durée correcte à travers un changement d'heure (25 oct. 2026)", () => {
    const dep = localToUtcIso("2026-10-25T01:00", "Europe/Paris");
    const arr = localToUtcIso("2026-10-25T05:00", "Europe/Paris");
    expect(diffMinutes(dep, arr)).toBe(5 * 60); // 4 h d'horloge murale = 5 h réelles
  });

  it("ne compare jamais naïvement deux heures locales de fuseaux différents", () => {
    // Départ Londres 10:00 (UTC+1 en été) → arrivée Paris 13:20 (UTC+2) : 2 h 20 de trajet réel.
    const dep = localToUtcIso("2026-07-01T10:00", "Europe/London");
    const arr = localToUtcIso("2026-07-01T13:20", "Europe/Paris");
    expect(diffMinutes(dep, arr)).toBe(140);
    expect(utcToLocal(arr, "Europe/Paris")).toBe("2026-07-01T13:20");
  });

  it("refuse un instant ambigu sans offset", () => {
    expect(() => toEpochMs("2026-10-16T15:00:00")).toThrow(/ambigu/);
  });

  it("calcule le décalage de jour (+1) en heure locale", () => {
    expect(dayOffset("2026-10-16T20:00:00Z", "Europe/Paris", "2026-10-16T22:30:00Z", "Europe/Madrid")).toBe(1);
    expect(dayOffset("2026-10-16T13:00:00Z", "Europe/Paris", "2026-10-16T20:00:00Z", "Europe/Madrid")).toBe(0);
  });

  it("formate les durées", () => {
    expect(formatDuration(342)).toBe("5 h 42");
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(-65)).toBe("-1 h 05");
  });
});

describe("monnaie", () => {
  it("additionne en centimes sans erreur de flottant", () => {
    const total = sumMoney([money(2), money(14), money(39), money(6)], "EUR");
    expect(total.amountMinor).toBe(6100);
    expect(addMoney(money(0.1), money(0.2)).amountMinor).toBe(30);
  });

  it("refuse d'additionner deux devises", () => {
    expect(() => addMoney(money(1, "EUR"), money(1, "GBP"))).toThrow(CurrencyMismatchError);
  });

  it("formate en français", () => {
    expect(formatMoney(money(60.7))).toMatch(/60,70\s€/);
    expect(formatMoney(money(61))).toMatch(/^61\s€$/);
  });

  it("n'invente jamais de taux de change", async () => {
    const conv = new CurrencyConverter(new NoRateSource());
    expect(await conv.convert(money(10, "GBP"), "EUR")).toBeNull();
    expect(await conv.convert(money(10, "EUR"), "EUR")).toEqual(money(10, "EUR"));
    const fixed: RateSource = { id: "test", getRate: async (f, t) => (f === "GBP" && t === "EUR" ? { rate: 1.15, asOf: "2026-10-02" } : null) };
    expect((await new CurrencyConverter(fixed).convert(money(10, "GBP"), "EUR"))?.amountMinor).toBe(1150);
  });
});
