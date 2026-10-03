import "server-only";
import Redis from "ioredis";
import type { Cache } from "@/core/cache";

/** Cache Redis partagé entre instances (activé si REDIS_URL est défini). */
export class RedisCache implements Cache {
  private readonly client: Redis;
  constructor(url: string, private readonly prefix = "ta:") {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.client.on("error", () => {
      /* une panne Redis ne doit jamais casser une recherche : get/set dégradent en « pas de cache » */
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const v = await this.client.get(this.prefix + key);
      return v ? (JSON.parse(v) as T) : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      await this.client.set(this.prefix + key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      /* ignoré */
    }
  }

  /** Incrément atomique avec expiration (rate limiting). */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = this.prefix + key;
    const n = await this.client.incr(k);
    if (n === 1) await this.client.expire(k, ttlSeconds);
    return n;
  }
}
