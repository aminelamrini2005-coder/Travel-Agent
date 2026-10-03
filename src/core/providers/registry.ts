import type { Cache } from "../cache";
import { NoCache } from "../cache";
import { haversineKm } from "../location/geo";
import type { CurrencyConverter } from "../money";
import { toEpochMs } from "../time";
import {
  MODE_CATEGORY,
  TransportSegmentSchema,
  type ModeCategory,
  type QueryTraceEntry,
  type TransportMode,
  type TransportSegment,
} from "../types";
import {
  ProviderBlockedError,
  ProviderTimeoutError,
  type ProviderContext,
  type ProviderLogger,
  type SegmentQuery,
  type TransportProvider,
} from "./types";

/**
 * Politique vis-à-vis des providers fictifs :
 *  - "fallback" (défaut) : un provider mock n'est interrogé, pour une paire donnée, que sur les familles de modes
 *    pour lesquelles AUCUNE source réelle n'a renvoyé de résultat sur cette paire ;
 *  - "off" : jamais de mock ;
 *  - "all" : mocks toujours interrogés (développement).
 */
export type MockPolicy = "fallback" | "off" | "all";

/** Familles de couverture : une donnée réelle d'une famille rend inutile le mock de la même famille. */
const COVERAGE_FAMILY: Record<ModeCategory, string> = {
  FLIGHT: "air",
  RAIL: "rail",
  COACH: "road_public",
  LOCAL: "road_public",
  RIDESHARE: "rideshare",
  FERRY: "sea",
  FLEX: "flex",
};
const familyOf = (m: TransportMode) => COVERAGE_FAMILY[MODE_CATEGORY[m]];

export interface ExecuteOptions {
  phase: QueryTraceEntry["phase"];
  logger: ProviderLogger;
  now?: () => Date;
  /** Compteur d'appels partagé entre recherche principale et alternatives (budget par provider). */
  callBudget?: Map<string, number>;
}

export interface ExecuteResult {
  segments: TransportSegment[];
  queries: QueryTraceEntry[];
  /** Nombre d'appels réseau réels (hors cache). */
  providerCalls: number;
  invalidSegments: number;
  /** providerId → nombre de requêtes où le mock a été écarté au profit de données réelles. */
  suppressedMock: Map<string, number>;
}

/** Distance sous laquelle un lieu renvoyé par un provider est assimilé au lieu demandé (même point). */
const SNAP_KM = 0.15;

interface Task {
  provider: TransportProvider;
  query: SegmentQuery;
  queryIndex: number;
}

export class ProviderRegistry {
  constructor(
    private readonly providers: TransportProvider[],
    private readonly cache: Cache = new NoCache(),
    private readonly converter?: CurrencyConverter,
    private readonly mockPolicy: MockPolicy = "fallback",
  ) {}

  list(): readonly TransportProvider[] {
    return this.providers;
  }

  get policy(): MockPolicy {
    return this.mockPolicy;
  }

  enabledProviders(): TransportProvider[] {
    return this.providers.filter((p) => p.availability().enabled && !(p.isMock && this.mockPolicy === "off"));
  }

  private tasksFor(queries: SegmentQuery[], providers: TransportProvider[], allowed?: (qi: number, modes: TransportMode[]) => TransportMode[]): Task[] {
    const tasks: Task[] = [];
    queries.forEach((query, queryIndex) => {
      for (const provider of providers) {
        let modes = query.modes.filter((m) => provider.modes.includes(m));
        if (allowed) modes = allowed(queryIndex, modes);
        if (modes.length === 0) continue;
        const q: SegmentQuery = { ...query, modes };
        if (!provider.supports(q)) continue;
        tasks.push({ provider, query: q, queryIndex });
      }
    });
    return tasks;
  }

