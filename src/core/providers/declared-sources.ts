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
  { id: "skyscanner", name: "Skyscanner", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
  { id: "amadeus", name: "Amadeus Self-Service", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.amadeusClosed" },
  { id: "kiwi", name: "Kiwi.com Tequila", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.invitationOnly" },
  { id: "airlines-direct", name: "Compagnies aériennes (Ryanair, easyJet, Vueling…)", modes: ["flight"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noPublicApi" },
  { id: "sncf-connect", name: "SNCF Connect (prix)", modes: ["train", "regional_train", "high_speed_train"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noPublicApi" },
  { id: "trainline", name: "Trainline", modes: ["train", "regional_train", "high_speed_train", "coach"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerContract" },
  { id: "flixbus-gtfs", name: "FlixBus / FlixTrain (horaires GTFS)", modes: ["coach", "train"], status: "not_integrated", recommendedMethod: "OPEN_DATA", plannedProviderId: "gtfs-flixbus-eu", reasonKey: "source.reason.feedNotDownloaded" },
  { id: "tib-gtfs", name: "TIB Majorque (horaires GTFS)", modes: ["coach", "bus", "regional_train"], status: "not_integrated", recommendedMethod: "OPEN_DATA", plannedProviderId: "gtfs-tib-mallorca", reasonKey: "source.reason.feedNotDownloaded" },
  { id: "sncf-ter-gtfs", name: "SNCF TER / TGV / Intercités (GTFS)", modes: ["regional_train", "train", "high_speed_train"], status: "not_integrated", recommendedMethod: "OPEN_DATA", reasonKey: "source.reason.feedExpired" },
  { id: "lignes-dazur-gtfs", name: "Lignes d'Azur / Zou! 06 (GTFS)", modes: ["bus", "tram", "coach"], status: "not_integrated", recommendedMethod: "OPEN_DATA", reasonKey: "source.reason.feedExpired" },
  { id: "palmbus-gtfs", name: "Palmbus Cannes (GTFS)", modes: ["bus"], status: "not_integrated", recommendedMethod: "OPEN_DATA", reasonKey: "source.reason.feedExpired" },
  { id: "amp-gtfs", name: "Métropole Aix-Marseille (GTFS)", modes: ["bus", "tram", "metro", "coach"], status: "not_integrated", recommendedMethod: "OPEN_DATA", reasonKey: "source.reason.feedExpired" },
  { id: "flixbus-prices", name: "FlixBus (prix)", modes: ["coach"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
  { id: "blablacar", name: "BlaBlaCar (covoiturage)", modes: ["rideshare"], status: "pending_access", recommendedMethod: "API", plannedProviderId: "blablacar", reasonKey: "source.reason.apiKeyRequested" },
  { id: "blablacar-bus", name: "BlaBlaCar Bus", modes: ["coach"], status: "not_integrated", recommendedMethod: "API", reasonKey: "source.reason.apiUnreachable" },
  { id: "google-routes", name: "Google Routes (transit)", modes: ["bus", "tram", "metro", "regional_train", "train"], status: "not_integrated", recommendedMethod: "API", reasonKey: "source.reason.apiKeyMissing" },
  { id: "ferries", name: "Compagnies de ferry", modes: ["ferry"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.noFerrySource" },
  { id: "vtc", name: "Uber / Bolt (VTC)", modes: ["vtc"], status: "not_integrated", recommendedMethod: "PARTNER", reasonKey: "source.reason.partnerOnly" },
];
