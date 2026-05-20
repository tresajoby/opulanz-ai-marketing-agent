"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { brandsApi } from "@/lib/api";
import type { WebsiteFetchResult } from "@/types";
import { BookOpen, Package, Users, ShieldAlert, Globe, Loader2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

type Tab = "guidelines" | "products" | "audiences" | "prohibited";

export default function BrandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const brandId = Number(id);
  const qc = useQueryClient();
  const invalidateBrand = () => qc.invalidateQueries({ queryKey: ["brand", brandId] });

  const { data: brand } = useQuery({
    queryKey: ["brand", brandId],
    queryFn: () => brandsApi.get(brandId),
  });
  const { data: products = [], refetch: refetchProducts } = useQuery({
    queryKey: ["products", brandId],
    queryFn: () => brandsApi.listProducts(brandId),
  });
  const { data: audiences = [], refetch: refetchAudiences } = useQuery({
    queryKey: ["audiences", brandId],
    queryFn: () => brandsApi.listAudiences(brandId),
  });
  const { data: prohibited = [], refetch: refetchProhibited } = useQuery({
    queryKey: ["prohibited", brandId],
    queryFn: () => brandsApi.listProhibited(brandId),
  });

  const [tab, setTab] = useState<Tab>("guidelines");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function flash(type: "success" | "error", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "guidelines", label: "Brand Guidelines", icon: BookOpen },
    { key: "products",   label: "Products",         icon: Package },
    { key: "audiences",  label: "Audiences",        icon: Users },
    { key: "prohibited", label: "Prohibited Content",icon: ShieldAlert },
  ];

  return (
    <DashboardLayout title={brand ? `${brand.name} — Configuration` : "Brand Configuration"}>
      <div className="max-w-2xl space-y-5">
        {/* Website auto-fetch card */}
        <WebsiteFetchCard
          brandId={brandId}
          currentUrl={brand?.website_url ?? null}
          onFlash={flash}
          onSuccess={invalidateBrand}
        />

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 pb-0">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {msg && <Alert variant={msg.type}>{msg.text}</Alert>}

        {/* Guidelines tab */}
        {tab === "guidelines" && (
          <GuidelinesTab brandId={brandId} onFlash={flash} />
        )}

        {/* Products tab */}
        {tab === "products" && (
          <ProductsTab brandId={brandId} products={products} onFlash={flash} refetch={refetchProducts} />
        )}

        {/* Audiences tab */}
        {tab === "audiences" && (
          <AudiencesTab brandId={brandId} audiences={audiences} onFlash={flash} refetch={refetchAudiences} />
        )}

        {/* Prohibited tab */}
        {tab === "prohibited" && (
          <ProhibitedTab brandId={brandId} prohibited={prohibited} onFlash={flash} refetch={refetchProhibited} />
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Website Fetch Card ───────────────────────────────────────────────────────

function WebsiteFetchCard({
  brandId,
  currentUrl,
  onFlash,
  onSuccess,
}: {
  brandId: number;
  currentUrl: string | null;
  onFlash: (t: "success" | "error", m: string) => void;
  onSuccess: () => void;
}) {
  const [url, setUrl] = useState(currentUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WebsiteFetchResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await brandsApi.fetchWebsite(brandId, url.trim());
      setResult(res);
      setExpanded(true);
      onSuccess();
      onFlash("success", res.message);
    } catch (err: unknown) {
      onFlash("error", err instanceof Error ? err.message : "Website fetch failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-indigo-600" />
          <h3 className="font-semibold text-gray-900">Brand Website</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Enter your brand website URL. OMMA will scrape it, extract brand signals with AI,
          and automatically ingest the results as brand guidelines.
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleFetch} className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="https://yourbrand.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" loading={loading} disabled={!url.trim()}>
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
            ) : (
              <><Globe className="h-4 w-4" /> Fetch & Analyse</>
            )}
          </Button>
        </form>

        {result && (
          <div className="mt-4 border border-emerald-200 rounded-xl bg-emerald-50 overflow-hidden">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {result.guidelines_chunks} chunks ingested from {result.website_url}
              </span>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {expanded && (
              <div className="px-4 pb-4 space-y-3 text-sm">
                {result.tagline && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Tagline detected</p>
                    <p className="text-gray-700 italic">"{result.tagline}"</p>
                  </div>
                )}
                {result.tone_summary && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Tone of voice</p>
                    <p className="text-gray-700">{result.tone_summary}</p>
                  </div>
                )}
                {result.key_messages.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Key messages</p>
                    <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                      {result.key_messages.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </div>
                )}
                {result.products_mentioned.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Products / services</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.products_mentioned.map((p, i) => (
                        <span key={i} className="bg-white border border-emerald-300 text-emerald-700 text-xs px-2 py-0.5 rounded-full">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}


// ─── Guidelines Tab ───────────────────────────────────────────────────────────

function GuidelinesTab({ brandId, onFlash }: { brandId: number; onFlash: (t: "success" | "error", m: string) => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await brandsApi.ingestText(brandId, text);
      onFlash("success", `Guidelines ingested — ${res.chunks_stored} chunks stored and embedded.`);
      setText("");
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="font-semibold text-gray-900">Upload Brand Guidelines</h3>
        <p className="text-xs text-gray-500 mt-1">
          Paste your brand guidelines text. It will be chunked, embedded, and stored in the
          vector database so the AI always generates on-brand content.
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            label="Guidelines text"
            placeholder="Paste your brand voice, messaging framework, tone of voice guide, or any brand documentation…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />
          <Button type="submit" variant="primary" loading={saving} disabled={!text.trim()}>
            <BookOpen className="h-4 w-4" />
            Ingest Guidelines
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab({ brandId, products, onFlash, refetch }: {
  brandId: number;
  products: { id: number; name: string; description: string | null; price: number | null; url: string | null }[];
  onFlash: (t: "success" | "error", m: string) => void;
  refetch: () => void;
}) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [price, setPrice] = useState(""); const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await brandsApi.addProduct(brandId, {
        name, description: desc || null,
        price: price ? Number(price) : null,
        url: url || null,
      });
      refetch();
      onFlash("success", `Product "${name}" added.`);
      setName(""); setDesc(""); setPrice(""); setUrl("");
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {products.length > 0 && (
        <div className="space-y-2">
          {products.map((p) => (
            <Card key={p.id}>
              <CardBody className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-gray-800">{p.name}</p>
                  {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                </div>
                {p.price && <span className="text-sm font-semibold text-gray-700">${p.price}</span>}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader><h3 className="font-semibold text-gray-900">Add Product</h3></CardHeader>
        <CardBody>
          <form onSubmit={handleAdd} className="space-y-3">
            <Input label="Product name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Textarea label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Price (optional)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
              <Input label="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" size="sm" loading={saving}>Add Product</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Audiences Tab ────────────────────────────────────────────────────────────

function AudiencesTab({ brandId, audiences, onFlash, refetch }: {
  brandId: number;
  audiences: { id: number; persona_name: string; pain_points: string | null }[];
  onFlash: (t: "success" | "error", m: string) => void;
  refetch: () => void;
}) {
  const [name, setName] = useState(""); const [pain, setPain] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await brandsApi.addAudience(brandId, { persona_name: name, pain_points: pain || null });
      refetch();
      onFlash("success", `Audience "${name}" added.`);
      setName(""); setPain("");
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {audiences.map((a) => (
        <Card key={a.id}>
          <CardBody className="py-3">
            <p className="font-medium text-gray-800">{a.persona_name}</p>
            {a.pain_points && <p className="text-xs text-gray-500 mt-1">{a.pain_points}</p>}
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader><h3 className="font-semibold text-gray-900">Add Audience Persona</h3></CardHeader>
        <CardBody>
          <form onSubmit={handleAdd} className="space-y-3">
            <Input label="Persona name" placeholder="e.g. Decision Maker Dana" value={name} onChange={(e) => setName(e.target.value)} required />
            <Textarea label="Pain points & motivations" placeholder="What keeps them up at night? What are they trying to achieve?" value={pain} onChange={(e) => setPain(e.target.value)} rows={3} />
            <Button type="submit" variant="primary" size="sm" loading={saving}>Add Persona</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Prohibited Tab ───────────────────────────────────────────────────────────

function ProhibitedTab({ brandId, prohibited, onFlash, refetch }: {
  brandId: number;
  prohibited: { id: number; content_type: string; content_value: string; reason: string | null }[];
  onFlash: (t: "success" | "error", m: string) => void;
  refetch: () => void;
}) {
  const [value, setValue] = useState(""); const [type, setType] = useState("word"); const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await brandsApi.addProhibited(brandId, { content_type: type, content_value: value, reason: reason || undefined });
      refetch();
      onFlash("success", `"${value}" added to prohibited list.`);
      setValue(""); setReason("");
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {prohibited.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {prohibited.map((p) => (
            <span key={p.id} className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs px-2.5 py-1 rounded-full">
              <ShieldAlert className="h-3 w-3" />
              {p.content_value}
              {p.reason && <span className="text-red-400">({p.reason})</span>}
            </span>
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Add Prohibited Content</h3>
          <p className="text-xs text-gray-500 mt-1">The compliance agent will block any generated content containing these words or phrases.</p>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input label="Word / phrase / claim" value={value} onChange={(e) => setValue(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Type</label>
                <select className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="word">Word</option>
                  <option value="phrase">Phrase</option>
                  <option value="claim">Claim</option>
                </select>
              </div>
            </div>
            <Input label="Reason (optional)" placeholder="e.g. Conflicts with premium positioning" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" variant="danger" size="sm" loading={saving}>
              <ShieldAlert className="h-3.5 w-3.5" />
              Add to Prohibited List
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
