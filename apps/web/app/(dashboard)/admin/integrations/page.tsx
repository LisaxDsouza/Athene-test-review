"use client";

import { useAuth } from "@clerk/nextjs";
import { Blocks, Plug, Trash2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDER_REGISTRY } from "@/lib/integrations/providers";
import Image from "next/image";

export default function AdminIntegrationsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({
    source_type: "gdrive",
    nango_connection_id: "",
    index_mode: "index_live_fetch",
    visibility_default: "department",
  });

  async function load() {
    const token = await getToken();
    const res = await fetch("/api/admin/integrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
        const data = await res.json();
        // Filter to only show active integrations if the API doesn't
        setRows(data.filter((r: any) => r.is_active !== false));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    const token = await getToken();
    await fetch("/api/admin/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    });
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Are you sure you want to remove this integration?")) return;
    
    setIsDeleting(id);
    try {
        const token = await getToken();
        const res = await fetch(`/api/admin/integrations?id=${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            await load();
        }
    } catch (err) {
        console.error("Failed to delete:", err);
    } finally {
        setIsDeleting(null);
    }
  }

  // Helper to find the icon for a source type
  const getIcon = (sourceType: string) => {
    // Try to find by key or nangoIntegrationId
    const provider = Object.values(PROVIDER_REGISTRY).find(
        p => p.key === sourceType || p.nangoIntegrationId === sourceType
    );
    if (provider?.icon) return provider.icon;
    
    // Manual fallbacks for common names
    if (sourceType.includes("google") || sourceType === "gdrive" || sourceType === "gmail") return "/integrations/gdrive.svg";
    if (sourceType === "outlook" || sourceType === "onedrive" || sourceType === "sharepoint") return "/integrations/outlook.svg";
    
    return null;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Blocks className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
            <p className="text-sm text-slate-500">Only Nango connection IDs are stored.</p>
          </div>
        </div>

        <Link
          href="/onboarding/integrations"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
        >
          <Plug className="w-4 h-4" />
          Connect Data Sources
        </Link>
      </div>

      {/* Manual registration form */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-5 gap-3">
        {Object.keys(form).map((key) => (
          <input
            key={key}
            value={(form as any)[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder={key}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        ))}
        <button
          onClick={save}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium transition-colors"
        >
          Register
        </button>
      </div>

      {/* Registered integrations list */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-12 text-sm text-slate-400 text-center">
            No integrations registered yet.{" "}
            <Link href="/onboarding/integrations" className="text-blue-600 hover:underline">
              Connect your first data source →
            </Link>
          </p>
        ) : (
          rows.map((row) => {
            const icon = getIcon(row.source_type);
            return (
              <div key={row.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center p-2 overflow-hidden">
                    {icon ? (
                      <Image src={icon} alt={row.source_type} width={24} height={24} className="object-contain" />
                    ) : (
                      <Plug className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 capitalize">
                        {row.source_type.replace("-", " ")}
                    </p>
                    <p className="text-xs text-slate-500">
                        {row.index_mode} · ID: {row.nango_connection_id || "None"}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right mr-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                        row.sync_status === 'idle' ? 'bg-slate-100 text-slate-600' :
                        row.sync_status === 'syncing' ? 'bg-blue-100 text-blue-600' :
                        row.sync_status === 'error' ? 'bg-red-100 text-red-600' :
                        'bg-emerald-100 text-emerald-600'
                    }`}>
                        {row.sync_status || 'idle'}
                    </span>
                    {row.last_synced_at && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                            Synced {new Date(row.last_synced_at).toLocaleDateString()}
                        </p>
                    )}
                  </div>
                  
                  <button
                    onClick={() => remove(row.id)}
                    disabled={isDeleting === row.id}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    title="Remove integration"
                  >
                    {isDeleting === row.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Trash2 className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
