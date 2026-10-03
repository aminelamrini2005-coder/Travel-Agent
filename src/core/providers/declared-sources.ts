import type { AccessMethod, TransportMode } from "../types";

/**
 * Registre des plateformes CONNUES mais pas (encore) interrogées par le Travel Agent.
 * Il sert uniquement à la transparence : la trace affiche « ✗ non recherché » avec une raison factuelle.
 * Voir docs/PROVIDER_ACCESS_STUDY.md pour l'analyse détaillée.
 */
export interface DeclaredSource {
  id: string;
  name: string;
  modes: TransportMode[];
  status: "not_integrated" | "pending_access";
  /** Méthode recommandée pour l'intégrer, selon l'ordre de priorité API → Open data/partenaire → Browser. */
  recommendedMethod: AccessMethod | "PARTNER";
  /** Id du provider qui la remplacera une fois intégrée (pour ne pas la lister en double). */
  plannedProviderId?: string;
  reasonKey: string;
}

export const DECLARED_SOURCES: DeclaredSource[] = [
  { id: "duffel", name: "Duffel (vols)", modes: ["flight"], status: "pending_access", recommendedMethod: "API", plannedProviderId: "duffel", reasonKey: "source.reason.apiKeyMissing" },
  { id: "skyscanner", name: "Skyscanner", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
  { id: "amadeus", name: "Amadeus Self-Service", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.amadeusClosed" },
  { id: "kiwi", name: "Kiwi.com Tequila", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.invitationOnly" },
  { id: "airlines-direct", name: "Compagnies aériennes (Ryanair, easyJet, Vueling…)", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noPublicApi" },
  { id: "sncf-api", name: "API SNCF (horaires)", modes: ["train", "regional_train", "high_speed_train"], status: "pending_access", recommendedMethod: "API", plannedProviderId: "sncf", reasonKey: "source.reason.apiKeyMissing" },
  { id: "sncf-connect", name: "SNCF Connect (prix)", modes: ["train", "regional_train", "high_speed_train"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noPublicApi" },
  { id: "trainline", name: "Trainline", modes: ["train", "regional_train", "high_speed_train", "coach"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerContract" },
  { id: "flixbus-gtfs", name: "FlixBus / FlixTrain (horaires GTFS)", modes: ["coach", "train"], status: "not_integrated", recommendedMethod: "OPEN_DATA", plannedProviderId: "transitous", reasonKey: "source.reason.plannedPhase2" },
  { id: "flixbus-prices", name: "FlixBus (prix)", modes: ["coach"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
  { id: "blablacar", name: "BlaBlaCar (covoiturage)", modes: ["rideshare"], status: "pending_access", recommendedMethod: "API", plannedProviderId: "blablacar", reasonKey: "source.reason.apiKeyRequested" },
  { id: "blablacar-bus", name: "BlaBlaCar Bus", modes: ["coach"], status: "not_integrated", recommendedMethod: "API", reasonKey: "source.reason.apiUnreachable" },
  { id: "transitous", name: "Transitous (transports publics européens, GTFS)", modes: ["bus", "tram", "metro", "regional_train", "train", "coach"], status: "not_integrated", recommendedMethod: "OPEN_DATA", plannedProviderId: "transitous", reasonKey: "source.reason.plannedPhase2" },
  { id: "google-routes", name: "Google Routes (transit)", modes: ["bus", "tram", "metro", "regional_train", "train"], status: "not_integrated", recommendedMethod: "API", reasonKey: "source.reason.apiKeyMissing" },
  { id: "ferries", name: "Compagnies de ferry", modes: ["ferry"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noFerrySource" },
  { id: "vtc", name: "Uber / Bolt (VTC)", modes: ["vtc"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
];
