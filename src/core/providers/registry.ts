import type { Cache } from "../cache";
import { NoCache } from "../cache";
import { haversineKm } from "../location/geo";
import type { CurrencyConverter } from "../money";
import { toEpochMs } from "../time";
import { TransportSegmentSchema, type QueryTraceEntry, type TransportSegment } from "../types";
import {
  ProviderBlockedError,
  ProviderTimeoutError,
  type ProviderContext,
  type ProviderLogger,
  type SegmentQuery,
  type TransportProvider,
} from "./types";

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
}

/** Distance sous laquelle un lieu renvoyé par un provider est assimilé au lieu demandé. */
const SNAP_KM = 1.0;

export class ProviderRegistry {
  constructor(
    private readonly providers: TransportProvider[],
    private readonly cache: Cache = new NoCache(),
    private readonly converter?: CurrencyConverter,
  ) {}

  list(): readonly TransportProvider[] {
    return this.providers;
  }

  enabledProviders(): TransportProvider[] {
    return this.providers.filter((p) => p.availability().enabled);
  }

  /**
   * Exécute un lot de requêtes : chaque (requête × provider compatible) est un appel indépendant.
   * Tout est lancé en parallèle (Promise.allSettled) avec timeout ; un provider en échec n'interrompt jamais les autres.
   */
  async execute(queries: SegmentQuery[], opts: ExecuteOptions): Promise<ExecuteResult> {
    const now = opts.now ?? (() => new Date());
    const budget = opts.callBudget ?? new Map<string, number>();
    const tasks: { provider: TransportProvider; query: SegmentQuery }[] = [];
    const traces: QueryTraceEntry[] = [];

    for (const query of queries) {
      for (const provider of this.enabledProviders()) {
        const modes = query.modes.filter((m) => provider.modes.includes(m));
        if (modes.length === 0) continue;
        const q: SegmentQuery = { ...query, modes };
        if (!provider.supports(q)) continue;
        tasks.push({ provider, query: q });
      }
    }

    const limiters = new Map<string, Limiter>();
    const results = await Promise.allSettled(
      tasks.map(async ({ provider, query }) => {
        const key = cacheKey(provider, query);
        const started = Date.now();
        const cached = provider.cacheTtlSeconds > 0 ? await this.cache.get<TransportSegment[]>(key) : undefined;
        if (cached) {
          traces.push(trace(provider, query, opts.phase, "cache_hit", cached.length, Date.now() - started));
          return { segments: cached, called: false };
        }
        const used = budget.get(provider.id) ?? 0;
        if (used >= provider.maxCallsPerSearch) {
          traces.push(trace(provider, query, opts.phase, "skipped_budget", 0, 0));
          return { segments: [] as TransportSegment[], called: false };
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
          traces.push(trace(provider, query, opts.phase, "success", valid.length, Date.now() - started));
          opts.logger.info(
            { event: "provider.call", provider: provider.id, durationMs: Date.now() - started, results: valid.length, invalid },
            "provider call",
          );
          return { segments: valid, called: true, invalid };
        } catch (err) {
          const status = err instanceof ProviderTimeoutError ? "timeout" : err instanceof ProviderBlockedError ? "blocked" : "error";
          const message = err instanceof Error ? err.message : String(err);
          traces.push(trace(provider, query, opts.phase, status, 0, Date.now() - started, message));
          opts.logger.warn({ event: "provider.error", provider: provider.id, status, error: message }, "provider error");
          throw err;
        }
      }),
    );

    const segments: TransportSegment[] = [];
    let providerCalls = 0;
    let invalidSegments = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        segments.push(...r.value.segments);
        if (r.value.called) providerCalls++;
        invalidSegments += r.value.invalid ?? 0;
      } else {
        providerCalls++;
      }
    }
    return { segments, queries: traces, providerCalls, invalidSegments };
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
  resultCount: number,
  durationMs: number,
  error?: string,
): QueryTraceEntry {
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
    resultCount,
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
