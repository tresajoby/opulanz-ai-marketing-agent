"use client";

import { useState } from "react";
import { contentApi } from "@/lib/api";
import { platformLabel, platformColor } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  Copy, CheckCircle, XCircle, RefreshCw, Rocket,
  Hash, ImageIcon, Bot, Check,
} from "lucide-react";
import type { ApprovalQueueItem } from "@/types";

interface PostCardProps {
  item: ApprovalQueueItem;
  onAction?: () => void;
  onRevise?: (notes: string, originalText: string, platform: string) => void;
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-14 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs font-medium text-gray-600">{pct}%</span>
    </span>
  );
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  facebook: "bg-blue-600",
  tiktok: "bg-black",
  facebook_ads: "bg-blue-700",
  google_ads: "bg-green-600",
};

export function PostCard({ item, onAction, onRevise }: PostCardProps) {
  const { user } = useAuth();
  const ci = item.content_item;
  const canAct = user?.role === "super_admin" || user?.role === "marketing_manager";

  const [mode, setMode] = useState<"view" | "reject" | "revise" | "approve">("view");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);
  const [localStatus, setLocalStatus] = useState(item.status);

  const confidence = ci.ai_confidence_score ?? null;
  const compliance = ci.generation_metadata?.compliance_score as number | null ?? null;
  const variantLabel = ci.generation_metadata?.variant_label as string ?? "";

  function copyText() {
    const full = [ci.text_body, ci.hashtags].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleApprove() {
    setLoading(true); setError(null);
    try {
      await contentApi.approve(ci.id, comment);
      setLocalStatus("approved"); setMode("view"); setComment("");
      onAction?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handleReject() {
    if (!comment.trim()) { setError("A rejection reason is required."); return; }
    setLoading(true); setError(null);
    try {
      await contentApi.reject(ci.id, comment);
      setLocalStatus("rejected"); setMode("view"); setComment("");
      onAction?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handleRevise() {
    if (!comment.trim()) { setError("Revision notes are required."); return; }
    setLoading(true); setError(null);
    try {
      await contentApi.requestRevision(ci.id, comment);
      setLocalStatus("revision_requested"); setMode("view");
      onRevise?.(comment, ci.text_body, ci.platform);
      setComment("");
      onAction?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handlePublish() {
    setLoading(true); setError(null);
    try {
      await contentApi.publish(ci.id);
      setPublished(true); onAction?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  const statusStyles: Record<string, string> = {
    pending: "text-amber-600 bg-amber-50 border-amber-200",
    approved: "text-emerald-700 bg-emerald-50 border-emerald-200",
    rejected: "text-red-600 bg-red-50 border-red-200",
    revision_requested: "text-blue-600 bg-blue-50 border-blue-200",
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Card header — platform stripe */}
      <div className={`${PLATFORM_COLORS[ci.platform] || "bg-indigo-600"} px-4 py-2 flex items-center justify-between`}>
        <span className="text-white text-xs font-semibold tracking-wide uppercase">
          {platformLabel(ci.platform)}{variantLabel ? ` · ${variantLabel}` : ""}
        </span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusStyles[localStatus] || "text-gray-600 bg-white/20 border-white/30"}`}>
          {localStatus.replace(/_/g, " ")}
        </span>
      </div>

      {/* Post body */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{ci.text_body}</p>

        {ci.hashtags && (
          <p className="mt-3 text-xs font-medium text-indigo-600 flex items-start gap-1.5">
            <Hash className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {ci.hashtags}
          </p>
        )}

        {ci.image_prompt && (
          <div className="mt-3 bg-violet-50 rounded-lg px-3 py-2 flex items-start gap-2">
            <ImageIcon className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
            <p className="text-xs text-violet-700 italic">{ci.image_prompt}</p>
          </div>
        )}
      </div>

      {/* Scores + copy */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {confidence !== null && (
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-500">Confidence</span>
              <ScoreBar score={confidence} />
            </div>
          )}
          {compliance !== null && (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-500">Compliance</span>
              <ScoreBar score={compliance} />
            </div>
          )}
        </div>
        <button
          onClick={copyText}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors px-2 py-1 rounded hover:bg-gray-100"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Comment input for reject/revise/approve modes */}
      {(mode === "reject" || mode === "revise" || mode === "approve") && (
        <div className="px-4 pb-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder={
              mode === "reject" ? "Rejection reason…" :
              mode === "revise" ? "What should the agent change or improve?" :
              "Approval note (optional)…"
            }
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
      )}

      {/* Action buttons */}
      {canAct && localStatus === "pending" && !published && (
        <div className="px-4 pb-4 flex gap-2 flex-wrap border-t border-gray-100 pt-3">
          {mode === "view" && (
            <>
              <button
                onClick={() => setMode("approve")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
              >
                <CheckCircle className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                onClick={() => setMode("revise")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Revise
              </button>
              <button
                onClick={() => setMode("reject")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </button>
            </>
          )}
          {mode === "approve" && (
            <>
              <button onClick={handleApprove} disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                {loading ? "Saving…" : "Confirm Approval"}
              </button>
              <button onClick={() => { setMode("view"); setComment(""); setError(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
            </>
          )}
          {mode === "reject" && (
            <>
              <button onClick={handleReject} disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                {loading ? "Saving…" : "Confirm Reject"}
              </button>
              <button onClick={() => { setMode("view"); setComment(""); setError(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
            </>
          )}
          {mode === "revise" && (
            <>
              <button onClick={handleRevise} disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                {loading ? "Sending…" : "Send to Agent"}
              </button>
              <button onClick={() => { setMode("view"); setComment(""); setError(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* Publish after approval */}
      {localStatus === "approved" && !published && canAct && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <button onClick={handlePublish} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
            <Rocket className="h-3.5 w-3.5" />
            {loading ? "Publishing…" : "Publish Now"}
          </button>
        </div>
      )}
      {published && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <p className="text-xs text-emerald-600 flex items-center gap-1.5">
            <Rocket className="h-3.5 w-3.5" /> Dispatched to publishing queue.
          </p>
        </div>
      )}
    </div>
  );
}
