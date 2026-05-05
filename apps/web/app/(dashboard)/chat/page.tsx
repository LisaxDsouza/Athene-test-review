"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useUser, useOrganization } from "@clerk/nextjs";
import {
    Send,
    Bot,
    User as UserIcon,
    Paperclip,
    Sparkles,
    Search,
    AlertCircle
} from "lucide-react";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata?: string; // To show which agent was used behind the scenes
    sources?: { chunk_id: string; source_url: string; title: string }[];
};

export default function ChatInterface() {
    const router = useRouter();
    const { user } = useUser();
    const { getToken } = useAuth();
    const { organization, isLoaded: isOrgLoaded } = useOrganization();
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [approval, setApproval] = useState<{ threadId: string; toolCallId: string; description: string } | null>(null);

    // Suggested enterprise prompts for the empty state
    const suggestedPrompts = ["Summarize the latest QBR deck.", "Find risks across the renewal pipeline.", "Plan my day.", "Draft a reply to the highest priority unread email."];

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !organization) return;
        const prompt = input;
        const newUserMsg: Message = { id: Date.now().toString(), role: "user", content: input };
        setMessages(prev => [...prev, newUserMsg]);
        setInput("");
        setIsTyping(true);
        const assistantId = crypto.randomUUID();
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", metadata: "athene supervisor" }]);
        try {
            console.log("[chat] Requesting token for org:", organization.id);
            const token = await getToken();
            const response = await fetch("/api/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ prompt }),
            });
            if (!response.body) throw new Error("Streaming response was not available");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let threadId = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n\n");
                buffer = parts.pop() || "";
                for (const part of parts) {
                    if (!part.startsWith("data: ")) continue;
                    const event = JSON.parse(part.slice(6));
                    if (event.type === "token") {
                        setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, content: msg.content + event.content } : msg));
                    }
                    if (event.type === "tool_call") {
                        setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, metadata: `${event.agent}: ${event.tool}` } : msg));
                    }
                    if (event.type === "approval_required") {
                        setApproval({ threadId: event.thread_id || threadId, toolCallId: event.tool_call_id, description: event.description });
                        setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, content: event.description, metadata: "approval required" } : msg));
                    }
                    if (event.type === "done") {
                        threadId = event.thread_id;
                        setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, sources: event.cited_sources } : msg));
                    }
                    if (event.type === "error") throw new Error(event.message);
                }
            }
        } catch (error) {
            setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, content: error instanceof Error ? error.message : "Request failed", metadata: "error" } : msg));
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] max-w-5xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-500">

            {/* Header */}
            <div className="h-16 border-b border-slate-100 flex items-center px-6 shrink-0 bg-slate-50/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg text-white shadow-sm">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Athene Intelligence</h2>
                        <p className="text-xs text-slate-500">Your enterprise orchestrator</p>
                    </div>
                </div>
            </div>

            {/* Org Check */}
            {isOrgLoaded && !organization && (
                <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3 text-amber-800 text-sm">
                        <AlertCircle className="w-5 h-5" />
                        <span>You need to select or create an organization to use the chat.</span>
                    </div>
                    <button 
                        onClick={() => router.push('/onboarding')}
                        className="text-xs font-bold uppercase tracking-wider text-amber-700 hover:underline"
                    >
                        Go to Onboarding →
                    </button>
                </div>
            )}

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
                {messages.length === 0 ? (
                    // Empty State
                    <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-8">
                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-blue-100">
                            <Sparkles className="w-8 h-8" />
                        </div>
                        <h1 className="text-2xl font-semibold text-slate-900">
                            Good afternoon, {user?.firstName || "there"}.
                        </h1>
                        <p className="text-slate-500">
                            Ask me anything. I securely search across your company's apps, documents, and code to find the exact answer you need.
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mt-8">
                            {suggestedPrompts.map((prompt, i) => (
                                <button
                                    key={i}
                                    onClick={() => setInput(prompt)}
                                    className="text-left p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-sm text-slate-600 hover:text-blue-700"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    // Message Feed
                    <div className="space-y-6 pb-6">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex gap-4 max-w-3xl ${msg.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>

                                {/* Avatar */}
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${msg.role === "user" ? "bg-slate-900 text-white" : "bg-blue-600 text-white"
                                    }`}>
                                    {msg.role === "user" ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                </div>

                                {/* Message Bubble */}
                                <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                    <div className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${msg.role === "user"
                                            ? "bg-slate-900 text-white rounded-tr-sm"
                                            : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"
                                        }`}>
                                        {msg.content}
                                    </div>

                                    {/* Metadata (Showing the user what tools Athene used) */}
                                    {msg.metadata && (
                                        <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400 ml-1">
                                            <Search className="w-3 h-3" />
                                            {msg.metadata}
                                        </div>
                                    )}
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {msg.sources.map(source => (
                                                <a key={source.chunk_id} href={source.source_url} target="_blank" className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                                    {source.title}
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Loading State */}
                        {isTyping && (
                            <div className="flex gap-4 max-w-3xl">
                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 mt-1">
                                    <Bot className="w-4 h-4" />
                                </div>
                                <div className="px-5 py-4 bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Input Box */}
            <div className="p-4 bg-white border-t border-slate-100 shrink-0">
                {approval && (
                    <div className="max-w-4xl mx-auto mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3">
                        <span>{approval.description}</span>
                        <div className="flex gap-2">
                            <button className="px-3 py-1.5 rounded-md bg-white border border-amber-200" onClick={() => setApproval(null)}>Reject</button>
                            <button className="px-3 py-1.5 rounded-md bg-amber-600 text-white" onClick={async () => {
                                const token = await getToken();
                                await fetch("/api/agent/approve", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ thread_id: approval.threadId, approved: true }) });
                                setApproval(null);
                            }}>Approve</button>
                        </div>
                    </div>
                )}
                <form
                    onSubmit={handleSend}
                    className="max-w-4xl mx-auto relative flex items-center bg-slate-50 border border-slate-200 rounded-2xl focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all shadow-sm pl-4 pr-2 py-2"
                >
                    <button type="button" className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                        <Paperclip className="w-5 h-5" />
                    </button>

                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask Athene to search, summarize, or orchestrate..."
                        className="flex-1 bg-transparent border-none focus:ring-0 text-[15px] text-slate-900 px-3 placeholder:text-slate-400 outline-none"
                    />

                    <button
                        type="submit"
                        disabled={!input.trim() || isTyping}
                        className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
                <p className="text-center text-[11px] text-slate-400 mt-3 font-medium">
                    Athene AI can make mistakes. Verify important information from source documents.
                </p>
            </div>

        </div>
    );
}
