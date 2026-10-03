import "server-only";
import { MemoryCache, type Cache } from "@/core/cache";
import { HubCatalog } from "@/core/location/hubs";
import { LocationResolver, NominatimGeocoder, type Geocoder } from "@/core/location/resolver";
import { EcbRateSource, NoRateSource } from "@/core/money";
import type { TransportProvider } from "@/core/providers/types";
import { createRegistry } from "@/core/search/default-providers";
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
import { buildIntegrations, type Integration } from "./integrations";
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
  integrations: Integration[];
}

let container: Container | undefined;

/** Assemble les dépendances serveur une seule fois par processus. */
export function getContainer(): Container {
  if (container) return container;
  const e = env();
  const catalog = new HubCatalog();

  const redis = e.REDIS_URL ? new RedisCache(e.REDIS_URL) : undefined;
  const cache: Cache = redis ?? new MemoryCache();

  const geocoders: Geocoder[] = [];
  if (e.NOMINATIM_ENABLED) {
    const ua = e.NOMINATIM_USER_AGENT ?? `TravelAgentAI/0.2 (${e.NOMINATIM_CONTACT_EMAIL ?? "https://github.com/aminelamrini2005-coder/Travel-Agent"})`;
    geocoders.push(new NominatimGeocoder({ userAgent: ua, email: e.NOMINATIM_CONTACT_EMAIL, cache, countryCodes: "fr,es,it,mc,ch,be,de,pt,ad,gb,nl,lu,at" }));
  }

  const integrations = buildIntegrations(e, catalog);
  const providers: TransportProvider[] = integrations.flatMap((i) => i.providers);
  const mockPolicy = e.USE_MOCK_PROVIDERS ? e.MOCK_POLICY : "off";
  const registry = createRegistry(providers, cache, e.ENABLE_ECB_RATES ? new EcbRateSource() : new NoRateSource(), mockPolicy);

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
    integrations,
  };
  logger.info(
    {
      event: "container.ready",
      store: container.store.kind,
      cache: container.cacheKind,
      llm: extractor.id,
      mockPolicy,
      integrations: integrations.map((i) => `${i.id}:${i.status}`),
    },
    "container ready",
  );
  return container;
}
