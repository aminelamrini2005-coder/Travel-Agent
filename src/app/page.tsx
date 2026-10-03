import { ChatApp } from "@/components/ChatApp";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export default function Home() {
  return <ChatApp llmEnabled={getContainer().llmEnabled} />;
}
