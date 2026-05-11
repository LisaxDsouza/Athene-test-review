"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, BarChart3, Trash2, Plus, Loader2, RefreshCw } from "lucide-react";

interface Insight {
  id: string;
  title: string;
  query: string;
  result: Record<string, unknown> | null;
  citations: unknown[];
  refreshed_at: string | null;
  created_at: string;
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Insight | null>(null);

  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) throw new Error(`Failed to load insights (${res.status})`);
      const data = await res.json();
      const list: Insight[] = data.insights ?? [];
      setInsights(list);
      if (list.length > 0) setSelected((prev) => prev ?? list[0]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInsights(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add insight");
      setAddSuccess(true);
      setTitle("");
      setQuery("");
      await fetchInsights();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/insights", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Delete failed");
      }
      if (selected?.id === id) setSelected(null);
      await fetchInsights();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">Analytics & Insights</h1>
          <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
            Saved BI queries and data-driven answers
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchInsights}
          className="border-[var(--sidebar-border)] text-[var(--sidebar-text-secondary)] hover:text-[var(--foreground)]"
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Add insight form */}
      <div className="p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Insight
        </h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q2 Support Ticket Trends"
                required
                className="bg-[var(--background)] border-[var(--sidebar-border)]"
              />
            </div>
            <div className="space-y-1">
              <Label>Query</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. What were the top support issues in Q2?"
                required
                className="bg-[var(--background)] border-[var(--sidebar-border)]"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={adding || !title || !query}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {adding ? "Saving..." : "Save Insight"}
          </Button>
        </form>
        {addError && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {addError}
          </div>
        )}
        {addSuccess && (
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Insight saved.
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : insights.length === 0 ? (
        <div className="p-12 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] flex flex-col items-center justify-center gap-3 text-center">
          <BarChart3 className="h-10 w-10 text-purple-400/50" />
          <p className="text-[var(--foreground)] font-medium">No insights yet</p>
          <p className="text-sm text-[var(--sidebar-text-secondary)] max-w-sm">
            Save a natural-language BI query above and the agent will populate results.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Sidebar list */}
          <div className="space-y-2">
            {insights.map((ins) => (
              <div
                key={ins.id}
                className={`group relative p-4 rounded-xl border cursor-pointer transition-colors ${
                  selected?.id === ins.id
                    ? "border-purple-500/40 bg-purple-500/10"
                    : "border-[var(--sidebar-border)] bg-[var(--nav-hover)] hover:border-purple-500/20"
                }`}
                onClick={() => setSelected(ins)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BarChart3 className="h-4 w-4 text-purple-400 shrink-0" />
                    <p className="text-sm font-medium text-[var(--foreground)] truncate">{ins.title}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleting === ins.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(ins.id); }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 hover:bg-red-500/10 h-6 w-6 p-0 shrink-0"
                  >
                    {deleting === ins.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Trash2 className="h-3 w-3" />}
                  </Button>
                </div>
                <p className="text-xs text-[var(--sidebar-text-secondary)] mt-1.5 line-clamp-2">{ins.query}</p>
                {ins.refreshed_at && (
                  <p className="text-xs text-[var(--sidebar-text-secondary)] mt-1">
                    Updated {new Date(ins.refreshed_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Detail pane */}
          {selected && (
            <div className="lg:col-span-2 p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">{selected.title}</h2>
                <p className="text-sm text-[var(--sidebar-text-secondary)] mt-1 italic">"{selected.query}"</p>
              </div>

              {selected.result ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide">Result</h3>
                  <pre className="text-sm text-[var(--foreground)] bg-[var(--background)] rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selected.result, null, 2)}
                  </pre>
                  {Array.isArray(selected.citations) && selected.citations.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide mb-2">Citations</h3>
                      <ul className="space-y-1">
                        {selected.citations.map((c, i) => (
                          <li key={i} className="text-xs text-[var(--sidebar-text-secondary)]">
                            {typeof c === "string" ? c : JSON.stringify(c)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-lg border border-dashed border-[var(--sidebar-border)] text-center">
                  <p className="text-sm text-[var(--sidebar-text-secondary)]">
                    No result yet. The agent will populate this when it next runs a query matching this insight.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
