import { getContainer } from "@/server/container";
import { handle, HttpError } from "@/server/http";

/** Trace complète d'une recherche (« Voir toutes les recherches »). */
export async function GET(req: Request, ctx: RouteContext<"/api/searches/[id]/trace">) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const search = await getContainer().store.getSearch(id);
    if (!search) throw new HttpError(404, "not_found", "Recherche introuvable.");
    return Response.json(search.trace);
  });
}
