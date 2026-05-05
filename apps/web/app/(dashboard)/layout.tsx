"use client";

import { UserButton, OrganizationSwitcher, useOrganization } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Blocks,
    Database,
    Menu,
    MessageSquare,
    ShieldCheck,
    KeyRound,
    FileClock,
    Users,
    BarChart3,
    Newspaper
} from "lucide-react";
import { useState } from "react";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { organization, isLoaded: isOrgLoaded } = useOrganization();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navigation = [
        { name: "Command Center", href: "/", icon: LayoutDashboard },
        { name: "Chat", href: "/chat", icon: MessageSquare },
        { name: "Insights", href: "/insights", icon: BarChart3 },
        { name: "Briefing", href: "/briefing", icon: Newspaper },
        { name: "Users", href: "/admin/users", icon: Users },
        { name: "Integrations", href: "/admin/integrations", icon: Blocks },
        { name: "BYOK Keys", href: "/admin/keys", icon: KeyRound },
        { name: "BI Grants", href: "/admin/grants", icon: ShieldCheck },
        { name: "Audit Log", href: "/admin/audit", icon: FileClock },
        { name: "Data Sources", href: "/sources", icon: Database },
    ];

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden">

            {/* Desktop Sidebar */}
            <aside className="hidden md:flex w-64 flex-col bg-white border-r border-slate-200 z-10">
                {/* Logo Area */}
                <div className="h-16 flex items-center px-6 border-b border-slate-100 shrink-0">
                    <Image
                        src="/athene-logo.png"
                        alt="Athene AI"
                        width={120}
                        height={32}
                        className="object-contain"
                        priority
                    />
                </div>

                {/* Navigation Links */}
                <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                    {navigation.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                    }`}
                            >
                                <Icon className={`w-5 h-5 ${isActive ? "text-blue-700" : "text-slate-400"}`} />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom User Area */}
                <div className="p-4 border-t border-slate-100 shrink-0">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-50 transition-colors">
                        <UserButton />
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-sm font-medium text-slate-900 truncate">
                                {isOrgLoaded && organization ? organization.name : (isOrgLoaded ? "Personal Account" : "Loading...")}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">
                                {isOrgLoaded && organization ? "Organization" : (isOrgLoaded ? "Private" : "...")}
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content Wrapper */}
            <div className="flex-1 flex flex-col h-full relative overflow-hidden">

                {/* Top Header */}
                <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        {/* Mobile Menu Button */}
                        <button
                            className="md:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-md"
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        >
                            <Menu className="w-5 h-5" />
                        </button>

                        <h1 className="text-lg font-semibold text-slate-900 hidden sm:block">
                            {navigation.find(n => n.href === pathname)?.name || "Workspace"}
                        </h1>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Clerk Organization Switcher (Crucial for B2B) */}
                        <OrganizationSwitcher
                            hidePersonal
                            appearance={{
                                elements: {
                                    rootBox: "flex items-center justify-center",
                                    organizationSwitcherTrigger: "border border-slate-200 rounded-md px-3 py-1.5 hover:bg-slate-50 transition-colors"
                                }
                            }}
                        />
                    </div>
                </header>

                {/* Scrollable Page Content */}
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                    {children}
                </main>
            </div>

        </div>
    );
}
