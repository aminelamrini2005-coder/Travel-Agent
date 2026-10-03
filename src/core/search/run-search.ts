/**
 * Orchestrateur d'une recherche complète :
 * résolution des lieux → sélection des hubs → plan de requêtes → providers (parallèle) → moteur multimodal
 * → classement → AlternativeEngine → SearchTrace.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_ALTERNATIVE_THRESHOLDS, DEFAULT_RANKING_WEIGHTS, type AlternativeThresholds, type RankingWeights } from "../../config/ranking";
import { runAlternativeEngine } from "../alternatives/alternative-engine";
import { applyPatch } from "../conversation/apply-patch";
import { DEFAULT_ENGINE_LIMITS, runLabelSearch, type EngineLimits } from "../engine/label-search";
import { planQueries } from "../engine/query-planner";
import { walkLinks } from "../engine/walk-links";
import { DEFAULT_HUB_SELECTION, selectHubs, stripHub, type HubCatalog, type HubSelectionConfig } from "../location/hubs";
import type { LocationResolver } from "../location/resolver";
import type { ProviderRegistry } from "../providers/registry";
import type { ProviderLogger } from "../providers/types";
import { rankJourneys } from "../ranking/rank";
import { addMinutesIso, localToUtcIso, toEpochMs } from "../time";
import { TraceRecorder } from "../trace/recorder";
import type { HubConsideration, Journey, Place, QueryTraceEntry, SearchParams, SearchResult, SearchVariant, TransportSegment } from "../types";

export interface SearchDeps {
  registry: ProviderRegistry;
  catalog: HubCatalog;
  resolver: LocationResolver;
  logger: ProviderLogger;
  now?: () => Date;
  engineLimits?: EngineLimits;
  hubSelection?: HubSelectionConfig;
  rankingWeights?: RankingWeights;
  alternativeThresholds?: AlternativeThresholds;
  /** Désactive l'AlternativeEngine (tests unitaires ciblés). */
  disableAlternatives?: boolean;
}

/** Marge ajoutée après l'heure d'arrivée max pour que les variantes « arriver un peu plus tard » réutilisent les mêmes données. */
const WINDOW_EXTENSION_MIN = 180;
const DEFAULT_HORIZON_MIN = 24 * 60;

interface CoreRun {
  journeys: Journey[];
  segments: TransportSegment[];
  queries: QueryTraceEntry[];
  suppressed: Map<string, number>;
  providerCalls: number;
  trunkPairs: { from: Place; to: Place }[];
  modes: SearchParams["excludedModes"];
}

function timeBounds(params: SearchParams, origin: Place, destination: Place) {
  const earliest = localToUtcIso(params.earliestDeparture, origin.timezone);
  const latest = params.latestArrival ? localToUtcIso(params.latestArrival, destination.timezone) : undefined;
  return { earliest, latest };
}

function engineConstraints(params: SearchParams, origin: Place, destination: Place) {
  const { earliest, latest } = timeBounds(params, origin, destination);
  return {
    originId: origin.id,
    destinationId: destination.id,
    earliestDepartureMs: toEpochMs(earliest),
    latestArrivalMs: latest ? toEpochMs(latest) : undefined,
    maxBudgetMinor: params.maxBudget !== undefined ? Math.round(params.maxBudget * 100) : undefined,
    maxTransfers: params.maxTransfers,
    excludedModes: new Set(params.excludedModes),
    includedModes: params.includedModes ? new Set(params.includedModes) : undefined,
    connection: { luggage: params.luggage, userMinBufferMinutes: params.minConnectionBufferMinutes },
    currency: params.currency,
  };
}

