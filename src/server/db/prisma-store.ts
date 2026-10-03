import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import type { SearchParams, SearchResult } from "@/core/types";
import { journeyIn, type Store, type StoredMessage } from "./store";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export class PrismaStore implements Store {
  readonly kind = "postgres" as const;
  private readonly prisma: PrismaClient;

  constructor(connectionString: string) {
    this.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  async createConversation() {
    const c = await this.prisma.conversation.create({ data: {} });
    return c.id;
  }

  async getConversation(id: string) {
    const c = await this.prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
    });
    if (!c) return null;
    return {
      id: c.id,
      currentParams: (c.currentParams as Partial<SearchParams> | null) ?? null,
      messages: c.messages.map((m) => ({
        role: m.role as StoredMessage["role"],
        content: m.content,
        searchId: m.searchId ?? undefined,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async saveConversationParams(id: string, params: Partial<SearchParams> | null) {
    await this.prisma.conversation.update({ where: { id }, data: { currentParams: params === null ? undefined : json(params) } });
  }

  async addMessage(conversationId: string, msg: Omit<StoredMessage, "createdAt">) {
    await this.prisma.message.create({ data: { conversationId, role: msg.role, content: msg.content, searchId: msg.searchId } });
  }

  async saveSearch(result: SearchResult, conversationId?: string) {
    await this.prisma.search.create({
      data: {
        id: result.searchId,
        conversationId,
        params: json(result.params),
        result: json(result),
        containsMock: result.containsMockData,
        journeyCount: result.journeys.length,
        providerCalls: {
          create: result.trace.queries
            .filter((q) => q.status !== "cache_hit" && q.status !== "skipped_budget")
            .map((q) => ({
              providerId: q.providerId,
              accessMethod: q.accessMethod,
              status: q.status,
              durationMs: Math.round(q.durationMs),
              resultCount: q.resultCount,
              phase: q.phase,
            })),
        },
      },
    });
  }

  async getSearch(id: string) {
    const s = await this.prisma.search.findUnique({ where: { id } });
    return s ? (s.result as unknown as SearchResult) : null;
  }

  async findJourney(journeyId: string, searchId?: string) {
    const searches = searchId
      ? await this.prisma.search.findMany({ where: { id: searchId } })
      : await this.prisma.search.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
    for (const s of searches) {
      const search = s.result as unknown as SearchResult;
      const journey = journeyIn(search, journeyId);
      if (journey) return { search, journey };
    }
    return null;
  }

  async ping() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
