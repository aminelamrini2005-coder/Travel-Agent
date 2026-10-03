import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { z } from "zod";
import { parseMessage, type ParseContext } from "@/core/conversation/rule-parser";
import { SearchParamsPatchSchema, TRANSPORT_MODES, type SearchParamsPatch } from "@/core/types";
import { nowLocal } from "@/core/time";

/**
 * Schéma demandé au LLM. Volontairement plat et « nullable » (compatible sorties structurées).
 * Il ne contient QUE des contraintes exprimées par l'utilisateur : aucun horaire de transport, prix ou trajet.
 */
export const LlmIntentSchema = z.object({
  origin: z.string().nullable().describe("Lieu de départ tel qu'écrit par l'utilisateur, ou null s'il n'est pas mentionné dans CE message"),
  destination: z.string().nullable().describe("Lieu d'arrivée tel qu'écrit, ou null"),
  earliestDeparture: z.string().nullable().describe("Départ au plus tôt, heure LOCALE au format YYYY-MM-DDTHH:mm, ou null"),
  departureIsHardConstraint: z.boolean().nullable().describe("true si l'utilisateur ne peut pas partir avant (ex. fin des cours)"),
  latestArrival: z.string().nullable().describe("Arrivée au plus tard, heure LOCALE YYYY-MM-DDTHH:mm, ou null"),
  shiftDepartureMinutes: z.number().int().nullable().describe("Décalage relatif du départ demandé (« 2 h plus tôt » = -120), ou null"),
  objective: z.enum(["best", "cheapest", "fastest", "comfort"]).nullable(),
  maxBudget: z.number().nullable().describe("Budget total maximum en unités de la devise, ou null"),
  clearMaxBudget: z.boolean().describe("true si l'utilisateur lève sa contrainte de budget"),
  maxTransfers: z.number().int().nullable(),
  includedModes: z.array(z.enum(TRANSPORT_MODES)).nullable().describe("Restriction explicite à certains modes, ou null"),
  addExcludedModes: z.array(z.enum(TRANSPORT_MODES)).describe("Modes à exclure demandés dans ce message"),
  removeExcludedModes: z.array(z.enum(TRANSPORT_MODES)).describe("Modes précédemment exclus à réautoriser"),
  luggage: z.enum(["backpack", "cabin", "checked"]).nullable(),
  valueOfTimePerHour: z.number().nullable().describe("€ que l'utilisateur accepte de payer par heure gagnée, ou null"),
  minConnectionBufferMinutes: z.number().int().nullable(),
  isNewSearch: z.boolean().describe("true si le message démarre une nouvelle recherche plutôt que de modifier la précédente"),
});
export type LlmIntent = z.infer<typeof LlmIntentSchema>;

export function intentToPatch(i: LlmIntent): SearchParamsPatch {
  const p: SearchParamsPatch = {};
  if (i.isNewSearch) p.reset = true;
  if (i.origin) p.origin = { text: i.origin };
  if (i.destination) p.destination = { text: i.destination };
  if (i.earliestDeparture) p.earliestDeparture = i.earliestDeparture;
  if (i.departureIsHardConstraint !== null) p.departureFlexibility = i.departureIsHardConstraint ? "hard" : "soft";
  if (i.latestArrival) p.latestArrival = i.latestArrival;
  if (i.shiftDepartureMinutes) p.shiftDepartureMinutes = i.shiftDepartureMinutes;
  if (i.objective) p.objective = i.objective;
  if (i.maxBudget !== null && i.maxBudget > 0) p.maxBudget = i.maxBudget;
  if (i.clearMaxBudget) p.clearMaxBudget = true;
  if (i.maxTransfers !== null) p.maxTransfers = i.maxTransfers;
  if (i.includedModes?.length) p.includedModes = i.includedModes;
  if (i.addExcludedModes.length) p.addExcludedModes = i.addExcludedModes;
  if (i.removeExcludedModes.length) p.removeExcludedModes = i.removeExcludedModes;
  if (i.luggage) p.luggage = i.luggage;
  if (i.valueOfTimePerHour !== null) p.valueOfTimePerHour = i.valueOfTimePerHour;
  if (i.minConnectionBufferMinutes !== null) p.minConnectionBufferMinutes = i.minConnectionBufferMinutes;
  return p;
}

