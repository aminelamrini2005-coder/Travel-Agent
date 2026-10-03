import { formatMoney } from "@/core/money";
import { dayOffset, formatDuration, formatLocalTime } from "@/core/time";
import type { Journey, TransportMode, TransportSegment } from "@/core/types";
import { t } from "@/i18n";

export const MODE_ICON: Record<TransportMode, string> = {
  flight: "✈️",
  train: "🚆",
  regional_train: "🚆",
  high_speed_train: "🚄",
  coach: "🚌",
  bus: "🚍",
  metro: "🚇",
  tram: "🚊",
  ferry: "⛴️",
  rideshare: "🚗",
  taxi: "🚕",
  vtc: "🚕",
  walk: "🚶",
  car_rental: "🚙",
};

export const modeLabel = (m: TransportMode) => t(`mode.${m}`);
export const depTime = (s: TransportSegment) => formatLocalTime(s.departureTime, s.origin.timezone);
export const arrTime = (s: TransportSegment) => formatLocalTime(s.arrivalTime, s.destination.timezone);
export { formatDuration, formatMoney };

/** "21:54" ou "00:31 (+1)" si l'arrivée est le lendemain (dates locales). */
export function journeyArrival(j: Journey): string {
  const first = j.segments[0]!;
  const last = j.segments[j.segments.length - 1]!;
  const off = dayOffset(first.departureTime, first.origin.timezone, last.arrivalTime, last.destination.timezone);
  return `${arrTime(last)}${off > 0 ? ` (+${off})` : ""}`;
}

/** Prix total affiché : jamais de total « complet » si un segment a un prix inconnu. */
export function journeyPrice(j: Journey): string {
  if (j.unknownPriceSegments > 0) {
    return j.totalPrice.amountMinor > 0 ? `≥ ${formatMoney(j.totalPrice)} + ?` : t("price.unknownShort");
  }
  const approx = j.totalPriceConfidence === "ESTIMATED" || j.totalPriceConfidence === "RANGE" ? "≈ " : "";
  return `${approx}${formatMoney(j.totalPrice)}`;
}

export type SegmentKind = "REAL_DATA" | "MOCK" | "ESTIMATED";
export function segmentKind(s: TransportSegment): SegmentKind {
  if (s.isMock || s.accessMethod === "MOCK") return "MOCK";
  if (s.accessMethod === "COMPUTED") return "ESTIMATED";
  return "REAL_DATA";
}

export function signed(minor: number, currency: string): string {
  const s = formatMoney({ amountMinor: Math.abs(minor), currency });
  return minor > 0 ? `+${s}` : minor < 0 ? `−${s}` : s;
}

export function signedDuration(minutes: number): string {
  if (minutes === 0) return "±0";
  return `${minutes > 0 ? "+" : "−"}${formatDuration(Math.abs(minutes))}`;
}
