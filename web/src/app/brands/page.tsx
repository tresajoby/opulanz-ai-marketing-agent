"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { brandsApi } from "@/lib/api";
import { Building2, Plus, ArrowRight, CheckCircle } from "lucide-react";
import type { Brand } from "@/types";

export default function BrandsPage() {
  const qc = useQueryClient();
  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["brands"],
    queryFn: brandsApi.list,
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [tone, setTone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Brand name is required."); return; }
    setSaving(true); setError(null);
    try {
      await brandsApi.create({ name, tagline: tagline || null, tone_of_voice: tone || null });
      await qc.invalidateQueries({ queryKey: ["brands"] });
      setName(""); setTagline(""); setTone("");
      setShowForm(false); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create brand.");
    } finally { setSaving(false); }
  }

  return (
    <DashboardLayout title="Brand Management">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <p className="text-gray-500 text-sm">
            Each brand has its own voice, products, audiences, and guidelines that the AI uses as context.
          </p>
          <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" />
            New Brand
          </Button>
        </div>

        {success && <Alert variant="success">Brand created successfully.</Alert>}

        {/* Create form */}
        {showForm && (
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-gray-900">Create Brand</h3>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <Input
                  label="Brand name"
                  placeholder="Opulanz"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <Input
                  label="Tagline (optional)"
                  placeholder="Your brand tagline"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                />
                <Textarea
                  label="Tone of voice (optional)"
                  placeholder="e.g. Professional yet approachable. Confident. Clear. Never pushy."
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={3}
                />
                {error && <Alert variant="error">{error}</Alert>}
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" loading={saving}>Create Brand</Button>
                  <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        )}

        {/* Brand list */}
        {isLoading && <p className="text-gray-400 text-sm">Loading brands…</p>}

        {!isLoading && brands.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center py-12 text-center">
              <Building2 className="h-10 w-10 text-gray-300 mb-3" />
              <p className="font-medium text-gray-600">No brands yet</p>
              <p className="text-sm text-gray-500 mt-1">Create your first brand to get started.</p>
            </CardBody>
          </Card>
        )}

        <div className="space-y-3">
          {brands.map((brand: Brand) => (
            <Card key={brand.id} className="hover:shadow-md transition-shadow">
              <CardBody className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
                    <span className="text-indigo-700 font-bold text-sm">
                      {brand.name[0].toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{brand.name}</p>
                    {brand.tagline && (
                      <p className="text-sm text-gray-500">{brand.tagline}</p>
                    )}
                    {brand.tone_of_voice && (
                      <p className="text-xs text-gray-400 mt-0.5 max-w-md truncate">
                        Tone: {brand.tone_of_voice}
                      </p>
                    )}
                  </div>
                </div>
                <Link href={`/brands/${brand.id}`}>
                  <Button variant="secondary" size="sm">
                    Configure
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
