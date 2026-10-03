"use client";
import { useState } from "react";
import { formatLocalDate, formatLocalTime } from "@/core/time";
import type { SearchResult, TransportMode } from "@/core/types";
import { t } from "@/i18n";
import { modeLabel } from "./format";

const MODE_FAMILY: Partial<Record<TransportMode, string>> = {
  flight: "flight",
  train: "train",
  regional_train: "train",
  high_speed_train: "train",
  coach: "coach",
  rideshare: "rideshare",
  bus: "bus",
  tram: "bus",
  metro: "bus",
  taxi: "taxi",
  walk: "walk",
};

/**
 * « Ce que j'ai recherché » : uniquement des actions factuelles (sources interrogées, liaisons, filtres, exclusions).
 * Aucune source n'est affichée ✓ sans requête réellement tracée.
 */
export function SearchTracePanel({ result }: { result: SearchResult }) {
  const [all, setAll] = useState(false);
  const tr = result.trace;
  const p = tr.interpretedParams;
  const tzO = tr.resolvedOrigin.timezone;
  const tzD = tr.resolvedDestination.timezone;

  // Liaisons interrogées avec succès, regroupées par famille de mode (recherche principale uniquement).
  const byFamily = new Map<string, Set<string>>();
  for (const q of tr.queries) {
    if (q.phase !== "primary" || (q.status !== "success" && q.status !== "cache_hit") || q.resultCount === 0) continue;
    const fam = MODE_FAMILY[q.modes[0]!] ?? "other";
    if (fam === "walk" || fam === "taxi") continue;
    const set = byFamily.get(fam) ?? new Set<string>();
    set.add(`${q.fromName} → ${q.toName}`);
    byFamily.set(fam, set);
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-base font-semibold">🔎 {t("trace.title")}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500">{t("trace.from")}</dt>
        <dd>{tr.resolvedOrigin.name}</dd>
        <dt className="text-zinc-500">{t("trace.to")}</dt>
        <dd>{tr.resolvedDestination.name}</dd>
        <dt className="text-zinc-500">{t("trace.departure")}</dt>
        <dd>
          {formatLocalDate(tr.earliestDepartureUtc, tzO)} {formatLocalTime(tr.earliestDepartureUtc, tzO)}
        </dd>
        {tr.latestArrivalUtc && (
          <>
            <dt className="text-zinc-500">{t("trace.latestArrival")}</dt>
            <dd>
              {formatLocalDate(tr.latestArrivalUtc, tzD)} {formatLocalTime(tr.latestArrivalUtc, tzD)}
            </dd>
          </>
        )}
        <dt className="text-zinc-500">{t("trace.objective")}</dt>
        <dd>{t(`trace.objective.${p.objective}`)}</dd>
        {p.maxBudget !== undefined && (
          <>
            <dt className="text-zinc-500">{t("trace.budget")}</dt>
            <dd>{p.maxBudget} {p.currency}</dd>
          </>
        )}
        {(p.excludedModes.length > 0 || p.includedModes || p.maxTransfers !== undefined) && (
          <>
            <dt className="text-zinc-500">{t("trace.filters")}</dt>
            <dd>
              {p.includedModes && <>{p.includedModes.map(modeLabel).join(", ")} · </>}
              {p.excludedModes.length > 0 && <>sans {p.excludedModes.map(modeLabel).join(", ")} · </>}
              {p.maxTransfers !== undefined && <>≤ {p.maxTransfers} corresp.</>}
            </dd>
          </>
        )}
      </dl>

      <h4 className="mt-3 font-semibold">{t("trace.sources")}</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1 pr-2">{t("trace.col.source")}</th>
              <th className="pr-2">{t("trace.col.method")}</th>
              <th className="pr-2">{t("trace.col.status")}</th>
              <th className="pr-2 text-right">{t("trace.col.results")}</th>
              <th className="pr-2 text-right">{t("trace.col.priced")}</th>
              <th className="pr-2">{t("trace.col.freshness")}</th>
              <th className="text-right">{t("trace.col.time")}</th>
            </tr>
          </thead>
          <tbody>
            {tr.providers.map((pr) => (
              <tr key={pr.providerId} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-1 pr-2">
                  {pr.displayName}
                  {pr.isMock && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-950">{t("badge.MOCK")}</span>}
                  {pr.suppressedByRealData > 0 && <div className="text-[11px] text-zinc-500">{t("trace.suppressed", { n: pr.suppressedByRealData })}</div>}
                  {pr.errors.length > 0 && <div className="text-[11px] text-red-700">{pr.errors[0]}</div>}
                </td>
                <td className="pr-2">{t(`access.${pr.accessMethod}`)}</td>
                <td className="pr-2">
                  {t(`trace.status.${pr.status}`)}
                  {pr.reason && <div className="text-[11px] text-zinc-500">{t(pr.reason)}</div>}
                </td>
                <td className="pr-2 text-right">{pr.status === "success" || pr.calls > 0 ? pr.resultCount : "—"}</td>
                <td className="pr-2 text-right">{pr.status === "success" ? pr.pricedResults : "—"}</td>
                <td className="pr-2">{pr.dataAsOf ? new Date(pr.dataAsOf).toLocaleDateString("fr-FR") : "—"}</td>
                <td className="text-right">{pr.calls > 0 ? `${pr.avgResponseMs} ms` : pr.cacheHits > 0 ? "cache" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="mt-3 font-semibold">{t("trace.notSearched")}</h4>
      <ul className="mt-1 space-y-0.5">
        {tr.declaredSources
          .filter((s) => s.status !== "disabled")
          .map((s) => (
            <li key={s.id}>
              {t(`trace.status.${s.status}`)} — {s.name} <span className="text-xs text-zinc-500">({t(s.reasonKey)})</span>
            </li>
          ))}
      </ul>

      <h4 className="mt-3 font-semibold">{t("trace.hubsOrigin")}</h4>
      <p>{tr.hubs.filter((h) => h.side === "origin" && h.selected).map((h) => h.place.name).join(" · ") || "—"}</p>
      <h4 className="mt-2 font-semibold">{t("trace.hubsDestination")}</h4>
      <p>{tr.hubs.filter((h) => h.side === "destination" && h.selected).map((h) => h.place.name).join(" · ") || "—"}</p>

      {byFamily.size > 0 && (
        <>
          <h4 className="mt-3 font-semibold">{t("trace.queriesByMode")}</h4>
          {[...byFamily.entries()].map(([fam, set]) => (
            <div key={fam} className="mt-1">
              <span className="font-medium">{fam === "other" ? "Autres" : modeLabel(fam as TransportMode)} :</span>{" "}
              <span className="text-zinc-600 dark:text-zinc-400">{[...set].slice(0, 8).map((s) => `${s} ✓`).join(" · ")}{set.size > 8 ? ` … (+${set.size - 8})` : ""}</span>
            </div>
          ))}
        </>
      )}

      {tr.routePatternsTested.length > 0 && (
        <>
          <h4 className="mt-3 font-semibold">{t("trace.routes")}</h4>
          <ul className="list-disc pl-5">
            {tr.routePatternsTested.slice(0, 6).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {tr.providers.some((p) => p.attribution && p.status === "success") && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-zinc-500">
          {tr.providers
            .filter((p) => p.attribution && p.status === "success")
            .map((p) => (
              <li key={p.providerId}>{p.attribution}</li>
            ))}
          {tr.resolvedOrigin.id.startsWith("osm:") || tr.resolvedDestination.id.startsWith("osm:") ? <li>{t("osm.attribution")}</li> : null}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        {t("trace.lastChecked")} : {new Date(tr.completedAt).toLocaleString("fr-FR")} ·{" "}
        {t("trace.stats", { queries: tr.queries.length, segments: tr.segmentsCollected, labels: tr.labelsExplored, ms: tr.totalDurationMs })}
      </p>

      <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
        {all ? t("trace.hideAll") : t("trace.seeAll")}
      </button>
      {all && (
        <div className="mt-2 space-y-3">
          <div>
            <h4 className="font-semibold">{t("trace.rejections")}</h4>
            <ul className="list-disc pl-5">
              {Object.entries(tr.rejectionCounts).map(([k, v]) => (
                <li key={k}>
                  {t(`rejection.${k}`)} : {v}
                </li>
              ))}
            </ul>
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
              {tr.rejectionSamples.slice(0, 15).map((s, i) => (
                <li key={i}>
                  [{t(`rejection.${s.reason}`)}] {s.detail}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold">{t("trace.alternatives")}</h4>
            <ul className="list-disc pl-5">
              {tr.alternativeSearches.map((a) => (
                <li key={a.variant.id}>
                  {t(a.variant.reasonKey, a.variant.reasonParams)} — {t(`variant.status.${a.status}`)}
                  {a.providerCalls > 0 ? ` (${a.providerCalls} appels)` : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold">Requêtes ({tr.queries.length})</h4>
            <div className="max-h-72 overflow-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-900">
                  <tr>
                    <th className="p-1 text-left">Source</th>
                    <th className="p-1 text-left">Liaison</th>
                    <th className="p-1">Statut</th>
                    <th className="p-1">Rés.</th>
                    <th className="p-1">Prix</th>
                    <th className="p-1">ms</th>
                    <th className="p-1">Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {tr.queries.map((q, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="p-1">{q.providerId}</td>
                      <td className="p-1">
                        {q.fromName} → {q.toName}
                      </td>
                      <td className="p-1 text-center">{q.status}</td>
                      <td className="p-1 text-center">{q.resultCount}</td>
                      <td className="p-1 text-center">{q.pricedCount}</td>
                      <td className="p-1 text-center">{Math.round(q.durationMs)}</td>
                      <td className="p-1 text-center">{q.phase.replace("alternative:", "alt:")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
