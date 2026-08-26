"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Sidebar } from "@/components/layout/Sidebar";

export default function ChatPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <svg className="h-7 w-7 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Loading OMMA…</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      {/* Full-height chat layout, no inner scroll wrapper */}
      <div className="flex flex-col flex-1 ml-56 overflow-hidden">
        <div className="flex-1 p-5 overflow-hidden">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
}

