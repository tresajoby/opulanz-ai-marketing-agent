"use client";

import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { contentApi } from "@/lib/api";
import { platformLabel, platformColor, statusColor, formatDate } from "@/lib/utils";
import { BarChart3, TrendingUp, Send, Clock } from "lucide-react";
import type { ContentStatus } from "@/types";

const STATUS_ORDER: ContentStatus[] = ["published", "approved", "pending_review", "rejected"];

export default function AnalyticsPage() {
  const { data: allContent = [], isLoading } = useQuery({
    queryKey: ["content-all"],
    queryFn: () => contentApi.list(),
  });

  const byStatus = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = allContent.filter((c) => c.status === s).length;
    return acc;
  }, {});

  const byPlatform = allContent.reduce<Record<string, number>>((acc, c) => {
    acc[c.platform] = (acc[c.platform] ?? 0) + 1;
    return acc;
  }, {});

  const published = allContent.filter((c) => c.status === "published");
  const avgConfidence =
    allContent.length > 0
      ? allContent.reduce((s, c) => s + (c.ai_confidence_score ?? 0), 0) / allContent.length
      : 0;

  return (
    <DashboardLayout title="Analytics">
      <div className="space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard icon={Send} label="Published" value={byStatus.published ?? 0} color="text-indigo-600" bg="bg-indigo-50" />
          <KpiCard icon={Clock} label="Pending Review" value={byStatus.pending_review ?? 0} color="text-amber-600" bg="bg-amber-50" />
          <KpiCard icon={TrendingUp} label="Total Generated" value={allContent.length} color="text-blue-600" bg="bg-blue-50" />
          <KpiCard
            icon={BarChart3}
            label="Avg AI Confidence"
            value={`${Math.round(avgConfidence * 100)}%`}
            color="text-green-600"
            bg="bg-green-50"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* By platform */}
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Content by Platform</h3></CardHeader>
            <CardBody className="space-y-3">
              {Object.entries(byPlatform).map(([platform, count]) => (
                <div key={platform} className="flex items-center justify-between">
                  <Badge colorClass={platformColor(platform as never)}>{platformLabel(platform as never)}</Badge>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${(count / allContent.length) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-6 text-right">{count}</span>
                  </div>
                </div>
              ))}
              {Object.keys(byPlatform).length === 0 && (
                <p className="text-sm text-gray-400">No content yet.</p>
              )}
            </CardBody>
          </Card>

          {/* By status */}
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Content by Status</h3></CardHeader>
            <CardBody className="space-y-3">
              {STATUS_ORDER.map((s) => (
                <div key={s} className="flex items-center justify-between">
                  <Badge colorClass={statusColor(s)} className="capitalize">{s.replace(/_/g, " ")}</Badge>
                  <span className="text-sm font-medium text-gray-700">{byStatus[s] ?? 0}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        {/* Recent published */}
        {published.length > 0 && (
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Recently Published</h3></CardHeader>
            <CardBody className="divide-y divide-gray-50">
              {published.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Badge colorClass={platformColor(c.platform)} className="shrink-0 mt-0.5">
                    {platformLabel(c.platform)}
                  </Badge>
                  <p className="text-sm text-gray-700 flex-1 truncate">{c.text_body}</p>
                  <span className="text-xs text-gray-400 shrink-0">{formatDate(c.created_at)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {isLoading && <p className="text-gray-400 text-sm">Loading analytics…</p>}
      </div>
    </DashboardLayout>
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
