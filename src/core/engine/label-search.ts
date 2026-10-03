/**
 * MOTEUR MULTIMODAL — recherche par labels multicritères (Martins généralisé) sur un graphe temporel.
 *
 * Nœuds  : lieux (Place.id) — origine, hubs, destination.
 * Arêtes : segments renvoyés par les providers.
 *   - planifiées (train, vol, car, covoiturage…) : départ fixe ;
 *   - flexibles (marche, taxi) : départ à tout instant, durée fixe.
 *
 * Un label = un trajet partiel arrivant à un nœud, évalué sur plusieurs critères :
 *   heure d'arrivée ↓, coût ↓, nombre de véhicules ↓, heure de départ effective ↑, segments au prix inconnu ↓.
 * Chaque nœud conserve un « sac » de labels NON DOMINÉS (front de Pareto local) : on ne jette pas une option
 * à 65 € / 5 h parce qu'une autre coûte 50 € / 8 h.
 *
 * Les labels sont traités par heure d'arrivée croissante (file de priorité). Élagages :
 *   - contraintes dures (budget, arrivée max, correspondances max, modes exclus) ;
 *   - marge de correspondance minimale (règles configurables) ;
 *   - dominance locale (sac du nœud) et dominance par la destination (borne cible) ;
 *   - beam : taille max des sacs, en gardant les extrêmes (plus tôt, moins cher, moins de correspondances) ;
 *   - limites d'attente, de nombre de segments et de durée totale.
 * Toutes les exclusions sont comptées par raison et échantillonnées pour la SearchTrace.
 */
import { formatLocalTime, MINUTE_MS, toEpochMs, toIsoUtc } from "../time";
import { MODE_CATEGORY, PRICE_CONFIDENCE_RANK, type Journey, type RejectionReason, type RejectionSample, type TransportMode, type TransportSegment } from "../types";
import { requiredConnection, type ConnectionContext } from "./connection-rules";
import { buildJourney, isVehicle, segmentSignature } from "./journey-builder";
import { dedupeJourneys, paretoFront } from "./pareto";

export interface EngineConstraints {
  originId: string;
  destinationId: string;
  earliestDepartureMs: number;
  latestArrivalMs?: number;
  maxBudgetMinor?: number;
  maxTransfers?: number;
  excludedModes: ReadonlySet<TransportMode>;
  /** undefined = tous. Les modes locaux et flexibles (accès/sortie) restent autorisés sauf exclusion explicite. */
  includedModes?: ReadonlySet<TransportMode>;
  connection: ConnectionContext;
  currency: string;
}

export interface EngineLimits {
  beamWidth: number;
  maxLegs: number;
  maxWaitMinutes: number;
  /** Attente maximale au départ (l'utilisateur peut partir plus tard que l'heure demandée). */
  maxInitialWaitMinutes: number;
  maxTotalMinutes: number;
  maxLabels: number;
  maxRejectionSamples: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  beamWidth: 14,
  maxLegs: 7,
  maxWaitMinutes: 6 * 60,
  maxInitialWaitMinutes: 12 * 60,
  maxTotalMinutes: 36 * 60,
  maxLabels: 300_000,
  maxRejectionSamples: 40,
};

export interface EngineResult {
  journeys: Journey[];
  labelsExplored: number;
  rejectionCounts: Partial<Record<RejectionReason, number>>;
  rejectionSamples: RejectionSample[];
  segmentsUsed: number;
  durationMs: number;
  truncated: boolean;
}

interface Label {
  node: string;
  time: number;
  cost: number;
  unknown: number;
  vehicles: number;
  legs: number;
  /** Départ effectif (premier segment planifié, recalé) ; +Infinity tant qu'aucun segment planifié. */
  start: number;
  /** Segment ayant amené à ce nœud (horaires matérialisés pour les flexibles). */
  seg: TransportSegment | null;
  prev: Label | null;
  dead: boolean;
}

