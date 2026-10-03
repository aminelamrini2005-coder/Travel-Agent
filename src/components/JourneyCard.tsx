"use client";
import { useState } from "react";
import type { Explanation, Journey } from "@/core/types";
import { t } from "@/i18n";
import { JourneyTimeline } from "./JourneyTimeline";
import { MODE_ICON, depTime, formatDuration, journeyArrival, journeyPrice, modeLabel } from "./format";

export function PlaceChain({ journey }: { journey: Journey }) {
  return (
    <ol className="mt-2 space-y-0.5 text-sm">
      <li className="font-medium">{journey.segments[0]!.origin.name}</li>
      {journey.segments.map((s, i) => (
        <li key={i}>
          <div className="pl-2 text-xs text-zinc-500">
            ↓ {MODE_ICON[s.mode]} {modeLabel(s.mode)}
            {s.operator ? ` · ${s.operator}` : ""}
          </div>
          <div className="font-medium">{s.destination.name}</div>
        </li>
      ))}
    </ol>
  );
}

export function JourneyCard({
  title,
  journey,
  explanation,
  highlight = false,
  compact = false,
}: {
  title: string;
  journey: Journey;
  explanation?: Explanation;
  highlight?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article
      className={`rounded-2xl border p-4 ${highlight ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
          <div className={`${highlight ? "text-3xl" : "text-2xl"} font-bold`}>{journeyPrice(journey)}</div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{formatDuration(journey.totalDurationMinutes)}</div>
          <div className="font-mono">
            {depTime(journey.segments[0]!)} → {journeyArrival(journey)}
          </div>
          <div className="text-xs text-zinc-500">{journey.transfers === 0 ? t("result.direct") : t("result.transfers", { n: journey.transfers })}</div>
        </div>
      </div>
      {journey.containsMockData && <span className="mt-1 inline-block rounded bg-amber-200 px-1.5 text-xs font-semibold text-amber-900">{t("mock.badge")}</span>}
      {!compact && <PlaceChain journey={journey} />}
      {compact && (
        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {journey.segments.map((s) => MODE_ICON[s.mode]).join(" → ")}
        </div>
      )}
      {explanation && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{t("result.why")} : </span>
          {t(explanation.key, explanation.params)}
        </p>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
        {open ? t("result.hideDetail") : t("result.seeDetail")}
      </button>
      {open && <JourneyTimeline journey={journey} />}
    </article>
  );
}
