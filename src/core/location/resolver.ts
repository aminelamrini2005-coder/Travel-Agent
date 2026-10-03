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

/**
 * Géocodeur Nominatim (OpenStreetMap). Politique d'usage : User-Agent identifiable, ≤ 1 requête/s, cache obligatoire.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export class NominatimGeocoder implements Geocoder {
  readonly id = "nominatim";
  private last = 0;
  private readonly memo = new Map<string, Place | null>();

  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://nominatim.openstreetmap.org",
  ) {}

  async geocode(text: string): Promise<Place | null> {
    const key = normalizeText(text);
    if (this.memo.has(key)) return this.memo.get(key)!;
    const wait = this.last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const url = `${this.baseUrl}/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(text)}`;
    const res = await this.fetchImpl(url, { headers: { "User-Agent": this.userAgent, "Accept-Language": "fr" } });
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
    if (!r) {
      this.memo.set(key, null);
      return null;
    }
    const cc = r.address?.country_code?.toUpperCase();
    const tz = timezoneForCountry(cc);
    if (!tz) {
      // Fuseau inconnu : on refuse plutôt que de supposer un fuseau faux.
      this.memo.set(key, null);
      return null;
    }
    const place: Place = {
      id: `osm:${r.osm_type ?? "x"}/${r.osm_id ?? key}`,
      name: r.name || r.display_name.split(",")[0]!,
      kind: mapOsmKind(r.category, r.type),
      lat: Number(r.lat),
      lon: Number(r.lon),
      timezone: tz,
      countryCode: cc,
    };
    this.memo.set(key, place);
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
