import "server-only";
import { MemoryCache, type Cache } from "@/core/cache";
import { HubCatalog } from "@/core/location/hubs";
import { LocationResolver, NominatimGeocoder, type Geocoder } from "@/core/location/resolver";
import { EcbRateSource, NoRateSource } from "@/core/money";
import { TaxiEstimateProvider, WalkProvider } from "@/core/providers/computed/computed-providers";
import type { TransportProvider } from "@/core/providers/types";
import { createRegistry, phase1Providers } from "@/core/search/default-providers";
import type { SearchDeps } from "@/core/search/run-search";
import { RedisCache } from "./cache/redis-cache";
import { MemoryStore } from "./db/memory-store";
import { PrismaStore } from "./db/prisma-store";
import type { Store } from "./db/store";
import { env } from "./env";
import {
  AnthropicIntentExtractor,
  FallbackIntentExtractor,
  OpenAIIntentExtractor,
  type IntentExtractor,
} from "./llm/intent";
import { logger } from "./logger";
import { RateLimiter } from "./rate-limit";

export interface Container {
  deps: SearchDeps;
  store: Store;
  extractor: IntentExtractor;
  llmEnabled: boolean;
  rateLimiter: RateLimiter;
  cacheKind: "redis" | "memory";
  timezone: string;
}

let container: Container | undefined;

/** Assemble les dépendances serveur une seule fois par processus. */
export function getContainer(): Container {
  if (container) return container;
  const e = env();
  const catalog = new HubCatalog();

  const geocoders: Geocoder[] = [];
  if (e.NOMINATIM_CONTACT_EMAIL) geocoders.push(new NominatimGeocoder(`TravelAgentAI/0.1 (${e.NOMINATIM_CONTACT_EMAIL})`));

  const redis = e.REDIS_URL ? new RedisCache(e.REDIS_URL) : undefined;
  const cache: Cache = redis ?? new MemoryCache();

  // Phase 1 : mocks clairement identifiés + estimations calculées. Les vraies sources s'ajouteront ici.
  const providers: TransportProvider[] = e.USE_MOCK_PROVIDERS ? phase1Providers(catalog) : [new WalkProvider(), new TaxiEstimateProvider()];
  const registry = createRegistry(providers, cache, e.ENABLE_ECB_RATES ? new EcbRateSource() : new NoRateSource());

  let primary: IntentExtractor | null = null;
  const wantAnthropic = e.LLM_PROVIDER === "anthropic" || (e.LLM_PROVIDER === "auto" && !!e.ANTHROPIC_API_KEY);
  const wantOpenAI = e.LLM_PROVIDER === "openai" || (e.LLM_PROVIDER === "auto" && !e.ANTHROPIC_API_KEY && !!e.OPENAI_API_KEY);
  if (wantAnthropic && e.ANTHROPIC_API_KEY) primary = new AnthropicIntentExtractor(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL);
  else if (wantOpenAI && e.OPENAI_API_KEY && e.OPENAI_MODEL) primary = new OpenAIIntentExtractor(e.OPENAI_API_KEY, e.OPENAI_MODEL);
  const extractor = new FallbackIntentExtractor(primary, undefined, (err) =>
    logger.warn({ event: "llm.error", error: err instanceof Error ? err.message : String(err) }, "LLM extraction failed, using rule parser"),
  );

  container = {
    deps: { registry, catalog, resolver: new LocationResolver(catalog, geocoders, e.USER_TIMEZONE), logger },
    store: e.DATABASE_URL ? new PrismaStore(e.DATABASE_URL) : new MemoryStore(),
    extractor,
    llmEnabled: primary !== null,
    rateLimiter: new RateLimiter(e.RATE_LIMIT_PER_MINUTE, redis),
    cacheKind: redis ? "redis" : "memory",
    timezone: e.USER_TIMEZONE,
  };
  logger.info(
    { event: "container.ready", store: container.store.kind, cache: container.cacheKind, llm: extractor.id, providers: providers.map((p) => p.id) },
    "container ready",
  );
  return container;
}
