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
  rejectionCounts: Partial<Record<RejectionReason, number>> = {};
  rejectionSamples: RejectionSample[] = [];
  segmentsCollected = 0;
  labelsExplored = 0;
  journeysGenerated = 0;
  engineDurationMs = 0;

  addQueries(q: QueryTraceEntry[]) {
    this.queries.push(...q);
  }

  addRejections(counts: Partial<Record<RejectionReason, number>>, samples: RejectionSample[]) {
    for (const [k, v] of Object.entries(counts) as [RejectionReason, number][]) {
      this.rejectionCounts[k] = (this.rejectionCounts[k] ?? 0) + v;
    }
    for (const s of samples) if (this.rejectionSamples.length < 60) this.rejectionSamples.push(s);
  }

  /** Agrège l'état de chaque provider à partir des requêtes réellement effectuées. */
  providerEntries(providers: readonly TransportProvider[], searchedModes: TransportMode[]): ProviderTraceEntry[] {
    return providers.map((p) => {
      const qs = this.queries.filter((q) => q.providerId === p.id);
      const availability = p.availability();
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
      };
      if (!availability.enabled) return { ...base, status: "disabled" as const, reason: availability.reasonKey };
      if (qs.length === 0) {
        const modeRelevant = p.modes.some((m) => searchedModes.includes(m));
        return { ...base, status: "skipped" as const, reason: modeRelevant ? "provider.skipped.noSupportedPair" : "provider.skipped.modeExcluded" };
      }
      const has = (s: QueryTraceEntry["status"]) => qs.some((q) => q.status === s);
      const status = has("success") || has("cache_hit") ? "success" : has("blocked") ? "blocked" : has("timeout") && !has("error") ? "timeout" : has("error") ? "error" : "skipped";
      return { ...base, status, reason: status === "skipped" ? "provider.skipped.budget" : undefined };
    });
  }

  /** Plateformes connues mais non interrogées, pertinentes pour les modes recherchés. */
  declaredEntries(providers: readonly TransportProvider[], searchedModes: TransportMode[]): DeclaredSourceTraceEntry[] {
    const enabledIds = new Set(providers.filter((p) => p.availability().enabled).map((p) => p.id));
    return DECLARED_SOURCES.filter((s) => !(s.plannedProviderId && enabledIds.has(s.plannedProviderId))).map((s) => ({
      id: s.id,
      name: s.name,
      modes: s.modes,
      status: s.modes.some((m) => searchedModes.includes(m)) ? s.status : "disabled",
      reasonKey: s.modes.some((m) => searchedModes.includes(m)) ? s.reasonKey : "source.reason.modeExcluded",
    }));
  }
}
