"use client";

import { useAuth } from "@clerk/nextjs";
import { Blocks, Plug } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminIntegrationsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
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
    if (res.ok) setRows(await res.json());
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

        {/* ── Connect Data Sources button → opens the onboarding Nango wizard ── */}
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
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-400 text-center">
            No integrations registered yet.{" "}
            <Link href="/onboarding/integrations" className="text-blue-600 hover:underline">
              Connect your first data source →
            </Link>
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="p-4 text-sm flex justify-between">
              <span className="text-slate-900">
                {row.source_type} · {row.index_mode}
              </span>
              <span className="text-slate-500">{row.sync_status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
