import "server-only";
import type { Journey, SearchParams, SearchResult } from "@/core/types";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  searchId?: string;
  createdAt: string;
}

export interface StoredConversation {
  id: string;
  currentParams: Partial<SearchParams> | null;
  messages: StoredMessage[];
}

/** Persistance des conversations et des recherches (PostgreSQL via Prisma, ou mémoire). */
export interface Store {
  readonly kind: "postgres" | "memory";
  createConversation(): Promise<string>;
  getConversation(id: string): Promise<StoredConversation | null>;
  saveConversationParams(id: string, params: Partial<SearchParams> | null): Promise<void>;
  addMessage(conversationId: string, msg: Omit<StoredMessage, "createdAt">): Promise<void>;
  saveSearch(result: SearchResult, conversationId?: string): Promise<void>;
  getSearch(id: string): Promise<SearchResult | null>;
  /** Cherche un trajet dans une recherche donnée, ou dans les recherches récentes. */
  findJourney(journeyId: string, searchId?: string): Promise<{ search: SearchResult; journey: Journey } | null>;
  ping(): Promise<boolean>;
}

export function journeyIn(search: SearchResult, journeyId: string): Journey | undefined {
  return search.journeys.find((j) => j.id === journeyId) ?? search.alternatives.find((a) => a.journey.id === journeyId)?.journey;
}
