"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Nango from "@nangohq/frontend";
import { useAuth } from "@clerk/nextjs";
import {
    Lock,
    ShieldCheck,
    Users,
    ArrowRight,
    CheckCircle2,
    Loader2,
    Search,
    Send,
    AlertCircle,
} from "lucide-react";
import type { NangoProvider } from "@/app/api/nango/providers/route";
import type { ConfiguredIntegration } from "@/app/api/nango/integrations/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2;

// ─── Icon component with graceful fallback ────────────────────────────────────

function ProviderIcon({ logoUrl, name }: { logoUrl: string; name: string }) {
    const [failed, setFailed] = useState(false);

    if (failed || !logoUrl) {
        return (
            <div className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-500 uppercase select-none">
                {name.slice(0, 2)}
            </div>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={logoUrl}
            alt={name}
            className="w-6 h-6 object-contain"
            onError={() => setFailed(true)}
        />
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SetupWizardPage() {
    const router = useRouter();
    const { getToken } = useAuth();
    const [step, setStep] = useState<Step>(1);

    // Data from API
    const [providers, setProviders] = useState<NangoProvider[]>([]);
    const [configured, setConfigured] = useState<ConfiguredIntegration[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Connection state
    const [connected, setConnected] = useState<string[]>([]); // provider keys
    const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);

    // Request state
    const [requested, setRequested] = useState<string[]>([]); // provider keys
    const [isRequesting, setIsRequesting] = useState<string | null>(null);

    // Search
    const [searchQuery, setSearchQuery] = useState("");

    // Finish
    const [isFinishing, setIsFinishing] = useState(false);

    // ── Fetch providers + configured integrations on mount ──────────────────
    useEffect(() => {
        async function fetchData() {
            setIsLoadingData(true);
            setLoadError(null);

            // Use allSettled so a failure in one doesn't kill the other
            const [providersResult, configuredResult] = await Promise.allSettled([
                fetch("/api/nango/providers").then((r) => r.json() as Promise<NangoProvider[]>),
                fetch("/api/nango/integrations").then((r) => r.json() as Promise<ConfiguredIntegration[]>),
            ]);

            if (providersResult.status === "fulfilled" && Array.isArray(providersResult.value)) {
                setProviders(providersResult.value);
            } else {
                console.error("[integrations page] providers failed:", providersResult);
                setLoadError("Could not load the full provider catalog. Showing configured integrations only.");
            }

            if (configuredResult.status === "fulfilled" && Array.isArray(configuredResult.value)) {
                setConfigured(configuredResult.value);
            } else {
                console.error("[integrations page] configured integrations failed:", configuredResult);
                // Non-fatal — page still works, everything just shows as requestable
            }

            setIsLoadingData(false);
        }

        fetchData();
    }, []);

    // ── Derived: set of configured provider keys for O(1) lookup ───────────
    const configuredProviderKeys = useMemo(
        () => new Set(configured.map((c) => c.provider)),
        [configured]
    );

    // ── Derived: search-filtered providers ──────────────────────────────────
    const filteredProviders = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return providers;
        return providers.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                p.key.toLowerCase().includes(q) ||
                p.categories.some((cat) => cat.toLowerCase().includes(q))
        );
    }, [providers, searchQuery]);

    // ── Derived: split into configured (connect-able) vs requestable ────────
    const { availableProviders, requestableProviders } = useMemo(() => {
        const available: NangoProvider[] = [];
        const requestable: NangoProvider[] = [];

        filteredProviders.forEach((p) => {
            if (configuredProviderKeys.has(p.key)) {
                available.push(p);
            } else {
                requestable.push(p);
            }
        });

        return { availableProviders: available, requestableProviders: requestable };
    }, [filteredProviders, configuredProviderKeys]);

    // ── Nango OAuth connect ──────────────────────────────────────────────────
    const handleConnect = async (providerKey: string) => {
        if (connected.includes(providerKey)) {
            setConnected((prev) => prev.filter((k) => k !== providerKey));
            return;
        }

        setIsAuthenticating(providerKey);

        // When the popup closes (whether success or cancel), the parent window
        // regains focus. We use that to detect abandonment.
        // authCompleted guards against clearing state after a successful auth.
        let authCompleted = false;
        let focusTimer: ReturnType<typeof setTimeout> | null = null;

        const onWindowFocus = () => {
            // 500 ms grace period — on success the SDK resolves via postMessage
            // before the popup closes, so authCompleted will already be true.
            focusTimer = setTimeout(() => {
                if (!authCompleted) {
                    setIsAuthenticating(null);
                }
            }, 500);
        };

        window.addEventListener("focus", onWindowFocus, { once: true });

        try {
            const res = await fetch("/api/nango/session", { method: "POST" });
            const { token } = await res.json() as { token: string };
            if (!token) throw new Error("No token received");

            const nango = new Nango({ connectSessionToken: token });
            const result = await nango.auth(providerKey);

            // ── Persist to Supabase so the admin Integrations page reflects it ──
            try {
                const clerkToken = await getToken();
                await fetch("/api/admin/integrations", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${clerkToken}`,
                    },
                    body: JSON.stringify({
                        source_type: result.providerConfigKey,
                        nango_connection_id: result.connectionId,
                        index_mode: "index_live_fetch",
                        visibility_default: "department",
                    }),
                });
            } catch (persistErr) {
                // Non-fatal — connection is live in Nango even if DB write fails
                console.error("[integrations] Failed to persist connection to DB:", persistErr);
            }

            setConnected((prev) => [...prev, providerKey]);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.toLowerCase().includes("closed") && !msg.toLowerCase().includes("cancel")) {
                console.error("Nango auth failed:", err);
            }
        } finally {
            authCompleted = true;
            if (focusTimer) clearTimeout(focusTimer);
            window.removeEventListener("focus", onWindowFocus);
            setIsAuthenticating(null);
        }
    };

    // ── Request an unconfigured integration ──────────────────────────────────
    const handleRequest = async (provider: NangoProvider) => {
        if (requested.includes(provider.key)) return;

        setIsRequesting(provider.key);
        try {
            await fetch("/api/integrations/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerKey: provider.key, providerName: provider.name }),
            });
            setRequested((prev) => [...prev, provider.key]);
        } catch (err) {
            console.error("Request failed:", err);
        } finally {
            setIsRequesting(null);
        }
    };

    // ── Finish ───────────────────────────────────────────────────────────────
    const handleFinish = () => {
        setIsFinishing(true);
        setTimeout(() => router.push("/"), 1200);
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex min-h-screen w-full flex-col items-center bg-slate-50 p-4 pt-12">

            {/* Header + step indicator */}
            <div className="mb-8 w-full max-w-3xl flex items-center justify-between">
                <Image src="/athene-logo.png" alt="Athene AI" width={140} height={40} className="object-contain" priority />
                <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
                    <span className={step === 1 ? "text-blue-600" : "text-slate-400"}>1. Integrations</span>
                    <ArrowRight className="w-4 h-4" />
                    <span className={step === 2 ? "text-blue-600" : "text-slate-400"}>2. Access Control</span>
                </div>
            </div>

            {/* Main card */}
            <div className="w-full max-w-3xl bg-white shadow-lg border border-slate-200 rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: "82vh" }}>

                {/* ── STEP 1: INTEGRATIONS ────────────────────────────────── */}
                {step === 1 && (
                    <div className="flex flex-col h-full animate-in fade-in duration-300">

                        {/* Header */}
                        <div className="p-8 pb-4 shrink-0 border-b border-slate-100">
                            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">Connect Data Sources</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Securely authenticate via Nango. Can&apos;t find what you need? Search below and request it.
                            </p>

                            {/* Search bar */}
                            <div className="relative mt-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search 400+ integrations (e.g. Salesforce, Snowflake, Linear…)"
                                    className="w-full pl-9 pr-4 h-10 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all bg-slate-50"
                                />
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">

                            {/* Loading */}
                            {isLoadingData && (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
                                    <p className="text-sm text-slate-500">Loading integrations from Nango…</p>
                                </div>
                            )}

                            {/* Soft warning — doesn't block the page */}
                            {!isLoadingData && loadError && (
                                <div className="flex items-center gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-700">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {loadError}
                                </div>
                            )}

                            {/* Available (configured in Nango dashboard) */}
                            {!isLoadingData && !loadError && (
                                <>
                                    {availableProviders.length > 0 && (
                                        <section>
                                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                                                {searchQuery ? "Available to connect" : "Your configured integrations"}
                                            </p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {availableProviders.map((p) => {
                                                    const isConnected = connected.includes(p.key);
                                                    const isSpinning = isAuthenticating === p.key;

                                                    return (
                                                        <div
                                                            key={p.key}
                                                            className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex items-center justify-center w-10 h-10 p-2 bg-slate-50 border border-slate-100 rounded-md">
                                                                    <ProviderIcon logoUrl={p.logoUrl} name={p.name} />
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                                                                    {p.categories.length > 0 && (
                                                                        <p className="text-xs text-slate-400 capitalize">{p.categories[0]}</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <button
                                                                onClick={() => handleConnect(p.key)}
                                                                disabled={isAuthenticating !== null}
                                                                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                                                                    isConnected
                                                                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 group"
                                                                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                                                }`}
                                                            >
                                                                {isSpinning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                                                {!isSpinning && isConnected && (
                                                                    <>
                                                                        <span className="group-hover:hidden">✓ Connected</span>
                                                                        <span className="hidden group-hover:inline">Disconnect</span>
                                                                    </>
                                                                )}
                                                                {!isSpinning && !isConnected && "Connect"}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </section>
                                    )}

                                    {/* Requestable (not yet configured in Nango dashboard) */}
                                    {requestableProviders.length > 0 && (
                                        <section>
                                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                                                {searchQuery ? "Not yet available — request to add" : "Discover more"}
                                            </p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {requestableProviders.map((p) => {
                                                    const hasRequested = requested.includes(p.key);
                                                    const isSubmitting = isRequesting === p.key;

                                                    return (
                                                        <div
                                                            key={p.key}
                                                            className="flex items-center justify-between p-4 border border-slate-100 rounded-lg bg-slate-50/50"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex items-center justify-center w-10 h-10 p-2 bg-white border border-slate-100 rounded-md opacity-70">
                                                                    <ProviderIcon logoUrl={p.logoUrl} name={p.name} />
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-semibold text-slate-700">{p.name}</p>
                                                                    {p.categories.length > 0 && (
                                                                        <p className="text-xs text-slate-400 capitalize">{p.categories[0]}</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <button
                                                                onClick={() => handleRequest(p)}
                                                                disabled={hasRequested || isSubmitting}
                                                                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 disabled:cursor-not-allowed ${
                                                                    hasRequested
                                                                        ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-default"
                                                                        : "bg-white text-blue-600 border border-blue-200 hover:bg-blue-50"
                                                                }`}
                                                            >
                                                                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                                                {!isSubmitting && hasRequested && "✓ Requested"}
                                                                {!isSubmitting && !hasRequested && (
                                                                    <>
                                                                        <Send className="w-3 h-3" />
                                                                        Request
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </section>
                                    )}

                                    {/* Empty search state */}
                                    {!isLoadingData && filteredProviders.length === 0 && searchQuery && (
                                        <div className="flex flex-col items-center py-12 gap-2 text-slate-400">
                                            <Search className="w-8 h-8 opacity-40" />
                                            <p className="text-sm">No integrations found for &quot;{searchQuery}&quot;</p>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-5 shrink-0 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                            <p className="text-xs text-slate-400">
                                {connected.length > 0
                                    ? `${connected.length} integration${connected.length > 1 ? "s" : ""} connected`
                                    : "Connect at least one source, or skip for now"}
                            </p>
                            <button
                                onClick={() => setStep(2)}
                                className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-6 rounded-md font-medium transition-colors shadow-sm flex items-center gap-2 text-sm"
                            >
                                Continue <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── STEP 2: ACCESS CONTROL ───────────────────────────────── */}
                {step === 2 && (
                    <div className="p-8 animate-in slide-in-from-right-8 fade-in duration-300 overflow-y-auto">
                        <div className="mb-6">
                            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">Governance & Access</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Configure baseline security policies for your Athene AI workspace.
                            </p>
                        </div>

                        <div className="space-y-4 mb-8">
                            <div className="flex items-start gap-4 p-4 border border-slate-200 rounded-lg">
                                <div className="mt-0.5 p-1.5 bg-blue-50 text-blue-600 rounded-md">
                                    <ShieldCheck className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <p className="font-semibold text-sm text-slate-900">Enforce Strict RBAC</p>
                                        <input type="checkbox" defaultChecked className="w-4 h-4 accent-blue-600" />
                                    </div>
                                    <p className="text-xs text-slate-500">Only workspace Admins can execute destructive agent commands.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 p-4 border border-slate-200 rounded-lg">
                                <div className="mt-0.5 p-1.5 bg-blue-50 text-blue-600 rounded-md">
                                    <Lock className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <p className="font-semibold text-sm text-slate-900">Require 2FA for Members</p>
                                        <input type="checkbox" className="w-4 h-4 accent-blue-600" />
                                    </div>
                                    <p className="text-xs text-slate-500">Mandate Two-Factor Authentication for all invited workspace users.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 p-4 border border-slate-200 rounded-lg">
                                <div className="mt-0.5 p-1.5 bg-blue-50 text-blue-600 rounded-md">
                                    <Users className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <p className="font-semibold text-sm text-slate-900">Audit Logging</p>
                                        <input type="checkbox" defaultChecked className="w-4 h-4 accent-blue-600" />
                                    </div>
                                    <p className="text-xs text-slate-500">Record all agent queries and system actions to the centralized ledger.</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between pt-4 border-t border-slate-100">
                            <button
                                onClick={() => setStep(1)}
                                className="text-slate-500 hover:text-slate-900 font-medium text-sm px-4 transition-colors"
                            >
                                ← Back
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={isFinishing}
                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white h-10 px-6 rounded-md font-medium transition-colors shadow-sm flex items-center gap-2 text-sm"
                            >
                                {isFinishing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> Provisioning…
                                    </>
                                ) : (
                                    <>
                                        Launch Command Center <CheckCircle2 className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
