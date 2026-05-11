"use client";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Sidebar } from "@/components/layout/Sidebar";

export default function ChatPage() {
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
