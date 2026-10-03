import { DECLARED_SOURCES } from "../providers/declared-sources";
import type { TransportProvider } from "../providers/types";
import type {
  AlternativeSearchTrace,
  DeclaredSourceTraceEntry,
  HubConsideration,
  ProviderTraceEntry,
  QueryTraceEntry,
  RejectionReason,
  RejectionSample,
  TransportMode,
} from "../types";

/**
 * Collecte FACTUELLE des actions de recherche, au fil de l'eau.
 * Rien n'est reconstitué après coup : un provider n'apparaît « recherché » que s'il existe une requête tracée.
 */
export class TraceRecorder {
  readonly queries: QueryTraceEntry[] = [];
  readonly hubs: HubConsideration[] = [];
  readonly alternativeSearches: AlternativeSearchTrace[] = [];
  readonly routePatterns = new Set<string>();
  readonly suppressedMock = new Map<string, number>();
  rejectionCounts: Partial<Record<RejectionReason, number>> = {};
  rejectionSamples: RejectionSample[] = [];
  segmentsCollected = 0;
  labelsExplored = 0;
  journeysGenerated = 0;
  engineDurationMs = 0;

  addQueries(q: QueryTraceEntry[], suppressed?: Map<string, number>) {
    this.queries.push(...q);
    for (const [k, v] of suppressed ?? []) this.suppressedMock.set(k, (this.suppressedMock.get(k) ?? 0) + v);
  }

  addRejections(counts: Partial<Record<RejectionReason, number>>, samples: RejectionSample[]) {
    for (const [k, v] of Object.entries(counts) as [RejectionReason, number][]) {
      this.rejectionCounts[k] = (this.rejectionCounts[k] ?? 0) + v;
    }
    for (const s of samples) if (this.rejectionSamples.length < 60) this.rejectionSamples.push(s);
  }

  /** Agrège l'état de chaque provider à partir des requêtes réellement effectuées. */
  providerEntries(providers: readonly TransportProvider[], searchedModes: TransportMode[], mockPolicy: "fallback" | "off" | "all" = "fallback"): ProviderTraceEntry[] {
    return providers.map((p) => {
      const qs = this.queries.filter((q) => q.providerId === p.id);
      const availability = p.isMock && mockPolicy === "off" ? { enabled: false, reasonKey: "provider.disabled.mockOff" } : p.availability();
      const live = qs.filter((q) => q.status === "success" || q.status === "error" || q.status === "timeout" || q.status === "blocked");
      const asOf = qs.map((q) => q.dataAsOf).filter((x): x is string => !!x).sort()[0];
      const base = {
        providerId: p.id,
        displayName: p.displayName,
        accessMethod: p.accessMethod,
        isMock: p.isMock,
        modes: [...p.modes],
        calls: qs.filter((q) => q.status !== "cache_hit" && q.status !== "skipped_budget").length,
        cacheHits: qs.filter((q) => q.status === "cache_hit").length,
        resultCount: qs.reduce((a, q) => a + q.resultCount, 0),
        totalDurationMs: qs.reduce((a, q) => a + q.durationMs, 0),
        errors: [...new Set(qs.filter((q) => q.error).map((q) => q.error!))].slice(0, 5),
        pricedResults: qs.reduce((a, q) => a + q.pricedCount, 0),
        dataAsOf: asOf,
        avgResponseMs: live.length ? Math.round(live.reduce((a, q) => a + q.durationMs, 0) / live.length) : 0,
        suppressedByRealData: this.suppressedMock.get(p.id) ?? 0,
        attribution: p.attribution,
      };
      if (!availability.enabled) return { ...base, status: "disabled" as const, reason: availability.reasonKey };
      if (qs.length === 0) {
        const modeRelevant = p.modes.some((m) => searchedModes.includes(m));
        const reason = !modeRelevant
          ? "provider.skipped.modeExcluded"
          : base.suppressedByRealData > 0
            ? "provider.skipped.realDataPreferred"
            : "provider.skipped.noSupportedPair";
        return { ...base, status: "skipped" as const, reason };
      }
      const has = (s: QueryTraceEntry["status"]) => qs.some((q) => q.status === s);
      const status = has("success") || has("cache_hit") ? "success" : has("blocked") ? "blocked" : has("timeout") && !has("error") ? "timeout" : has("error") ? "error" : "skipped";
      return { ...base, status, reason: status === "skipped" ? "provider.skipped.budget" : undefined };
    });
  }

  /** Plateformes connues mais non interrogées, pertinentes pour les modes recherchés. */
  declaredEntries(providers: readonly TransportProvider[], searchedModes: TransportMode[]): DeclaredSourceTraceEntry[] {
    // Une plateforme dont l'adapter existe (actif ou désactivé) apparaît déjà dans la liste des providers.
    const knownIds = new Set(providers.map((p) => p.id));
    return DECLARED_SOURCES.filter((s) => !(s.plannedProviderId && knownIds.has(s.plannedProviderId))).map((s) => ({
      id: s.id,
      name: s.name,
      modes: s.modes,
      status: s.modes.some((m) => searchedModes.includes(m)) ? s.status : "disabled",
      reasonKey: s.modes.some((m) => searchedModes.includes(m)) ? s.reasonKey : "source.reason.modeExcluded",
    }));
  }
}
