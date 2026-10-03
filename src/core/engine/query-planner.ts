import { haversineKm } from "../location/geo";
import type { SegmentQuery } from "../providers/types";
import { MODE_CATEGORY, TRANSPORT_MODES, type Place, type SearchParams, type TransportMode } from "../types";

export interface PlanInput {
  origin: Place;
  destination: Place;
  originHubs: Place[];
  destinationHubs: Place[];
  windowStart: string;
  windowEnd: string;
  params: Pick<SearchParams, "excludedModes" | "includedModes" | "passengers" | "currency">;
}

export interface QueryPlan {
  queries: SegmentQuery[];
  modes: TransportMode[];
  /** Paires interrogées côté « tronc » (hub de départ → hub d'arrivée), pour la trace. */
  trunkPairs: { from: Place; to: Place }[];
}

/** Modes autorisés : tous sauf exclusions ; si l'utilisateur restreint les modes, l'accès local (bus, tram, marche, taxi) reste permis. */
export function allowedModes(params: PlanInput["params"]): TransportMode[] {
  const excluded = new Set(params.excludedModes);
  return TRANSPORT_MODES.filter((m) => {
    if (excluded.has(m)) return false;
    if (params.includedModes && !params.includedModes.includes(m)) {
      const cat = MODE_CATEGORY[m];
      return cat === "LOCAL" || cat === "FLEX";
    }
    return true;
  });
}

/**
 * Génère les requêtes élémentaires (paires de lieux) à envoyer aux providers.
 * Nœuds = origine + hubs de départ + hubs d'arrivée + destination.
 * Une paire (a → b) n'est retenue que si elle « progresse » vers la destination (élagage géographique),
 * ce qui évite l'explosion combinatoire tout en autorisant les détours utiles (positionnement).
 * Les paires « tronc » (côté départ → côté arrivée) sont placées en tête : elles sont prioritaires
 * si un provider a un budget d'appels limité.
 */
export function planQueries(input: PlanInput): QueryPlan {
  const { origin, destination } = input;
  const originSide = uniq([origin, ...input.originHubs]);
  const destSide = uniq([...input.destinationHubs, destination]).filter((p) => !originSide.some((o) => o.id === p.id));
  const nodes = uniq([...originSide, ...destSide]);
  const modes = allowedModes(input.params);
  const distToDest = new Map(nodes.map((n) => [n.id, haversineKm(n, destination)]));

  const trunk: SegmentQuery[] = [];
  const other: SegmentQuery[] = [];
  const trunkPairs: { from: Place; to: Place }[] = [];
  for (const a of nodes) {
    if (a.id === destination.id) continue;
    for (const b of nodes) {
      if (a.id === b.id || b.id === origin.id) continue;
      const da = distToDest.get(a.id)!;
      const db = distToDest.get(b.id)!;
      if (db > da + Math.max(30, 0.15 * da)) continue; // ne s'éloigne pas de la destination
      const q: SegmentQuery = {
        origin: a,
        destination: b,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        modes,
        passengers: input.params.passengers,
        currency: input.params.currency,
      };
      const isTrunk = originSide.some((o) => o.id === a.id) && destSide.some((d) => d.id === b.id);
      if (isTrunk) {
        trunk.push(q);
        trunkPairs.push({ from: a, to: b });
      } else {
        other.push(q);
      }
    }
  }
  return { queries: [...trunk, ...other], modes, trunkPairs };
}

function uniq(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
