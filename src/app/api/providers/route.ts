import { DECLARED_SOURCES } from "@/core/providers/declared-sources";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";

/** Providers branchés (avec méthode d'accès et statut) + plateformes connues non intégrées. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const providers = getContainer().deps.registry.list().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      accessMethod: p.accessMethod,
      isMock: p.isMock,
      modes: p.modes,
      cacheTtlSeconds: p.cacheTtlSeconds,
      attribution: p.attribution,
      ...p.availability(),
    }));
    const integrations = getContainer().integrations.map(({ providers: ps, ...i }) => ({ ...i, providerIds: ps.map((p) => p.id) }));
    return Response.json({ providers, integrations, declaredSources: DECLARED_SOURCES });
  });
}
