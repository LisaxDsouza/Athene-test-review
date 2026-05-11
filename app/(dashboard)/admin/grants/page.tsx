"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, ShieldCheck, Trash2, Plus, Loader2 } from "lucide-react";

interface BiGrant {
  id: string;
  user_id: string;
  dept_id: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export default function GrantsPage() {
  const [grants, setGrants] = useState<BiGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchGrants = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bi-grants");
      if (!res.ok) throw new Error(`Failed to load grants (${res.status})`);
      const data = await res.json();
      setGrants(data.grants ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGrants(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const body: Record<string, string> = { user_id: userId, dept_id: deptId };
      if (expiresAt) body.expires_at = new Date(expiresAt).toISOString();
      const res = await fetch("/api/admin/bi-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add grant");
      setAddSuccess(true);
      setUserId("");
      setDeptId("");
      setExpiresAt("");
      await fetchGrants();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, uid: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/bi-grants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, user_id: uid }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Delete failed");
      }
      await fetchGrants();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-[var(--foreground)] tracking-tight">BI Access Grants</h1>
        <p className="text-base text-[var(--sidebar-text-secondary)] mt-1">
          Grant users cross-department data access for BI queries.
        </p>
      </div>

      {/* Add grant form */}
      <div className="p-6 rounded-xl border border-[var(--sidebar-border)] bg-[var(--nav-hover)] space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Grant
        </h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <Label>User ID</Label>
            <Input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="uuid"
              required
              className="bg-[var(--background)] border-[var(--sidebar-border)]"
            />
          </div>
          <div className="space-y-1">
            <Label>Department ID</Label>
            <Input
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              placeholder="uuid"
              required
              className="bg-[var(--background)] border-[var(--sidebar-border)]"
            />
          </div>
          <div className="space-y-1">
            <Label>Expires (optional)</Label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="bg-[var(--background)] border-[var(--sidebar-border)]"
            />
          </div>
          <Button
            type="submit"
            disabled={adding || !userId || !deptId}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {adding ? "Saving..." : "Grant Access"}
          </Button>
        </form>
        {addError && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {addError}
          </div>
        )}
        {addSuccess && (
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Grant created successfully.
          </div>
        )}
      </div>

      {/* Grants table */}
      <div className="rounded-xl border border-[var(--sidebar-border)] overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--sidebar-text-secondary)]" />
          </div>
        ) : error ? (
          <div className="p-6 flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        ) : grants.length === 0 ? (
          <div className="p-8 text-center text-[var(--sidebar-text-secondary)]">
            No grants found. Add one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--nav-hover)] border-b border-[var(--sidebar-border)]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">User ID</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Dept ID</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Expires</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--sidebar-text-secondary)]">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sidebar-border)]">
              {grants.map((g) => (
                <tr key={g.id} className="hover:bg-[var(--nav-hover)] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--foreground)]">{g.user_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--foreground)]">{g.dept_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${g.is_active ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                      <ShieldCheck className="h-3 w-3" />
                      {g.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">
                    {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3 text-[var(--sidebar-text-secondary)]">
                    {new Date(g.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleting === g.id}
                      onClick={() => handleDelete(g.id, g.user_id)}
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                    >
                      {deleting === g.id
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
