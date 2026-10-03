import { DateTime } from "luxon";

/**
 * Utilitaires temporels. Règle d'or : on ne compare JAMAIS deux heures locales.
 * Tout instant manipulé par le moteur est un instant UTC (ms epoch ou ISO "…Z").
 * Le fuseau IANA d'un lieu ne sert qu'à la saisie (heure locale → UTC) et à l'affichage.
 */

export const MINUTE_MS = 60_000;

/** Convertit un ISO avec offset en ms epoch. Lève une erreur si l'offset est absent (ambigu). */
export function toEpochMs(iso: string): number {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) {
    throw new Error(`Instant ambigu sans offset : ${iso}`);
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Instant invalide : ${iso}`);
  return ms;
}

/** Instant UTC normalisé "YYYY-MM-DDTHH:mm:ssZ" (millisecondes omises si nulles). */
export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

/** Différence en minutes (b - a), arrondie à la minute. */
export function diffMinutes(aIso: string, bIso: string): number {
  return Math.round((toEpochMs(bIso) - toEpochMs(aIso)) / MINUTE_MS);
}

export function addMinutesIso(iso: string, minutes: number): string {
  return toIsoUtc(toEpochMs(iso) + minutes * MINUTE_MS);
}

/** "2026-10-16T15:00" interprété dans `timezone` → instant UTC ISO. */
export function localToUtcIso(local: string, timezone: string): string {
  const dt = DateTime.fromISO(local, { zone: timezone });
  if (!dt.isValid) throw new Error(`Date locale invalide : ${local} (${timezone}) — ${dt.invalidReason}`);
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

/** Instant UTC → "YYYY-MM-DDTHH:mm" local. */
export function utcToLocal(iso: string, timezone: string): string {
  return DateTime.fromMillis(toEpochMs(iso), { zone: timezone }).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** Heure locale "HH:mm" pour affichage. */
export function formatLocalTime(iso: string, timezone: string): string {
  return DateTime.fromMillis(toEpochMs(iso), { zone: timezone }).toFormat("HH:mm");
}

/** Date locale lisible, ex. "ven. 16 oct.". */
export function formatLocalDate(iso: string, timezone: string, locale = "fr"): string {
  return DateTime.fromMillis(toEpochMs(iso), { zone: timezone })
    .setLocale(locale)
    .toFormat("ccc d LLL");
}

/** Nombre de jours calendaires entre deux instants, vus dans leurs fuseaux respectifs (pour afficher "+1"). */
export function dayOffset(fromIso: string, fromTz: string, toIso: string, toTz: string): number {
  const a = DateTime.fromMillis(toEpochMs(fromIso), { zone: fromTz }).startOf("day");
  const b = DateTime.fromMillis(toEpochMs(toIso), { zone: toTz }).startOf("day");
  return Math.round(b.diff(a, "days").days);
}

/** Décale une date-heure locale de N minutes en restant en heure locale (gère les changements d'heure). */
export function shiftLocal(local: string, minutes: number, timezone: string): string {
  return DateTime.fromISO(local, { zone: timezone }).plus({ minutes }).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** Date-heure locale actuelle dans un fuseau. */
export function nowLocal(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** Liste des dates locales (YYYY-MM-DD) couvertes par une fenêtre UTC, dans un fuseau donné. */
export function localDatesInWindow(startIso: string, endIso: string, timezone: string): string[] {
  let d = DateTime.fromMillis(toEpochMs(startIso), { zone: timezone }).startOf("day");
  const end = DateTime.fromMillis(toEpochMs(endIso), { zone: timezone });
  const out: string[] = [];
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

/** "YYYY-MM-DD" + "HH:mm" local → instant UTC ISO. */
export function localDateTimeToUtc(date: string, time: string, timezone: string): string {
  return localToUtcIso(`${date}T${time}`, timezone);
}

/** Formatage de durée : 342 → "5 h 42". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${sign}${r} min`;
  return `${sign}${h} h ${String(r).padStart(2, "0")}`;
}
