"use client";

import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { analyticsApi, type PostMetric } from "@/lib/api";
import { platformLabel, platformColor, formatDate } from "@/lib/utils";
import { BarChart3, TrendingUp, Send, Heart, MessageCircle, Share2, Clock } from "lucide-react";

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => analyticsApi.summary(),
    staleTime: 2 * 60 * 1000,
  });

  const totals = data?.totals;
  const byPlatform = data?.by_platform ?? {};
  const postMetrics = data?.post_metrics ?? [];
  const totalItems = Object.values(byPlatform).reduce((s, p) => s + p.generated, 0);

  return (
    <DashboardLayout title="Analytics">
      <div className="space-y-6">

        {/* KPI row — content counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard icon={Send}      label="Published"        value={totals?.published ?? 0}      color="text-indigo-600" bg="bg-indigo-50" />
          <KpiCard icon={Clock}     label="Pending Review"   value={totals?.pending_review ?? 0} color="text-amber-600"  bg="bg-amber-50"  />
          <KpiCard icon={TrendingUp} label="Total Generated" value={totals?.generated ?? 0}      color="text-blue-600"   bg="bg-blue-50"   />
          <KpiCard
            icon={BarChart3}
            label="Avg AI Confidence"
            value={totals ? `${Math.round((totals.avg_confidence) * 100)}%` : "—"}
            color="text-green-600"
            bg="bg-green-50"
          />
        </div>

        {/* Engagement KPI row */}
        <div className="grid grid-cols-3 gap-4">
          <KpiCard icon={Heart}         label="Total Likes"    value={totals?.total_likes ?? 0}    color="text-rose-600"   bg="bg-rose-50"   />
          <KpiCard icon={MessageCircle} label="Total Comments" value={totals?.total_comments ?? 0} color="text-purple-600" bg="bg-purple-50" />
          <KpiCard icon={Share2}        label="Total Shares"   value={totals?.total_shares ?? 0}   color="text-teal-600"   bg="bg-teal-50"   />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* By platform */}
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Posts by Platform</h3></CardHeader>
            <CardBody className="space-y-3">
              {Object.entries(byPlatform).map(([platform, counts]) => (
                <div key={platform} className="flex items-center justify-between gap-3">
                  <Badge colorClass={platformColor(platform as never)}>{platformLabel(platform as never)}</Badge>
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    <div className="w-20 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: totalItems ? `${(counts.generated / totalItems) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right">
                      {counts.published} published / {counts.generated} total
                    </span>
                  </div>
                </div>
              ))}
              {Object.keys(byPlatform).length === 0 && (
                <p className="text-sm text-gray-400">No content yet.</p>
              )}
            </CardBody>
          </Card>

          {/* Status breakdown */}
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Content Status</h3></CardHeader>
            <CardBody className="space-y-3">
              {[
                { label: "Published",      key: "published",      color: "text-indigo-600 bg-indigo-50" },
                { label: "Approved",       key: "approved",       color: "text-green-600 bg-green-50" },
                { label: "Pending Review", key: "pending_review", color: "text-amber-600 bg-amber-50" },
                { label: "Rejected",       key: "rejected",       color: "text-red-600 bg-red-50" },
              ].map(({ label, key, color }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{label}</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {totals ? (totals as Record<string, number>)[key] ?? 0 : 0}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        {/* Published posts with engagement */}
        {postMetrics.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-gray-900">Post Performance</h3>
              <p className="text-xs text-gray-400 mt-0.5">Live engagement from connected platforms</p>
            </CardHeader>
            <CardBody className="divide-y divide-gray-50">
              {postMetrics.map((p) => (
                <PostMetricRow key={p.content_item_id} post={p} />
              ))}
            </CardBody>
          </Card>
        )}

        {isLoading && (
          <p className="text-gray-400 text-sm">Loading analytics…</p>
        )}
      </div>
    </DashboardLayout>
  );
}

function PostMetricRow({ post }: { post: PostMetric }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Badge colorClass={platformColor(post.platform as never)} className="shrink-0 mt-0.5">
        {platformLabel(post.platform as never)}
      </Badge>
      <p className="text-sm text-gray-700 flex-1 line-clamp-1">{post.text_body}</p>
      <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
        {post.likes !== null && (
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3 text-rose-400" /> {post.likes}
          </span>
        )}
        {post.comments !== null && (
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3 text-purple-400" /> {post.comments}
          </span>
        )}
        {post.shares !== null && (
          <span className="flex items-center gap-1">
            <Share2 className="h-3 w-3 text-teal-400" /> {post.shares}
          </span>
        )}
        {post.likes === null && post.comments === null && (
          <span className="text-gray-300">no metrics</span>
        )}
        <span className="text-gray-300">{post.published_at ? formatDate(post.published_at) : ""}</span>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, color, bg,
}: {
  icon: React.ElementType; label: string; value: number | string; color: string; bg: string;
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} shrink-0`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
      </CardBody>
    </Card>
  );
}
