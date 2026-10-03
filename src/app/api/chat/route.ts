import { z } from "zod";
import { handleChat } from "@/server/chat-service";
import { getContainer } from "@/server/container";
import { handle, readJson } from "@/server/http";

const ChatBody = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(1000),
});

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = ChatBody.parse(await readJson(req));
    return Response.json(await handleChat(getContainer(), body));
  });
}