const SYSTEM_PROMPT = `Tu es le module de compréhension d'un planificateur de voyages multimodal.
Ta seule tâche : transformer le message de l'utilisateur en contraintes de recherche structurées.
Règles :
- N'invente jamais d'horaires de transport, de prix, de disponibilités ni de trajets : tu ne les connais pas.
- Ne remplis un champ que si le message l'exprime ; sinon null (ou false / liste vide).
- Les dates et heures sont des heures LOCALES (YYYY-MM-DDTHH:mm) calculées à partir de la date actuelle fournie.
- Si une recherche précédente existe et que le message la modifie (« seulement moins de 70 € », « enlève les bus »), isNewSearch = false et ne renvoie que les changements.
- Modes : flight, train, regional_train, high_speed_train, coach, bus, metro, tram, ferry, rideshare, taxi, vtc, walk, car_rental. « bus » au sens large = bus + coach ; « train » = train + regional_train + high_speed_train ; « taxi » = taxi + vtc.`;

export interface IntentExtractor {
  readonly id: string;
  extract(message: string, ctx: ParseContext): Promise<SearchParamsPatch>;
}

function contextText(message: string, ctx: ParseContext): string {
  return [
    `Date et heure actuelles (${ctx.timezone}) : ${nowLocal(ctx.timezone, ctx.now)}`,
    ctx.previous ? `Recherche précédente (JSON) : ${JSON.stringify(ctx.previous)}` : "Aucune recherche précédente.",
    `Message de l'utilisateur : ${message}`,
  ].join("\n");
}

/** Validation finale : un patch invalide n'est jamais transmis au moteur. */
function validated(intent: LlmIntent): SearchParamsPatch {
  const parsed = SearchParamsPatchSchema.safeParse(intentToPatch(intent));
  if (!parsed.success) throw new Error(`Patch LLM invalide : ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return parsed.data;
}

/** Claude via sorties structurées (le choix d'outil forcé n'est pas supporté sur les modèles récents). */
export class AnthropicIntentExtractor implements IntentExtractor {
  readonly id = "anthropic";
  private readonly client: Anthropic;
  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async extract(message: string, ctx: ParseContext): Promise<SearchParamsPatch> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 4000,
      // Repli serveur automatique si un classifieur de sécurité refuse la requête.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(LlmIntentSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: contextText(message, ctx) }],
    });
    if (response.stop_reason === "refusal") throw new Error("Requête refusée par le modèle");
    if (!response.parsed_output) throw new Error("Réponse LLM non structurée");
    return validated(response.parsed_output);
  }
}

export class OpenAIIntentExtractor implements IntentExtractor {
  readonly id = "openai";
  private readonly client: OpenAI;
  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async extract(message: string, ctx: ParseContext): Promise<SearchParamsPatch> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contextText(message, ctx) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "search_intent", schema: z.toJSONSchema(LlmIntentSchema) as Record<string, unknown>, strict: false } },
    });
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("Réponse LLM vide");
    return validated(LlmIntentSchema.parse(JSON.parse(content)));
  }
}

/** Analyseur local déterministe (aucune clé requise). */
export class RuleIntentExtractor implements IntentExtractor {
  readonly id = "rules";
  async extract(message: string, ctx: ParseContext): Promise<SearchParamsPatch> {
    return SearchParamsPatchSchema.parse(parseMessage(message, ctx));
  }
}

/**
 * LLM d'abord, analyseur local en repli. Les deux résultats sont fusionnés : le LLM prime, mais un champ
 * qu'il aurait omis et que les règles détectent sans ambiguïté (ex. budget) est conservé.
 */
export class FallbackIntentExtractor implements IntentExtractor {
  readonly id: string;
  constructor(
    private readonly primary: IntentExtractor | null,
    private readonly fallback: IntentExtractor = new RuleIntentExtractor(),
    private readonly onError: (err: unknown) => void = () => {},
  ) {
    this.id = primary ? `${primary.id}+rules` : "rules";
  }

  async extract(message: string, ctx: ParseContext) {
    const rules = await this.fallback.extract(message, ctx);
    if (!this.primary) return rules;
    try {
      const llm = await this.primary.extract(message, ctx);
      return { ...rules, ...llm };
    } catch (err) {
      this.onError(err);
      return rules;
    }
  }
}
