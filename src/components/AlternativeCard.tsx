"use client";
import { useState } from "react";
import type { Alternative } from "@/core/types";
import { t } from "@/i18n";
import { DataQualityBar } from "./DataBadges";
import { PlaceChain } from "./JourneyCard";
import { JourneyTimeline } from "./JourneyTimeline";
import { depTime, formatDuration, journeyArrival, journeyPrice, signed, signedDuration } from "./format";

export function AlternativeCard({ alt, index }: { alt: Alternative; index: number }) {
  const [open, setOpen] = useState(false);
  const j = alt.journey;
  return (
    <article className="rounded-2xl border border-violet-300 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        {index + 1} — {t(`alt.type.${alt.variant.type}`)}
      </div>
      <p className="mt-1 font-medium">« {t(alt.explanation.key, alt.explanation.params)} »</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-2xl font-bold">{journeyPrice(j)}</div>
        <div className="text-right text-sm">
          <div>
            {formatDuration(j.totalDurationMinutes)} · <span className="font-mono">{depTime(j.segments[0]!)} → {journeyArrival(j)}</span>
          </div>
          {alt.referenceJourneyId && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {alt.priceDeltaKnown ? `${signed(alt.deltaPrice.amountMinor, alt.deltaPrice.currency)} · ` : ""}
              {t("result.arrival", { time: signedDuration(alt.deltaArrivalMinutes) })}
            </div>
          )}
        </div>
      </div>
      {alt.violatesConstraints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {alt.violatesConstraints.map((v) => (
            <span key={v} className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900 dark:bg-orange-950 dark:text-orange-200">
              ⚠ {t(`result.violates.${v}`)}
            </span>
          ))}
        </div>
      )}
      <DataQualityBar q={j.dataQuality} />
      <PlaceChain journey={j} />
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
        {open ? t("result.hideDetail") : t("result.seeDetail")}
      </button>
      {open && <JourneyTimeline journey={j} />}
    </article>
  );
}
