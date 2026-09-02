"use client";

import { useEffect, useState } from "react";
import { contentApi, normalizeContentImageUrl } from "@/lib/api";
import { platformLabel } from "@/lib/utils";
import { formatPublishError, getPlatformImageGuide } from "@/lib/platformImage";
import { useAuth } from "@/context/AuthContext";
import { ImageCropModal } from "@/components/chat/ImageCropModal";
import {
  Copy, CheckCircle, XCircle, RefreshCw, Rocket,
  Hash, ImageIcon, Bot, Check, Loader2, Sparkles, Pencil, X, Upload, AlertTriangle,
  Eye, EyeOff, Heart, MessageSquare, Share2, ThumbsUp, MoreHorizontal,
} from "lucide-react";
import type { ApprovalQueueItem, ApprovalStatus } from "@/types";

export interface PostCardUpdate {
  status?: ApprovalStatus;
  image_url?: string | null;
  image_prompt?: string | null;
  published?: boolean;
}

interface PostCardProps {
  item: ApprovalQueueItem;
  onAction?: () => void;
  onItemUpdate?: (queueItemId: number, patch: PostCardUpdate) => void;
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

export function PostCard({ item, onAction, onItemUpdate, onRevise }: PostCardProps) {
  const { user } = useAuth();
  const ci = item.content_item;
  const canAct = user?.role === "super_admin" || user?.role === "marketing_manager";

  const [mode, setMode] = useState<"view" | "reject" | "revise" | "approve">("view");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(
    ci.status === "published" || Boolean(ci.published_at),
  );
  const [localStatus, setLocalStatus] = useState<ApprovalStatus>(item.status);
  const [imageUrl, setImageUrl] = useState<string | null>(
    normalizeContentImageUrl(ci.id, ci.image_url),
  );
  const [imageLoading, setImageLoading] = useState(false);
  const [imageStage, setImageStage] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(ci.image_prompt ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const imageGuide = getPlatformImageGuide(ci.platform);

  // Keep local UI in sync when parent hydrates fresh server state (e.g. after tab nav)
  useEffect(() => {
    setLocalStatus(item.status);
  }, [item.status, item.id]);

  useEffect(() => {
    setImageUrl(normalizeContentImageUrl(ci.id, ci.image_url));
  }, [ci.id, ci.image_url]);

  useEffect(() => {
    setPromptDraft(ci.image_prompt ?? "");
  }, [ci.image_prompt]);

  useEffect(() => {
    if (ci.status === "published" || ci.published_at) setPublished(true);
  }, [ci.status, ci.published_at]);

  const confidence = ci.ai_confidence_score ?? null;
  const compliance = ci.generation_metadata?.compliance_score as number | null ?? null;
  const variantLabel = ci.generation_metadata?.variant_label as string ?? "";

  function notifyUpdate(patch: PostCardUpdate) {
    onItemUpdate?.(item.id, patch);
    onAction?.();
  }

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
      notifyUpdate({ status: "approved" });
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
      notifyUpdate({ status: "rejected" });
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
      notifyUpdate({ status: "revision_requested" });
      onRevise?.(comment, ci.text_body, ci.platform);
      setComment("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  async function handleGenerateImage() {
    setEditingPrompt(false);
    setImageLoading(true);
    setImageError(null);
    setUploadWarning(null);
    setImageStage("Preparing prompt…");
    const stageTimer = window.setTimeout(() => setImageStage("Generating image…"), 2500);
    const stageTimer2 = window.setTimeout(() => setImageStage("Almost done — applying brand finish…"), 12000);
    try {
      const customPrompt = promptDraft.trim() !== (ci.image_prompt ?? "").trim()
        ? promptDraft.trim()
        : undefined;
      const res = await contentApi.generateImage(ci.id, customPrompt);
      const nextUrl = normalizeContentImageUrl(ci.id, res.image_url) ?? res.image_url;
      setImageUrl(nextUrl);
      notifyUpdate({
        image_url: nextUrl,
        image_prompt: customPrompt ?? ci.image_prompt,
      });
    } catch (e: unknown) {
      setImageError(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      window.clearTimeout(stageTimer);
      window.clearTimeout(stageTimer2);
      setImageStage(null);
      setImageLoading(false);
    }
  }

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file (JPG, PNG, WebP, etc.).");
      return;
    }
    setImageError(null);
    setUploadWarning(null);
    setCropFile(file);
  }

  async function handleCroppedUpload(cropped: File) {
    setUploadLoading(true);
    setImageError(null);
    setUploadWarning(null);
    try {
      const res = await contentApi.uploadImage(ci.id, cropped);
      const nextUrl = normalizeContentImageUrl(ci.id, res.image_url) ?? res.image_url;
      setImageUrl(nextUrl);
      setUploadWarning(res.warning ?? null);
      setCropFile(null);
      notifyUpdate({ image_url: nextUrl });
    } catch (e: unknown) {
      setImageError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  async function handlePublish() {
    setLoading(true); setError(null);
    try {
      const result = await contentApi.publish(ci.id);
      if (result?.warning) {
        setError(formatPublishError(result.warning));
      } else {
        setPublished(true);
        notifyUpdate({ published: true, status: "approved" });
      }
    } catch (e: unknown) {
      setError(formatPublishError(e instanceof Error ? e.message : "Failed"));
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

        {(ci.image_prompt || imageUrl || canAct) && (
          <div className="mt-3 space-y-2">
            {/* Prompt display / inline editor */}
            {(ci.image_prompt || promptDraft) && (
              <div className="bg-violet-50 rounded-lg px-3 py-2">
                <div className="flex items-start gap-2">
                  <ImageIcon className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                  {editingPrompt ? (
                    <div className="flex-1 space-y-2">
                      <textarea
                        value={promptDraft}
                        onChange={(e) => setPromptDraft(e.target.value)}
                        rows={4}
                        className="w-full text-xs text-violet-900 bg-white border border-violet-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                      />
                      <button
                        onClick={() => { setEditingPrompt(false); setPromptDraft(ci.image_prompt ?? ""); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-start justify-between gap-2">
                      <p className="text-xs text-violet-700 italic">{promptDraft}</p>
                      <button
                        onClick={() => setEditingPrompt(true)}
                        className="shrink-0 p-1 rounded hover:bg-violet-100 text-violet-400 hover:text-violet-600 transition-colors"
                        title="Edit image prompt"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Generated image or upload button */}
            {imageUrl ? (
              <div className="space-y-2">
                <img
                  src={imageUrl}
                  alt="Campaign Attachment"
                  className="w-full rounded-lg border border-gray-200 object-cover max-h-96"
                  onError={() => {
                    setImageError("Could not load image. Try regenerating.");
                    setImageUrl(null);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {(ci.image_prompt || promptDraft) && (
                    <button
                      onClick={handleGenerateImage}
                      disabled={imageLoading || uploadLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-100 text-violet-700 text-xs font-medium hover:bg-violet-200 disabled:opacity-50 transition-colors"
                    >
                      {imageLoading
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Regenerating…</>
                        : <><RefreshCw className="h-3.5 w-3.5" /> Regenerate Image</>
                      }
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 cursor-pointer transition-colors">
                    {uploadLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5" /> Upload Custom Image</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadImage}
                      className="hidden"
                      disabled={uploadLoading || imageLoading}
                    />
                  </label>
                  <span className="text-[10px] text-gray-500">{imageGuide.guide}</span>
                </div>
                {imageLoading && imageStage && (
                  <p className="text-xs text-violet-600 flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> {imageStage}
                  </p>
                )}
                {uploadWarning && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 leading-relaxed">{uploadWarning}</p>
                  </div>
                )}
                {imageError && (
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-red-600">{imageError}</p>
                    <button
                      onClick={handleGenerateImage}
                      disabled={imageLoading}
                      className="shrink-0 text-xs font-medium text-violet-600 hover:text-violet-800"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(ci.image_prompt || promptDraft) && (
                    <button
                      onClick={handleGenerateImage}
                      disabled={imageLoading || uploadLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
                    >
                      {imageLoading
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                        : <><Sparkles className="h-3.5 w-3.5" /> Generate Image</>
                      }
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 cursor-pointer transition-colors">
                    {uploadLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5" /> Upload Custom Image</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadImage}
                      className="hidden"
                      disabled={uploadLoading || imageLoading}
                    />
                  </label>
                  <span className="text-[10px] text-gray-500">{imageGuide.guide}</span>
                </div>
                {imageLoading && (
                  <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/60 px-3 py-6 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-violet-500 mx-auto mb-2" />
                    <p className="text-xs font-medium text-violet-700">
                      {imageStage ?? "Generating image…"}
                    </p>
                    <p className="text-[10px] text-violet-500 mt-1">This usually takes 15–45 seconds</p>
                  </div>
                )}
                {imageError && (
                  <div className="flex items-start justify-between gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                    <p className="text-xs text-red-600">{imageError}</p>
                    <button
                      onClick={handleGenerateImage}
                      disabled={imageLoading}
                      className="shrink-0 text-xs font-medium text-violet-600 hover:text-violet-800"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showPreview && (
          <div className="mt-4 border-t border-gray-100 pt-4 bg-gray-50/50 p-4 rounded-xl">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Simulated Live Feed Preview</p>
            {ci.platform === "instagram" ? (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-w-sm mx-auto shadow-sm">
                {/* IG Header */}
                <div className="flex items-center justify-between p-3 border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-yellow-500 via-red-500 to-purple-600 p-[1.5px]">
                      <div className="h-full w-full rounded-full bg-white flex items-center justify-center text-[10px] font-bold text-gray-700">OP</div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-900">opulanz_marketing</p>
                      <p className="text-[9px] text-gray-500">Sponsored</p>
                    </div>
                  </div>
                  <MoreHorizontal className="h-4 w-4 text-gray-400" />
                </div>
                {/* IG Image */}
                <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {imageUrl ? (
                    <img src={imageUrl} alt="IG Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center p-6 text-gray-400">
                      <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-55" />
                      <p className="text-[10px]">No image generated yet</p>
                    </div>
                  )}
                </div>
                {/* IG Actions */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Heart className="h-5 w-5 text-gray-700 hover:text-red-500 cursor-pointer" />
                      <MessageSquare className="h-5 w-5 text-gray-700" />
                      <Share2 className="h-5 w-5 text-gray-700" />
                    </div>
                  </div>
                  {/* IG Caption */}
                  <div className="text-xs text-gray-800 space-y-1">
                    <p>
                      <span className="font-semibold mr-1.5 text-gray-900">opulanz_marketing</span>
                      {ci.text_body}
                    </p>
                    {ci.hashtags && (
                      <p className="text-indigo-600 font-medium">{ci.hashtags}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : ci.platform === "linkedin" ? (
              <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-md mx-auto shadow-sm space-y-3">
                {/* LI Header */}
                <div className="flex items-start justify-between">
                  <div className="flex gap-2">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700 text-sm">OP</div>
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-semibold text-gray-900">Opulanz Business Hub</p>
                        <span className="text-[10px] text-gray-400 font-medium">• 1st</span>
                      </div>
                      <p className="text-[9px] text-gray-500">AI Marketing Director at Opulanz</p>
                      <p className="text-[9px] text-gray-400">Just now • Edited • 🌐</p>
                    </div>
                  </div>
                  <MoreHorizontal className="h-4 w-4 text-gray-400" />
                </div>
                {/* LI Body */}
                <div className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {ci.text_body}
                  {ci.hashtags && (
                    <p className="mt-2 text-indigo-600 font-medium">{ci.hashtags}</p>
                  )}
                </div>
                {/* LI Media */}
                {imageUrl && (
                  <div className="rounded-lg overflow-hidden border border-gray-200 max-h-72 bg-gray-50">
                    <img src={imageUrl} alt="LinkedIn Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                {/* LI Actions */}
                <div className="border-t border-gray-100 pt-2 flex items-center justify-around text-gray-500 text-[11px] font-medium">
                  <button className="flex items-center gap-1.5 hover:bg-gray-50 p-1.5 rounded transition-colors">
                    <ThumbsUp className="h-4 w-4" /> Like
                  </button>
                  <button className="flex items-center gap-1.5 hover:bg-gray-50 p-1.5 rounded transition-colors">
                    <MessageSquare className="h-4 w-4" /> Comment
                  </button>
                  <button className="flex items-center gap-1.5 hover:bg-gray-50 p-1.5 rounded transition-colors">
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                </div>
              </div>
            ) : (
              // Default generic social mock (for tiktok, facebook etc.)
              <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-sm mx-auto shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-xs">OP</div>
                  <div>
                    <p className="text-xs font-semibold text-gray-900">opulanz_brand</p>
                    <p className="text-[9px] text-gray-400 capitalize">{ci.platform} Post Preview</p>
                  </div>
                </div>
                <div className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{ci.text_body}</div>
                {ci.hashtags && <p className="text-xs text-indigo-600 font-medium">{ci.hashtags}</p>}
                {imageUrl && (
                  <div className="rounded-lg overflow-hidden border border-gray-200">
                    <img src={imageUrl} alt="Preview" className="w-full max-h-60 object-cover" />
                  </div>
                )}
              </div>
            )}
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors ${
              showPreview ? "text-indigo-600 bg-indigo-50 border border-indigo-200" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            }`}
            title="Toggle Live Social Media Feed Preview"
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? "Hide Preview" : "Preview"}
          </button>
          <button
            onClick={copyText}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors px-2 py-1 rounded hover:bg-gray-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
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
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
      {published && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <p className="text-xs text-emerald-600 flex items-center gap-1.5">
            <Rocket className="h-3.5 w-3.5" /> Dispatched to publishing queue.
          </p>
        </div>
      )}

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          platform={ci.platform}
          open={Boolean(cropFile)}
          busy={uploadLoading}
          onCancel={() => { if (!uploadLoading) setCropFile(null); }}
          onConfirm={handleCroppedUpload}
        />
      )}
    </div>
  );
}
