"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import {
  Blocks,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Trash2,
  Search,
  Loader2,
  Plus,
  X,
  Wifi,
  WifiOff,
} from "lucide-react";
import Nango from "@nangohq/frontend";

// ─── Provider catalogue ───────────────────────────────────────────────────────
// Matches Joshua's canonical PROVIDER_REGISTRY keys + our public/integrations/ icons

interface ProviderMeta {
  key: string;
  displayName: string;
  description: string;
  icon: string;           // path inside /public/integrations/
  nangoKey: string;       // Nango integration unique_key / provider_config_key
  category: "productivity" | "crm" | "devtools" | "communication" | "data";
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: "google",
    displayName: "Google Workspace",
    description: "Sync Drive files, Gmail threads, and Calendar events",
    icon: "/integrations/gdrive.svg",
    nangoKey: "google",
    category: "productivity",
  },
  {
    key: "microsoft",
    displayName: "Microsoft 365",
    description: "Sync SharePoint, OneDrive, Outlook, and Teams",
    icon: "/integrations/onedrive.svg",
    nangoKey: "microsoft",
    category: "productivity",
  },
  {
    key: "slack",
    displayName: "Slack",
    description: "Index public channels, threads, and search messages live",
    icon: "/integrations/slack.svg",
    nangoKey: "slack",
    category: "communication",
  },
  {
    key: "notion",
    displayName: "Notion",
    description: "Sync workspace pages, databases, and wikis",
    icon: "/integrations/notion.svg",
    nangoKey: "notion",
    category: "productivity",
  },
  {
    key: "jira",
    displayName: "Jira",
    description: "Sync issues, sprints, and project boards",
    icon: "/integrations/jira.svg",
    nangoKey: "jira",
    category: "devtools",
  },
  {
    key: "confluence",
    displayName: "Confluence",
    description: "Sync spaces, pages, and knowledge base articles",
    icon: "/integrations/confluence.svg",
    nangoKey: "confluence",
    category: "devtools",
  },
  {
    key: "github",
    displayName: "GitHub",
    description: "Sync repos, issues, PRs, wikis, and search code",
    icon: "/integrations/github.svg",
    nangoKey: "github",
    category: "devtools",
  },
  {
    key: "linear",
    displayName: "Linear",
    description: "Sync issues, cycles, and projects",
    icon: "/integrations/linear.svg",
    nangoKey: "linear",
    category: "devtools",
  },
  {
    key: "salesforce",
    displayName: "Salesforce",
    description: "Sync accounts, opportunities, and cases",
    icon: "/integrations/salesforce.svg",
    nangoKey: "salesforce",
    category: "crm",
  },
  {
    key: "hubspot",
    displayName: "HubSpot",
    description: "Sync contacts, companies, deals, and notes",
    icon: "/integrations/hubspot.svg",
    nangoKey: "hubspot",
    category: "crm",
  },
  {
    key: "zendesk",
    displayName: "Zendesk",
    description: "Sync support tickets and help center articles",
    icon: "/integrations/zendesk.svg",
    nangoKey: "zendesk",
    category: "communication",
  },
  {
    key: "snowflake",
    displayName: "Snowflake",
    description: "Query schemas and sync table data for BI analysis",
    icon: "/integrations/snowflake.svg",
    nangoKey: "snowflake",
    category: "data",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  productivity: "Productivity",
  crm: "CRM",
  devtools: "Dev Tools",
  communication: "Communication",
  data: "Data & Analytics",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  connection_id: string;
  provider_config_key: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

type ConnectionStatus = "live" | "syncing" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProviderMeta(providerKey: string): ProviderMeta | undefined {
  return PROVIDERS.find(
    (p) => p.nangoKey === providerKey || p.key === providerKey
  );
}

function getStatusBadge(status: ConnectionStatus) {
  if (status === "live")
    return {
      label: "Live",
      icon: <CheckCircle2 className="w-3 h-3" />,
      className: "text-emerald-700 bg-emerald-50 border-emerald-200",
    };
  if (status === "syncing")
    return {
      label: "Syncing",
      icon: <RefreshCw className="w-3 h-3 animate-spin" />,
      className: "text-blue-700 bg-blue-50 border-blue-200",
    };
  return {
    label: "Needs Re-auth",
    icon: <AlertCircle className="w-3 h-3" />,
    className: "text-amber-700 bg-amber-50 border-amber-200",
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProviderIcon({ src, alt, size = 36 }: { src: string; alt: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center"
      >
        <Blocks className="w-4 h-4 text-slate-400" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="rounded-lg object-contain bg-white border border-slate-100 p-1"
      onError={() => setErr(true)}
    />
  );
}

function ConfirmDialog({
  open,
  providerName,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  providerName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-w-sm w-full mx-4 animate-in fade-in zoom-in duration-200">
        <div className="flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <WifiOff className="w-5 h-5 text-red-500" />
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-1">
          Disconnect {providerName}?
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          This will remove the OAuth connection and stop all future syncs.
          Already-indexed data is not deleted.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null); // providerKey being connected
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // ── Fetch active connections ──────────────────────────────────────────────
  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setConnections(json.data ?? []);
      setError(null);
    } catch (e: any) {
      setError("Failed to load connections. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // ── Auto-dismiss toast ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Connect via Nango ──────────────────────────────────────────────────────
  const handleConnect = useCallback(async (provider: ProviderMeta) => {
    setConnecting(provider.key);
    try {
      // 1. Get a short-lived Nango session token from our backend
      const sessionRes = await fetch("/api/nango/session", { method: "POST" });
      if (!sessionRes.ok) throw new Error("Failed to create session");
      const { token } = await sessionRes.json();

      // 2. Open the Nango Connect OAuth flow
      const nango = new Nango({ connectSessionToken: token });

      await nango.openConnectUI({
        onEvent: async (event) => {
          if (event.type === "close") {
            setConnecting(null);
          }
          if (event.type === "connect") {
            setToast({ msg: `${provider.displayName} connected — starting sync…`, type: "success" });
            fetchConnections();
            setConnecting(null);

            // Trigger initial indexing job via QStash
            try {
              await fetch("/api/connections/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  connectionId: (event as any).payload?.connectionId ?? provider.nangoKey,
                  provider: provider.nangoKey,
                }),
              });
            } catch {
              // Non-fatal — job will run on next scheduled sync
            }
          }
        },
      });
    } catch (e: any) {
      setToast({ msg: `Failed to connect ${provider.displayName}: ${e.message}`, type: "error" });
      setConnecting(null);
    }
  }, [fetchConnections]);

  // ── Force re-index ─────────────────────────────────────────────────────────
  const handleReindex = useCallback(async (conn: Connection) => {
    setReindexing(conn.connection_id);
    try {
      // Fetch all document IDs for this connection then trigger index-delta
      const docsRes = await fetch(`/api/connections/documents?connectionId=${encodeURIComponent(conn.connection_id)}`);
      const documentIds: string[] = docsRes.ok ? ((await docsRes.json()).ids ?? []) : [];

      await fetch("/api/worker/index-delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: conn.org_id ?? "",
          document_ids: documentIds,
        }),
      });
      const meta = getProviderMeta(conn.provider_config_key);
      setToast({ msg: `Re-index queued for ${meta?.displayName ?? "integration"}.`, type: "success" });
    } catch (e: any) {
      setToast({ msg: `Re-index failed: ${e.message}`, type: "error" });
    } finally {
      setReindexing(null);
    }
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    if (!disconnecting) return;
    setDisconnectLoading(true);
    try {
      const params = new URLSearchParams({
        connectionId: disconnecting.connection_id,
        providerConfigKey: disconnecting.provider_config_key,
      });
      const res = await fetch(`/api/connections/delete?${params}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const meta = getProviderMeta(disconnecting.provider_config_key);
      setToast({ msg: `${meta?.displayName ?? "Integration"} disconnected.`, type: "success" });
      setConnections((prev) =>
        prev.filter((c) => c.connection_id !== disconnecting.connection_id)
      );
    } catch (e: any) {
      setToast({ msg: `Failed to disconnect: ${e.message}`, type: "error" });
    } finally {
      setDisconnectLoading(false);
      setDisconnecting(null);
    }
  }, [disconnecting]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const connectedKeys = new Set(connections.map((c) => c.provider_config_key));

  const filteredProviders = PROVIDERS.filter(
    (p) =>
      !connectedKeys.has(p.nangoKey) &&
      (search === "" ||
        p.displayName.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        CATEGORY_LABELS[p.category].toLowerCase().includes(search.toLowerCase()))
  );

  const groupedProviders = CATEGORY_LABELS
    ? Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => ({
        key: catKey,
        label: catLabel,
        providers: filteredProviders.filter((p) => p.category === catKey),
      })).filter((g) => g.providers.length > 0)
    : [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 duration-300 ${
            toast.type === "success"
              ? "bg-white border-emerald-200 text-emerald-800"
              : "bg-white border-red-200 text-red-800"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          )}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Disconnect confirm dialog */}
      <ConfirmDialog
        open={!!disconnecting}
        providerName={getProviderMeta(disconnecting?.provider_config_key ?? "")?.displayName ?? "this integration"}
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnecting(null)}
        loading={disconnectLoading}
      />

      <div className="max-w-5xl mx-auto space-y-10 pb-12">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)] tracking-tight flex items-center gap-2">
              Integrations
              <Blocks className="w-5 h-5 text-blue-600" />
            </h1>
            <p className="text-sm text-[var(--sidebar-text-secondary)] mt-1">
              Connect your enterprise tools so Athene AI can securely index and query your data.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            <span>{connections.length} active {connections.length === 1 ? "connection" : "connections"}</span>
          </div>
        </div>

        {/* ── Active Connections ── */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Connections
          </h2>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 h-32 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          ) : connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 bg-white rounded-xl border border-dashed border-slate-200 text-center">
              <Blocks className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-600">No integrations connected yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Connect a tool below to start syncing your data.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map((conn) => {
                const meta = getProviderMeta(conn.provider_config_key);
                // All established connections are "live" — extend this once we have sync job status
                const status: ConnectionStatus = "live";
                const badge = getStatusBadge(status);

                return (
                  <div
                    key={conn.connection_id}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col group hover:border-blue-300 hover:shadow-md transition-all duration-200"
                  >
                    {/* Status badge */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {meta ? (
                          <ProviderIcon src={meta.icon} alt={meta.displayName} size={36} />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                            <Blocks className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-slate-900 leading-tight">
                            {meta?.displayName ?? conn.provider_config_key}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {conn.connection_id}
                          </p>
                        </div>
                      </div>

                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${badge.className}`}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </div>

                    {/* Footer */}
                    <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {meta?.description ?? "Connected"}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleReindex(conn)}
                          disabled={reindexing === conn.connection_id}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-40"
                          title="Force re-index"
                        >
                          {reindexing === conn.connection_id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setDisconnecting(conn)}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Disconnect"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="border-t border-slate-100" />

        {/* ── App Directory ── */}
        <section className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              App Directory
            </h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search integrations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-52 transition-all"
              />
            </div>
          </div>

          {filteredProviders.length === 0 && search && (
            <div className="flex flex-col items-center justify-center py-10 bg-white rounded-xl border border-slate-200 text-center">
              <Search className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-500">No results for &quot;{search}&quot;</p>
            </div>
          )}

          {groupedProviders.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                {group.label}
              </p>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                {group.providers.map((provider) => {
                  const isConnecting = connecting === provider.key;
                  const isAlreadyConnected = connectedKeys.has(provider.nangoKey);

                  return (
                    <div
                      key={provider.key}
                      className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <ProviderIcon src={provider.icon} alt={provider.displayName} size={36} />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {provider.displayName}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {provider.description}
                          </p>
                        </div>
                      </div>

                      {isAlreadyConnected ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected
                        </span>
                      ) : (
                        <button
                          onClick={() => handleConnect(provider)}
                          disabled={!!connecting}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 text-slate-700 text-xs font-medium rounded-lg transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Connecting…
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              Connect
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
