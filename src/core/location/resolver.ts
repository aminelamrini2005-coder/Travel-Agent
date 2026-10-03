import type { Cache } from "../cache";
import type { LocationQuery, Place, PlaceKind } from "../types";
import { normalizeText, timezoneForCountry } from "./geo";
import type { HubCatalog } from "./hubs";
import { stripHub } from "./hubs";

/** Géocodeur externe (Nominatim, Google, Mapbox…). */
export interface Geocoder {
  readonly id: string;
  geocode(text: string): Promise<Place | null>;
}

export interface ResolvedLocation {
  place: Place;
  /** "catalog" | "coordinates" | id du géocodeur. */
  source: string;
}

export class LocationNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`Lieu introuvable : ${query}`);
  }
}

/**
 * Résout un texte libre / des coordonnées en Place.
 * Ordre : coordonnées explicites → catalogue local (hubs + lieux connus) → géocodeurs externes configurés.
 */
export class LocationResolver {
  constructor(
    private readonly catalog: HubCatalog,
    private readonly geocoders: Geocoder[] = [],
    private readonly defaultTimezone = "Europe/Paris",
  ) {}

  async resolve(q: LocationQuery): Promise<ResolvedLocation> {
    if ("lat" in q) {
      return { place: this.fromCoordinates(q.lat, q.lon, q.label), source: "coordinates" };
    }
    const coords = /^\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$/.exec(q.text);
    if (coords) {
      return { place: this.fromCoordinates(Number(coords[1]), Number(coords[2])), source: "coordinates" };
    }
    const entry = this.catalog.findByText(q.text);
    if (entry) return { place: entry.hub ? stripHub(entry.hub) : entry.place, source: "catalog" };
    for (const g of this.geocoders) {
      const place = await g.geocode(q.text).catch(() => null);
      if (place) return { place, source: g.id };
    }
    throw new LocationNotFoundError(q.text);
  }

  private fromCoordinates(lat: number, lon: number, label?: string): Place {
    return {
      id: `geo:${lat.toFixed(5)},${lon.toFixed(5)}`,
      name: label ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      kind: "coordinates",
      lat,
      lon,
      // Sans service de fuseau : on retient le fuseau par défaut (documenté) — à remplacer par un lookup tz.
      timezone: this.defaultTimezone,
    };
  }
}

export interface NominatimOptions {
  /** User-Agent identifiant l'application (obligatoire selon la politique d'usage). */
  userAgent: string;
  /** E-mail de contact (recommandé par la politique pour un usage régulier). */
  email?: string;
  cache?: Cache;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Codes pays autorisés (réduit les ambiguïtés), ex. "fr,es,it,mc". */
  countryCodes?: string;
}

/**
 * Géocodeur Nominatim (OpenStreetMap), conforme à la politique d'usage
 * https://operations.osmfoundation.org/policies/nominatim/ :
 *  - au plus 1 requête par seconde, toutes recherches confondues (file d'attente globale) ;
 *  - User-Agent identifiant l'application (+ e-mail de contact si fourni) ;
 *  - résultats mis en cache 30 jours (y compris les absences de résultat), pas d'autocomplétion ;
 *  - attribution « © contributeurs OpenStreetMap » affichée dans l'interface.
 * Utilisé uniquement quand le catalogue local ne connaît pas le lieu.
 */
export class NominatimGeocoder implements Geocoder {
  readonly id = "nominatim";
  static readonly attribution = "© contributeurs OpenStreetMap (ODbL) — géocodage Nominatim";
  /** File globale partagée par toutes les instances : garantit ≤ 1 req/s dans le processus. */
  private static queue: Promise<void> = Promise.resolve();
  private static last = 0;
  private readonly memo = new Map<string, Place | null>();

  constructor(private readonly o: NominatimOptions) {}

  private static async throttle(): Promise<void> {
    const turn = NominatimGeocoder.queue.then(async () => {
      const wait = NominatimGeocoder.last + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      NominatimGeocoder.last = Date.now();
    });
    NominatimGeocoder.queue = turn.catch(() => {});
    return turn;
  }

  async geocode(text: string): Promise<Place | null> {
    const key = normalizeText(text);
    if (!key) return null;
    if (this.memo.has(key)) return this.memo.get(key)!;
    const cacheKey = `nominatim:${key}`;
    const cached = await this.o.cache?.get<{ place: Place | null }>(cacheKey);
    if (cached) {
      this.memo.set(key, cached.place);
      return cached.place;
    }
    await NominatimGeocoder.throttle();
    const params = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "1", q: text, "accept-language": "fr" });
    if (this.o.email) params.set("email", this.o.email);
    if (this.o.countryCodes) params.set("countrycodes", this.o.countryCodes);
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.baseUrl ?? "https://nominatim.openstreetmap.org"}/search?${params}`, {
      headers: { "User-Agent": this.o.userAgent },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429 || res.status === 403) throw new Error(`Nominatim HTTP ${res.status} (limite d'usage) — aucune nouvelle tentative`);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      name?: string;
      category?: string;
      type?: string;
      osm_type?: string;
      osm_id?: number;
      address?: { country_code?: string };
    }[];
    const r = data[0];
    let place: Place | null = null;
    const cc = r?.address?.country_code?.toUpperCase();
    const tz = timezoneForCountry(cc);
    // Fuseau inconnu : on refuse plutôt que de supposer un fuseau faux.
    if (r && tz) {
      place = {
        id: `osm:${r.osm_type ?? "x"}/${r.osm_id ?? key}`,
        name: r.name || r.display_name.split(",")[0]!,
        kind: mapOsmKind(r.category, r.type),
        lat: Number(r.lat),
        lon: Number(r.lon),
        timezone: tz,
        countryCode: cc,
      };
    }
    this.memo.set(key, place);
    await this.o.cache?.set(cacheKey, { place }, 30 * 86400);
    return place;
  }
}

function mapOsmKind(category?: string, type?: string): PlaceKind {
  if (type === "aerodrome" || category === "aeroway") return "airport";
  if (type === "station" || category === "railway") return "station";
  if (type === "bus_station") return "bus_station";
  if (type === "ferry_terminal") return "port";
  if (category === "place" || type === "city" || type === "town" || type === "village") return "city";
  if (category === "building" || category === "highway") return "address";
  return "poi";
}
