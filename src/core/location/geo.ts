/** Distance orthodromique (km). */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Masses terrestres (îles) — un train, un bus ou un covoiturage ne peut pas relier deux masses différentes.
 * Boîtes englobantes approximatives ; tout point hors boîte est considéré « continent ».
 */
const ISLANDS: { id: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { id: "mallorca", minLat: 39.25, maxLat: 40.0, minLon: 2.3, maxLon: 3.5 },
  { id: "menorca", minLat: 39.78, maxLat: 40.1, minLon: 3.78, maxLon: 4.35 },
  { id: "ibiza", minLat: 38.62, maxLat: 39.15, minLon: 1.15, maxLon: 1.65 },
  { id: "corsica", minLat: 41.33, maxLat: 43.03, minLon: 8.53, maxLon: 9.57 },
  { id: "sardinia", minLat: 38.85, maxLat: 41.32, minLon: 8.1, maxLon: 9.85 },
  { id: "sicily", minLat: 36.6, maxLat: 38.32, minLon: 12.4, maxLon: 15.7 },
];

export function landmassOf(p: { lat: number; lon: number }): string {
  for (const i of ISLANDS) {
    if (p.lat >= i.minLat && p.lat <= i.maxLat && p.lon >= i.minLon && p.lon <= i.maxLon) return i.id;
  }
  return "continent";
}

export function sameLandmass(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return landmassOf(a) === landmassOf(b);
}

/**
 * Estimation du temps de trajet terrestre porte-à-porte (minutes), SANS appel réseau.
 * Utilisée uniquement pour présélectionner les hubs (jamais affichée comme un horaire).
 */
export function estimateGroundMinutes(km: number): number {
  const roadKm = km * 1.3; // facteur de détour
  const speedKmh = km < 15 ? 25 : km < 60 ? 45 : 80;
  return Math.round((roadKm / speedKmh) * 60 + 8);
}

/** Pays → fuseau IANA par défaut (pour les lieux géocodés sans fuseau). Simplification documentée. */
const COUNTRY_TZ: Record<string, string> = {
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  MC: "Europe/Monaco",
  CH: "Europe/Zurich",
  DE: "Europe/Berlin",
  BE: "Europe/Brussels",
  NL: "Europe/Amsterdam",
  LU: "Europe/Luxembourg",
  AT: "Europe/Vienna",
  PT: "Europe/Lisbon",
  GB: "Europe/London",
  IE: "Europe/Dublin",
};

export function timezoneForCountry(cc: string | undefined): string | undefined {
  return cc ? COUNTRY_TZ[cc.toUpperCase()] : undefined;
}

/** Normalisation de texte pour la recherche de lieux (minuscules, sans accents ni ponctuation). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`-]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
