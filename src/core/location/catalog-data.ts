/**
 * Catalogue initial de hubs et de lieux (phase 1).
 * Coordonnées APPROXIMATIVES (précision ~100–500 m), suffisantes pour la présélection de hubs.
 * Elles ne sont jamais présentées comme des horaires ou des prix. Couverture : Côte d'Azur, Provence,
 * Ligurie, Lyon, Paris, Barcelone, Majorque. Extensible via OurAirports (domaine public) et les GTFS.
 */

export interface HubServices {
  flight?: boolean;
  rail?: boolean;
  coach?: boolean;
  ferry?: boolean;
}

export interface HubSeed {
  id: string;
  name: string;
  kind: "airport" | "station" | "bus_station" | "port";
  lat: number;
  lon: number;
  timezone: string;
  countryCode: string;
  /** 0..1 — taille / niveau d'offre du hub (priorisation des requêtes). */
  importance: number;
  services: HubServices;
  iata?: string;
  aliases: string[];
}

export interface PlaceSeed {
  id: string;
  name: string;
  kind: "city" | "poi" | "address";
  lat: number;
  lon: number;
  timezone: string;
  countryCode: string;
  aliases: string[];
}

const P = "Europe/Paris";
const M = "Europe/Madrid";
const R = "Europe/Rome";

