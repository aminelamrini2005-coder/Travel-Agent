"use client";
import type { RankingProfile, SearchResult } from "@/core/types";
import { t } from "@/i18n";
import { AlternativeCard } from "./AlternativeCard";
import { JourneyCard } from "./JourneyCard";
import { SearchTracePanel } from "./SearchTracePanel";

const PROFILE_TITLE: Record<RankingProfile, string> = {
  best: "profile.best",
  cheapest: "profile.cheapest",
  fastest: "profile.fastest",
  comfort: "profile.comfort",
};

export function MockBanner() {
  return (
    <div role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
      <strong>⚠️ {t("mock.banner.title")}</strong> — {t("mock.banner.body")}
    </div>
  );
}

export function SearchResultView({ result }: { result: SearchResult }) {
  const byId = new Map(result.journeys.map((j) => [j.id, j]));
  const [primary, ...others] = result.ranking;
  const primaryJourney = primary ? byId.get(primary.journeyId) : undefined;
  // Profils qui désignent le même trajet que le meilleur résultat : affichés comme badges, pas en double.
  const alsoPrimary = others.filter((e) => e.journeyId === primary?.journeyId).map((e) => t(PROFILE_TITLE[e.profile]));
  // Les autres profils sont regroupés par trajet (un trajet = une carte).
  const groups = new Map<string, typeof others>();
  for (const e of others) {
    if (e.journeyId === primary?.journeyId) continue;
    groups.set(e.journeyId, [...(groups.get(e.journeyId) ?? []), e]);
  }

  return (
    <div className="space-y-4">
      {result.containsMockData && <MockBanner />}

      {primary && primaryJourney ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{t("result.bestMatch")}</h3>
          <JourneyCard
            title={[t(PROFILE_TITLE[primary.profile]), ...alsoPrimary].join(" · ")}
            journey={primaryJourney}
            explanation={primary.explanation}
            highlight
          />
        </section>
      ) : (
        <p className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
          {t("result.none")} {result.emptyReasonKey ? t(result.emptyReasonKey) : ""}
        </p>
      )}

      {groups.size > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{t("result.otherCompatible")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...groups.entries()].map(([journeyId, entries]) => {
              const j = byId.get(journeyId);
              if (!j) return null;
              return (
                <JourneyCard
                  key={journeyId}
                  title={entries.map((e) => t(PROFILE_TITLE[e.profile])).join(" · ")}
                  journey={j}
                  explanation={entries[0]!.explanation}
                  compact
                />
              );
            })}
          </div>
        </section>
      )}

      {result.alternatives.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">💡 {t("result.alternatives")}</h3>
          <div className="space-y-3">
            {result.alternatives.map((a, i) => (
              <AlternativeCard key={a.id} alt={a} index={i} />
            ))}
          </div>
        </section>
      )}

      <SearchTracePanel result={result} />
    </div>
  );
}
