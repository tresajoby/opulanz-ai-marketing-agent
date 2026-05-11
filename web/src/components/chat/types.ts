import type { Platform, ApprovalQueueItem } from "@/types";

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  platform: Platform;
  brandName: string;
  timestamp: Date;
}

export interface ThinkingMessage {
  id: string;
  role: "thinking";
  timestamp: Date;
}

export interface ContentMessage {
  id: string;
  role: "assistant";
  items: ApprovalQueueItem[];
  platform: Platform;
  warnings: string[];
  timestamp: Date;
}

export interface SystemMessage {
  id: string;
  role: "system";
  text: string;
  variant: "success" | "error" | "info";
  timestamp: Date;
}

export type ChatMessage = UserMessage | ThinkingMessage | ContentMessage | SystemMessage;
