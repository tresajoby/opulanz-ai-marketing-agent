import type { Platform } from "@/types";

export interface PlatformImageGuide {
  /** width / height */
  aspect: number;
  label: string;
  sizeHint: string;
  /** Short chip next to upload button */
  guide: string;
  presets: { id: string; label: string; aspect: number }[];
}

/** Recommended feed sizes shown in the upload UI. */
export const PLATFORM_IMAGE_GUIDE: Record<string, PlatformImageGuide> = {
  instagram: {
    aspect: 1,
    label: "1:1 square",
    sizeHint: "1080×1080",
    guide: "Instagram: 1080×1080",
    presets: [
      { id: "1:1", label: "Square 1:1", aspect: 1 },
      { id: "4:5", label: "Portrait 4:5", aspect: 4 / 5 },
      { id: "1.91:1", label: "Landscape 1.91:1", aspect: 1.91 },
    ],
  },
  tiktok: {
    aspect: 9 / 16,
    label: "9:16 vertical",
    sizeHint: "1080×1920",
    guide: "TikTok: 1080×1920",
    presets: [{ id: "9:16", label: "Vertical 9:16", aspect: 9 / 16 }],
  },
  facebook: {
    aspect: 1.91,
    label: "landscape ~1.91:1",
    sizeHint: "1200×630",
    guide: "Facebook: 1200×630",
    presets: [
      { id: "1.91:1", label: "Landscape 1.91:1", aspect: 1.91 },
      { id: "1:1", label: "Square 1:1", aspect: 1 },
    ],
  },
  linkedin: {
    aspect: 1.91,
    label: "landscape ~1.91:1",
    sizeHint: "1200×627",
    guide: "LinkedIn: 1200×627",
    presets: [
      { id: "1.91:1", label: "Landscape 1.91:1", aspect: 1.91 },
      { id: "1:1", label: "Square 1:1", aspect: 1 },
    ],
  },
  facebook_ads: {
    aspect: 1.91,
    label: "landscape ~1.91:1",
    sizeHint: "1200×628",
    guide: "Facebook Ads: 1200×628",
    presets: [{ id: "1.91:1", label: "Landscape 1.91:1", aspect: 1.91 }],
  },
  google_ads: {
    aspect: 1.91,
    label: "landscape ~1.91:1",
    sizeHint: "1200×628",
    guide: "Google Ads: 1200×628",
    presets: [{ id: "1.91:1", label: "Landscape 1.91:1", aspect: 1.91 }],
  },
};

export function getPlatformImageGuide(platform: Platform | string): PlatformImageGuide {
  return (
    PLATFORM_IMAGE_GUIDE[platform] ?? {
      aspect: 1,
      label: "1:1 square",
      sizeHint: "1080×1080",
      guide: "Recommended: 1080×1080",
      presets: [{ id: "1:1", label: "Square 1:1", aspect: 1 }],
    }
  );
}

/** Strip tokens / long Graph URLs from publish errors shown in the UI. */
export function formatPublishError(raw: string): string {
  let msg = raw.replace(/access_token=[^&\s'"]+/gi, "access_token=[redacted]");
  msg = msg.replace(/https?:\/\/graph\.facebook\.com\/[^\s'"]+/gi, "Facebook API");
  msg = msg.replace(/Client error '(\d+ [^']+)' for url '[^']*'/gi, "Platform error $1");
  msg = msg.replace(/\s*For more information check:.*$/i, "");
  // Prefer the human part after our publisher prefix
  const ig = msg.match(/Instagram[^:]*:\s*(.+)$/i);
  if (ig?.[1]) return ig[1].trim();
  const fb = msg.match(/Facebook[^:]*:\s*(.+)$/i);
  if (fb?.[1]) return fb[1].trim();
  return msg.trim() || "Publishing failed. Please try again.";
}
