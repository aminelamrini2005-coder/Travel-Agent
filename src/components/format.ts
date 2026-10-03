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

export function journeyPrice(j: Journey): string {
  const base = formatMoney(j.totalPrice);
  const approx = j.totalPriceConfidence === "ESTIMATED" || j.totalPriceConfidence === "RANGE" ? "≈ " : "";
  return `${approx}${base}${j.unknownPriceSegments > 0 ? " +?" : ""}`;
}

export function signed(minor: number, currency: string): string {
  const s = formatMoney({ amountMinor: Math.abs(minor), currency });
  return minor > 0 ? `+${s}` : minor < 0 ? `−${s}` : s;
}

export function signedDuration(minutes: number): string {
  if (minutes === 0) return "±0";
  return `${minutes > 0 ? "+" : "−"}${formatDuration(Math.abs(minutes))}`;
}