export const HUB_SEEDS: HubSeed[] = [
  // --- Aéroports ---
  { id: "hub:NCE", name: "Nice Côte d'Azur (aéroport)", kind: "airport", lat: 43.6584, lon: 7.2159, timezone: P, countryCode: "FR", importance: 1, services: { flight: true, coach: true }, iata: "NCE", aliases: ["nice airport", "aeroport de nice", "aeroport nice", "nice cote d azur", "nce"] },
  { id: "hub:MRS", name: "Marseille Provence (aéroport)", kind: "airport", lat: 43.4393, lon: 5.2214, timezone: P, countryCode: "FR", importance: 1, services: { flight: true, coach: true }, iata: "MRS", aliases: ["marseille airport", "aeroport de marseille", "aeroport marseille", "marignane", "marseille provence", "mrs"] },
  { id: "hub:TLN", name: "Toulon-Hyères (aéroport)", kind: "airport", lat: 43.0973, lon: 6.146, timezone: P, countryCode: "FR", importance: 0.5, services: { flight: true }, iata: "TLN", aliases: ["toulon airport", "aeroport de toulon", "toulon hyeres", "tln"] },
  { id: "hub:MPL", name: "Montpellier Méditerranée (aéroport)", kind: "airport", lat: 43.5762, lon: 3.963, timezone: P, countryCode: "FR", importance: 0.6, services: { flight: true }, iata: "MPL", aliases: ["montpellier airport", "aeroport de montpellier", "mpl"] },
  { id: "hub:GOA", name: "Gênes Cristoforo Colombo (aéroport)", kind: "airport", lat: 44.4133, lon: 8.8375, timezone: R, countryCode: "IT", importance: 0.6, services: { flight: true }, iata: "GOA", aliases: ["genoa airport", "aeroport de genes", "genova aeroporto", "goa"] },
  { id: "hub:LYS", name: "Lyon Saint-Exupéry (aéroport)", kind: "airport", lat: 45.7256, lon: 5.0811, timezone: P, countryCode: "FR", importance: 1, services: { flight: true, rail: true }, iata: "LYS", aliases: ["lyon airport", "aeroport de lyon", "saint exupery", "lys"] },
  { id: "hub:CDG", name: "Paris-Charles de Gaulle (aéroport)", kind: "airport", lat: 49.0097, lon: 2.5479, timezone: P, countryCode: "FR", importance: 1, services: { flight: true, rail: true }, iata: "CDG", aliases: ["cdg", "roissy", "charles de gaulle", "paris cdg"] },
  { id: "hub:ORY", name: "Paris-Orly (aéroport)", kind: "airport", lat: 48.7262, lon: 2.3652, timezone: P, countryCode: "FR", importance: 1, services: { flight: true }, iata: "ORY", aliases: ["orly", "paris orly", "ory"] },
  { id: "hub:BCN", name: "Barcelone-El Prat (aéroport)", kind: "airport", lat: 41.2974, lon: 2.0833, timezone: M, countryCode: "ES", importance: 1, services: { flight: true }, iata: "BCN", aliases: ["barcelona airport", "aeroport de barcelone", "el prat", "bcn"] },
  { id: "hub:PMI", name: "Palma de Majorque (aéroport)", kind: "airport", lat: 39.5517, lon: 2.7388, timezone: M, countryCode: "ES", importance: 1, services: { flight: true, coach: true }, iata: "PMI", aliases: ["palma airport", "aeroport de palma", "son sant joan", "pmi"] },

  // --- Gares ---
  { id: "hub:nice-ville", name: "Nice-Ville (gare)", kind: "station", lat: 43.7046, lon: 7.2619, timezone: P, countryCode: "FR", importance: 0.9, services: { rail: true }, aliases: ["gare de nice", "nice ville", "gare nice ville"] },
  { id: "hub:cannes", name: "Cannes (gare)", kind: "station", lat: 43.5535, lon: 7.0197, timezone: P, countryCode: "FR", importance: 0.7, services: { rail: true, coach: true }, aliases: ["gare de cannes", "cannes gare"] },
  { id: "hub:antibes", name: "Antibes (gare)", kind: "station", lat: 43.5864, lon: 7.1205, timezone: P, countryCode: "FR", importance: 0.65, services: { rail: true, coach: true }, aliases: ["gare d antibes", "antibes gare"] },
  { id: "hub:golfe-juan", name: "Golfe-Juan-Vallauris (gare)", kind: "station", lat: 43.5672, lon: 7.0753, timezone: P, countryCode: "FR", importance: 0.35, services: { rail: true }, aliases: ["gare de golfe juan", "golfe juan vallauris", "gare de vallauris"] },
  { id: "hub:biot", name: "Biot (gare)", kind: "station", lat: 43.6128, lon: 7.124, timezone: P, countryCode: "FR", importance: 0.3, services: { rail: true }, aliases: ["gare de biot"] },
  { id: "hub:grasse", name: "Grasse (gare)", kind: "station", lat: 43.6539, lon: 6.923, timezone: P, countryCode: "FR", importance: 0.3, services: { rail: true }, aliases: ["gare de grasse"] },
  { id: "hub:monaco", name: "Monaco-Monte-Carlo (gare)", kind: "station", lat: 43.7387, lon: 7.4196, timezone: "Europe/Monaco", countryCode: "MC", importance: 0.6, services: { rail: true }, aliases: ["gare de monaco", "monaco monte carlo"] },
  { id: "hub:menton", name: "Menton (gare)", kind: "station", lat: 43.7744, lon: 7.493, timezone: P, countryCode: "FR", importance: 0.35, services: { rail: true }, aliases: ["gare de menton"] },
  { id: "hub:st-raphael", name: "Saint-Raphaël-Valescure (gare)", kind: "station", lat: 43.4232, lon: 6.7686, timezone: P, countryCode: "FR", importance: 0.5, services: { rail: true }, aliases: ["gare de saint raphael", "saint raphael valescure"] },
  { id: "hub:toulon", name: "Toulon (gare)", kind: "station", lat: 43.1283, lon: 5.9297, timezone: P, countryCode: "FR", importance: 0.7, services: { rail: true, coach: true }, aliases: ["gare de toulon"] },
  { id: "hub:marseille-st-charles", name: "Marseille Saint-Charles (gare)", kind: "station", lat: 43.3027, lon: 5.3806, timezone: P, countryCode: "FR", importance: 0.95, services: { rail: true, coach: true }, aliases: ["gare de marseille", "marseille saint charles", "saint charles", "gare saint charles"] },
  { id: "hub:vitrolles-aeroport", name: "Vitrolles Aéroport Marseille-Provence (gare)", kind: "station", lat: 43.4176, lon: 5.2148, timezone: P, countryCode: "FR", importance: 0.4, services: { rail: true }, aliases: ["gare de vitrolles", "vitrolles aeroport"] },
  { id: "hub:aix-tgv", name: "Aix-en-Provence TGV (gare)", kind: "station", lat: 43.4553, lon: 5.3173, timezone: P, countryCode: "FR", importance: 0.7, services: { rail: true, coach: true }, aliases: ["aix tgv", "gare aix en provence tgv"] },
  { id: "hub:avignon-tgv", name: "Avignon TGV (gare)", kind: "station", lat: 43.9216, lon: 4.786, timezone: P, countryCode: "FR", importance: 0.65, services: { rail: true }, aliases: ["avignon tgv"] },
  { id: "hub:montpellier", name: "Montpellier Saint-Roch (gare)", kind: "station", lat: 43.6046, lon: 3.8807, timezone: P, countryCode: "FR", importance: 0.75, services: { rail: true, coach: true }, aliases: ["gare de montpellier", "montpellier saint roch"] },
  { id: "hub:lyon-part-dieu", name: "Lyon Part-Dieu (gare)", kind: "station", lat: 45.7606, lon: 4.8594, timezone: P, countryCode: "FR", importance: 0.95, services: { rail: true, coach: true }, aliases: ["lyon part dieu", "part dieu", "gare de lyon part dieu"] },
  { id: "hub:paris-gare-de-lyon", name: "Paris Gare de Lyon", kind: "station", lat: 48.8443, lon: 2.3743, timezone: P, countryCode: "FR", importance: 1, services: { rail: true }, aliases: ["paris gare de lyon", "gare de lyon"] },
  { id: "hub:paris-bercy", name: "Paris Bercy Seine (gare routière)", kind: "bus_station", lat: 48.8386, lon: 2.3825, timezone: P, countryCode: "FR", importance: 0.8, services: { coach: true }, aliases: ["bercy seine", "gare routiere de bercy", "paris bercy"] },
  { id: "hub:genova-principe", name: "Genova Piazza Principe (gare)", kind: "station", lat: 44.4176, lon: 8.9213, timezone: R, countryCode: "IT", importance: 0.7, services: { rail: true, coach: true }, aliases: ["genova piazza principe", "gare de genes"] },
  { id: "hub:barcelona-sants", name: "Barcelona Sants (gare)", kind: "station", lat: 41.3791, lon: 2.14, timezone: M, countryCode: "ES", importance: 0.95, services: { rail: true, coach: true }, aliases: ["barcelona sants", "gare de barcelone", "sants"] },
  { id: "hub:barcelona-nord", name: "Barcelona Nord (gare routière)", kind: "bus_station", lat: 41.3947, lon: 2.183, timezone: M, countryCode: "ES", importance: 0.7, services: { coach: true }, aliases: ["barcelona nord", "estacio del nord"] },
  { id: "hub:palma-intermodal", name: "Palma Estació Intermodal", kind: "station", lat: 39.5762, lon: 2.6555, timezone: M, countryCode: "ES", importance: 0.8, services: { rail: true, coach: true }, aliases: ["palma intermodal", "estacio intermodal", "placa d espanya palma"] },
  { id: "hub:manacor", name: "Manacor (gare)", kind: "station", lat: 39.5714, lon: 3.2089, timezone: M, countryCode: "ES", importance: 0.35, services: { rail: true, coach: true }, aliases: ["gare de manacor", "estacio de manacor"] },

  // --- Ports (aucun provider ferry en phase 1 : servent au catalogue et à la trace) ---
  { id: "hub:port-barcelona", name: "Port de Barcelone", kind: "port", lat: 41.3713, lon: 2.1793, timezone: M, countryCode: "ES", importance: 0.7, services: { ferry: true }, aliases: ["port de barcelone", "port of barcelona"] },
  { id: "hub:port-palma", name: "Port de Palma", kind: "port", lat: 39.5653, lon: 2.6343, timezone: M, countryCode: "ES", importance: 0.7, services: { ferry: true }, aliases: ["port de palma", "port of palma"] },
  { id: "hub:port-toulon", name: "Port de Toulon", kind: "port", lat: 43.121, lon: 5.933, timezone: P, countryCode: "FR", importance: 0.5, services: { ferry: true }, aliases: ["port de toulon"] },
  { id: "hub:port-nice", name: "Port de Nice", kind: "port", lat: 43.696, lon: 7.285, timezone: P, countryCode: "FR", importance: 0.5, services: { ferry: true }, aliases: ["port de nice"] },
];

