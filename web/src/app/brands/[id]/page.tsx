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
import { BookOpen, Package, Users, ShieldAlert, Globe, Loader2, CheckCircle2, ChevronDown, ChevronUp, Link2, Link2Off, Target } from "lucide-react";
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
        {/* Brand logo card */}
        <BrandLogoCard
          brandId={brandId}
          logoUrl={brand?.logo_url ?? null}
          brandName={brand?.name ?? ""}
          onFlash={flash}
          onSuccess={invalidateBrand}
        />

        {/* Website auto-fetch card */}
        <WebsiteFetchCard
          brandId={brandId}
          currentUrl={brand?.website_url ?? null}
          onFlash={flash}
          onSuccess={invalidateBrand}
        />

        {/* Marketing strategy card */}
        <MarketingStrategyCard
          brandId={brandId}
          currentStrategy={brand?.marketing_strategy ?? null}
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

// ─── Social Accounts Tab ──────────────────────────────────────────────────────

const SOCIAL_PLATFORMS: { key: string; label: string; color: string; textColor: string; abbr: string }[] = [
  { key: "instagram", label: "Instagram", color: "from-purple-500 to-pink-500", textColor: "text-white", abbr: "IG" },
  { key: "facebook",  label: "Facebook",  color: "bg-blue-600",                 textColor: "text-white", abbr: "FB" },
  { key: "linkedin",  label: "LinkedIn",  color: "bg-blue-700",                 textColor: "text-white", abbr: "in" },
  { key: "tiktok",    label: "TikTok",    color: "bg-gray-900",                 textColor: "text-white", abbr: "TT" },
];

const POPUP_OPTS = "width=520,height=680,scrollbars=yes,resizable=yes";

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
  const [pasteMode, setPasteMode] = useState<string | null>(null);
  const [pasteForm, setPasteForm] = useState({ pageId: "", pageName: "", token: "" });
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function handleManualConnect(platform: string) {
    if (!pasteForm.token.trim()) { setPasteError("Access token is required."); return; }
    if (!pasteForm.pageId.trim()) { setPasteError("Page ID is required."); return; }
    setBusy(`manual-${platform}`);
    setPasteError(null);
    try {
      await socialApi.manualConnect(brandId, platform, pasteForm.pageId.trim(), pasteForm.pageName.trim() || platform, pasteForm.token.trim());
      setPasteMode(null);
      setPasteForm({ pageId: "", pageName: "", token: "" });
      refetch();
      onFlash("success", `${platform} connected successfully.`);
    } catch (e: unknown) {
      setPasteError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  }

  function handleConnect(platform: string) {
    const url = socialApi.getConnectUrl(platform, brandId);
    const popup = window.open(url, `connect_${platform}`, POPUP_OPTS);
    if (!popup) {
      onFlash("error", "Popup blocked — please allow popups for this site.");
      return;
    }

    const listener = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      window.removeEventListener("message", listener);
      if (e.data.success) {
        refetch();
        onFlash("success", e.data.message || `${platform} connected.`);
      } else {
        onFlash("error", e.data.message || `${platform} connection failed.`);
      }
    };
    window.addEventListener("message", listener);
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
          Connect your accounts via OAuth. When you publish, OMMA{"'"}s AI agent reformats each post
          for its platform before sending it live.
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCIAL_PLATFORMS.map((plat) => {
            const acct = connectedByPlatform[plat.key];
            const isConnected = !!acct;
            const isGradient = plat.color.startsWith("from-");
            const isBusy = busy === `disconnect-${acct?.id}`;

            return (
              <div
                key={plat.key}
                className={`rounded-xl border p-4 ${
                  isConnected ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"
                }`}
              >
                {/* Main row */}
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
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <button
                        onClick={() => handleConnect(plat.key)}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors font-medium"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Connect
                      </button>
                      <button
                        onClick={() => { setPasteMode(plat.key); setPasteForm({ pageId: "", pageName: "", token: "" }); setPasteError(null); }}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2"
                      >
                        Paste token
                      </button>
                    </div>
                  )}
                </div>

                {/* Paste token form */}
                {pasteMode === plat.key && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <input
                      placeholder="Page / Account ID"
                      value={pasteForm.pageId}
                      onChange={e => setPasteForm(f => ({ ...f, pageId: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <input
                      placeholder="Page name (e.g. Opulanz)"
                      value={pasteForm.pageName}
                      onChange={e => setPasteForm(f => ({ ...f, pageName: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <textarea
                      placeholder="Paste access token here"
                      value={pasteForm.token}
                      onChange={e => setPasteForm(f => ({ ...f, token: e.target.value }))}
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none font-mono"
                    />
                    {pasteError && <p className="text-xs text-red-500">{pasteError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleManualConnect(plat.key)}
                        disabled={busy === `manual-${plat.key}`}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busy === `manual-${plat.key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => { setPasteMode(null); setPasteError(null); }}
                        className="px-3 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
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

// ─── Brand Logo Card ──────────────────────────────────────────────────────────

function BrandLogoCard({
  brandId,
  logoUrl,
  brandName,
  onFlash,
  onSuccess,
}: {
  brandId: number;
  logoUrl: string | null;
  brandName: string;
  onFlash: (t: "success" | "error", m: string) => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await brandsApi.uploadLogo(brandId, file);
      onSuccess();
      onFlash("success", "Logo uploaded successfully.");
    } catch (err: unknown) {
      onFlash("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-indigo-600" />
          <h3 className="font-semibold text-gray-900">Brand Logo</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Used as a visual reference when generating images for this brand.
        </p>
      </CardHeader>
      <CardBody>
        <div className="flex items-center gap-5">
          {/* Logo preview */}
          <div className="h-20 w-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
            {logoUrl ? (
              <img src={logoUrl} alt={`${brandName} logo`} className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-xs text-gray-400 text-center px-1">No logo</span>
            )}
          </div>

          {/* Upload button */}
          <div className="space-y-2">
            <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              {logoUrl ? "Replace logo" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
                disabled={loading}
              />
            </label>
            <p className="text-xs text-gray-400">PNG, JPG, SVG or WebP — max 2 MB</p>
          </div>
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


// ─── Marketing Strategy Card ─────────────────────────────────────────────────

function MarketingStrategyCard({
  brandId,
  currentStrategy,
  onFlash,
  onSuccess,
}: {
  brandId: number;
  currentStrategy: string | null;
  onFlash: (t: "success" | "error", m: string) => void;
  onSuccess: () => void;
}) {
  const [strategy, setStrategy] = useState(currentStrategy ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await brandsApi.update(brandId, { marketing_strategy: strategy.trim() || null });
      onSuccess();
      onFlash("success", "Marketing strategy saved. AI will use it when generating posts.");
    } catch (err: unknown) {
      onFlash("error", err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-indigo-600" />
          <h3 className="font-semibold text-gray-900">Marketing Strategy</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Paste your brand's marketing strategy here. OMMA will use it as inspiration when
          generating posts — it won't be followed rigidly, just used as context to produce
          more aligned content.
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSave} className="space-y-3">
          <Textarea
            placeholder="e.g. Our goal is to position the brand as a premium yet accessible option for young professionals. We focus on aspirational lifestyle imagery, education-forward content, and community building…"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            rows={8}
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save Strategy"}
            </Button>
          </div>
        </form>
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
