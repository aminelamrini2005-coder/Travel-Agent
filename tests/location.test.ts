import { describe, expect, it } from "vitest";
import { MemoryCache } from "@/core/cache";
import { landmassOf } from "@/core/location/geo";
import { HubCatalog, reachableHubs, selectHubs } from "@/core/location/hubs";
import { LocationNotFoundError, LocationResolver, NominatimGeocoder } from "@/core/location/resolver";

const cat = new HubCatalog();
const resolver = new LocationResolver(cat);

describe("LocationResolver", () => {
  it("résout un point d'intérêt, une ville, un aéroport et des coordonnées", async () => {
    expect((await resolver.resolve({ text: "SKEMA Business School Sophia Antipolis" })).place.id).toBe("place:skema-sophia");
    expect((await resolver.resolve({ text: "Je pars de Vallauris" })).place.id).toBe("place:vallauris");
    expect((await resolver.resolve({ text: "Marseille Airport" })).place.id).toBe("hub:MRS");
    expect((await resolver.resolve({ text: "Manacor, Mallorca" })).place.id).toBe("place:manacor");
    const geo = await resolver.resolve({ text: "43.58, 7.05" });
    expect(geo.place.kind).toBe("coordinates");
    expect(geo.source).toBe("coordinates");
  });

  it("signale un lieu inconnu au lieu d'inventer", async () => {
    await expect(resolver.resolve({ text: "Xyzzyville" })).rejects.toBeInstanceOf(LocationNotFoundError);
  });

  it("géocodeur Nominatim : User-Agent identifiable, fuseau dérivé du pays, refus si pays inconnu", async () => {
    const calls: RequestInit[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify([{ lat: "43.7", lon: "7.26", display_name: "Nice, France", name: "Nice", category: "place", type: "city", osm_type: "relation", osm_id: 1, address: { country_code: "fr" } }]));
    }) as unknown as typeof fetch;
    const cache = new MemoryCache();
    const g = new NominatimGeocoder({ userAgent: "TravelAgentAI/0.2 (test@example.org)", fetchImpl: fakeFetch, cache });
    const p = await g.geocode("Nice");
    expect(p?.timezone).toBe("Europe/Paris");
    expect((calls[0]!.headers as Record<string, string>)["User-Agent"]).toMatch(/TravelAgentAI/);
    // Deuxième instance, même cache : aucun nouvel appel réseau.
    const g2 = new NominatimGeocoder({ userAgent: "x", fetchImpl: fakeFetch, cache });
    expect((await g2.geocode("Nice"))?.name).toBe("Nice");
    expect(calls).toHaveLength(1);
  });

  it("Nominatim : au plus 1 requête par seconde (file globale)", async () => {
    const times: number[] = [];
    const fakeFetch = (async () => {
      times.push(Date.now());
      return new Response("[]");
    }) as unknown as typeof fetch;
    const g = new NominatimGeocoder({ userAgent: "t", fetchImpl: fakeFetch });
    await Promise.all([g.geocode("Lieu A"), g.geocode("Lieu B")]);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
  });
});

describe("hubs atteignables", () => {
  it("depuis Vallauris : Cannes, Antibes, Nice et l'aéroport de Nice dans la recherche principale ; Marseille en positionnement", async () => {
    const v = (await resolver.resolve({ text: "Vallauris" })).place;
    const sel = selectHubs(v, cat);
    const primary = sel.primary.map((c) => c.hub.id);
    expect(primary).toEqual(expect.arrayContaining(["hub:cannes", "hub:antibes", "hub:nice-ville", "hub:NCE"]));
    expect(sel.positioning.map((c) => c.hub.id)).toEqual(expect.arrayContaining(["hub:MRS", "hub:marseille-st-charles"]));
  });

  it("depuis Manacor : Palma (aéroport) atteignable par voie terrestre ; pas de hub du continent", async () => {
    const m = (await resolver.resolve({ text: "Manacor" })).place;
    const hubs = reachableHubs(m, cat, 210).map((c) => c.hub.id);
    expect(hubs).toContain("hub:PMI");
    expect(hubs).not.toContain("hub:BCN");
    expect(landmassOf(m)).toBe("mallorca");
  });
});