export const PLACE_SEEDS: PlaceSeed[] = [
  { id: "place:skema-sophia", name: "SKEMA Business School, Sophia Antipolis", kind: "poi", lat: 43.6147, lon: 7.0712, timezone: P, countryCode: "FR", aliases: ["skema", "skema sophia", "skema sophia antipolis", "skema business school", "skema business school sophia antipolis"] },
  { id: "place:sophia-antipolis", name: "Sophia Antipolis", kind: "city", lat: 43.6163, lon: 7.0553, timezone: P, countryCode: "FR", aliases: ["sophia antipolis", "sophia"] },
  { id: "place:vallauris", name: "Vallauris", kind: "city", lat: 43.5784, lon: 7.0538, timezone: P, countryCode: "FR", aliases: ["vallauris"] },
  { id: "place:golfe-juan", name: "Golfe-Juan", kind: "city", lat: 43.5686, lon: 7.0761, timezone: P, countryCode: "FR", aliases: ["golfe juan"] },
  { id: "place:antibes", name: "Antibes", kind: "city", lat: 43.5808, lon: 7.1251, timezone: P, countryCode: "FR", aliases: ["antibes", "juan les pins"] },
  { id: "place:cannes", name: "Cannes", kind: "city", lat: 43.5528, lon: 7.0174, timezone: P, countryCode: "FR", aliases: ["cannes"] },
  { id: "place:biot", name: "Biot", kind: "city", lat: 43.629, lon: 7.096, timezone: P, countryCode: "FR", aliases: ["biot"] },
  { id: "place:grasse", name: "Grasse", kind: "city", lat: 43.6589, lon: 6.9223, timezone: P, countryCode: "FR", aliases: ["grasse"] },
  { id: "place:nice", name: "Nice", kind: "city", lat: 43.7102, lon: 7.262, timezone: P, countryCode: "FR", aliases: ["nice"] },
  { id: "place:monaco", name: "Monaco", kind: "city", lat: 43.7384, lon: 7.4246, timezone: "Europe/Monaco", countryCode: "MC", aliases: ["monaco", "monte carlo"] },
  { id: "place:menton", name: "Menton", kind: "city", lat: 43.775, lon: 7.4975, timezone: P, countryCode: "FR", aliases: ["menton"] },
  { id: "place:saint-raphael", name: "Saint-Raphaël", kind: "city", lat: 43.4253, lon: 6.7684, timezone: P, countryCode: "FR", aliases: ["saint raphael", "st raphael"] },
  { id: "place:toulon", name: "Toulon", kind: "city", lat: 43.1242, lon: 5.928, timezone: P, countryCode: "FR", aliases: ["toulon"] },
  { id: "place:marseille", name: "Marseille", kind: "city", lat: 43.2965, lon: 5.3698, timezone: P, countryCode: "FR", aliases: ["marseille"] },
  { id: "place:aix", name: "Aix-en-Provence", kind: "city", lat: 43.5297, lon: 5.4474, timezone: P, countryCode: "FR", aliases: ["aix en provence", "aix"] },
  { id: "place:avignon", name: "Avignon", kind: "city", lat: 43.9493, lon: 4.8055, timezone: P, countryCode: "FR", aliases: ["avignon"] },
  { id: "place:montpellier", name: "Montpellier", kind: "city", lat: 43.6108, lon: 3.8767, timezone: P, countryCode: "FR", aliases: ["montpellier"] },
  { id: "place:lyon", name: "Lyon", kind: "city", lat: 45.764, lon: 4.8357, timezone: P, countryCode: "FR", aliases: ["lyon"] },
  { id: "place:paris", name: "Paris", kind: "city", lat: 48.8566, lon: 2.3522, timezone: P, countryCode: "FR", aliases: ["paris"] },
  { id: "place:genoa", name: "Gênes", kind: "city", lat: 44.4056, lon: 8.9463, timezone: R, countryCode: "IT", aliases: ["genes", "genova", "genoa"] },
  { id: "place:barcelona", name: "Barcelone", kind: "city", lat: 41.3874, lon: 2.1686, timezone: M, countryCode: "ES", aliases: ["barcelone", "barcelona"] },
  { id: "place:palma", name: "Palma (Majorque)", kind: "city", lat: 39.5696, lon: 2.6502, timezone: M, countryCode: "ES", aliases: ["palma", "palma de majorque", "palma de mallorca"] },
  { id: "place:manacor", name: "Manacor (Majorque)", kind: "city", lat: 39.5696, lon: 3.2096, timezone: M, countryCode: "ES", aliases: ["manacor", "manacor majorque", "manacor mallorca"] },
];
