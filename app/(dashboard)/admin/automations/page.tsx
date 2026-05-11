"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Zap, Trash2, Plus, Loader2, Clock } from "lucide-react";

interface Automation {
  id: string;
  type: string;
  status: string;
  cron_expression: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
}

const AUTOMATION_TYPES = [
  { value: "morning_briefing", label: "Morning Briefing" },
  { value: "weekly_report", label: "Weekly Report" },
];

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  paused: "bg-yellow-500/10 text-yellow-600",
  error: "bg-red-500/10 text-red-500",
};

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState("");
  const [cron, setCron] = useState("0 7 * * *");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAutomations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/automations");
      if (!res.ok) throw new Error(`Failed to load automations (${res.status})`);
      const data = await res.json();
      setAutomations(data.automations ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAutomations(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const res = await fetch("/api/admin/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, cron_expression: cron, status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add automation");
      setAddSuccess(true);
      setType("");
      setCron("0 7 * * *");
      await fetchAutomations();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/automations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Delete failed");
      }
      await fetchAutomations();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">Automations</h1>
        <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
          Schedule recurring jobs like morning briefings and weekly reports.
        </p>
      </div>

      {/* Add automation form */}
      <div className="p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Automation
        </h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType} required>
              <SelectTrigger className="bg-[var(--background)] border-[var(--sidebar-border)]">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Cron schedule</Label>
            <Input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 7 * * *"
              required
              className="bg-[var(--background)] border-[var(--sidebar-border)] font-mono text-sm"
            />
          </div>
          <Button
            type="submit"
            disabled={adding || !type}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {adding ? "Saving..." : "Create"}
          </Button>
        </form>
        {addError && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {addError}
          </div>
        )}
        {addSuccess && (
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Automation created.
          </div>
        )}
      </div>

      {/* Automations list */}
      <div className="rounded-xl border border-[var(--sidebar-border)] overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--sidebar-text-secondary)]" />
          </div>
        ) : error ? (
          <div className="p-6 flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        ) : automations.length === 0 ? (
          <div className="p-8 text-center text-[var(--sidebar-text-secondary)]">
            No automations configured. Create one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--nav-hover)] border-b border-[var(--sidebar-border)]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Schedule</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Last run</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Runs</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sidebar-border)]">
              {automations.map((a) => (
                <tr key={a.id} className="hover:bg-[var(--nav-hover)] transition-colors">
                  <td className="px-4 py-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <span className="font-medium capitalize">{a.type.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[a.status] ?? "bg-[var(--nav-hover)] text-[var(--sidebar-text-secondary)]"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--sidebar-text-secondary)]">
                    {a.cron_expression ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">
                    {a.last_run_at ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(a.last_run_at).toLocaleString()}
                        {a.last_run_status === "error" && (
                          <AlertCircle className="h-3 w-3 text-red-400" />
                        )}
                      </span>
                    ) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">{a.run_count}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleting === a.id}
                      onClick={() => handleDelete(a.id)}
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                    >
                      {deleting === a.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
