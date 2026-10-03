import type { TransportMode } from "../../types";
import type { GtfsRoute } from "./gtfs-index";

/**
 * Flux GTFS (open data) exploités. Chaque flux a une source officielle et, si elle n'est pas joignable,
 * la copie horodatée publiée par la Mobility Database (MobilityData, organisme à but non lucratif).
 * La provenance réellement utilisée et sa date sont enregistrées dans data/gtfs/manifest.json.
 */
export interface GtfsFeedConfig {
  id: string;
  /** Nom affiché (provider). */
  displayName: string;
  operator: string;
  officialUrl: string;
  mirrorUrl?: string;
  datasetPage: string;
  license: string;
  attribution: string;
  /** Site officiel (information / réservation), utilisé comme lien de redirection. */
  officialSite?: string;
  /** Rayon de recherche des arrêts autour d'un lieu (km). */
  stopRadiusKm: number;
  /** Modes que le flux peut produire. */
  modes: TransportMode[];
  mapMode: (route: GtfsRoute) => TransportMode;
  /** Activé par défaut si le fichier est présent. */
  enabledByDefault: boolean;
}

const MDB = (name: string) => `https://storage.googleapis.com/storage/v1/b/mdb-latest/o/${encodeURIComponent(name + ".zip")}?alt=media`;

/** Modes GTFS de base et étendus → nos modes. `busMode` : car (interurbain) ou bus (urbain). */
export function genericMode(routeType: number, busMode: TransportMode = "bus"): TransportMode {
  if (routeType === 0 || (routeType >= 900 && routeType < 1000)) return "tram";
  if (routeType === 1 || (routeType >= 400 && routeType < 500)) return "metro";
  if (routeType === 2) return "train";
  if (routeType >= 100 && routeType < 200) return routeType === 101 ? "high_speed_train" : routeType === 106 ? "regional_train" : "train";
  if (routeType === 4 || routeType === 1200) return "ferry";
  if (routeType === 200 || (routeType >= 201 && routeType < 300)) return "coach";
  return busMode;
}

export const GTFS_FEEDS: GtfsFeedConfig[] = [
  {
    id: "flixbus-eu",
    displayName: "FlixBus / FlixTrain — horaires GTFS (open data)",
    operator: "FlixBus",
    officialUrl: "https://transport.data.gouv.fr/resources/11681/download",
    mirrorUrl: MDB("de-unknown-flixbus-gtfs-853"),
    datasetPage: "https://transport.data.gouv.fr/datasets/flixbus-horaires-theoriques-du-reseau-europeen-1",
    license: "ODbL-1.0",
    attribution: "Horaires FlixBus/FlixTrain (FlixMobility) — ODbL, transport.data.gouv.fr / Mobility Database",
    officialSite: "https://www.flixbus.fr/",
    stopRadiusKm: 2,
    modes: ["coach", "train"],
    mapMode: (r) => (r.type === 2 || (r.type >= 100 && r.type < 200) ? "train" : "coach"),
    enabledByDefault: true,
  },
  {
    id: "tib-mallorca",
    displayName: "TIB Majorque (CTM) — horaires GTFS (open data)",
    operator: "TIB / CTM Mallorca",
    officialUrl: "https://www.tib.org/documents/20124/478141/ctm-mallorca-es.zip",
    mirrorUrl: MDB("es-pm-consorcio-de-transportes-de-mallorca-gtfs-2141"),
    datasetPage: "https://www.tib.org/en/sobre-ctm/portal-de-transparencia/dades-obertes",
    license: "CC-BY-4.0",
    attribution: "Horaires TIB — Consorci de Transports de Mallorca, CC BY 4.0 (via Mobility Database)",
    stopRadiusKm: 1.2,
    modes: ["coach", "bus", "regional_train", "metro"],
    // Réseau interurbain TIB = car ; EMT Palma (agence 59) = bus urbain ; SFM = train régional / métro.
    mapMode: (r) => (r.type === 2 ? "regional_train" : r.type === 1 ? "metro" : r.agencyId === "59" ? "bus" : "coach"),
    enabledByDefault: true,
  },
];
