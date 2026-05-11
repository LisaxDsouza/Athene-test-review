"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuditLog {
  id: string;
  org_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit-log");
      if (!res.ok) throw new Error(`Failed to load audit logs (${res.status})`);
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">Audit Log</h1>
          <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
            System activity and security events for your organization
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          disabled={loading}
          className="border-[var(--sidebar-border)] text-[var(--sidebar-text-secondary)] hover:text-[var(--foreground)]"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      ) : logs.length === 0 ? (
        <div className="p-12 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] flex flex-col items-center justify-center gap-3 text-center">
          <ShieldCheck className="h-10 w-10 text-purple-400/60" />
          <p className="text-[var(--foreground)] font-medium">No audit events yet</p>
          <p className="text-sm text-[var(--sidebar-text-secondary)] max-w-sm">
            Security and admin activity will be logged here as your team uses Athene.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--sidebar-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--sidebar-border)] bg-[var(--nav-hover)]">
                <th className="text-left px-4 py-3 text-[var(--sidebar-text-secondary)] font-medium">Time</th>
                <th className="text-left px-4 py-3 text-[var(--sidebar-text-secondary)] font-medium">Action</th>
                <th className="text-left px-4 py-3 text-[var(--sidebar-text-secondary)] font-medium">Resource</th>
                <th className="text-left px-4 py-3 text-[var(--sidebar-text-secondary)] font-medium">User</th>
                <th className="text-left px-4 py-3 text-[var(--sidebar-text-secondary)] font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr
                  key={log.id}
                  className={`border-b border-[var(--sidebar-border)] last:border-0 ${
                    i % 2 === 0 ? "bg-transparent" : "bg-[var(--nav-hover)]/40"
                  }`}
                >
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString(undefined, {
                      month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--foreground)]">
                    <span className="font-medium">{log.resource_type}</span>
                    {log.resource_id && (
                      <span className="text-[var(--sidebar-text-secondary)] ml-1 text-xs truncate max-w-[120px] inline-block align-middle">
                        {log.resource_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)] font-mono text-xs">
                    {log.user_id.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)] text-xs max-w-[200px] truncate">
                    {log.metadata ? JSON.stringify(log.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
