// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | "super_admin"
  | "marketing_manager"
  | "content_creator"
  | "affiliate_manager"
  | "analyst";

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  user: User;
}

// ─── Brand ────────────────────────────────────────────────────────────────────

export interface Brand {
  id: number;
  name: string;
  tagline: string | null;
  tone_of_voice: string | null;
  color_palette: Record<string, string> | null;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: number;
  brand_id: number;
  name: string;
  description: string | null;
  price: number | null;
  url: string | null;
  category: string | null;
  is_active: boolean;
}

export interface TargetAudience {
  id: number;
  brand_id: number;
  persona_name: string;
  demographics: Record<string, string> | null;
  psychographics: Record<string, string> | null;
  pain_points: string | null;
}

// ─── Content ──────────────────────────────────────────────────────────────────

export type Platform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "google_ads"
  | "facebook_ads";

export type ContentStatus =
  | "draft"
  | "pending_review"
  | "revision_requested"
  | "approved"
  | "rejected"
  | "published";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "expired";

export interface ContentItem {
  id: number;
  brand_id: number;
  platform: Platform;
  content_type: string;
  text_body: string;
  hashtags: string | null;
  image_prompt: string | null;
  image_url: string | null;
  status: ContentStatus;
  ai_confidence_score: number | null;
  ai_model_used: string | null;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  published_at: string | null;
  platform_post_id: string | null;
}

export interface ApprovalQueueItem {
  id: number;
  content_item_id: number;
  action_type: string;
  status: ApprovalStatus;
  assigned_to_role: string | null;
  ai_reasoning: string | null;
  reviewer_comment: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  requested_at: string;
  deadline_at: string | null;
  content_item: ContentItem;
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  brand_id: number;
  platform: Platform;
  goal: string;
  additional_context?: string;
  num_variants?: number;
  content_type?: string;
}

export interface GenerateResponse {
  items_created: number;
  approval_queue_ids: number[];
  compliance_warnings: string[];
  message: string;
}
