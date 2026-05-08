import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Platform, ContentStatus, ApprovalStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function platformLabel(p: Platform): string {
  const map: Record<Platform, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
    google_ads: "Google Ads",
    facebook_ads: "Facebook Ads",
  };
  return map[p] ?? p;
}

export function platformColor(p: Platform): string {
  const map: Record<Platform, string> = {
    facebook: "bg-blue-100 text-blue-800",
    instagram: "bg-pink-100 text-pink-800",
    tiktok: "bg-slate-100 text-slate-800",
    google_ads: "bg-yellow-100 text-yellow-800",
    facebook_ads: "bg-blue-100 text-blue-800",
  };
  return map[p] ?? "bg-gray-100 text-gray-800";
}

export function statusColor(s: ContentStatus | ApprovalStatus): string {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    pending_review: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    published: "bg-indigo-100 text-indigo-800",
    revision_requested: "bg-orange-100 text-orange-800",
    expired: "bg-gray-100 text-gray-600",
    draft: "bg-gray-100 text-gray-600",
  };
  return map[s] ?? "bg-gray-100 text-gray-600";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function scoreBar(score: number | null): string {
  if (score === null) return "—";
  return `${Math.round(score * 100)}%`;
}
