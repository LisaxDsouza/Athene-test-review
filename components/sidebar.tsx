"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  BookOpen,
  BarChart3,
  Settings,
  Users,
  Key,
  Zap,
  Database,
  LogOut,
  ChevronDown,
  Shield,
  FileSearch,
  Workflow,
  ClipboardList,
} from "lucide-react";
import { useState, memo } from "react";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/rbac";

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
  requiresRole?: UserRole[];
}

interface SidebarProps {
  role: UserRole;
  className?: string;
  onNavClick?: () => void;
}

const Sidebar = memo(function SidebarContent({ role, className, onNavClick }: SidebarProps) {
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(pathname.startsWith("/admin"));

  const mainLinks: NavLink[] = [
    {
      href: "/chat",
      label: "Chat",
      icon: <MessageSquare className="h-4 w-4" />,
    },
    {
      href: "/briefing",
      label: "Briefing",
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      href: "/insights",
      label: "Insights",
      icon: <BarChart3 className="h-4 w-4" />,
      requiresRole: ["super_user", "admin"],
    },
  ];

  const adminLinks: NavLink[] = [
    {
      href: "/admin/users",
      label: "Users",
      icon: <Users className="h-4 w-4" />,
    },
    {
      href: "/admin/integrations",
      label: "Integrations",
      icon: <Zap className="h-4 w-4" />,
    },
    {
      href: "/admin/keys",
      label: "Keys",
      icon: <Key className="h-4 w-4" />,
    },
    {
      href: "/admin/grants",
      label: "Grants",
      icon: <Database className="h-4 w-4" />,
    },
    {
      href: "/admin/audit",
      label: "Audit",
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      href: "/admin/automations",
      label: "Automations",
      icon: <Workflow className="h-4 w-4" />,
    },
  ];

  const isActive = (href: string) => pathname === href;
  const isAdminActive = adminLinks.some((link) =>
    pathname.startsWith(link.href.split("/").slice(0, -1).join("/"))
  );

  return (
    <aside className={cn("w-64 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] flex flex-col h-screen", className)}>
      {/* Logo Section with Purple Glow */}
      <div className="px-6 py-8 border-b border-[var(--sidebar-border)] overflow-visible flex items-center justify-center bg-gradient-to-b from-[var(--sidebar-bg)] to-[var(--background)] dark:from-purple-950/30 dark:to-transparent">
        <Link
          href="/chat"
          className="flex items-center justify-center group relative"
        >
          {/* Purple glow effect */}
          <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/20 to-violet-500/20 dark:from-purple-400/30 dark:to-violet-500/30 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl" />

          <div className="relative flex-shrink-0">
            <Image
              src="/logo.webp"
              alt="Athene"
              width={120}
              height={120}
              className="w-32 h-auto"
              priority
            />
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        {/* Main Links */}
        {mainLinks.map((link) => {
          if (link.requiresRole && !link.requiresRole.includes(role)) {
            return null;
          }

          const active = isActive(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavClick}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium transition-all duration-200",
                active
                  ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-lg shadow-purple-500/20 dark:shadow-purple-400/25"
                  : "text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] hover:bg-[var(--nav-hover)] dark:hover:bg-purple-950/20"
              )}
            >
              <div className="flex-shrink-0">{link.icon}</div>
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}

        {/* Admin Section */}
        {role === "admin" && (
          <div className="pt-2 mt-6 border-t border-[var(--sidebar-border)]">
            <button
              onClick={() => setAdminOpen(!adminOpen)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-base font-medium transition-all duration-200",
                isAdminActive || adminOpen
                  ? "text-[var(--accent)] bg-[var(--nav-hover)] dark:bg-purple-950/30"
                  : "text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] hover:bg-[var(--nav-hover)] dark:hover:bg-purple-950/20"
              )}
            >
              <span className="flex items-center gap-3">
                <Shield className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">Admin</span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 flex-shrink-0 transition-transform duration-200",
                  adminOpen && "rotate-180"
                )}
              />
            </button>

            {adminOpen && (
              <div className="ml-2 mt-2 space-y-1 border-l border-[var(--sidebar-border)] pl-2">
                {adminLinks.map((link) => {
                  const active = isActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onNavClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        active
                          ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-lg shadow-purple-500/20 dark:shadow-purple-400/25"
                          : "text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] hover:bg-[var(--nav-hover)] dark:hover:bg-purple-950/20"
                      )}
                    >
                      {link.icon}
                      <span className="truncate">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer Section - User Avatar */}
      <div className="px-4 py-4 border-t border-[var(--sidebar-border)] bg-gradient-to-t from-[var(--sidebar-bg)] to-transparent dark:from-purple-950/10">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--nav-hover)] dark:hover:bg-purple-950/20 transition-colors duration-200">
          <UserButton
            appearance={{
              elements: {
                userButtonBox: "h-8 w-8",
                userButtonTrigger: "rounded-full",
              },
            }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--sidebar-text)] truncate">
              Account
            </p>
            <p className="text-xs text-[var(--sidebar-text-secondary)] truncate">
              Settings
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
});

export { Sidebar };
