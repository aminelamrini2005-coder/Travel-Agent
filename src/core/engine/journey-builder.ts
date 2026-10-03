import { addMinutesIso, diffMinutes, toEpochMs } from "../time";
import {
  MODE_CATEGORY,
  PRICE_CONFIDENCE_RANK,
  type Connection,
  type Journey,
  type PriceConfidence,
  type RiskLevel,
  type TransportSegment,
} from "../types";
import { connectionRisk, missProbability, requiredConnection, type ConnectionContext } from "./connection-rules";

export function isVehicle(s: TransportSegment): boolean {
  return s.mode !== "walk";
}

export function segmentSignature(s: TransportSegment): string {
  return [s.mode, s.operator ?? "", s.serviceNumber ?? "", s.origin.id, s.destination.id, s.flexibleDeparture ? "flex" : s.departureTime].join("|");
}

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Recale les segments flexibles (marche, taxi) situés AVANT le premier segment à horaire fixe :
 * on part le plus tard possible tout en respectant la marge minimale. Évite d'afficher une attente
 * inutile au point de départ.
 */
export function alignLeadingFlexible(segments: TransportSegment[], ctx: ConnectionContext): TransportSegment[] {
  const out = segments.map((s) => ({ ...s }));
  const firstFixed = out.findIndex((s) => !s.flexibleDeparture);
  if (firstFixed <= 0) return out;
  for (let i = firstFixed - 1; i >= 0; i--) {
    const next = out[i + 1]!;
    const seg = out[i]!;
    const req = requiredConnection(seg, next, ctx).minutes;
    const arrival = addMinutesIso(next.departureTime, -req);
    // Ne jamais décaler plus tôt que l'horaire déjà calculé.
    if (toEpochMs(arrival) > toEpochMs(seg.arrivalTime)) {
      seg.arrivalTime = arrival;
      seg.departureTime = addMinutesIso(arrival, -seg.durationMinutes);
    }
  }
  return out;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/** Assemble un Journey complet (correspondances, totaux, fiabilité) à partir d'une suite de segments. */
export function buildJourney(rawSegments: TransportSegment[], ctx: ConnectionContext, currency: string): Journey {
  const segments = alignLeadingFlexible(rawSegments, ctx);
  const connections: Connection[] = [];
  let reliability = 1;
  let risk: RiskLevel = "low";
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const next = segments[i]!;
    const wait = diffMinutes(prev.arrivalTime, next.departureTime);
    const req = requiredConnection(prev, next, ctx);
    const p = missProbability(prev, next, wait, req);
    reliability *= 1 - p;
    // Correspondance vers un segment flexible, ou à très faible probabilité d'échec (marche maîtrisée,
    // bus local fréquent) : risque faible quelle que soit la marge.
    const level = MODE_CATEGORY[next.mode] === "FLEX" || p < 0.012 ? "low" : connectionRisk(wait, req.minutes);
    if (RISK_ORDER[level] > RISK_ORDER[risk]) risk = level;
    connections.push({
      fromSegmentId: prev.id,
      toSegmentId: next.id,
      waitMinutes: wait,
      requiredMinutes: req.minutes,
      slackMinutes: wait - req.minutes,
      separateTickets: req.separateTickets,
      missProbability: Math.round(p * 1000) / 1000,
      risk: level,
      notes: req.notes,
    });
  }
  if (reliability < 0.8) risk = "high";
  else if (reliability < 0.92 && risk === "low") risk = "medium";

  let total = 0;
  let totalMax = 0;
  let hasRange = false;
  let unknown = 0;
  let confidence: PriceConfidence = "REAL";
  for (const s of segments) {
    if (PRICE_CONFIDENCE_RANK[s.priceConfidence] > PRICE_CONFIDENCE_RANK[confidence]) confidence = s.priceConfidence;
    if (!s.price) {
      if (s.mode !== "walk") unknown++;
      continue;
    }
    total += s.price.amountMinor;
    if (s.priceRange) {
      hasRange = true;
      totalMax += s.priceRange.max.amountMinor;
    } else {
      totalMax += s.price.amountMinor;
    }
  }

  const vehicleLegs = segments.filter(isVehicle).length;
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const signature = segments.map(segmentSignature).join(">");
  const modes = [...new Set(segments.map((s) => s.mode))];
  const sources = [...new Map(segments.map((s) => [`${s.provider}|${s.accessMethod}`, { provider: s.provider, accessMethod: s.accessMethod }])).values()];

  return {
    id: `j_${shortHash(signature)}`,
    segments,
    connections,
    totalPrice: { amountMinor: total, currency },
    totalPriceMax: hasRange ? { amountMinor: totalMax, currency } : undefined,
    unknownPriceSegments: unknown,
    totalPriceConfidence: confidence,
    departureTime: first.departureTime,
    arrivalTime: last.arrivalTime,
    totalDurationMinutes: diffMinutes(first.departureTime, last.arrivalTime),
    transfers: Math.max(0, vehicleLegs - 1),
    walkingMinutes: segments.filter((s) => s.mode === "walk").reduce((a, s) => a + s.durationMinutes, 0),
    waitingMinutes: connections.reduce((a, c) => a + Math.max(0, c.waitMinutes), 0),
    reliabilityScore: Math.round(reliability * 1000) / 1000,
    riskLevel: risk,
    bookingLinks: segments.filter((s) => s.bookingUrl).map((s) => ({ segmentId: s.id, url: s.bookingUrl!, provider: s.provider })),
    containsMockData: segments.some((s) => s.isMock),
    modes,
    sources,
    signature,
  };
}
