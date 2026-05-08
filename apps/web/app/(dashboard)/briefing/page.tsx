"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { CalendarDays, Mail, ListChecks, Sparkles } from "lucide-react";

export default function BriefingPage() {
  const { getToken } = useAuth();
  const [briefing, setBriefing] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeAgent, setActiveAgent] = useState("");

  async function planDay() {
    setLoading(true);
    setError("");
    setBriefing("");
    setActiveAgent("");
    try {
      const token = await getToken();
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: "plan my day using my briefing sources" }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const part of decoder.decode(value).split("\n\n")) {
          if (!part.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(part.slice(6));
            if (event.type === "token") setBriefing(prev => prev + event.content);
            if (event.type === "agent") setActiveAgent(event.content);
            if (event.type === "done") setActiveAgent("");
            if (event.type === "error") throw new Error(event.message);
          } catch (parseErr) {
            console.warn("SSE parse error:", parseErr, "raw part:", part);
          }
        }
      }
    } catch (err) {
      console.error("planDay failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setActiveAgent("");
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Morning Briefing</h1>
          <p className="text-sm text-slate-500">
            Summaries are stored. Email bodies and event bodies are not.
          </p>
        </div>
        <button
          onClick={planDay}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          <Sparkles className="w-4 h-4" />
          {loading ? "Planning…" : "Plan my day"}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {([["Priority email", Mail], ["Calendar blocks", CalendarDays], ["Tasks", ListChecks]] as const).map(
          ([label, Icon]) => (
            <div key={label} className="bg-white border border-slate-200 rounded-xl p-5">
              <Icon className="w-5 h-5 text-blue-600" />
              <h2 className="mt-4 font-semibold text-slate-900">{label}</h2>
              <p className="text-sm text-slate-500 mt-1">Generated from live connected sources.</p>
            </div>
          )
        )}
      </div>

      {/* Shows which agent is currently working */}
      {activeAgent && (
        <div className="text-xs text-slate-400 italic">
          Running: {activeAgent}…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 min-h-64 whitespace-pre-wrap text-sm leading-6 text-slate-800">
        {briefing || "Run a briefing to generate a live summary."}
      </div>
    </div>
  );
}