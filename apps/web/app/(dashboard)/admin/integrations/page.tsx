"use client";

import { useAuth } from "@clerk/nextjs";
import { Blocks } from "lucide-react";
import { useEffect, useState } from "react";

export default function AdminIntegrationsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ source_type: "gdrive", nango_connection_id: "", index_mode: "index_live_fetch", visibility_default: "department" });
  async function load() {
    const token = await getToken();
    const res = await fetch("/api/admin/integrations", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => { load(); }, []);
  async function save() {
    const token = await getToken();
    await fetch("/api/admin/integrations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(form) });
    await load();
  }
  return <div className="max-w-6xl mx-auto space-y-6"><div className="flex items-center gap-3"><Blocks className="w-6 h-6 text-blue-600" /><div><h1 className="text-2xl font-semibold text-slate-900">Integrations</h1><p className="text-sm text-slate-500">Only Nango connection IDs are stored.</p></div></div><div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-5 gap-3">{Object.keys(form).map(key => <input key={key} value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={key} className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400" />)}<button onClick={save} className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm">Register</button></div><div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">{rows.map(row => <div key={row.id} className="p-4 text-sm flex justify-between"><span>{row.source_type} · {row.index_mode}</span><span className="text-slate-500">{row.sync_status}</span></div>)}</div></div>;
}
