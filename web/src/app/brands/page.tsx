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
import { Building2, Plus, ArrowRight } from "lucide-react";
import type { Brand } from "@/types";

const TONE_PRESETS = [
  "Professional & Authoritative",
  "Friendly & Approachable",
  "Playful & Fun",
  "Inspirational & Motivational",
  "Luxurious & Premium",
  "Bold & Edgy",
  "Calm & Reassuring",
  "Witty & Clever",
];

export default function BrandsPage() {
  const qc = useQueryClient();
  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["brands"],
    queryFn: brandsApi.list,
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [toneOption, setToneOption] = useState("");
  const [toneCustom, setToneCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardBrandId, setWizardBrandId] = useState<number | null>(null);
  const [guidelinesText, setGuidelinesText] = useState("");
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  const toneValue = toneOption === "custom" ? toneCustom : toneOption;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Brand name is required."); return; }
    setSaving(true); setError(null);
    try {
      await brandsApi.create({ name, tagline: tagline || null, tone_of_voice: toneValue || null });
      await qc.invalidateQueries({ queryKey: ["brands"] });
      setName(""); setTagline(""); setToneOption(""); setToneCustom("");
      setShowForm(false); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create brand.");
    } finally { setSaving(false); }
  }

  async function handleWizardStep1(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setWizardError("Brand name is required."); return; }
    setWizardSaving(true); setWizardError(null);
    try {
      const b = await brandsApi.create({ name, tagline: tagline || null, tone_of_voice: toneValue || null });
      setWizardBrandId(b.id);
      setWizardStep(2);
    } catch (err: unknown) {
      setWizardError(err instanceof Error ? err.message : "Failed to create brand.");
    } finally { setWizardSaving(false); }
  }

  async function handleWizardStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!wizardBrandId) return;
    if (!guidelinesText.trim()) {
      // Allow skipping guidelines if they don't have text yet
      setWizardStep(3);
      await qc.invalidateQueries({ queryKey: ["brands"] });
      return;
    }
    setWizardSaving(true); setWizardError(null);
    try {
      await brandsApi.ingestText(wizardBrandId, guidelinesText);
      await qc.invalidateQueries({ queryKey: ["brands"] });
      setWizardStep(3);
    } catch (err: unknown) {
      setWizardError(err instanceof Error ? err.message : "Failed to ingest brand guidelines.");
    } finally { setWizardSaving(false); }
  }

  function handleWizardReset() {
    setName(""); setTagline(""); setToneOption(""); setToneCustom("");
    setGuidelinesText(""); setWizardBrandId(null); setWizardStep(1);
    setWizardError(null);
  }

  return (
    <DashboardLayout title="Brand Management">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <p className="text-gray-500 text-sm">
            Each brand has its own voice, products, audiences, and guidelines that the AI uses as context.
          </p>
          {brands.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="h-4 w-4" />
              New Brand
            </Button>
          )}
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
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Tone of voice (optional)</label>
                  <select
                    value={toneOption}
                    onChange={(e) => setToneOption(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">Select a tone…</option>
                    {TONE_PRESETS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                  {toneOption === "custom" && (
                    <Textarea
                      placeholder="e.g. Confident and direct, with a touch of warmth. Never salesy or corporate."
                      value={toneCustom}
                      onChange={(e) => setToneCustom(e.target.value)}
                      rows={3}
                    />
                  )}
                </div>
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
          <Card className="border-indigo-100 bg-indigo-50/20">
            <CardHeader className="border-b border-indigo-50/60 pb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-indigo-900 text-lg">Quick Brand Setup Wizard</h3>
                <p className="text-xs text-indigo-500 mt-0.5">Configure your brand voice and AI RAG guidelines in minutes</p>
              </div>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">
                Step {wizardStep} of 3
              </span>
            </CardHeader>
            <CardBody className="py-6">
              {/* Step indicator bubbles */}
              <div className="flex items-center gap-2 mb-6">
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    className={`h-2.5 rounded-full flex-1 transition-all ${
                      step <= wizardStep ? "bg-indigo-600" : "bg-gray-200"
                    }`}
                  />
                ))}
              </div>

              {wizardStep === 1 && (
                <form onSubmit={handleWizardStep1} className="space-y-4">
                  <h4 className="font-semibold text-gray-900 text-sm">Step 1 — Tell us about your Brand</h4>
                  <Input
                    label="Brand Name"
                    placeholder="e.g. Opulanz"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <Input
                    label="Brand Tagline"
                    placeholder="e.g. Next-Gen Marketing for Everyone"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                  />
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Brand Voice / Tone</label>
                    <select
                      value={toneOption}
                      onChange={(e) => setToneOption(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">Select pre-defined tone preset...</option>
                      {TONE_PRESETS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      <option value="custom">Custom Brand Guidelines Voice...</option>
                    </select>
                    {toneOption === "custom" && (
                      <Textarea
                        placeholder="e.g. Approachable and warm. We never use jargon or hard sales copy."
                        value={toneCustom}
                        onChange={(e) => setToneCustom(e.target.value)}
                        rows={3}
                      />
                    )}
                  </div>
                  {wizardError && <Alert variant="error">{wizardError}</Alert>}
                  <div className="flex justify-end pt-2">
                    <Button type="submit" variant="primary" loading={wizardSaving}>
                      Next: Brand Guidelines <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}

              {wizardStep === 2 && (
                <form onSubmit={handleWizardStep2} className="space-y-4">
                  <h4 className="font-semibold text-gray-900 text-sm">Step 2 — Paste Brand Guidelines (RAG Context)</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Paste text from your brand manual, editorial stylebook, or mission statement.
                    OMMA parses this guidelines document to align AI-generated content with your voice.
                  </p>
                  <Textarea
                    placeholder="Paste guidelines here..."
                    value={guidelinesText}
                    onChange={(e) => setGuidelinesText(e.target.value)}
                    rows={8}
                  />
                  {wizardError && <Alert variant="error">{wizardError}</Alert>}
                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                    >
                      Back
                    </button>
                    <Button type="submit" variant="primary" loading={wizardSaving}>
                      {guidelinesText.trim() ? "Next: Ingest Guidelines" : "Skip Guideline Ingestion"}{" "}
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}

              {wizardStep === 3 && (
                <div className="space-y-5 text-center py-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mx-auto">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-base">Setup Complete!</h4>
                    <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
                      Your brand <strong>{name}</strong> is successfully configured and guidelines ingested.
                    </p>
                  </div>
                  <div className="flex justify-center gap-3 pt-2">
                    <Link href={`/brands/${wizardBrandId}`}>
                      <Button variant="primary">
                        Configure Social Accounts & Products
                        <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Button>
                    </Link>
                    <Button variant="ghost" onClick={handleWizardReset}>
                      Add Another Brand
                    </Button>
                  </div>
                </div>
              )}
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

