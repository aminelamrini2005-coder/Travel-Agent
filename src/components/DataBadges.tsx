"use client";
import type { DataQuality, TransportSegment } from "@/core/types";
import { t } from "@/i18n";
import { segmentKind } from "./format";

const KIND_STYLE = {
  REAL_DATA: "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200",
  MOCK: "bg-amber-200 text-amber-950 ring-amber-400",
  ESTIMATED: "bg-sky-100 text-sky-900 ring-sky-300 dark:bg-sky-950 dark:text-sky-200",
} as const;

export function SegmentBadge({ segment }: { segment: TransportSegment }) {
  const k = segmentKind(segment);
  return <span className={`ml-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${KIND_STYLE[k]}`}>{t(`badge.${k}`)}</span>;
}

const PRICE_STYLE = {
  REAL: "text-emerald-800 dark:text-emerald-300",
  RANGE: "text-sky-800 dark:text-sky-300",
  ESTIMATED: "text-sky-800 dark:text-sky-300",
  UNKNOWN: "text-zinc-500",
} as const;

export function PriceConfidenceLabel({ segment }: { segment: TransportSegment }) {
  // Un prix « réel » venant d'un provider fictif reste un prix fictif.
  if (segment.mode === "walk") return <span className="text-[10px] font-bold uppercase text-zinc-500">{t("price.free")}</span>;
  if (segment.isMock) return <span className="text-[10px] font-bold uppercase text-amber-800">{t("badge.MOCK")}</span>;
  return <span className={`text-[10px] font-bold uppercase ${PRICE_STYLE[segment.priceConfidence]}`}>{t(`price.${segment.priceConfidence}`)}</span>;
}

const STATUS_STYLE = {
  verified: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  partial: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  demo: "border-amber-400 bg-amber-100 text-amber-950",
  estimated: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
} as const;

/** Couverture en données réelles (calculée par le backend), affichée sur chaque trajet. */
export function DataQualityBar({ q }: { q: DataQuality }) {
  const parts = [t("quality.segments", { verified: q.verifiedSegments, counted: q.countedSegments })];
  if (q.mockSegments) parts.push(t("quality.mock", { n: q.mockSegments }));
  if (q.estimatedSegments) parts.push(t("quality.estimated", { n: q.estimatedSegments }));
  parts.push(t("quality.priced", { priced: q.pricedSegments, counted: q.countedSegments }));
  return (
    <div className={`mt-2 rounded-lg border px-2 py-1.5 text-xs ${STATUS_STYLE[q.status]}`}>
      <div className="flex items-center justify-between gap-2 font-semibold">
        <span>{t(`quality.status.${q.status}`)}</span>
        <span className="whitespace-nowrap">{t("quality.coverage", { percent: q.realCoveragePercent })}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/10">
        <div className="h-full bg-emerald-600" style={{ width: `${q.realCoveragePercent}%` }} />
      </div>
      <div className="mt-1">{parts.join(" · ")}</div>
      {q.uncoveredLegs.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {q.uncoveredLegs.map((l, i) => (
            <li key={i}>
              • {t(`quality.uncovered.${l.kind}`, { from: l.from, to: l.to, mode: t(`mode.${l.mode}`) })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
