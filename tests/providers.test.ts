import { describe, expect, it } from "vitest";
import { MemoryCache } from "@/core/cache";
import { BrowserProvider, detectProtection, evaluateBrowserGate, type BrowserDriver, type TosReview } from "@/core/providers/browser/browser-provider";
import { ProviderRegistry } from "@/core/providers/registry";
import { ProviderBlockedError, type SegmentQuery, type TransportProvider } from "@/core/providers/types";
import type { Place, TransportSegment } from "@/core/types";
import { place, seg, silentLogger } from "./helpers";

const A = place("A");
const B = place("B");
const q: SegmentQuery = { origin: A, destination: B, windowStart: "2026-10-16T13:00:00Z", windowEnd: "2026-10-17T03:00:00Z", modes: ["train", "coach", "flight"], passengers: 1, currency: "EUR" };

function provider(id: string, impl: (q: SegmentQuery) => Promise<unknown[]>, over: Partial<TransportProvider> = {}): TransportProvider {
  return {
    id,
    displayName: id,
    accessMethod: "API",
    modes: ["train"],
    isMock: false,
    cacheTtlSeconds: 60,
    timeoutMs: 200,
    maxCallsPerSearch: 10,
    maxConcurrency: 4,
    availability: () => ({ enabled: true }),
    supports: () => true,
    search: impl as TransportProvider["search"],
    ...over,
  };
}

const goodSeg = () => seg({ mode: "train", from: A, to: B, dep: "2026-10-16T15:00:00Z", arr: "2026-10-16T17:00:00Z", price: 20 });

describe("ProviderRegistry", () => {
  it("un provider en panne ou trop lent n'empêche pas les autres de répondre", async () => {
    const reg = new ProviderRegistry([
      provider("ok", async () => [goodSeg()]),
      provider("boom", async () => {
        throw new Error("HTTP 503");
      }),
      provider("slow", () => new Promise((r) => setTimeout(() => r([goodSeg()]), 2000))),
    ]);
    const out = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(out.segments).toHaveLength(1);
    const status = Object.fromEntries(out.queries.map((x) => [x.providerId, x.status]));
    expect(status).toEqual({ ok: "success", boom: "error", slow: "timeout" });
  });

  it("s'arrête net sur une protection anti-bot (statut blocked, aucun contournement)", async () => {
    const reg = new ProviderRegistry([
      provider("guarded", async () => {
        throw new ProviderBlockedError("captcha");
      }),
    ]);
    const out = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(out.queries[0]!.status).toBe("blocked");
  });

  it("force la provenance : un provider mock ne peut pas produire de données « réelles »", async () => {
    const reg = new ProviderRegistry([provider("m", async () => [{ ...goodSeg(), isMock: false, accessMethod: "API" }], { isMock: true, accessMethod: "MOCK" })]);
    const out = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(out.segments[0]!.isMock).toBe(true);
    expect(out.segments[0]!.accessMethod).toBe("MOCK");
  });

  it("écarte les segments invalides et hors fenêtre", async () => {
    const bad = { ...goodSeg(), departureTime: "pas une date" };
    const outside = seg({ mode: "train", from: A, to: B, dep: "2026-10-18T15:00:00Z", arr: "2026-10-18T17:00:00Z" });
    const reg = new ProviderRegistry([provider("p", async () => [goodSeg(), bad, outside])]);
    const out = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(out.segments).toHaveLength(1);
    expect(out.invalidSegments).toBe(1);
  });

  it("met en cache selon le TTL du provider et le trace comme cache_hit", async () => {
    let calls = 0;
    const reg = new ProviderRegistry([provider("p", async () => (calls++, [goodSeg()]))], new MemoryCache());
    await reg.execute([q], { phase: "primary", logger: silentLogger });
    const second = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(calls).toBe(1);
    expect(second.queries[0]!.status).toBe("cache_hit");
    expect(second.segments[0]!.checkedAt).toBe("2026-10-03T10:00:00Z"); // l'heure de vérification d'origine est conservée
  });

  it("respecte le budget d'appels par provider", async () => {
    const reg = new ProviderRegistry([provider("p", async () => [], { maxCallsPerSearch: 2, cacheTtlSeconds: 0 })]);
    const qs = [q, { ...q, destination: place("C") }, { ...q, destination: place("D") }];
    const out = await reg.execute(qs, { phase: "primary", logger: silentLogger });
    expect(out.queries.filter((x) => x.status === "skipped_budget")).toHaveLength(1);
  });

  it("ignore un provider désactivé et une paire non couverte", async () => {
    let called = false;
    const reg = new ProviderRegistry([
      provider("off", async () => ((called = true), []), { availability: () => ({ enabled: false, reasonKey: "provider.disabled.apiKeyMissing" }) }),
      provider("nope", async () => ((called = true), []), { supports: () => false }),
    ]);
    const out = await reg.execute([q], { phase: "primary", logger: silentLogger });
    expect(called).toBe(false);
    expect(out.queries).toHaveLength(0);
  });
});

