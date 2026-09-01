"use client";

import { useState } from "react";
import { Card, CardBody, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { contentApi } from "@/lib/api";
import { platformLabel, platformColor, statusColor, formatDate, scoreBar } from "@/lib/utils";
import { formatPublishError } from "@/lib/platformImage";
import { useAuth } from "@/context/AuthContext";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  Bot,
  Hash,
  ImageIcon,
  Rocket,
  Trash2,
} from "lucide-react";
import type { ApprovalQueueItem } from "@/types";

interface ApprovalCardProps {
  item: ApprovalQueueItem;
  onAction: () => void;
}

export function ApprovalCard({ item, onAction }: ApprovalCardProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"view" | "reject" | "revise" | "approve">("view");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const ci = item.content_item;
  const canAct = user?.role === "super_admin" || user?.role === "marketing_manager";

  async function handleApprove() {
    setLoading(true); setError(null);
    try {
      await contentApi.approve(ci.id, comment);
      setMode("view"); setComment(""); onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handleReject() {
    if (!comment.trim()) { setError("A rejection reason is required."); return; }
    setLoading(true); setError(null);
    try {
      await contentApi.reject(ci.id, comment);
      setMode("view"); setComment(""); onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handleRevise() {
    if (!comment.trim()) { setError("Revision notes are required."); return; }
    setLoading(true); setError(null);
    try {
      await contentApi.requestRevision(ci.id, comment);
      setMode("view"); setComment(""); onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handlePublish() {
    setLoading(true); setError(null);
    try {
      const result = await contentApi.publish(ci.id);
      if (result?.warning) {
        setError(formatPublishError(result.warning));
      } else {
        setPublished(true); onAction();
      }
    } catch (e: unknown) {
      setError(formatPublishError(e instanceof Error ? e.message : "Failed"));
    } finally { setLoading(false); }
  }

  async function handleDelete() {
    if (!confirm("Delete this content item? This cannot be undone.")) return;
    setLoading(true); setError(null);
    try {
      await contentApi.delete(ci.id);
      onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
    } finally { setLoading(false); }
  }

  const confidenceScore = ci.ai_confidence_score ?? null;
  const complianceScore = ci.generation_metadata?.compliance_score as number | null ?? null;
  const variantLabel = ci.generation_metadata?.variant_label as string ?? "";

  return (
    <Card className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge colorClass={platformColor(ci.platform)}>{platformLabel(ci.platform)}</Badge>
          <Badge colorClass={statusColor(item.status)} className="capitalize">
            {item.status.replace(/_/g, " ")}
          </Badge>
          {variantLabel && (
            <span className="text-xs text-gray-500 font-medium">Variant: {variantLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatDate(item.requested_at)}
          </span>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex items-center gap-1 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <CardBody className="space-y-4">
        {/* Main content */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{ci.text_body}</p>
        </div>

        {/* Hashtags */}
        {ci.hashtags && (
          <div className="flex items-start gap-2">
            <Hash className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
            <p className="text-xs text-indigo-700">{ci.hashtags}</p>
          </div>
        )}

        {/* Image prompt */}
        {ci.image_prompt && (
          <div className="flex items-start gap-2">
            <ImageIcon className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
            <p className="text-xs text-violet-700 italic">{ci.image_prompt}</p>
          </div>
        )}

        {/* AI scores */}
        <div className="flex items-center gap-4 pt-1">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-500">Confidence</span>
            <ScoreBar score={confidenceScore} />
          </div>
          {complianceScore !== null && (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-500">Compliance</span>
              <ScoreBar score={complianceScore} />
            </div>
          )}
        </div>

        {/* AI reasoning */}
        {item.ai_reasoning && (
          <p className="text-xs text-gray-400 italic">{item.ai_reasoning}</p>
        )}

        {/* Action panels */}
        {error && <Alert variant="error">{error}</Alert>}

        {(mode === "reject" || mode === "revise") && (
          <div className="space-y-2">
            <Textarea
              label={mode === "reject" ? "Rejection reason" : "Revision notes for the agent"}
              placeholder={
                mode === "reject"
                  ? "Why are you rejecting this content?"
                  : "What should the agent change or improve?"
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {mode === "approve" && (
          <div className="space-y-2">
            <Textarea
              label="Approval comment (optional)"
              placeholder="Any notes for the record…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </div>
        )}
      </CardBody>

      {/* Action footer */}
      {canAct && item.status === "pending" && (
        <CardFooter>
          {mode === "view" && !published && (
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="success"
                onClick={() => setMode("approve")}
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setMode("revise")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Request Revision
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setMode("reject")}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          )}

          {mode === "approve" && (
            <div className="flex gap-2">
              <Button size="sm" variant="success" onClick={handleApprove} loading={loading}>
                Confirm Approval
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode("view"); setComment(""); }}>
                Cancel
              </Button>
            </div>
          )}

          {mode === "reject" && (
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={handleReject} loading={loading}>
                Confirm Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode("view"); setComment(""); }}>
                Cancel
              </Button>
            </div>
          )}

          {mode === "revise" && (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={handleRevise} loading={loading}>
                Send Revision Notes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode("view"); setComment(""); }}>
                Cancel
              </Button>
            </div>
          )}
        </CardFooter>
      )}

      {/* Publish button — shown after approve */}
      {ci.status === "approved" && !published && canAct && (
        <CardFooter>
          <Button size="sm" variant="primary" onClick={handlePublish} loading={loading}>
            <Rocket className="h-3.5 w-3.5" />
            Publish Now
          </Button>
        </CardFooter>
      )}

      {published && (
        <CardFooter>
          <Alert variant="success">Dispatched to publishing queue.</Alert>
        </CardFooter>
      )}
    </Card>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs font-medium text-gray-700">{pct}%</span>
    </span>
  );
}
