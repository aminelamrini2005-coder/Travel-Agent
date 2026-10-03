import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Logs structurés JSON. Les champs sensibles sont masqués ; on ne logge jamais le texte libre
 * de l'utilisateur ni de clé API.
 */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: "travel-agent" },
  redact: {
    paths: ["*.apiKey", "*.token", "*.password", "*.authorization", "*.cookie", "message", "*.message.text", "headers"],
    censor: "[masqué]",
  },
});
