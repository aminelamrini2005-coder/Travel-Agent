import { getContainer } from "@/server/container";
import { handle, HttpError } from "@/server/http";

/** Détail d'un trajet issu d'une recherche stockée (instantané horodaté, non rafraîchi). */
export async function GET(req: Request, ctx: RouteContext<"/api/journeys/[id]">) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const searchId = new URL(req.url).searchParams.get("searchId") ?? undefined;
    const found = await getContainer().store.findJourney(id, searchId);
    if (!found) throw new HttpError(404, "not_found", "Trajet introuvable (recherche expirée ?).");
    return Response.json({ searchId: found.search.searchId, checkedAt: found.search.createdAt, journey: found.journey });
  });
}
