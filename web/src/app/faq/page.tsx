"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardBody } from "@/components/ui/Card";
import { HelpCircle, Search, ChevronDown, ChevronUp, AlertCircle, Sparkles, Sliders, Globe } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
  category: "general" | "integrations" | "generation" | "approvals";
}

const FAQ_DATA: FAQItem[] = [
  {
    category: "general",
    question: "What is OMMA?",
    answer: "OMMA (Opulanz Marketing Manager Agent) is an AI-powered multi-channel marketing manager. It automatically generates high-quality, brand-compliant social media posts, runs them through compliance checks, manages them in an approval queue, and schedules/publishes them to connected platforms.",
  },
  {
    category: "general",
    question: "How do I configure my brand voice and settings?",
    answer: "Go to the Brand Management section in the sidebar. Select your brand (or create a new one) to configure settings such as your tagline, target audience, brand color palettes, website URL, tone of voice guidelines, and specific compliance rules. The AI will use these rules to generate and check posts.",
  },
  {
    category: "integrations",
    question: "Which social media platforms does OMMA support?",
    answer: "OMMA currently supports Instagram, Facebook (both regular posts and ads), TikTok, LinkedIn, and Google Ads. You can connect active social accounts for your configured brands and publish directly to them.",
  },
  {
    category: "integrations",
    question: "Why am I seeing an error when uploading custom images?",
    answer:
      "Uploaded images must be standard types (PNG, JPG, JPEG, WebP) and under 8 MB. After you pick a file, OMMA opens a crop preview so you can frame the image for the target platform before upload.\n\nRecommended sizes:\n• Instagram: 1080×1080 (square). Allowed aspect range is 4:5 to 1.91:1.\n• TikTok: 1080×1920 (9:16 vertical).\n• Facebook / LinkedIn: about 1200×630 (landscape ~1.91:1).\n\nUltra-wide or unusual aspect ratios can be rejected by Instagram — use the crop tool (or re-upload a better-fitting image) if you see a size warning.",
  },
  {
    category: "integrations",
    question: "What image size should I use for each platform?",
    answer:
      "Use the size hint next to Upload Custom Image on each post card. Defaults: Instagram 1080×1080, TikTok 1080×1920, Facebook/LinkedIn ~1200×630. AI-generated images already match these ratios; custom uploads should be cropped to match before publishing.",
  },
  {
    category: "generation",
    question: "How does the AI generate social media posts?",
    answer: "In the AI Chat Studio, specify what your campaign goals are (e.g., 'Draft 3 Instagram posts for our summer sale'). OMMA leverages Claude to write target-oriented, formatted posts complete with appropriate hashtags, along with DALL-E 3 image generation prompts matched to each platform's standard aspect ratios.",
  },
  {
    category: "generation",
    question: "Can I customize the generated image prompt?",
    answer: "Yes! Click the pencil edit icon next to the DALL-E image prompt on any variant card. You can edit the text to refine the scene, click 'Generate Image', and the system will run prompt expansion and call DALL-E to create a customized branded image for you.",
  },
  {
    category: "approvals",
    question: "What are the different post statuses?",
    answer: "• Pending: The post has been generated and is awaiting review.\n• Approved: The post has been approved by a manager and is ready to publish.\n• Rejected: The post was rejected, along with comments outlining why.\n• Revision Requested: The post needs changes. You can send feedback directly to the agent to regenerate the variant.\n• Published: The post has been successfully dispatched and published to the social platform.",
  },
  {
    category: "approvals",
    question: "Who can approve or publish content items?",
    answer: "Only users with the role of 'Super Admin' or 'Marketing Manager' have the authority to Approve, Request Revision, Reject, or Publish content items. Content Creators can generate items and request images, but they cannot approve or dispatch them to live publishing queues.",
  },
];

const CATEGORIES = [
  { id: "all", label: "All Topics", icon: HelpCircle },
  { id: "general", label: "General", icon: Sliders },
  { id: "integrations", label: "Integrations", icon: Globe },
  { id: "generation", label: "Content Generation", icon: Sparkles },
  { id: "approvals", label: "Approvals & Queue", icon: AlertCircle },
];

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleAccordion = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const filteredFaqs = FAQ_DATA.filter((faq) => {
    const matchesSearch =
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "all" || faq.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <DashboardLayout title="Help & FAQ">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Banner */}
        <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">How can we help you today?</h2>
            <p className="text-indigo-200 text-sm">
              Search our knowledge base or browse categories below to learn about processes, integrations, and queue workflows.
            </p>
          </div>
          <div className="relative w-full md:w-80 shrink-0">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </span>
            <input
              type="text"
              placeholder="Search help topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-slate-900 placeholder-slate-400 bg-white border border-slate-700/30 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setExpandedIndex(null);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* FAQ List */}
        <div className="space-y-3">
          {filteredFaqs.length > 0 ? (
            filteredFaqs.map((faq, idx) => {
              const isOpen = expandedIndex === idx;
              return (
                <Card
                  key={idx}
                  className={`overflow-hidden transition-all duration-200 hover:shadow border ${
                    isOpen ? "border-indigo-200 shadow" : "border-gray-200"
                  }`}
                >
                  <button
                    onClick={() => toggleAccordion(idx)}
                    className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 font-semibold text-sm text-gray-900 bg-white focus:outline-none"
                  >
                    <span>{faq.question}</span>
                    <span className="shrink-0 text-gray-400 hover:text-gray-600">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {isOpen && (
                    <CardBody className="px-5 pb-4 pt-0 border-t border-slate-100 bg-slate-50/50">
                      <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed pt-3">
                        {faq.answer}
                      </p>
                    </CardBody>
                  )}
                </Card>
              );
            })
          ) : (
            <div className="text-center py-16 bg-white border border-gray-200 rounded-2xl space-y-2">
              <HelpCircle className="h-10 w-10 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600 text-sm">No FAQs found</p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                We couldn&apos;t find anything matching your search term. Try searching for other keywords.
              </p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
