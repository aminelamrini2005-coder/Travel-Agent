import "server-only";
import { z } from "zod";

const bool = (def: "true" | "false") =>
  z
    .enum(["true", "false", ""])
    .default(def)
    .transform((v) => (v === "" ? def === "true" : v === "true"));
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** Variables d'environnement validées au démarrage. Aucune n'est exposée au navigateur. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: optional,
  REDIS_URL: optional,
  LLM_PROVIDER: z.enum(["auto", "anthropic", "openai", "none"]).default("auto"),
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: optional,
  /** fallback (défaut) : mocks uniquement là où aucune donnée réelle n'existe ; off : jamais ; all : toujours. */
  MOCK_POLICY: z.enum(["fallback", "off", "all", ""]).default("fallback").transform((v) => (v === "" ? "fallback" : v)),
  /** Ancien interrupteur (phase 1) : false équivaut à MOCK_POLICY=off. */
  USE_MOCK_PROVIDERS: bool("true"),
  GTFS_DIR: z.string().default("data/gtfs"),
  NOMINATIM_ENABLED: bool("true"),
  NOMINATIM_CONTACT_EMAIL: optional,
  NOMINATIM_USER_AGENT: optional,
  ENABLE_ECB_RATES: bool("true"),
  TRANSITOUS_ENABLED: bool("false"),
  TRANSITOUS_CONTACT: optional,
  SNCF_API_TOKEN: optional,
  DUFFEL_ACCESS_TOKEN: optional,
  BLABLACAR_API_KEY: optional,
  GOOGLE_MAPS_API_KEY: optional,
  BROWSER_PROFILE_DIR: optional,
  USER_TIMEZONE: z.string().default("Europe/Paris"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function env(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
