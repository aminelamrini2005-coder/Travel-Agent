import { getContainer } from "@/server/container";

export async function GET() {
  const c = getContainer();
  const db = await c.store.ping();
  return Response.json({
    status: db ? "ok" : "degraded",
    store: c.store.kind,
    database: db,
    cache: c.cacheKind,
    llm: c.extractor.id,
    mockProviders: c.deps.registry.list().some((p) => p.isMock),
  });
}