const review = (over: Partial<TosReview> = {}): TosReview => ({
  platform: "Exemple",
  termsUrl: "https://example.org/cgu",
  reviewedOn: "2026-09-01",
  automationAllowed: true,
  evidence: "Article X des CGU",
  ...over,
});

describe("BrowserProvider — garde-fous", () => {
  const today = new Date("2026-10-03T00:00:00Z");
  it("désactivé sans revue des CGU, si les CGU interdisent, si la revue a expiré, sans opt-in ou sans session", () => {
    expect(evaluateBrowserGate({ review: null, optInEnv: "true", hasDriver: true, today }).reasonKey).toBe("provider.disabled.noTosReview");
    expect(evaluateBrowserGate({ review: review({ automationAllowed: false }), optInEnv: "true", hasDriver: true, today }).reasonKey).toBe("provider.disabled.tosForbids");
    expect(evaluateBrowserGate({ review: review({ reviewedOn: "2025-01-01" }), optInEnv: "true", hasDriver: true, today }).reasonKey).toBe("provider.disabled.tosReviewExpired");
    expect(evaluateBrowserGate({ review: review(), optInEnv: undefined, hasDriver: true, today }).reasonKey).toBe("provider.disabled.noOptIn");
    expect(evaluateBrowserGate({ review: review(), optInEnv: "true", hasDriver: false, today }).reasonKey).toBe("provider.disabled.noBrowserSession");
    expect(evaluateBrowserGate({ review: review(), optInEnv: "true", hasDriver: true, today }).enabled).toBe(true);
  });

  it("détecte les protections", () => {
    expect(detectProtection("<div id='px-captcha'>Press & Hold</div>")).not.toBeNull();
    expect(detectProtection("<html>Résultats : 3 trajets</html>")).toBeNull();
  });

  class DemoBrowserProvider extends BrowserProvider {
    readonly id = "demo-browser";
    readonly displayName = "Démo navigateur";
    readonly modes = ["train"] as const;
    supports() {
      return true;
    }
    protected buildSearchUrl() {
      return "https://example.org/search?from=A&to=B";
    }
    protected parseResults(_html: string, ctx: { origin: Place; destination: Place; sourceUrl: string; checkedAt: string }): TransportSegment[] {
      return [{ ...goodSeg(), origin: ctx.origin, destination: ctx.destination, accessMethod: "API" }];
    }
  }

  it("conserve la source, l'heure de récupération et l'URL ; s'arrête sur CAPTCHA", async () => {
    const okDriver: BrowserDriver = { open: async (url) => ({ finalUrl: url + "&page=1", html: "<html>ok</html>" }) };
    const p = new DemoBrowserProvider(review(), "true", okDriver, () => today);
    const segs = await p.search(q, { signal: new AbortController().signal, logger: silentLogger, now: () => new Date("2026-10-03T10:05:00Z") });
    expect(segs[0]!.accessMethod).toBe("BROWSER");
    expect(segs[0]!.sourceUrl).toBe("https://example.org/search?from=A&to=B&page=1");
    expect(segs[0]!.checkedAt).toBe("2026-10-03T10:05:00.000Z");

    const captcha: BrowserDriver = { open: async (url) => ({ finalUrl: url, html: "Please complete the CAPTCHA" }) };
    const blocked = new DemoBrowserProvider(review(), "true", captcha, () => today);
    await expect(blocked.search(q, { signal: new AbortController().signal, logger: silentLogger, now: () => today })).rejects.toBeInstanceOf(ProviderBlockedError);
  });

  it("ne fait aucun appel quand il est désactivé", async () => {
    let opened = false;
    const driver: BrowserDriver = { open: async (url) => ((opened = true), { finalUrl: url, html: "" }) };
    const p = new DemoBrowserProvider(review({ automationAllowed: false }), "true", driver, () => today);
    expect(await p.search(q, { signal: new AbortController().signal, logger: silentLogger, now: () => today })).toEqual([]);
    expect(opened).toBe(false);
  });
});
