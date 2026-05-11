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
import { AlertCircle, CheckCircle2, Key, Trash2, Plus, Loader2 } from "lucide-react";

interface LlmKey {
  id: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

const PROVIDERS = ["openai", "anthropic", "google"];

export default function KeysPage() {
  const [keys, setKeys] = useState<LlmKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/keys");
      if (!res.ok) throw new Error(`Failed to load keys (${res.status})`);
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, plaintext_key: plaintextKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add key");
      setAddSuccess(true);
      setProvider("");
      setPlaintextKey("");
      await fetchKeys();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Delete failed");
      }
      await fetchKeys();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">API Keys</h1>
        <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
          Bring your own LLM API keys. Keys are encrypted at rest using pgp_sym_encrypt.
        </p>
      </div>

      {/* Add key form */}
      <div className="p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add API Key
        </h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider} required>
              <SelectTrigger className="bg-[var(--background)] border-[var(--sidebar-border)]">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label>API Key</Label>
            <Input
              type="password"
              value={plaintextKey}
              onChange={(e) => setPlaintextKey(e.target.value)}
              placeholder="sk-..."
              required
              className="bg-[var(--background)] border-[var(--sidebar-border)]"
            />
          </div>
          <Button
            type="submit"
            disabled={adding || !provider || !plaintextKey}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {adding ? "Saving..." : "Save Key"}
          </Button>
        </form>
        {addError && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {addError}
          </div>
        )}
        {addSuccess && (
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Key saved and encrypted successfully.
          </div>
        )}
      </div>

      {/* Key list */}
      <div className="rounded-xl border border-[var(--sidebar-border)] overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--sidebar-text-secondary)]" />
          </div>
        ) : error ? (
          <div className="p-6 flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-[var(--sidebar-text-secondary)]">
            No API keys configured. Add one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--nav-hover)] border-b border-[var(--sidebar-border)]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Provider</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Added</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sidebar-border)]">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-[var(--nav-hover)] transition-colors">
                  <td className="px-4 py-3 flex items-center gap-2">
                    <Key className="h-4 w-4 text-purple-400" />
                    <span className="font-medium capitalize">{k.provider}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">
                    {new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">
                    {new Date(k.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleting === k.id}
                      onClick={() => handleDelete(k.id)}
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                    >
                      {deleting === k.id
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
