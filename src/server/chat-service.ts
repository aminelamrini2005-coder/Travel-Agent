import "server-only";
import { applyPatch } from "@/core/conversation/apply-patch";
import { LocationNotFoundError } from "@/core/location/resolver";
import { formatMoney } from "@/core/money";
import { runSearch } from "@/core/search/run-search";
import { formatDuration, formatLocalTime, nowLocal } from "@/core/time";
import type { SearchParams, SearchResult } from "@/core/types";
import { t } from "@/i18n";
import type { Container } from "./container";

export interface ChatResponse {
  conversationId: string;
  reply: string;
  params: Partial<SearchParams> | null;
  result?: SearchResult;
  clarification?: { key: string; params: Record<string, string> };
  understoodBy: string;
}

/** Résumé textuel construit à partir du résultat structuré (aucun chiffre n'est produit par un LLM). */
export function summarize(result: SearchResult): string {
  if (result.journeys.length === 0) {
    return t("reply.empty", { reason: t(result.emptyReasonKey ?? "empty.noRoute") });
  }
  const top = result.journeys.find((j) => j.id === result.ranking[0]?.journeyId) ?? result.journeys[0]!;
  const price =
    top.unknownPriceSegments > 0
      ? top.totalPrice.amountMinor > 0
        ? `≥ ${formatMoney(top.totalPrice)} (+ prix inconnus)`
        : t("price.unknownShort")
      : formatMoney(top.totalPrice);
  const parts = [
    t("reply.summary", {
      count: result.journeys.length,
      price,
      duration: formatDuration(top.totalDurationMinutes),
      arrival: formatLocalTime(top.arrivalTime, top.segments[top.segments.length - 1]!.destination.timezone),
    }),
  ];
  parts.push(t("reply.coverage", { percent: top.dataQuality.realCoveragePercent, verified: top.dataQuality.verifiedSegments, counted: top.dataQuality.countedSegments }));
  if (result.alternatives.length) parts.push(t("reply.alternatives", { count: result.alternatives.length }));
  const gaps = top.dataQuality.uncoveredLegs.filter((l) => l.kind === "mock");
  if (gaps.length) parts.push(t("reply.uncovered", { legs: gaps.map((l) => `${l.from} → ${l.to} (${t(`mode.${l.mode}`)})`).join(" ; ") }));
  if (top.dataQuality.mockSegments > 0) parts.push(t("reply.summaryMock"));
  else if (result.containsMockData) parts.push(t("reply.otherOptionsMock"));
  return parts.join(" ");
}

export async function handleChat(c: Container, input: { conversationId?: string; message: string }): Promise<ChatResponse> {
  let conversationId = input.conversationId;
  let conv = conversationId ? await c.store.getConversation(conversationId) : null;
  if (!conv) {
    conversationId = await c.store.createConversation();
    conv = { id: conversationId, currentParams: null, messages: [] };
  }
  const id = conv.id;
  await c.store.addMessage(id, { role: "user", content: input.message });

  const now = c.deps.now?.() ?? new Date();
  const patch = await c.extractor.extract(input.message, { now, timezone: c.timezone, previous: conv.currentParams });
  const applied = applyPatch(conv.currentParams, patch, nowLocal(c.timezone, now));
  await c.store.saveConversationParams(id, applied.draft);

  const finish = async (resp: Omit<ChatResponse, "conversationId" | "understoodBy">): Promise<ChatResponse> => {
    await c.store.addMessage(id, { role: "assistant", content: resp.reply, searchId: resp.result?.searchId });
    return { ...resp, conversationId: id, understoodBy: c.extractor.id };
  };

  if (!applied.params) {
    const key = applied.missing.length === 2 ? "clarify.both" : `clarify.${applied.missing[0]}`;
    return finish({ reply: t(key), params: applied.draft, clarification: { key, params: {} } });
  }

  try {
    const result = await runSearch(applied.params, c.deps);
    await c.store.saveSearch(result, id);
    return finish({ reply: summarize(result), params: applied.params, result });
  } catch (err) {
    if (err instanceof LocationNotFoundError) {
      const params = { place: err.query };
      return finish({ reply: t("clarify.locationNotFound", params), params: applied.draft, clarification: { key: "clarify.locationNotFound", params } });
    }
    throw err;
  }
}
