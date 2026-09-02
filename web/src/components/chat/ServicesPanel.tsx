"use client";

import type { Platform } from "@/types";
import {
  Instagram, Facebook, Video, Target, Search, Linkedin,
  Mail, Users, Zap, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ServicesPanelProps {
  activePlatform: Platform;
  onPlatformChange: (p: Platform) => void;
  onPromptTemplate: (t: string) => void;
  activeVariants: number;
  onVariantsChange: (n: number) => void;
}

const PLATFORMS: { value: Platform; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "instagram",    label: "Instagram",     icon: <Instagram className="h-4 w-4" />,  color: "from-purple-500 to-pink-500" },
  { value: "facebook",     label: "Facebook",      icon: <Facebook className="h-4 w-4" />,   color: "from-blue-600 to-blue-500" },
  { value: "tiktok",       label: "TikTok",        icon: <Video className="h-4 w-4" />,      color: "from-gray-900 to-gray-700" },
  { value: "linkedin",     label: "LinkedIn",      icon: <Linkedin className="h-4 w-4" />,   color: "from-blue-700 to-blue-600" },
  // { value: "facebook_ads", label: "Facebook Ads",  icon: <Target className="h-4 w-4" />,     color: "from-blue-700 to-blue-600" },
  // { value: "google_ads",   label: "Google Ads",    icon: <Search className="h-4 w-4" />,     color: "from-green-600 to-green-500" },
];

const TEMPLATES = [
  { label: "Announce a product launch", text: "Create a post announcing the launch of our new product. Generate excitement and a strong call-to-action." },
  { label: "Promote a limited-time offer", text: "Write a post promoting a limited-time discount offer. Create urgency and highlight the value." },
  { label: "Share a customer testimonial", text: "Turn this into an engaging social post: customer says they love our service and would recommend us to everyone." },
  { label: "Brand awareness post", text: "Create a brand awareness post that communicates our values and what makes us unique." },
  { label: "Holiday / seasonal campaign", text: "Create a seasonal post aligned with the upcoming holidays. Keep it warm, engaging, and on-brand." },
  { label: "Behind the scenes", text: "Write a behind-the-scenes post showing the human side of our brand and how we work." },
];

const SERVICES = [
  {
    category: "Social Media",
    icon: <Zap className="h-4 w-4 text-indigo-400" />,
    items: ["Organic post generation", "Hashtag research", "Caption writing", "Multi-variant testing"],
  },
  {
    category: "Paid Ads",
    icon: <Target className="h-4 w-4 text-blue-400" />,
    items: ["Ad copy generation", "Audience targeting copy", "CTA optimization", "A/B variant creation"],
  },
  {
    category: "Brand Compliance",
    icon: <Users className="h-4 w-4 text-emerald-400" />,
    items: ["Tone-of-voice checking", "Prohibited content scan", "PII detection", "Brand score (0–100%)"],
  },
];

export function ServicesPanel({
  activePlatform,
  onPlatformChange,
  onPromptTemplate,
  activeVariants,
  onVariantsChange,
}: ServicesPanelProps) {
  return (
    <aside className="w-72 shrink-0 flex flex-col gap-5 overflow-y-auto py-5 pr-1">

      {/* Platform selector */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
          Platform
        </p>
        <div className="space-y-1">
          {PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPlatformChange(p.value)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                activePlatform === p.value
                  ? `bg-gradient-to-r ${p.color} text-white shadow-sm`
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              {p.icon}
              {p.label}
              {activePlatform === p.value && (
                <span className="ml-auto text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">Active</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Variants */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
          Variants per request
        </p>
        <div className="flex gap-2">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => onVariantsChange(n)}
              className={cn(
                "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors",
                activeVariants === n
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5 px-1">3 gives you Short / Medium / Long</p>
      </div>

      {/* Prompt templates */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
          Quick prompts
        </p>
        <div className="space-y-1">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => onPromptTemplate(t.text)}
              className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors group"
            >
              <span className="flex-1">{t.label}</span>
              <ChevronRight className="h-3 w-3 text-gray-300 group-hover:text-gray-500 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Available services */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
          What OMMA can do
        </p>
        <div className="space-y-3">
          {SERVICES.map((s) => (
            <div key={s.category} className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                {s.icon}
                <p className="text-xs font-semibold text-gray-700">{s.category}</p>
              </div>
              <ul className="space-y-1">
                {s.items.map((item) => (
                  <li key={item} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