  /**
   * Exécute un lot de requêtes. Phase 1 : sources réelles (en parallèle). Phase 2 : providers fictifs,
   * uniquement là où aucune donnée réelle n'existe (politique "fallback").
   * Un provider en échec n'interrompt jamais les autres (Promise.allSettled + timeout).
   */
  async execute(queries: SegmentQuery[], opts: ExecuteOptions): Promise<ExecuteResult> {
    const enabled = this.enabledProviders();
    const real = enabled.filter((p) => !p.isMock);
    const mocks = enabled.filter((p) => p.isMock);
    const traces: QueryTraceEntry[] = [];
    const out: ExecuteResult = { segments: [], queries: traces, providerCalls: 0, invalidSegments: 0, suppressedMock: new Map() };

    const realTasks = this.tasksFor(queries, real);
    const realResults = await this.runTasks(realTasks, opts, traces, out);

    // Familles couvertes par des données réelles, par requête.
    const covered = new Map<number, Set<string>>();
    realTasks.forEach((t, i) => {
      const segs = realResults[i] ?? [];
      if (segs.length === 0) return;
      const set = covered.get(t.queryIndex) ?? new Set<string>();
      for (const s of segs) set.add(familyOf(s.mode));
      covered.set(t.queryIndex, set);
    });

    const mockTasks = this.tasksFor(queries, mocks, (qi, modes) => {
      if (this.mockPolicy !== "fallback") return modes;
      const fams = covered.get(qi);
      if (!fams) return modes;
      const kept = modes.filter((m) => !fams.has(familyOf(m)));
      return kept;
    });
    if (this.mockPolicy === "fallback") {
      // Comptage des suppressions (pour la trace).
      queries.forEach((query, qi) => {
        const fams = covered.get(qi);
        if (!fams) return;
        for (const p of mocks) {
          const modes = query.modes.filter((m) => p.modes.includes(m));
          if (modes.length && modes.every((m) => fams.has(familyOf(m))) && p.supports({ ...query, modes })) {
            out.suppressedMock.set(p.id, (out.suppressedMock.get(p.id) ?? 0) + 1);
          }
        }
      });
    }
    await this.runTasks(mockTasks, opts, traces, out);
    return out;
  }

  private async runTasks(tasks: Task[], opts: ExecuteOptions, traces: QueryTraceEntry[], out: ExecuteResult): Promise<(TransportSegment[] | undefined)[]> {
    const now = opts.now ?? (() => new Date());
    const budget = opts.callBudget ?? new Map<string, number>();
    const limiters = new Map<string, Limiter>();
    const results = await Promise.allSettled(
      tasks.map(async ({ provider, query }) => {
        const key = cacheKey(provider, query);
        const started = Date.now();
        const cached = provider.cacheTtlSeconds > 0 ? await this.cache.get<TransportSegment[]>(key) : undefined;
        if (cached) {
          traces.push(trace(provider, query, opts.phase, "cache_hit", cached, Date.now() - started));
          return { segments: cached, called: false, invalid: 0 };
        }
        const used = budget.get(provider.id) ?? 0;
        if (used >= provider.maxCallsPerSearch) {
          traces.push(trace(provider, query, opts.phase, "skipped_budget", [], 0));
          return { segments: [] as TransportSegment[], called: false, invalid: 0 };
        }
        budget.set(provider.id, used + 1);

        let limiter = limiters.get(provider.id);
        if (!limiter) {
          limiter = new Limiter(provider.maxConcurrency);
          limiters.set(provider.id, limiter);
        }
        try {
          const raw = await limiter.run(() => callWithTimeout(provider, query, opts.logger, now));
          const { valid, invalid } = await this.normalize(provider, query, raw);
          if (provider.cacheTtlSeconds > 0) await this.cache.set(key, valid, provider.cacheTtlSeconds);
          traces.push(trace(provider, query, opts.phase, "success", valid, Date.now() - started));
          opts.logger.info(
            { event: "provider.call", provider: provider.id, accessMethod: provider.accessMethod, durationMs: Date.now() - started, results: valid.length, invalid },
            "provider call",
          );
          return { segments: valid, called: true, invalid };
        } catch (err) {
          const status = err instanceof ProviderTimeoutError ? "timeout" : err instanceof ProviderBlockedError ? "blocked" : "error";
          const message = err instanceof Error ? err.message : String(err);
          traces.push(trace(provider, query, opts.phase, status, [], Date.now() - started, message));
          opts.logger.warn({ event: "provider.error", provider: provider.id, status, error: message }, "provider error");
          throw err;
        }
      }),
    );
    return results.map((r) => {
      if (r.status === "fulfilled") {
        out.segments.push(...r.value.segments);
        if (r.value.called) out.providerCalls++;
        out.invalidSegments += r.value.invalid;
        return r.value.segments;
      }
      out.providerCalls++;
      return undefined;
    });
  }

