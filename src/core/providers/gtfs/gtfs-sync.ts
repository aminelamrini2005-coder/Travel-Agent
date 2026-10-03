import type { GtfsFeedConfig } from "./feeds";

export interface DownloadedFeed {
  data: Uint8Array;
  sourceUsed: string;
  sourceKind: "official" | "mirror";
  /** Date de mise à jour de la source (Last-Modified, ou métadonnée du miroir). */
  sourceUpdatedAt: string;
}

/**
 * Télécharge un flux en PRÉFÉRANT TOUJOURS la source officielle directe ; la copie Mobility Database
 * n'est utilisée que si l'officielle est injoignable. Relancer la synchronisation remplace donc
 * automatiquement une copie miroir dès que la source officielle redevient accessible.
 */
export async function downloadFeed(
  feed: GtfsFeedConfig,
  fetchImpl: typeof fetch = fetch,
  userAgent = "TravelAgentAI/0.2 (gtfs-sync; open data import)",
  log: (msg: string) => void = () => {},
): Promise<DownloadedFeed | null> {
  const attempts: { url: string; kind: DownloadedFeed["sourceKind"] }[] = [{ url: feed.officialUrl, kind: "official" }];
  if (feed.mirrorUrl) attempts.push({ url: feed.mirrorUrl, kind: "mirror" });
  for (const { url, kind } of attempts) {
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(300_000) });
      if (!res.ok) {
        log(`  ✗ ${kind} → HTTP ${res.status}`);
        continue;
      }
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
        log(`  ✗ ${kind} → réponse qui n'est pas un ZIP`);
        continue;
      }
      const lm = res.headers.get("last-modified");
      let sourceUpdatedAt = lm ? new Date(lm).toISOString() : new Date().toISOString();
      if (kind === "mirror" && url.includes("storage.googleapis.com/storage/v1/")) {
        const meta = await fetchImpl(url.replace(/\?alt=media$/, ""), { headers: { "User-Agent": userAgent } })
          .then((r) => (r.ok ? (r.json() as Promise<{ updated?: string }>) : null))
          .catch(() => null);
        if (meta?.updated) sourceUpdatedAt = meta.updated;
      }
      return { data, sourceUsed: url, sourceKind: kind, sourceUpdatedAt };
    } catch (err) {
      log(`  ✗ ${kind} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}
