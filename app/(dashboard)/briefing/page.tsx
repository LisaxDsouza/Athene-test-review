"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Sun, CalendarDays, Mail, FileText, RefreshCw } from "lucide-react";

interface BriefingSection {
  title: string;
  items: string[];
}

interface Briefing {
  id: string;
  summary: string;
  content: { summary?: string; sections?: BriefingSection[] };
  calendar_items: number;
  email_items: number;
  doc_items: number;
  generated_at: string;
  delivered: boolean;
}

export default function BriefingPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Briefing | null>(null);

  const fetchBriefings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/briefings");
      if (!res.ok) throw new Error(`Failed to load briefings (${res.status})`);
      const data = await res.json();
      const list: Briefing[] = data.briefings ?? [];
      setBriefings(list);
      if (list.length > 0) setSelected((prev) => prev ?? list[0]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBriefings(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">Daily Briefing</h1>
          <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
            Your personalized daily digest
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchBriefings}
          className="border-[var(--sidebar-border)] text-[var(--sidebar-text-secondary)] hover:text-[var(--foreground)]"
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : briefings.length === 0 ? (
        <div className="p-12 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] flex flex-col items-center justify-center gap-3 text-center">
          <Sun className="h-10 w-10 text-yellow-400/60" />
          <p className="text-[var(--foreground)] font-medium">No briefings yet</p>
          <p className="text-sm text-[var(--sidebar-text-secondary)] max-w-sm">
            Your morning briefings will appear here once an automation is active. Ask an admin to enable the Morning Briefing automation.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Sidebar: briefing list */}
          <div className="space-y-2">
            {briefings.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b)}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  selected?.id === b.id
                    ? "border-purple-500/40 bg-purple-500/10"
                    : "border-[var(--sidebar-border)] bg-[var(--nav-hover)] hover:border-purple-500/20"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Sun className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs text-[var(--sidebar-text-secondary)]">
                    {new Date(b.generated_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </div>
                <p className="text-sm text-[var(--foreground)] line-clamp-2">{b.summary || "Morning briefing"}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-[var(--sidebar-text-secondary)]">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{b.calendar_items}</span>
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{b.email_items}</span>
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{b.doc_items}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Main: selected briefing detail */}
          {selected && (
            <div className="lg:col-span-2 p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-6">
              <div>
                <p className="text-xs text-[var(--sidebar-text-secondary)] mb-1">
                  {new Date(selected.generated_at).toLocaleString()}
                </p>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">{selected.summary || "Your briefing"}</h2>
              </div>

              {selected.content?.sections?.length ? (
                <div className="space-y-5">
                  {selected.content.sections.map((sec, i) => (
                    <div key={i}>
                      <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide mb-2">{sec.title}</h3>
                      <ul className="space-y-1.5">
                        {sec.items.map((item, j) => (
                          <li key={j} className="text-sm text-[var(--foreground)] flex gap-2">
                            <span className="text-purple-400 mt-0.5">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--sidebar-text-secondary)] whitespace-pre-wrap">
                  {typeof selected.content === "string"
                    ? selected.content
                    : JSON.stringify(selected.content, null, 2)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
