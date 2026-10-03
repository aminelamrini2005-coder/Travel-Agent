"use client";
import type { Journey } from "@/core/types";
import { t } from "@/i18n";
import { MODE_ICON, arrTime, depTime, formatDuration, formatMoney, modeLabel } from "./format";

const RISK_COLOR = { low: "text-emerald-700 dark:text-emerald-400", medium: "text-amber-700 dark:text-amber-400", high: "text-red-700 dark:text-red-400" };

/** Détail vertical : heure, lieu, mode, prix, source et heure de vérification pour chaque segment. */
export function JourneyTimeline({ journey }: { journey: Journey }) {
  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <ol className="relative ml-2 border-l border-zinc-300 dark:border-zinc-700">
        {journey.segments.map((s, i) => {
          const conn = i > 0 ? journey.connections[i - 1] : undefined;
          return (
            <li key={s.id + i} className="mb-3 ml-4">
              {conn && (
                <div className="mb-2 -ml-4 pl-4 text-xs text-zinc-500">
                  {t("result.wait", { minutes: Math.max(0, conn.waitMinutes) })} ·{" "}
                  <span className={RISK_COLOR[conn.risk]}>
                    {t(`risk.${conn.risk}`)} — {t("result.margin", { slack: conn.slackMinutes, required: conn.requiredMinutes })}
                  </span>
                  {conn.notes.map((n) => (
                    <div key={n}>• {t(n)}</div>
                  ))}
                </div>
              )}
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-zinc-400 dark:border-zinc-900" />
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold">{depTime(s)}</span> <span className="font-medium">{s.origin.name}</span>
                </div>
              </div>
              <div className="my-1 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {MODE_ICON[s.mode]} {modeLabel(s.mode)}
                    {s.operator ? ` · ${s.operator}` : ""}
                    {s.serviceNumber ? ` ${s.serviceNumber}` : ""}
                  </span>
                  <span className="font-semibold">
                    {s.price ? formatMoney(s.price) : t("price.UNKNOWN")}
                    {s.priceRange ? ` – ${formatMoney(s.priceRange.max)}` : ""}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {formatDuration(s.durationMinutes)} · {t(`price.${s.priceConfidence}`)} · {t(`access.${s.accessMethod}`)} · {s.realtime ? t("result.realtime") : t("result.notRealtime")} ·{" "}
                  {t("result.checkedAt", { time: new Date(s.checkedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) })}
                  {s.isMock && <span className="ml-1 rounded bg-amber-200 px-1 font-semibold text-amber-900">{t("mock.badge")}</span>}
                </div>
                {s.notes?.filter((n) => n !== "segment.note.mock").map((n) => (
                  <div key={n} className="text-xs text-zinc-500">• {t(n)}</div>
                ))}
                <div className="mt-1 text-xs">
                  {s.bookingUrl ? (
                    <a className="text-blue-700 underline dark:text-blue-400" href={s.bookingUrl} target="_blank" rel="noopener noreferrer">
                      {t("result.booking")} ↗
                    </a>
                  ) : (
                    <span className="text-zinc-400">{t("result.noBooking")}</span>
                  )}
                </div>
              </div>
              {i === journey.segments.length - 1 && (
                <div className="mt-2">
                  <span className="font-mono font-semibold">{arrTime(s)}</span> <span className="font-medium">{s.destination.name}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
        <dt className="text-zinc-500">{t("result.total")}</dt>
        <dd className="text-right font-semibold">
          {formatMoney(journey.totalPrice)}
          {journey.totalPriceMax ? ` – ${formatMoney(journey.totalPriceMax)}` : ""}
          {journey.unknownPriceSegments > 0 && <div className="text-xs font-normal text-zinc-500">{t("result.price.unknownPart", { n: journey.unknownPriceSegments })}</div>}
        </dd>
        <dt className="text-zinc-500">{t("result.duration")}</dt>
        <dd className="text-right">{formatDuration(journey.totalDurationMinutes)}</dd>
        <dt className="text-zinc-500">{t("result.transfersLabel")}</dt>
        <dd className="text-right">{journey.transfers}</dd>
        <dt className="text-zinc-500">{t("result.risk")}</dt>
        <dd className={`text-right ${RISK_COLOR[journey.riskLevel]}`}>{t(`risk.${journey.riskLevel}`)}</dd>
      </dl>
      <p className="mt-1 text-xs text-zinc-500">{t("result.reliability.disclaimer")}</p>
    </div>
  );
}
