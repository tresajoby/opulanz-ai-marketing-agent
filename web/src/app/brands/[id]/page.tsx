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
import { BookOpen, Package, Users, ShieldAlert, Globe, Loader2, CheckCircle2, ChevronDown, ChevronUp, Link2, Link2Off } from "lucide-react";
import { socialApi } from "@/lib/api";
import type { SocialAccount } from "@/types";

type Tab = "guidelines" | "products" | "audiences" | "prohibited" | "social";

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

  const { data: socialAccounts = [], refetch: refetchSocial } = useQuery({
    queryKey: ["social", brandId],
    queryFn: () => socialApi.listAccounts(brandId),
  });

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "guidelines", label: "Brand Guidelines", icon: BookOpen },
    { key: "products",   label: "Products",         icon: Package },
    { key: "audiences",  label: "Audiences",        icon: Users },
    { key: "prohibited", label: "Prohibited Content",icon: ShieldAlert },
    { key: "social",     label: "Connected Accounts", icon: Link2 },
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

        {/* Social accounts tab */}
        {tab === "social" && (
          <SocialAccountsTab brandId={brandId} accounts={socialAccounts} onFlash={flash} refetch={refetchSocial} />
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Social Accounts Tab (manual) ────────────────────────────────────────────

const SOCIAL_PLATFORMS: { key: string; label: string; color: string; textColor: string; abbr: string }[] = [
  { key: "instagram", label: "Instagram", color: "from-purple-500 to-pink-500", textColor: "text-white", abbr: "IG" },
  { key: "facebook",  label: "Facebook",  color: "bg-blue-600",                 textColor: "text-white", abbr: "FB" },
  { key: "linkedin",  label: "LinkedIn",  color: "bg-blue-700",                 textColor: "text-white", abbr: "in" },
  { key: "tiktok",    label: "TikTok",    color: "bg-gray-900",                 textColor: "text-white", abbr: "TT" },
];

function SocialAccountsTab({
  brandId,
  accounts,
  onFlash,
  refetch,
}: {
  brandId: number;
  accounts: SocialAccount[];
  onFlash: (t: "success" | "error", m: string) => void;
  refetch: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");

  async function handleAdd(platform: string) {
    const name = accountName.trim() || platform.charAt(0).toUpperCase() + platform.slice(1);
    setBusy(platform);
    try {
      await socialApi.markConnected(brandId, platform, name);
      refetch();
      onFlash("success", `${platform.charAt(0).toUpperCase() + platform.slice(1)} connected.`);
      setAdding(null);
      setAccountName("");
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed to save account.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(acct: SocialAccount) {
    setBusy(`disconnect-${acct.id}`);
    try {
      await socialApi.disconnect(acct.id);
      refetch();
      onFlash("success", `${acct.account_name} disconnected.`);
    } catch (e: unknown) {
      onFlash("error", e instanceof Error ? e.message : "Failed to disconnect.");
    } finally {
      setBusy(null);
    }
  }

  const connectedByPlatform = Object.fromEntries(accounts.map((a) => [a.platform, a]));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-indigo-600" />
          <h3 className="font-semibold text-gray-900">Connected Social Accounts</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Add your social account handles so OMMA knows which platforms to publish to.
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCIAL_PLATFORMS.map((plat) => {
            const acct = connectedByPlatform[plat.key];
            const isConnected = !!acct;
            const isGradient = plat.color.startsWith("from-");
            const isBusy = busy === plat.key || busy === `disconnect-${acct?.id}`;
            const isAdding = adding === plat.key;

            return (
              <div
                key={plat.key}
                className={`rounded-xl border p-4 flex flex-col gap-3 ${
                  isConnected ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                    isConnected
                      ? isGradient ? `bg-gradient-to-br ${plat.color} ${plat.textColor}` : `${plat.color} ${plat.textColor}`
                      : "bg-gray-200 text-gray-500"
                  }`}>
                    {plat.abbr}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{plat.label}</p>
                    {isConnected
                      ? <p className="text-xs text-emerald-700 truncate">{acct.account_name}</p>
                      : <p className="text-xs text-gray-400">Not connected</p>
                    }
                  </div>

                  {isConnected ? (
                    <button
                      onClick={() => handleDisconnect(acct)}
                      disabled={isBusy}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => { setAdding(plat.key); setAccountName(""); }}
                      disabled={isBusy || isAdding}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 disabled:opacity-50 transition-colors shrink-0 font-medium"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Add account
                    </button>
                  )}
                </div>

                {isAdding && (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder={`@${plat.label.toLowerCase()} handle`}
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAdd(plat.key); if (e.key === "Escape") { setAdding(null); setAccountName(""); } }}
                      className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                    <button
                      onClick={() => handleAdd(plat.key)}
                      disabled={isBusy}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-medium"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </button>
                    <button
                      onClick={() => { setAdding(null); setAccountName(""); }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
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
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
                      Products / services <span className="normal-case font-normal text-emerald-600">({result.products_created} added)</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.products_mentioned.map((p, i) => (
                        <span key={i} className="bg-white border border-emerald-300 text-emerald-700 text-xs px-2 py-0.5 rounded-full">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
                {result.target_audiences.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
                      Target audiences <span className="normal-case font-normal text-emerald-600">({result.audiences_created} added)</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.target_audiences.map((a, i) => (
                        <span key={i} className="bg-white border border-blue-200 text-blue-700 text-xs px-2 py-0.5 rounded-full">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                {result.prohibited_terms.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
                      Prohibited terms <span className="normal-case font-normal text-emerald-600">({result.prohibited_terms_created} added)</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.prohibited_terms.map((t, i) => (
                        <span key={i} className="bg-white border border-red-200 text-red-600 text-xs px-2 py-0.5 rounded-full">{t}</span>
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
