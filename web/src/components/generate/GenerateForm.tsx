"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { contentApi, brandsApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, CheckCircle } from "lucide-react";
import type { Platform, GenerateResponse } from "@/types";

const PLATFORM_OPTIONS = [
  { value: "instagram",    label: "Instagram" },
  { value: "facebook",     label: "Facebook" },
  { value: "tiktok",       label: "TikTok" },
  { value: "facebook_ads", label: "Facebook Ads" },
  { value: "google_ads",   label: "Google Ads" },
];

const VARIANT_OPTIONS = [
  { value: "1", label: "1 variant" },
  { value: "2", label: "2 variants" },
  { value: "3", label: "3 variants (recommended)" },
];

export function GenerateForm() {
  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: brandsApi.list,
  });

  const [brandId, setBrandId] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [variants, setVariants] = useState("3");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!brandId) { setError("Please select a brand."); return; }
    if (!goal.trim()) { setError("Campaign goal is required."); return; }
    setLoading(true); setError(null); setResult(null);

    try {
      const res = await contentApi.generate({
        brand_id: Number(brandId),
        platform,
        goal,
        additional_context: context,
        num_variants: Number(variants),
      });
      setResult(res);
      setGoal(""); setContext("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally { setLoading(false); }
  }

  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <h2 className="font-semibold text-gray-900">Generate Marketing Content</h2>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          The AI agent will create brand-aligned variants and send them to the approval queue.
        </p>
      </CardHeader>

      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-5">
          <Select
            label="Brand"
            options={brandOptions}
            placeholder="Select a brand…"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          />

          <Select
            label="Platform"
            options={PLATFORM_OPTIONS}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          />

          <Input
            label="Campaign goal"
            placeholder="e.g. Drive awareness of our new product launch"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
          />

          <Textarea
            label="Additional context (optional)"
            placeholder="e.g. Launch is this Friday. Early-bird pricing available until Sunday."
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
          />

          <Select
            label="Number of variants"
            options={VARIANT_OPTIONS}
            value={variants}
            onChange={(e) => setVariants(e.target.value)}
          />

          {error && <Alert variant="error">{error}</Alert>}

          {result && (
            <Alert variant="success" title="Content generated!">
              <p>{result.message}</p>
              {result.compliance_warnings.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-amber-700">Compliance warnings:</p>
                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                    {result.compliance_warnings.map((w, i) => (
                      <li key={i} className="text-xs">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-xs text-green-700 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" />
                {result.items_created} item(s) are now in the Approval Queue.
              </p>
            </Alert>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            className="w-full"
            disabled={!brandId || !goal.trim()}
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Generating…" : "Generate Content"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
