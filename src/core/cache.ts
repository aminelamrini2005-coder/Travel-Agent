/** Cache clé/valeur avec TTL. Implémentations : mémoire (défaut) ou Redis (src/server/cache). */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

/** LRU en mémoire avec expiration. Suffisant pour un seul processus. */
export class MemoryCache implements Cache {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Rafraîchit la position LRU.
    this.map.delete(key);
    this.map.set(key, e);
    return structuredClone(e.value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value: structuredClone(value), expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

/** Cache désactivé. */
export class NoCache implements Cache {
  async get<T>(): Promise<T | undefined> {
    return undefined;
  }
  async set(): Promise<void> {}
}
