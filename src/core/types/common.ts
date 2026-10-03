import { z } from "zod";

/** Modes de transport supportés par l'architecture (tous ne sont pas encore servis par un provider). */
export const TRANSPORT_MODES = [
  "flight",
  "train",
  "regional_train",
  "high_speed_train",
  "coach",
  "bus",
  "metro",
  "tram",
  "ferry",
  "rideshare",
  "taxi",
  "vtc",
  "walk",
  "car_rental",
] as const;
export const TransportModeSchema = z.enum(TRANSPORT_MODES);
export type TransportMode = z.infer<typeof TransportModeSchema>;

/** Familles de modes, utilisées par les règles de correspondance et l'UI. */
export type ModeCategory = "FLIGHT" | "RAIL" | "COACH" | "LOCAL" | "RIDESHARE" | "FERRY" | "FLEX";

export const MODE_CATEGORY: Record<TransportMode, ModeCategory> = {
  flight: "FLIGHT",
  train: "RAIL",
  regional_train: "RAIL",
  high_speed_train: "RAIL",
  coach: "COACH",
  bus: "LOCAL",
  metro: "LOCAL",
  tram: "LOCAL",
  ferry: "FERRY",
  rideshare: "RIDESHARE",
  taxi: "FLEX",
  vtc: "FLEX",
  walk: "FLEX",
  car_rental: "FLEX",
};

/** Groupes de modes exposés à l'utilisateur (« enlève les bus » → bus + coach). */
export const MODE_GROUPS: Record<string, TransportMode[]> = {
  flight: ["flight"],
  train: ["train", "regional_train", "high_speed_train"],
  bus: ["bus", "coach"],
  coach: ["coach"],
  local: ["bus", "metro", "tram"],
  rideshare: ["rideshare"],
  taxi: ["taxi", "vtc"],
  ferry: ["ferry"],
  walk: ["walk"],
  car_rental: ["car_rental"],
};

/** Niveau de confiance d'un prix (amendement A). */
export const PRICE_CONFIDENCES = ["REAL", "RANGE", "ESTIMATED", "UNKNOWN"] as const;
export const PriceConfidenceSchema = z.enum(PRICE_CONFIDENCES);
export type PriceConfidence = z.infer<typeof PriceConfidenceSchema>;

/** Ordre du plus fiable au moins fiable — sert à calculer la confiance la plus faible d'un trajet. */
export const PRICE_CONFIDENCE_RANK: Record<PriceConfidence, number> = {
  REAL: 0,
  RANGE: 1,
  ESTIMATED: 2,
  UNKNOWN: 3,
};

/** Méthode d'accès à la source de données (amendement A). */
export const ACCESS_METHODS = ["API", "OPEN_DATA", "BROWSER", "COMPUTED", "MOCK"] as const;
export const AccessMethodSchema = z.enum(ACCESS_METHODS);
export type AccessMethod = z.infer<typeof AccessMethodSchema>;

/** Instant ISO 8601 avec offset explicite (on stocke en UTC : suffixe Z). */
export const IsoInstantSchema = z.iso.datetime({ offset: true });
