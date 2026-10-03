import "server-only";
import { createHash } from "node:crypto";
import type { RedisCache } from "./cache/redis-cache";

/** Rate limiting basique par client (fenêtre fixe d'une minute). En mémoire, ou Redis si configuré. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly redis?: RedisCache,
  ) {}

  /** L'identifiant client (IP) est haché : il n'est jamais stocké en clair. */
  static clientKey(req: Request): string {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
    return createHash("sha256").update(ip).digest("hex").slice(0, 16);
  }

  async check(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const minute = Math.floor(Date.now() / 60_000);
    if (this.redis) {
      try {
        const n = await this.redis.incr(`rl:${key}:${minute}`, 65);
        return { allowed: n <= this.perMinute, retryAfterSeconds: 60 - (Math.floor(Date.now() / 1000) % 60) };
      } catch {
        /* repli mémoire */
      }
    }
    const w = this.windows.get(key);
    if (!w || w.start !== minute) {
      this.windows.set(key, { start: minute, count: 1 });
      if (this.windows.size > 10_000) this.windows.clear();
      return { allowed: true, retryAfterSeconds: 0 };
    }
    w.count++;
    return { allowed: w.count <= this.perMinute, retryAfterSeconds: 60 - (Math.floor(Date.now() / 1000) % 60) };
  }
}
