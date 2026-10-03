import { MemoryCache, type Cache } from "../cache";
import type { HubCatalog } from "../location/hubs";
import { CurrencyConverter, NoRateSource, type RateSource } from "../money";
import { TaxiEstimateProvider, WalkProvider } from "../providers/computed/computed-providers";
import {
  MockCoachProvider,
  MockFlightProvider,
  MockLocalTransitProvider,
  MockRailProvider,
  MockRideshareProvider,
} from "../providers/mock/mock-providers";
import { ProviderRegistry, type MockPolicy } from "../providers/registry";
import type { TransportProvider } from "../providers/types";

/** Providers fictifs (démonstration) — utilisés en repli uniquement selon la politique MOCK_POLICY. */
export function phase1Providers(catalog: HubCatalog): TransportProvider[] {
  return [
    new MockFlightProvider(catalog),
    new MockRailProvider(catalog),
    new MockCoachProvider(catalog),
    new MockRideshareProvider(catalog),
    new MockLocalTransitProvider(catalog),
  ];
}

/** Mocks + estimations calculées (tests et développement hors ligne). */
export function offlineProviders(catalog: HubCatalog): TransportProvider[] {
  return [...phase1Providers(catalog), new WalkProvider(), new TaxiEstimateProvider()];
}

export function createRegistry(
  providers: TransportProvider[],
  cache: Cache = new MemoryCache(),
  rates: RateSource = new NoRateSource(),
  mockPolicy: MockPolicy = "fallback",
) {
  return new ProviderRegistry(providers, cache, new CurrencyConverter(rates), mockPolicy);
}
