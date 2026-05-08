"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApprovalCard } from "@/components/queue/ApprovalCard";
import { Select } from "@/components/ui/Select";
import { contentApi, brandsApi } from "@/lib/api";
import { ClipboardCheck, Inbox } from "lucide-react";
import type { Platform } from "@/types";

const PLATFORM_FILTER = [
  { value: "",            label: "All platforms" },
  { value: "instagram",   label: "Instagram" },
  { value: "facebook",    label: "Facebook" },
  { value: "tiktok",      label: "TikTok" },
  { value: "facebook_ads",label: "Facebook Ads" },
  { value: "google_ads",  label: "Google Ads" },
];

export default function QueuePage() {
  const [brandFilter, setBrandFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: brandsApi.list,
  });

  const { data: queue = [], refetch, isLoading } = useQuery({
    queryKey: ["queue", brandFilter],
    queryFn: () => contentApi.queue(brandFilter ? Number(brandFilter) : undefined),
    refetchInterval: 15_000,
  });

  const filtered = platformFilter
    ? queue.filter((q) => q.content_item.platform === (platformFilter as Platform))
    : queue;

  const brandOptions = [
    { value: "", label: "All brands" },
    ...brands.map((b) => ({ value: String(b.id), label: b.name })),
  ];

  return (
    <DashboardLayout title="Approval Queue">
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              {filtered.length} item{filtered.length !== 1 ? "s" : ""} pending review
            </span>
          </div>
          <div className="flex gap-3 ml-auto">
            <Select
              options={brandOptions}
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="w-44"
            />
            <Select
              options={PLATFORM_FILTER}
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="w-44"
            />
          </div>
        </div>

        {/* Queue list */}
        {isLoading && (
          <div className="flex justify-center py-16 text-gray-400 text-sm">Loading queue…</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center py-20 text-center text-gray-400">
            <Inbox className="h-12 w-12 mb-3 text-gray-300" />
            <p className="font-medium text-gray-600">Queue is empty</p>
            <p className="text-sm mt-1">All caught up! Generate new content to fill it.</p>
          </div>
        )}

        <div className="space-y-4">
          {filtered.map((item) => (
            <ApprovalCard key={item.id} item={item} onAction={refetch} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
