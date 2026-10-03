import { haversineKm } from "../location/geo";
import { makeWalkSegment } from "../providers/computed/computed-providers";
import type { Place, TransportSegment } from "../types";

/**
 * Les sources réelles renvoient leurs propres arrêts (« Nice Airport (Bus Station - Terminal 1) »),
 * rarement exactement sur nos nœuds (hub, origine, destination). On relie donc à pied :
 *  - chaque arrêt « externe » aux nœuds du plan situés à moins de `maxKm` ;
 *  - les arrêts externes très proches entre eux (< `stopToStopKm`), pour les correspondances.
 * Les liaisons sont des estimations (COMPUTED) et apparaissent comme telles.
 */
export function walkLinks(
  segments: TransportSegment[],
  planNodes: Place[],
  opts: { maxKm?: number; stopToStopKm?: number; windowStart: string; currency: string; checkedAt: string },
): TransportSegment[] {
  const maxKm = opts.maxKm ?? 2.0;
  const stopKm = opts.stopToStopKm ?? 0.4;
  planNodes = [...new Map(planNodes.map((p) => [p.id, p])).values()];
  const planIds = new Set(planNodes.map((p) => p.id));
  const external = new Map<string, Place>();
  for (const s of segments) {
    for (const p of [s.origin, s.destination]) if (!planIds.has(p.id) && !external.has(p.id)) external.set(p.id, p);
  }
  const out: TransportSegment[] = [];
  const add = (a: Place, b: Place) => {
    out.push(makeWalkSegment(a, b, opts.windowStart, opts.currency, opts.checkedAt));
    out.push(makeWalkSegment(b, a, opts.windowStart, opts.currency, opts.checkedAt));
  };
  const ext = [...external.values()];
  for (const e of ext) {
    for (const n of planNodes) if (haversineKm(e, n) <= maxKm) add(e, n);
  }
  for (let i = 0; i < ext.length; i++) {
    for (let j = i + 1; j < ext.length; j++) {
      if (haversineKm(ext[i]!, ext[j]!) <= stopKm) add(ext[i]!, ext[j]!);
    }
  }
  return out;
}
