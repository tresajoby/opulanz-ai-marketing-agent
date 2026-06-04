"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { brandsApi, contentApi } from "@/lib/api";
import { ServicesPanel } from "./ServicesPanel";
import { TypingIndicator } from "./TypingIndicator";
import { PostCard } from "./PostCard";
import type { ChatMessage, UserMessage, ThinkingMessage, ContentMessage, SystemMessage } from "./types";
import type { Platform, ApprovalQueueItem, ConversationTurn } from "@/types";
import { Sparkles, Send, Bot, ChevronDown, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

let _msgId = 0;
function newId() { return String(++_msgId); }

function WelcomeScreen({ brandCount }: { brandCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full pb-12 text-center px-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-5">
        <Bot className="h-7 w-7 text-white" />
      </div>
      <h2 className="text-xl font-bold text-gray-900">OMMA — Your AI Marketing Manager</h2>
      <p className="text-gray-500 text-sm mt-2 max-w-sm leading-relaxed">
        Describe your campaign goal and I'll generate brand-aligned, compliance-checked posts ready for approval.
        You can then refine them conversationally — just like talking to a colleague.
      </p>
      {brandCount === 0 && (
        <div className="mt-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No brands found. Create a brand first in Brand Management.
        </div>
      )}
      <div className="mt-8 grid grid-cols-2 gap-3 text-left max-w-md w-full">
        {[
          "Create a post announcing our summer collection launch",
          "Write a Facebook ad for our 20% off weekend sale",
          "Generate a TikTok caption for our new product demo video",
          "Draft 3 Instagram posts for our brand awareness campaign",
        ].map((eg) => (
          <div key={eg} className="border border-gray-200 rounded-xl p-3 text-xs text-gray-600 bg-white hover:border-indigo-300 hover:bg-indigo-50 cursor-default transition-colors">
            {eg}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildAssistantHistoryContent(items: ApprovalQueueItem[], platform: string): string {
  if (items.length === 0) return "Content was generated and added to the approval queue.";
  const lines = [`I generated ${items.length} variant(s) for ${platform}:`];
  items.forEach((item, i) => {
    const label = (item.content_item.generation_metadata?.variant_label as string) || `Variant ${i + 1}`;
    lines.push(`\n${label}:\n${item.content_item.text_body}`);
    if (item.content_item.hashtags) lines.push(item.content_item.hashtags);
  });
  return lines.join("\n");
}

export function ChatWindow() {
  const qc = useQueryClient();
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: brandsApi.list });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [brandId, setBrandId] = useState<string>("");
  const [variants, setVariants] = useState(3);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (brands.length > 0 && !brandId) setBrandId(String(brands[0].id));
  }, [brands, brandId]);

  // Restore saved chat when brand changes
  useEffect(() => {
    if (!brandId) return;
    try {
      const saved = localStorage.getItem(`omma_chat_${brandId}`);
      if (saved) {
        const data = JSON.parse(saved);
        setMessages((data.messages || []).map((m: ChatMessage) => ({ ...m, timestamp: new Date((m as any).timestamp) })));
        setConversationHistory(data.conversationHistory || []);
      } else {
        setMessages([]);
        setConversationHistory([]);
      }
    } catch { /* ignore */ }
  }, [brandId]);

  // Persist chat after each completed turn
  useEffect(() => {
    if (!brandId || loading) return;
    const toSave = messages.filter((m) => m.role !== "thinking");
    if (toSave.length === 0) { localStorage.removeItem(`omma_chat_${brandId}`); return; }
    try {
      localStorage.setItem(`omma_chat_${brandId}`, JSON.stringify({ messages: toSave, conversationHistory }));
    } catch { /* ignore quota errors */ }
  }, [messages, conversationHistory, brandId, loading]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const handleRevisionRequest = useCallback(async (notes: string, originalText: string, cardPlatform: string) => {
    if (!brandId || loading) return;
    const brand = brands.find((b) => String(b.id) === brandId);
    const thinkingId = newId();

    const userMsg: UserMessage = {
      id: newId(), role: "user",
      text: `Revise: ${notes}`,
      platform: cardPlatform as Platform,
      brandName: brand?.name ?? "Brand",
      timestamp: new Date(),
    };
    const thinkingMsg: ThinkingMessage = { id: thinkingId, role: "thinking", timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setLoading(true);

    const additionalContext = `Revise the following post based on these notes.\n\nOriginal post:\n${originalText}\n\nRevision notes: ${notes}`;
    const updatedHistory: ConversationTurn[] = [
      ...conversationHistory,
      { role: "user", content: `Revise: ${notes}` },
    ];

    try {
      const result = await contentApi.generate({
        brand_id: Number(brandId),
        platform: cardPlatform as Platform,
        goal: notes,
        additional_context: additionalContext,
        num_variants: variants,
        conversation_history: updatedHistory,
      });

      let items: ApprovalQueueItem[] = [];
      try {
        if (result.approval_queue_ids?.length > 0) {
          const allQueue = await contentApi.queue(Number(brandId));
          items = allQueue.filter((q) => result.approval_queue_ids.includes(q.id));
          if (items.length === 0) items = allQueue.slice(0, result.items_created);
        }
      } catch {
        // Queue fetch failed — generation still succeeded
      }

      const assistantContent = buildAssistantHistoryContent(items, cardPlatform);
      setConversationHistory([...updatedHistory, { role: "assistant", content: assistantContent }]);

      const contentMsg: ContentMessage = {
        id: newId(), role: "assistant", items,
        platform: cardPlatform as Platform,
        warnings: result.compliance_warnings,
        timestamp: new Date(),
      };
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? contentMsg : m)));
      qc.invalidateQueries({ queryKey: ["queue"] });
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      const sysMsg: SystemMessage = { id: newId(), role: "system", text: errText, variant: "error", timestamp: new Date() };
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? sysMsg : m)));
    } finally {
      setLoading(false);
    }
  }, [brandId, brands, loading, conversationHistory, variants, qc]);

  function handleClearConversation() {
    setMessages([]);
    setConversationHistory([]);
    if (brandId) localStorage.removeItem(`omma_chat_${brandId}`);
  }

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !brandId || loading) return;

    const brand = brands.find((b) => String(b.id) === brandId);
    const thinkingId = newId();

    const userMsg: UserMessage = {
      id: newId(), role: "user", text, platform,
      brandName: brand?.name ?? "Brand", timestamp: new Date(),
    };
    const thinkingMsg: ThinkingMessage = { id: thinkingId, role: "thinking", timestamp: new Date() };

    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);

    // Append user turn to history before sending
    const updatedHistory: ConversationTurn[] = [
      ...conversationHistory,
      { role: "user", content: text },
    ];

    try {
      const result = await contentApi.generate({
        brand_id: Number(brandId),
        platform,
        goal: text,
        num_variants: variants,
        conversation_history: updatedHistory,
      });

      // Fetch queue items to display cards — wrapped in try/catch so a queue
      // fetch failure doesn't hide the fact that generation succeeded
      let items: ApprovalQueueItem[] = [];
      try {
        if (result.approval_queue_ids?.length > 0) {
          const allQueue = await contentApi.queue(Number(brandId));
          items = allQueue.filter((q) => result.approval_queue_ids.includes(q.id));
          if (items.length === 0) items = allQueue.slice(0, result.items_created);
        }
      } catch {
        // Queue fetch failed — cards won't show but generation did succeed
      }

      // Append assistant turn so next message has full context
      const assistantContent = buildAssistantHistoryContent(items, platform);
      setConversationHistory([
        ...updatedHistory,
        { role: "assistant", content: assistantContent },
      ]);

      const contentMsg: ContentMessage = {
        id: newId(), role: "assistant", items, platform,
        warnings: result.compliance_warnings,
        timestamp: new Date(),
      };
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? contentMsg : m)));

      // Keep queue in sync
      qc.invalidateQueries({ queryKey: ["queue"] });
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      const sysMsg: SystemMessage = {
        id: newId(), role: "system", text: errText, variant: "error", timestamp: new Date(),
      };
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? sysMsg : m)));
    } finally {
      setLoading(false);
    }
  }, [input, brandId, brands, platform, variants, loading, conversationHistory, qc]);

  function injectTemplate(template: string) {
    setInput(template);
    textareaRef.current?.focus();
  }

  const brandOptions = brands.map((b) => ({ id: String(b.id), name: b.name }));
  const selectedBrand = brands.find((b) => String(b.id) === brandId);
  const isRefinement = conversationHistory.length > 0;

  return (
    <div className="flex h-full gap-5">
      {/* ── Chat area ─────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-gray-900 text-sm">Content Studio</span>
            {isRefinement && (
              <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                Conversation active
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRefinement && (
              <button
                onClick={handleClearConversation}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                title="Start a new conversation"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New chat
              </button>
            )}
            {/* Brand selector */}
            <div className="relative">
              <select
                value={brandId}
                onChange={(e) => { setBrandId(e.target.value); handleClearConversation(); }}
                className="appearance-none pl-3 pr-8 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {brandOptions.length === 0 && <option value="">No brands — create one first</option>}
                {brandOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {messages.length === 0 ? (
            <WelcomeScreen brandCount={brands.length} />
          ) : (
            messages.map((msg) => {
              if (msg.role === "user") {
                const um = msg as UserMessage;
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[75%] space-y-1">
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-[10px] text-gray-400 capitalize">{um.platform.replace("_", " ")}</span>
                        <span className="text-[10px] text-gray-400">·</span>
                        <span className="text-[10px] text-gray-400">{um.brandName}</span>
                      </div>
                      <div className="bg-indigo-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-3 leading-relaxed">
                        {um.text}
                      </div>
                    </div>
                  </div>
                );
              }

              if (msg.role === "thinking") {
                return (
                  <div key={msg.id} className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                      <TypingIndicator />
                    </div>
                  </div>
                );
              }

              if (msg.role === "assistant") {
                const am = msg as ContentMessage;
                return (
                  <div key={msg.id} className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-3">
                      <p className="text-xs text-gray-500 mt-1">
                        Generated {am.items.length} variant{am.items.length !== 1 ? "s" : ""} for{" "}
                        <span className="font-medium capitalize">{am.platform.replace("_", " ")}</span>
                        {" · "}
                        <span className="text-indigo-500">Reply to refine or start fresh with "New chat"</span>
                      </p>
                      {am.warnings.length > 0 && (
                        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Compliance warnings:</p>
                            <ul className="mt-0.5 space-y-0.5 list-disc ml-3">
                              {am.warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}
                      {am.items.length === 0 && (
                        <p className="text-sm text-gray-400 italic">
                          Content was sent to the approval queue. Check the Queue page to review it.
                        </p>
                      )}
                      <div className="grid gap-3 grid-cols-1">
                        {am.items.map((item) => (
                          <PostCard key={item.id} item={item} onRevise={handleRevisionRequest} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              if (msg.role === "system") {
                const sm = msg as SystemMessage;
                const styles = {
                  error: "bg-red-50 border-red-200 text-red-700",
                  success: "bg-emerald-50 border-emerald-200 text-emerald-700",
                  info: "bg-blue-50 border-blue-200 text-blue-700",
                };
                return (
                  <div key={msg.id} className={cn("text-xs border rounded-lg px-4 py-3", styles[sm.variant])}>
                    {sm.text}
                  </div>
                );
              }

              return null;
            })
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
          {isRefinement && (
            <p className="text-[10px] text-indigo-500 mb-2 px-1">
              💬 You can refine — e.g. "Make them shorter", "Add more urgency", "Rewrite for a younger audience"
            </p>
          )}
          <div className="flex items-end gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isRefinement
                  ? `Refine the content above… (e.g. "make it shorter", "add a discount offer")`
                  : `Describe your campaign goal for ${selectedBrand?.name ?? "your brand"}… (Enter to send)`
              }
              disabled={loading || !brandId}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none disabled:opacity-50 max-h-40 leading-relaxed"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim() || !brandId}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-all shrink-0",
                input.trim() && brandId && !loading
                  ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              )}
            >
              {loading ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            Posts go to the Approval Queue — nothing is published without human review.
          </p>
        </div>
      </div>

      {/* ── Services panel ──────────────────────────────── */}
      <ServicesPanel
        activePlatform={platform}
        onPlatformChange={setPlatform}
        onPromptTemplate={injectTemplate}
        activeVariants={variants}
        onVariantsChange={setVariants}
      />
    </div>
  );
}