  /**
   * Validation et normalisation des segments renvoyés :
   *  - schéma Zod (les segments invalides sont écartés et comptés) ;
   *  - provenance forcée (provider, accessMethod, isMock) — un provider ne peut pas se déclarer « réel » s'il est mock ;
   *  - rattachement des lieux proches aux lieux demandés (pour relier les segments dans le graphe) ;
   *  - filtrage des modes et de la fenêtre ; conversion de devise sans taux inventé.
   */
  private async normalize(provider: TransportProvider, query: SegmentQuery, raw: unknown[]) {
    const valid: TransportSegment[] = [];
    let invalid = 0;
    const ws = toEpochMs(query.windowStart);
    const we = toEpochMs(query.windowEnd);
    for (const item of raw) {
      const parsed = TransportSegmentSchema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      const s: TransportSegment = { ...parsed.data, provider: provider.id, accessMethod: provider.accessMethod, isMock: provider.isMock || parsed.data.isMock };
      if (!query.modes.includes(s.mode)) continue;
      if (toEpochMs(s.arrivalTime) < toEpochMs(s.departureTime)) {
        invalid++;
        continue;
      }
      if (!s.flexibleDeparture) {
        const dep = toEpochMs(s.departureTime);
        if (dep < ws || dep > we) continue;
      }
      if (haversineKm(s.origin, query.origin) <= SNAP_KM) s.origin = query.origin;
      if (haversineKm(s.destination, query.destination) <= SNAP_KM) s.destination = query.destination;
      if (s.price && s.price.currency !== query.currency) {
        const converted = this.converter ? await this.converter.convert(s.price, query.currency) : null;
        if (converted) {
          s.price = converted;
          s.priceRange = undefined;
        } else {
          s.price = null;
          s.priceRange = undefined;
          s.priceConfidence = "UNKNOWN";
          s.notes = [...(s.notes ?? []), "segment.note.currencyNotConvertible"];
        }
      }
      valid.push(s);
    }
    return { valid, invalid };
  }
}

function cacheKey(p: TransportProvider, q: SegmentQuery): string {
  const round = (iso: string) => Math.floor(toEpochMs(iso) / 900_000); // 15 min
  return ["seg", p.id, q.origin.id, q.destination.id, round(q.windowStart), round(q.windowEnd), [...q.modes].sort().join("+"), q.passengers, q.currency].join("|");
}

function trace(
  p: TransportProvider,
  q: SegmentQuery,
  phase: QueryTraceEntry["phase"],
  status: QueryTraceEntry["status"],
  segments: TransportSegment[],
  durationMs: number,
  error?: string,
): QueryTraceEntry {
  const asOf = segments.map((s) => s.dataAsOf ?? s.checkedAt).sort()[0];
  return {
    providerId: p.id,
    accessMethod: p.accessMethod,
    modes: q.modes,
    fromId: q.origin.id,
    fromName: q.origin.name,
    toId: q.destination.id,
    toName: q.destination.name,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
    status,
    resultCount: segments.length,
    // Un prix fictif (mock) n'est pas un prix : il n'est jamais compté comme « prix disponible ».
    pricedCount: segments.filter((s) => !s.isMock && s.price !== null && s.priceConfidence !== "UNKNOWN").length,
    dataAsOf: asOf,
    durationMs,
    error,
    phase,
  };
}

async function callWithTimeout(p: TransportProvider, q: SegmentQuery, logger: ProviderLogger, now: () => Date): Promise<unknown[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ctx: ProviderContext = { signal: controller.signal, logger, now };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError(p.id, p.timeoutMs));
    }, p.timeoutMs);
  });
  try {
    const out = await Promise.race([p.search(q, ctx), timeout]);
    if (!Array.isArray(out)) throw new Error(`${p.id} : réponse invalide (tableau attendu)`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Limiteur de concurrence minimal. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
