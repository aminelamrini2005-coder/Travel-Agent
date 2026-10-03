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
import { ProviderRegistry } from "../providers/registry";
import type { TransportProvider } from "../providers/types";

/** Providers de la phase 1 : mocks clairement identifiés + providers calculés (marche, taxi estimé). */
export function phase1Providers(catalog: HubCatalog): TransportProvider[] {
  return [
    new MockFlightProvider(catalog),
    new MockRailProvider(catalog),
    new MockCoachProvider(catalog),
    new MockRideshareProvider(catalog),
    new MockLocalTransitProvider(catalog),
    new WalkProvider(),
    new TaxiEstimateProvider(),
  ];
}

export function createRegistry(providers: TransportProvider[], cache: Cache = new MemoryCache(), rates: RateSource = new NoRateSource()) {
  return new ProviderRegistry(providers, cache, new CurrencyConverter(rates));
}
