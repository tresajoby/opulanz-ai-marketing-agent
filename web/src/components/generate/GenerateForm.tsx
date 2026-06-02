"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { contentApi, brandsApi, socialApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, CheckCircle, AlertCircle } from "lucide-react";
import type { Platform, GenerateResponse } from "@/types";

// Ad platforms don't require OAuth — always available
const AD_PLATFORMS = [
  { value: "facebook_ads", label: "Facebook Ads" },
  { value: "google_ads",   label: "Google Ads" },
];

const ORGANIC_PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook:  "Facebook",
  tiktok:    "TikTok",
  linkedin:  "LinkedIn",
};

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

  const { data: socialAccounts = [] } = useQuery({
    queryKey: ["social", brandId],
    queryFn: () => socialApi.listAccounts(Number(brandId)),
    enabled: !!brandId,
  });

  const connectedPlatforms = socialAccounts.map((a) => a.platform);
  const hasConnectedOrganic = connectedPlatforms.length > 0;

  // When a brand is selected, filter to connected organic platforms + always-on ad platforms.
  // When no brand is selected yet, show all platforms so the dropdown isn't empty.
  const platformOptions = brandId
    ? [
        ...connectedPlatforms.map((p) => ({
          value: p,
          label: `${ORGANIC_PLATFORM_LABELS[p] ?? p} ✓`,
        })),
        ...AD_PLATFORMS,
      ]
    : [
        { value: "instagram", label: "Instagram" },
        { value: "facebook",  label: "Facebook" },
        { value: "tiktok",    label: "TikTok" },
        { value: "linkedin",  label: "LinkedIn" },
        ...AD_PLATFORMS,
      ];
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
            options={platformOptions}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          />
          {brandId && !hasConnectedOrganic && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 -mt-3">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              No social accounts connected for this brand. Only ad platforms are available.{" "}
              <a href={`/brands/${brandId}`} className="underline hover:text-amber-800">Connect accounts →</a>
            </p>
          )}

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
