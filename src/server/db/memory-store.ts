import "server-only";
import { randomUUID } from "node:crypto";
import type { SearchParams, SearchResult } from "@/core/types";
import { journeyIn, type Store, type StoredConversation, type StoredMessage } from "./store";

/** Stockage en mémoire (développement sans base de données). Borné pour éviter les fuites. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly searches = new Map<string, SearchResult>();

  constructor(private readonly maxSearches = 200) {}

  async createConversation() {
    const id = randomUUID();
    this.conversations.set(id, { id, currentParams: null, messages: [] });
    return id;
  }
  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }
  async saveConversationParams(id: string, params: Partial<SearchParams> | null) {
    const c = this.conversations.get(id);
    if (c) c.currentParams = params;
  }
  async addMessage(conversationId: string, msg: Omit<StoredMessage, "createdAt">) {
    this.conversations.get(conversationId)?.messages.push({ ...msg, createdAt: new Date().toISOString() });
  }
  async saveSearch(result: SearchResult) {
    this.searches.set(result.searchId, result);
    while (this.searches.size > this.maxSearches) this.searches.delete(this.searches.keys().next().value!);
  }
  async getSearch(id: string) {
    return this.searches.get(id) ?? null;
  }
  async findJourney(journeyId: string, searchId?: string) {
    const candidates = searchId ? [this.searches.get(searchId)].filter((s) => !!s) : [...this.searches.values()].reverse();
    for (const search of candidates) {
      const journey = journeyIn(search, journeyId);
      if (journey) return { search, journey };
    }
    return null;
  }
  async ping() {
    return true;
  }
}
