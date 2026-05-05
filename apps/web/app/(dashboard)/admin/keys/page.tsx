"use client";

import { useAuth } from "@clerk/nextjs";
import { KeyRound } from "lucide-react";
import { useState } from "react";

export default function KeysPage() {
  const { getToken } = useAuth();
  const [provider, setProvider] = useState("openai");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<any>(null);
  async function save() {
    const token = await getToken();
    const res = await fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider, key, label: provider }) });
    if (res.ok) setSaved(await res.json());
    setKey("");
  }
  return <div className="max-w-4xl mx-auto space-y-6"><div className="flex items-center gap-3"><KeyRound className="w-6 h-6 text-blue-600" /><div><h1 className="text-2xl font-semibold text-slate-900">BYOK Keys</h1><p className="text-sm text-slate-500">Keys are encrypted with pgcrypto. Only the last four characters are displayed.</p></div></div><div className="bg-white border border-slate-200 rounded-xl p-4 flex gap-3"><input value={provider} onChange={e => setProvider(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-slate-700" /><input value={key} onChange={e => setKey(e.target.value)} type="password" placeholder="Provider API key" className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400" /><button onClick={save} className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm">Store</button></div>{saved && <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm">Stored {saved.provider}, ending in {saved.key_hint}</div>}</div>;
}
