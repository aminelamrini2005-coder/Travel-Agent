"use client";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/core/types";
import { t } from "@/i18n";
import { SearchResultView } from "./SearchResultView";

interface UiMessage {
  role: "user" | "assistant";
  text: string;
  result?: SearchResult;
  error?: boolean;
}

interface ChatApiResponse {
  conversationId: string;
  reply: string;
  result?: SearchResult;
  error?: { message: string };
}

export function ChatApp({ llmEnabled }: { llmEnabled: boolean }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [messages.length]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      const data = (await res.json()) as ChatApiResponse;
      if (!res.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "assistant", text: data.reply, result: data.result }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: t("chat.error", { message: err instanceof Error ? err.message : String(err) }), error: true }]);
    } finally {
      setLoading(false);
    }
  }

  const reset = () => {
    setMessages([]);
    setConversationId(undefined);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-36 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🧭 {t("app.title")}</h1>
          <p className="text-sm text-zinc-500">{t("app.tagline")}</p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={reset} className="rounded-full border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">
            {t("chat.newSearch")}
          </button>
        )}
      </header>

      {messages.length === 0 && (
        <section className="mt-8">
          <h2 className="mb-6 text-center text-3xl font-semibold">{t("chat.placeholder")}</h2>
          <p className="mb-2 text-sm text-zinc-500">{t("chat.examples.title")}</p>
          <div className="space-y-2">
            {(["chat.example.1", "chat.example.2", "chat.example.3"] as const).map((k) => (
              <button key={k} type="button" onClick={() => send(t(k))} className="block w-full rounded-xl border border-zinc-200 p-3 text-left text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                {t(k)}
              </button>
            ))}
          </div>
          {!llmEnabled && <p className="mt-4 text-xs text-zinc-500">{t("chat.llm.off")}</p>}
        </section>
      )}

      <div className="space-y-4">
        {messages.map((m, i) => (
          <div key={i} ref={i === messages.length - 1 ? endRef : undefined}>
            {m.role === "user" ? (
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-blue-600 px-4 py-2 text-white">{m.text}</div>
            ) : (
              <div className="space-y-3">
                <div className={`w-fit max-w-[95%] rounded-2xl px-4 py-2 ${m.error ? "bg-red-100 text-red-900" : "bg-zinc-100 dark:bg-zinc-900"}`}>{m.text}</div>
                {m.result && <SearchResultView result={m.result} />}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="w-fit animate-pulse rounded-2xl bg-zinc-100 px-4 py-2 text-zinc-500 dark:bg-zinc-900">{t("chat.searching")}</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            className="flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-2 text-base outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" disabled={loading || !input.trim()} className="rounded-2xl bg-blue-600 px-4 font-medium text-white disabled:opacity-40">
            {t("chat.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
