import "server-only";
import { z } from "zod";
import { getContainer } from "./container";
import { logger } from "./logger";
import { RateLimiter } from "./rate-limit";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** Enveloppe commune : rate limit, erreurs normalisées (aucune stack exposée). */
export async function handle(req: Request, fn: () => Promise<Response>, opts: { rateLimit?: boolean } = {}): Promise<Response> {
  try {
    if (opts.rateLimit !== false) {
      const { allowed, retryAfterSeconds } = await getContainer().rateLimiter.check(RateLimiter.clientKey(req));
      if (!allowed) return errorResponse(429, "rate_limited", "Trop de requêtes, réessaie dans un instant.", { "Retry-After": String(retryAfterSeconds) });
    }
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof z.ZodError) {
      return errorResponse(400, "invalid_input", err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    }
    logger.error({ event: "api.error", error: err instanceof Error ? err.message : String(err) }, "unhandled API error");
    return errorResponse(500, "internal_error", "Erreur interne.");
  }
}

export async function readJson(req: Request, maxBytes = 20_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", "Requête trop volumineuse.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "JSON invalide.");
  }
}
