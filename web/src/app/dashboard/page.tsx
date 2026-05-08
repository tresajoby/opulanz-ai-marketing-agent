"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { contentApi, brandsApi } from "@/lib/api";
import { platformLabel, platformColor, formatDate } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  ClipboardCheck,
  Sparkles,
  CheckCircle,
  Send,
  ArrowRight,
  Building2,
} from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: queue = [] } = useQuery({
    queryKey: ["queue"],
    queryFn: () => contentApi.queue(),
    refetchInterval: 30_000,
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: brandsApi.list,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["content-recent"],
    queryFn: () => contentApi.list({ status: "published" }),
  });

  const pendingCount = queue.filter((q) => q.status === "pending").length;

  const stats = [
    {
      label: "Pending Approvals",
      value: pendingCount,
      icon: ClipboardCheck,
      color: pendingCount > 0 ? "text-amber-600" : "text-green-600",
      bg: pendingCount > 0 ? "bg-amber-50" : "bg-green-50",
      href: "/queue",
    },
    {
      label: "Brands Configured",
      value: brands.length,
      icon: Building2,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      href: "/brands",
    },
    {
      label: "Posts Published",
      value: recent.length,
      icon: Send,
      color: "text-blue-600",
      bg: "bg-blue-50",
      href: "/queue",
    },
  ];

  return (
    <DashboardLayout title="Command Center">
      <div className="space-y-6">
        {/* Welcome */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Good {getTimeOfDay()}, {user?.name?.split(" ")[0]} 👋
          </h2>
          <p className="text-gray-500 mt-1">Here&apos;s what needs your attention today.</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(({ label, value, icon: Icon, color, bg, href }) => (
            <Link key={label} href={href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardBody className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bg}`}>
                    <Icon className={`h-6 w-6 ${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{value}</p>
                    <p className="text-sm text-gray-500">{label}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/generate">
            <Button variant="primary">
              <Sparkles className="h-4 w-4" />
              Generate Content
            </Button>
          </Link>
          <Link href="/queue">
            <Button variant="secondary">
              <ClipboardCheck className="h-4 w-4" />
              Review Queue {pendingCount > 0 && `(${pendingCount})`}
            </Button>
          </Link>
          <Link href="/brands">
            <Button variant="secondary">
              <Building2 className="h-4 w-4" />
              Manage Brands
            </Button>
          </Link>
        </div>

        {/* Pending queue preview */}
        {queue.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Pending Approvals</h3>
              <Link href="/queue" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="space-y-2">
              {queue.slice(0, 4).map((item) => (
                <Card key={item.id}>
                  <CardBody className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge colorClass={platformColor(item.content_item.platform)}>
                        {platformLabel(item.content_item.platform)}
                      </Badge>
                      <p className="text-sm text-gray-700 truncate max-w-xs">
                        {item.content_item.text_body.slice(0, 80)}…
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span className="text-xs text-gray-400">{formatDate(item.requested_at)}</span>
                      <Link href="/queue">
                        <Button size="sm" variant="ghost">Review</Button>
                      </Link>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {queue.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center py-12 text-center">
              <CheckCircle className="h-10 w-10 text-green-400 mb-3" />
              <p className="font-medium text-gray-700">Approval queue is clear</p>
              <p className="text-sm text-gray-500 mt-1">Generate content to get started.</p>
              <Link href="/generate" className="mt-4">
                <Button variant="primary" size="sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Content
                </Button>
              </Link>
            </CardBody>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