export async function runSearch(params: SearchParams, deps: SearchDeps): Promise<SearchResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const t0 = Date.now();
  const searchId = randomUUID();
  const trace = new TraceRecorder();
  const callBudget = new Map<string, number>();
  const limits = deps.engineLimits ?? DEFAULT_ENGINE_LIMITS;
  const weights = deps.rankingWeights ?? DEFAULT_RANKING_WEIGHTS;
  const thresholds = deps.alternativeThresholds ?? DEFAULT_ALTERNATIVE_THRESHOLDS;

  deps.logger.info({ event: "search.started", searchId, objective: params.objective, modesExcluded: params.excludedModes }, "search started");

  const [o, d] = await Promise.all([deps.resolver.resolve(params.origin), deps.resolver.resolve(params.destination)]);
  const origin = o.place;
  const destination = d.place;
  const { earliest, latest } = timeBounds(params, origin, destination);

  const hubCfg = deps.hubSelection ?? DEFAULT_HUB_SELECTION;
  const originSel = selectHubs(origin, deps.catalog, hubCfg);
  const destSel = selectHubs(destination, deps.catalog, hubCfg);

  /** Recherche « cœur » : plan → providers → moteur. Réutilisée par la recherche principale et les variantes. */
  const core = async (p: SearchParams, originHubs: Place[], destHubs: Place[], phase: QueryTraceEntry["phase"]): Promise<CoreRun> => {
    const tb = timeBounds(p, origin, destination);
    const windowEnd = tb.latest ? addMinutesIso(tb.latest, WINDOW_EXTENSION_MIN) : addMinutesIso(tb.earliest, DEFAULT_HORIZON_MIN);
    const plan = planQueries({ origin, destination, originHubs, destinationHubs: destHubs, windowStart: tb.earliest, windowEnd, params: p });
    const exec = await deps.registry.execute(plan.queries, { phase, logger: deps.logger, now, callBudget });
    // Liaisons piétonnes entre les arrêts réels renvoyés par les sources et les nœuds du plan.
    const planNodes = [origin, destination, ...originHubs, ...destHubs];
    const links = walkLinks(exec.segments, planNodes, { windowStart: tb.earliest, currency: p.currency, checkedAt: now().toISOString() });
    const segments = [...exec.segments, ...links];
    const engine = runLabelSearch(segments, engineConstraints(p, origin, destination), limits);
    trace.labelsExplored += engine.labelsExplored;
    trace.engineDurationMs += engine.durationMs;
    if (phase === "primary") {
      trace.addRejections(engine.rejectionCounts, engine.rejectionSamples);
      trace.segmentsCollected = exec.segments.length;
    }
    return { journeys: engine.journeys, segments, queries: exec.queries, suppressed: exec.suppressedMock, providerCalls: exec.providerCalls, trunkPairs: plan.trunkPairs, modes: plan.modes };
  };

  // --- Recherche principale ---
  const primaryOriginHubs = originSel.primary.map((c) => stripHub(c.hub));
  const primaryDestHubs = destSel.primary.map((c) => stripHub(c.hub));
  const primary = await core(params, primaryOriginHubs, primaryDestHubs, "primary");
  trace.addQueries(primary.queries, primary.suppressed);
  recordPatterns(trace, origin, destination, primary.trunkPairs, primary.queries);

  const ranking = rankJourneys(primary.journeys, params.objective, params.currency, weights, params.valueOfTimePerHour);
  const reference = ranking.entries.length ? primary.journeys.find((j) => j.id === ranking.entries[0]!.journeyId) ?? null : null;

  // --- Alternatives ---
  let alternatives: SearchResult["alternatives"] = [];
  const usedAltHubs = new Set<string>();
  if (!deps.disableAlternatives) {
    const shown = new Set(ranking.entries.map((e) => primary.journeys.find((j) => j.id === e.journeyId)!.signature));
    const runner = async (v: SearchVariant) => {
      const patched = applyPatch(params, v.modifiedConstraints, params.earliestDeparture).params!;
      const phase = `alternative:${v.type}` as const;
      if (!v.requiresProviderCalls) {
        // Réutilise les segments réellement récupérés par la recherche principale.
        const engine = runLabelSearch(primary.segments, engineConstraints(patched, origin, destination), limits);
        trace.labelsExplored += engine.labelsExplored;
        return { journeys: engine.journeys, providerCalls: 0 };
      }
      const extraO = (v.extraOriginHubIds ?? []).map((id) => deps.catalog.getHub(id)).filter((h) => !!h).map(stripHub);
      const extraD = (v.extraDestinationHubIds ?? []).map((id) => deps.catalog.getHub(id)).filter((h) => !!h).map(stripHub);
      extraO.concat(extraD).forEach((h) => usedAltHubs.add(h.id));
      const r = await core(patched, [...primaryOriginHubs, ...extraO], [...primaryDestHubs, ...extraD], phase);
      trace.addQueries(r.queries, r.suppressed);
      recordPatterns(trace, origin, destination, r.trunkPairs, r.queries);
      return { journeys: r.journeys, providerCalls: r.providerCalls };
    };
    const altOut = await runAlternativeEngine(
      {
        params,
        origin,
        destination,
        earliestDepartureUtc: earliest,
        latestArrivalUtc: latest,
        reference,
        shownSignatures: shown,
        originPositioning: originSel.positioning,
        destinationPositioning: destSel.positioning,
        rejectionCounts: trace.rejectionCounts,
      },
      runner,
      thresholds,
      weights,
    );
    alternatives = altOut.alternatives;
    trace.alternativeSearches.push(...altOut.traces);
  }

  // --- Trace ---
  const hubs: HubConsideration[] = [];
  const pushHubs = (side: "origin" | "destination", sel: ReturnType<typeof selectHubs>) => {
    for (const c of sel.primary) hubs.push({ place: stripHub(c.hub), side, accessMinutesEstimate: c.accessMinutes, distanceKm: Math.round(c.distanceKm * 10) / 10, selected: true, usage: "primary", reasonKey: "hub.reason.primary" });
    for (const c of sel.positioning) {
      const used = usedAltHubs.has(c.hub.id);
      hubs.push({ place: stripHub(c.hub), side, accessMinutesEstimate: c.accessMinutes, distanceKm: Math.round(c.distanceKm * 10) / 10, selected: used, usage: used ? "alternative" : "not_used", reasonKey: used ? "hub.reason.alternative" : "hub.reason.positioningNotTested" });
    }
    for (const c of sel.discarded.slice(0, 8)) hubs.push({ place: stripHub(c.hub), side, accessMinutesEstimate: c.accessMinutes, distanceKm: Math.round(c.distanceKm * 10) / 10, selected: false, usage: "not_used", reasonKey: "hub.reason.lowPriority" });
  };
  pushHubs("origin", originSel);
  pushHubs("destination", destSel);

  const providers = deps.registry.list();
  const journeys = ranking.ordered.slice(0, 25);
  const completedAt = now();
  const result: SearchResult = {
    searchId,
    createdAt: completedAt.toISOString(),
    params,
    origin,
    destination,
    journeys,
    ranking: ranking.entries,
    alternatives,
    containsMockData: journeys.some((j) => j.containsMockData) || alternatives.some((a) => a.journey.containsMockData),
    emptyReasonKey: journeys.length === 0 ? emptyReason(trace) : undefined,
    trace: {
      searchId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      interpretedParams: params,
      resolvedOrigin: origin,
      resolvedDestination: destination,
      earliestDepartureUtc: earliest,
      latestArrivalUtc: latest,
      hubs,
      providers: trace.providerEntries(providers, primary.modes, deps.registry.policy),
      declaredSources: trace.declaredEntries(providers, primary.modes),
      queries: trace.queries,
      routePatternsTested: [...trace.routePatterns].slice(0, 40),
      modesSearched: primary.modes,
      modesExcludedByUser: params.excludedModes,
      rejectionCounts: trace.rejectionCounts,
      rejectionSamples: trace.rejectionSamples,
      segmentsCollected: trace.segmentsCollected,
      labelsExplored: trace.labelsExplored,
      journeysGenerated: primary.journeys.length,
      paretoSize: primary.journeys.length,
      alternativeSearches: trace.alternativeSearches,
      engineDurationMs: trace.engineDurationMs,
      totalDurationMs: Date.now() - t0,
    },
  };
  deps.logger.info(
    {
      event: "search.completed",
      searchId,
      journeys: journeys.length,
      alternatives: alternatives.length,
      queries: trace.queries.length,
      segments: trace.segmentsCollected,
      durationMs: result.trace.totalDurationMs,
    },
    "search completed",
  );
  return result;
}

/** Enregistre les patrons de route correspondant à des paires « tronc » réellement interrogées. */
function recordPatterns(trace: TraceRecorder, origin: Place, destination: Place, pairs: { from: Place; to: Place }[], queries: QueryTraceEntry[]) {
  const queried = new Set(queries.filter((q) => q.status !== "skipped_budget").map((q) => `${q.fromId}>${q.toId}`));
  for (const { from, to } of pairs) {
    if (!queried.has(`${from.id}>${to.id}`)) continue;
    const names = [origin.name, from.name, to.name, destination.name].filter((n, i, a) => i === 0 || n !== a[i - 1]);
    trace.routePatterns.add(names.join(" → "));
  }
}

function emptyReason(trace: TraceRecorder): string {
  const ok = trace.queries.some((q) => q.status === "success" || q.status === "cache_hit");
  if (!ok) return "empty.noProviderData";
  if ((trace.rejectionCounts.over_budget ?? 0) > 0) return "empty.overBudget";
  if ((trace.rejectionCounts.arrives_too_late ?? 0) > 0) return "empty.tooLate";
  if ((trace.rejectionCounts.connection_too_short ?? 0) > 0) return "empty.connections";
  return "empty.noRoute";
}
