import { getToken } from "./auth";
import type {
  AuthToken,
  Brand,
  ApprovalQueueItem,
  ContentItem,
  GenerateRequest,
  GenerateResponse,
  Product,
  TargetAudience,
  WebsiteFetchResult,
  SocialAccount,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api-production-69d9.up.railway.app";

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("Request timed out — the server took too long to respond.");
    }
    throw new Error("Network error — check your connection and try again.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `${res.status} ${res.statusText}` }));
    throw new Error(err.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<AuthToken> {
  const body = new URLSearchParams({ username: email, password });
  const token = getToken();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail ?? "Login failed");
  }
  return res.json();
}

// ─── Brands ───────────────────────────────────────────────────────────────────

export const brandsApi = {
  list: () => request<Brand[]>("/api/brands/"),
  get: (id: number) => request<Brand>(`/api/brands/${id}`),
  create: (data: Partial<Brand>) =>
    request<Brand>("/api/brands/", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Brand>) =>
    request<Brand>(`/api/brands/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  ingestText: (id: number, text: string, version = 1) =>
    request<{ message: string; chunks_stored: number }>(
      `/api/brands/${id}/guidelines/text`,
      { method: "POST", body: JSON.stringify({ text, version }) }
    ),
  addProduct: (id: number, data: Partial<Product>) =>
    request<Product>(`/api/brands/${id}/products`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listProducts: (id: number) => request<Product[]>(`/api/brands/${id}/products`),
  addAudience: (id: number, data: Partial<TargetAudience>) =>
    request<TargetAudience>(`/api/brands/${id}/audiences`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listAudiences: (id: number) => request<TargetAudience[]>(`/api/brands/${id}/audiences`),
  addProhibited: (id: number, data: { content_type: string; content_value: string; reason?: string }) =>
    request(`/api/brands/${id}/prohibited`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listProhibited: (id: number) =>
    request<Array<{ id: number; content_type: string; content_value: string; reason: string | null }>>(
      `/api/brands/${id}/prohibited`
    ),
  fetchWebsite: (id: number, url: string) =>
    request<WebsiteFetchResult>(`/api/brands/${id}/fetch-website`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
};

// ─── Content & Approval ───────────────────────────────────────────────────────

export const contentApi = {
  generate: (data: GenerateRequest) =>
    request<GenerateResponse>("/api/content/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  queue: (brandId?: number) => {
    const qs = brandId ? `?brand_id=${brandId}` : "";
    return request<ApprovalQueueItem[]>(`/api/content/queue${qs}`);
  },
  list: (params?: { brand_id?: number; status?: string; platform?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined) as [string, string][]
      )
    ).toString();
    return request<ContentItem[]>(`/api/content/${qs ? `?${qs}` : ""}`);
  },
  get: (id: number) => request<ContentItem>(`/api/content/${id}`),
  approve: (id: number, comment = "") =>
    request(`/api/content/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  reject: (id: number, comment: string) =>
    request(`/api/content/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  requestRevision: (id: number, notes: string) =>
    request(`/api/content/${id}/request-revision`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  publish: (id: number) =>
    request(`/api/content/${id}/publish`, { method: "POST" }),
  generateImage: (id: number) =>
    request<{ image_url: string; content_item_id: number }>(
      `/api/content/${id}/generate-image`,
      { method: "POST" },
      60_000,
    ),
};

// ─── Social OAuth ─────────────────────────────────────────────────────────────

export const socialApi = {
  listAccounts: (brandId: number) =>
    request<SocialAccount[]>(`/api/social/brands/${brandId}/accounts`),
  disconnect: (accountId: number) =>
    request(`/api/social/accounts/${accountId}`, { method: "DELETE" }),
  getConnectUrl: (platform: string, brandId: number) =>
    request<{ connect_url: string }>(
      `/api/social/connect-token?platform=${platform}&brand_id=${brandId}`
    ),
};
