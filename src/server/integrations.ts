import "server-only";
import path from "node:path";
import type { HubCatalog } from "@/core/location/hubs";
import { DuffelProvider } from "@/core/providers/api/duffel";
import { SncfProvider } from "@/core/providers/api/sncf";
import { TransitousProvider } from "@/core/providers/api/transitous";
import { TaxiEstimateProvider, WalkProvider } from "@/core/providers/computed/computed-providers";
import { createGtfsProviders } from "@/core/providers/gtfs/gtfs-loader";
import { phase1Providers } from "@/core/search/default-providers";
import type { AccessMethod } from "@/core/types";
import type { TransportProvider } from "@/core/providers/types";
import type { Env } from "./env";

/**
 * Registre des intégrations. Ajouter une source = ajouter une entrée ici (et son adapter dans
 * src/core/providers/…) : le moteur, le classement, les alternatives et la trace n'ont pas à changer.
 */
export interface Integration {
  id: string;
  label: string;
  accessMethod: AccessMethod | "PARTNER";
  /** Variables d'environnement nécessaires (aucune valeur n'est jamais exposée). */
  requiredEnv: string[];
  status: "active" | "inactive" | "awaiting_key" | "awaiting_partner_access" | "awaiting_agreement";
  note?: string;
  providers: TransportProvider[];
}

export function buildIntegrations(e: Env, catalog: HubCatalog): Integration[] {
  const has = (k: keyof Env) => !!e[k];
  const gtfs = createGtfsProviders(path.resolve(e.GTFS_DIR));
  const mockPolicy = e.USE_MOCK_PROVIDERS ? e.MOCK_POLICY : "off";
  const list: Integration[] = [
    {
      id: "gtfs",
      label: "Horaires GTFS open data (FlixBus, TIB Majorque)",
      accessMethod: "OPEN_DATA",
      requiredEnv: [],
      status: gtfs.some((p) => p.availability().enabled) ? "active" : "inactive",
      note: "npm run gtfs:sync télécharge les flux",
      providers: gtfs,
    },
    {
      id: "transitous",
      label: "Transitous (MOTIS)",
      accessMethod: "OPEN_DATA",
      requiredEnv: ["TRANSITOUS_ENABLED", "TRANSITOUS_CONTACT"],
      status: e.TRANSITOUS_ENABLED && has("TRANSITOUS_CONTACT") ? "active" : "awaiting_agreement",
      note: "Usage non commercial ; contacter l'équipe avant un usage intensif du routage",
      providers: [new TransitousProvider({ enabled: e.TRANSITOUS_ENABLED, contact: e.TRANSITOUS_CONTACT })],
    },
    {
      id: "sncf",
      label: "API SNCF (Navitia)",
      accessMethod: "API",
      requiredEnv: ["SNCF_API_TOKEN"],
      status: has("SNCF_API_TOKEN") ? "active" : "awaiting_key",
      providers: [new SncfProvider({ token: e.SNCF_API_TOKEN })],
    },
    {
      id: "duffel",
      label: "Duffel (vols)",
      accessMethod: "API",
      requiredEnv: ["DUFFEL_ACCESS_TOKEN"],
      status: has("DUFFEL_ACCESS_TOKEN") ? "active" : "awaiting_key",
      note: e.DUFFEL_ACCESS_TOKEN?.startsWith("duffel_test_") ? "Jeton de TEST : offres fictives, affichées comme démonstration" : undefined,
      providers: [new DuffelProvider({ token: e.DUFFEL_ACCESS_TOKEN })],
    },
    { id: "blablacar", label: "BlaBlaCar (covoiturage)", accessMethod: "API", requiredEnv: ["BLABLACAR_API_KEY"], status: "awaiting_key", note: "Adapter à écrire à réception de la clé et de la documentation officielle", providers: [] },
    { id: "google-routes", label: "Google Routes (transit)", accessMethod: "API", requiredEnv: ["GOOGLE_MAPS_API_KEY"], status: "awaiting_key", note: "Optionnel, payant", providers: [] },
    { id: "skyscanner", label: "Skyscanner", accessMethod: "PARTNER", requiredEnv: [], status: "awaiting_partner_access", providers: [] },
    { id: "trainline", label: "Trainline", accessMethod: "PARTNER", requiredEnv: [], status: "awaiting_partner_access", providers: [] },
    { id: "flixbus-commercial", label: "FlixBus (prix, API partenaire)", accessMethod: "PARTNER", requiredEnv: [], status: "awaiting_partner_access", providers: [] },
    { id: "ferries", label: "Compagnies de ferry", accessMethod: "PARTNER", requiredEnv: [], status: "awaiting_partner_access", providers: [] },
    { id: "computed", label: "Estimations calculées (marche, taxi)", accessMethod: "COMPUTED", requiredEnv: [], status: "active", providers: [new WalkProvider(), new TaxiEstimateProvider()] },
    {
      id: "mock",
      label: "Providers de démonstration (fictifs)",
      accessMethod: "MOCK",
      requiredEnv: [],
      status: mockPolicy === "off" ? "inactive" : "active",
      note: `Politique : ${mockPolicy} (uniquement là où aucune donnée réelle n'existe en mode « fallback »)`,
      providers: mockPolicy === "off" ? [] : phase1Providers(catalog),
    },
  ];
  return list;
}
