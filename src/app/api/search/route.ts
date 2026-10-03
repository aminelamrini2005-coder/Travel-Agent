import { runSearch } from "@/core/search/run-search";
import { SearchParamsSchema } from "@/core/types";
import { LocationNotFoundError } from "@/core/location/resolver";
import { getContainer } from "@/server/container";
import { handle, HttpError, readJson } from "@/server/http";

/** Recherche directe avec des paramètres structurés (sans LLM). */
export async function POST(req: Request) {
  return handle(req, async () => {
    const params = SearchParamsSchema.parse(await readJson(req));
    const c = getContainer();
    try {
      const result = await runSearch(params, c.deps);
      await c.store.saveSearch(result);
      return Response.json(result);
    } catch (err) {
      if (err instanceof LocationNotFoundError) throw new HttpError(422, "location_not_found", `Lieu introuvable : ${err.query}`);
      throw err;
    }
  });
}
