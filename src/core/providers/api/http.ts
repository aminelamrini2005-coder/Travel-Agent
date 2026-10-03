import { ProviderBlockedError } from "../types";

/**
 * Appel HTTP JSON commun aux adapters API. 429 / 403 « quota » = arrêt immédiat (statut blocked),
 * sans nouvelle tentative : on ne contourne jamais une limite de débit.
 */
export async function fetchJson<T>(fetchImpl: typeof fetch, url: string, init: RequestInit & { signal: AbortSignal }, providerId: string): Promise<T> {
  const res = await fetchImpl(url, init);
  if (res.status === 429) throw new ProviderBlockedError(`${providerId} : limite de débit atteinte (HTTP 429) — arrêt, aucune nouvelle tentative`);
  if (res.status === 401 || res.status === 403) throw new Error(`${providerId} : accès refusé (HTTP ${res.status}) — vérifier la clé`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${providerId} : HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Boîte englobante approximative de l'Europe (couverture Transitous / Duffel non limitée). */
export const EUROPE_BBOX = { minLat: 34, maxLat: 72, minLon: -25, maxLon: 45 };
export const FRANCE_BBOX = { minLat: 41.2, maxLat: 51.2, minLon: -5.3, maxLon: 9.7 };

export function inBox(p: { lat: number; lon: number }, b: typeof EUROPE_BBOX): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;
}
