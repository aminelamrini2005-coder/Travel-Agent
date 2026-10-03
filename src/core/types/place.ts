import { z } from "zod";

export const PLACE_KINDS = [
  "address",
  "city",
  "station",
  "airport",
  "bus_station",
  "port",
  "poi",
  "coordinates",
] as const;
export const PlaceKindSchema = z.enum(PLACE_KINDS);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

export const PlaceSchema = z.object({
  /** Identifiant stable : "hub:NCE", "place:vallauris", "geo:43.6,7.05"… */
  id: z.string().min(1),
  name: z.string().min(1),
  kind: PlaceKindSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Fuseau IANA, ex. "Europe/Paris". */
  timezone: z.string().min(1),
  countryCode: z.string().length(2).optional(),
  codes: z
    .object({
      iata: z.string().optional(),
      uic: z.string().optional(),
      gtfsStopIds: z.array(z.string()).optional(),
    })
    .optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Ce que l'utilisateur a écrit (texte libre ou coordonnées), avant résolution. */
export const LocationQuerySchema = z.union([
  z.object({ text: z.string().min(1) }),
  z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
]);
export type LocationQuery = z.infer<typeof LocationQuerySchema>;