/** Déduplique des segments identiques venant de plusieurs sources (on garde la meilleure confiance, puis le moins cher). */
export function dedupeSegments(segments: TransportSegment[]): TransportSegment[] {
  const map = new Map<string, TransportSegment>();
  for (const s of segments) {
    const key = segmentSignature(s);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, s);
      continue;
    }
    const better =
      PRICE_CONFIDENCE_RANK[s.priceConfidence] < PRICE_CONFIDENCE_RANK[cur.priceConfidence] ||
      (s.priceConfidence === cur.priceConfidence && (s.price?.amountMinor ?? Infinity) < (cur.price?.amountMinor ?? Infinity));
    if (better) map.set(key, s);
  }
  return [...map.values()];
}

class MinHeap {
  private a: Label[] = [];
  get size() {
    return this.a.length;
  }
  push(l: Label) {
    const a = this.a;
    a.push(l);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.time <= a[i]!.time) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): Label | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.time < a[m]!.time) m = l;
        if (r < a.length && a[r]!.time < a[m]!.time) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

function dominates(a: Label, b: Label): boolean {
  if (a.time > b.time || a.cost > b.cost || a.vehicles > b.vehicles || a.start < b.start || a.unknown > b.unknown) return false;
  return true; // égalité totale : on garde le premier arrivé
}

function segAllowed(s: TransportSegment, c: EngineConstraints): RejectionReason | null {
  if (c.excludedModes.has(s.mode)) return "excluded_mode";
  if (c.includedModes && !c.includedModes.has(s.mode)) {
    const cat = MODE_CATEGORY[s.mode];
    if (cat !== "LOCAL" && cat !== "FLEX") return "excluded_mode";
  }
  if (s.availability === "sold_out") return "sold_out";
  return null;
}

function describe(s: TransportSegment, at: "dep" | "arr"): string {
  const tz = at === "dep" ? s.origin.timezone : s.destination.timezone;
  const t = at === "dep" ? s.departureTime : s.arrivalTime;
  return `${s.mode} ${s.origin.name} → ${s.destination.name} (${at === "dep" ? "dép." : "arr."} ${formatLocalTime(t, tz)})`;
}

export function runLabelSearch(
  rawSegments: TransportSegment[],
  c: EngineConstraints,
  limits: EngineLimits = DEFAULT_ENGINE_LIMITS,
): EngineResult {
  const t0 = Date.now();
  const rejectionCounts: Partial<Record<RejectionReason, number>> = {};
  const samples: RejectionSample[] = [];
  const reject = (reason: RejectionReason, detail?: () => string, n = 1) => {
    rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + n;
    if (detail && samples.length < limits.maxRejectionSamples && samples.filter((s) => s.reason === reason).length < 8) {
      samples.push({ reason, detail: detail() });
    }
  };

  // --- Construction du graphe ---
  const scheduled = new Map<string, TransportSegment[]>();
  const flexible = new Map<string, TransportSegment[]>();
  const segments = dedupeSegments(rawSegments);
  let used = 0;
  for (const s of segments) {
    const why = segAllowed(s, c);
    if (why) {
      reject(why, why === "excluded_mode" ? () => `${s.mode} ${s.origin.name} → ${s.destination.name}` : undefined);
      continue;
    }
    if (s.destination.id === c.originId || s.origin.id === c.destinationId || s.origin.id === s.destination.id) continue;
    const map = s.flexibleDeparture ? flexible : scheduled;
    const list = map.get(s.origin.id) ?? [];
    list.push(s);
    map.set(s.origin.id, list);
    used++;
  }
  for (const list of scheduled.values()) list.sort((a, b) => toEpochMs(a.departureTime) - toEpochMs(b.departureTime));
  const depCache = new Map<TransportSegment, number>();
  const dep = (s: TransportSegment) => {
    let v = depCache.get(s);
    if (v === undefined) {
      v = toEpochMs(s.departureTime);
      depCache.set(s, v);
    }
    return v;
  };

  // --- Recherche ---
  const bags = new Map<string, Label[]>();
  const heap = new MinHeap();
  const start: Label = { node: c.originId, time: c.earliestDepartureMs, cost: 0, unknown: 0, vehicles: 0, legs: 0, start: Infinity, seg: null, prev: null, dead: false };
  bags.set(c.originId, [start]);
  heap.push(start);
  let explored = 0;
  let truncated = false;

  const beamScore = (l: Label) => l.cost / 100 + ((l.time - c.earliestDepartureMs) / 3_600_000) * 12 + l.vehicles * 5;

  const tryInsert = (l: Label): boolean => {
    // Borne cible : un trajet déjà complet meilleur sur tous les critères rend ce label inutile.
    const target = bags.get(c.destinationId);
    if (l.node !== c.destinationId && target) {
      for (const d of target) {
        if (!d.dead && d.time <= l.time && d.cost <= l.cost && d.vehicles <= l.vehicles && d.unknown <= l.unknown && d.start >= l.start) {
          reject("dominated");
          return false;
        }
      }
    }
    const bag = bags.get(l.node) ?? [];
    for (const o of bag) {
      if (dominates(o, l)) {
        reject("dominated");
        return false;
      }
    }
    const kept = bag.filter((o) => {
      if (dominates(l, o)) {
        o.dead = true;
        return false;
      }
      return true;
    });
    kept.push(l);
    if (kept.length > limits.beamWidth) {
      // Beam : on garde les extrêmes de chaque critère, puis le meilleur compromis.
      const keep = new Set<Label>();
      keep.add(kept.reduce((a, b) => (b.time < a.time ? b : a)));
      keep.add(kept.reduce((a, b) => (b.cost < a.cost ? b : a)));
      keep.add(kept.reduce((a, b) => (b.vehicles < a.vehicles ? b : a)));
      for (const o of [...kept].sort((a, b) => beamScore(a) - beamScore(b))) {
        if (keep.size >= limits.beamWidth) break;
        keep.add(o);
      }
      for (const o of kept) {
        if (!keep.has(o)) {
          o.dead = true;
          reject("beam_pruned");
        }
      }
      bags.set(l.node, kept.filter((o) => keep.has(o)));
      return keep.has(l);
    }
    bags.set(l.node, kept);
    return true;
  };

  const visited = (l: Label, node: string) => {
    for (let p: Label | null = l; p; p = p.prev) if (p.node === node) return true;
    return false;
  };

  const extend = (l: Label, s: TransportSegment, departMs: number, arriveMs: number) => {
    const isVeh = isVehicle(s);
    const vehicles = l.vehicles + (isVeh ? 1 : 0);
    if (c.maxTransfers !== undefined && vehicles - 1 > c.maxTransfers) {
      reject("too_many_transfers");
      return;
    }
    if (l.legs + 1 > limits.maxLegs) {
      reject("too_many_legs");
      return;
    }
    const cost = l.cost + (s.price?.amountMinor ?? 0);
    if (c.maxBudgetMinor !== undefined && cost > c.maxBudgetMinor) {
      reject("over_budget", () => `${describe(s, "dep")} : total ${(cost / 100).toFixed(2)} > budget ${(c.maxBudgetMinor! / 100).toFixed(2)}`);
      return;
    }
    if (c.latestArrivalMs !== undefined && arriveMs > c.latestArrivalMs) {
      reject("arrives_too_late", () => `${describe(s, "arr")} après l'heure d'arrivée maximale`);
      return;
    }
    let startMs = l.start;
    if (startMs === Infinity && !s.flexibleDeparture) {
      // Départ effectif = départ du premier segment planifié moins les segments flexibles qui le précèdent.
      let back = departMs;
      let next: TransportSegment = s;
      for (let p: Label | null = l; p && p.seg; p = p.prev) {
        back -= requiredConnection(p.seg, next, c.connection).minutes * MINUTE_MS + p.seg.durationMinutes * MINUTE_MS;
        next = p.seg;
      }
      startMs = Math.max(back, c.earliestDepartureMs);
    }
    const effectiveStart = startMs === Infinity ? c.earliestDepartureMs : startMs;
    if (arriveMs - effectiveStart > limits.maxTotalMinutes * MINUTE_MS) return;
    const materialized: TransportSegment = s.flexibleDeparture
      ? { ...s, departureTime: toIsoUtc(departMs), arrivalTime: toIsoUtc(arriveMs) }
      : s;
    const nl: Label = {
      node: s.destination.id,
      time: arriveMs,
      cost,
      unknown: l.unknown + (!s.price && s.mode !== "walk" ? 1 : 0),
      vehicles,
      legs: l.legs + 1,
      start: startMs,
      seg: materialized,
      prev: l,
      dead: false,
    };
    if (tryInsert(nl) && nl.node !== c.destinationId) heap.push(nl);
  };

  for (let l = heap.pop(); l; l = heap.pop()) {
    if (l.dead) continue;
    explored++;
    if (explored > limits.maxLabels) {
      truncated = true;
      break;
    }
    const isStart = l.prev === null;

    // Arêtes planifiées.
    const list = scheduled.get(l.node) ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dep(list[mid]!) < l.time) lo = mid + 1;
      else hi = mid;
    }
    const maxWait = (isStart ? limits.maxInitialWaitMinutes : limits.maxWaitMinutes) * MINUTE_MS;
    for (let i = lo; i < list.length; i++) {
      const s = list[i]!;
      const d = dep(s);
      if (visited(l, s.destination.id)) continue;
      const req = requiredConnection(l.seg, s, c.connection).minutes * MINUTE_MS;
      if (d < l.time + req) {
        if (l.seg) {
          reject("connection_too_short", () =>
            `${describe(l.seg!, "arr")} → ${describe(s, "dep")} : marge ${Math.round((d - l.time) / MINUTE_MS)} min < ${Math.round(req / MINUTE_MS)} min requises`,
          );
        }
        continue;
      }
      if (d - l.time > maxWait + req) {
        if (!isStart) reject("too_long_wait");
        break;
      }
      extend(l, s, d, toEpochMs(s.arrivalTime));
    }

    // Arêtes flexibles : pas deux segments flexibles consécutifs du même mode (marche → marche),
    // mais taxi → marche jusqu'à l'arrêt est permis.
    {
      for (const s of flexible.get(l.node) ?? []) {
        if (l.seg?.flexibleDeparture && l.seg.mode === s.mode) continue;
        if (visited(l, s.destination.id)) continue;
        const req = requiredConnection(l.seg, s, c.connection).minutes * MINUTE_MS;
        const d = l.time + req;
        extend(l, s, d, d + s.durationMinutes * MINUTE_MS);
      }
    }
  }

  // --- Reconstruction ---
  const finals = (bags.get(c.destinationId) ?? []).filter((l) => !l.dead);
  const journeys: Journey[] = [];
  for (const f of finals) {
    const segs: TransportSegment[] = [];
    for (let p: Label | null = f; p && p.seg; p = p.prev) segs.unshift(p.seg);
    if (segs.length === 0) continue;
    journeys.push(buildJourney(segs, c.connection, c.currency));
  }
  const front = paretoFront(dedupeJourneys(journeys));
  const dominatedAtEnd = journeys.length - front.length;
  if (dominatedAtEnd > 0) reject("dominated", undefined, dominatedAtEnd);

  return {
    journeys: front.sort((a, b) => toEpochMs(a.arrivalTime) - toEpochMs(b.arrivalTime)),
    labelsExplored: explored,
    rejectionCounts,
    rejectionSamples: samples,
    segmentsUsed: used,
    durationMs: Date.now() - t0,
    truncated,
  };
}
