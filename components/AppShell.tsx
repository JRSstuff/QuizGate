"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Download,
  GraduationCap,
  Home,
  LogOut,
  Moon,
  QrCode,
  ScanLine,
  Sun,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { offlineDb, type ActiveSession } from "@/lib/offline/storage";

interface AppShellProps {
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function AppShell({
  children,
  maxWidthClass = "max-w-4xl",
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [swReady, setSwReady] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [session, setSession] = useState<ActiveSession | null>(null);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    if (window.__qgInstallPrompt) setCanInstall(true);
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      setSwReady(true);
    }

    try {
      const savedTheme = localStorage.getItem("qg_theme");
      if (savedTheme === "dark") {
        setIsDark(true);
        document.documentElement.setAttribute("data-theme", "dark");
      } else if (savedTheme === "light") {
        setIsDark(false);
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      }
    } catch {
      // Ignore storage error
    }

    const loadSess = () => {
      if (offlineDb) {
        offlineDb.session
          .get("active")
          .then((s) => setSession(s || null))
          .catch(() => {});
      }
    };
    loadSess();

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onInstallReady = () => setCanInstall(true);
    const onOfflineReady = () => setSwReady(true);
    const onSessionChange = () => loadSess();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("qg:install-ready", onInstallReady);
    window.addEventListener("qg:offline-ready", onOfflineReady);
    window.addEventListener("qg:session-updated", onSessionChange);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("qg:install-ready", onInstallReady);
      window.removeEventListener("qg:offline-ready", onOfflineReady);
      window.removeEventListener("qg:session-updated", onSessionChange);
    };
  }, [pathname]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("qg_theme", next ? "dark" : "light");
    } catch {
      // Ignore
    }
  };

  const handleInstall = async () => {
    const promptEv = window.__qgInstallPrompt;
    if (!promptEv) return;
    await promptEv.prompt();
    const res = await promptEv.userChoice;
    if (res.outcome === "accepted") {
      window.__qgInstallPrompt = null;
      setCanInstall(false);
    }
  };

  const handleSignOut = async () => {
    if (offlineDb) {
      await offlineDb.session.delete("active");
    }
    setSession(null);
    window.dispatchEvent(new CustomEvent("qg:session-updated"));
    router.push("/");
  };

  const navItems = [
    { href: "/", label: "Home", icon: Home },
    { href: "/student", label: "Student", icon: BookOpen },
    { href: "/teacher", label: "Teacher", icon: GraduationCap },
    { href: "/verify", label: "Verify QR", icon: ScanLine },
  ];

  const isNavActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Desktop & Mobile Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md no-print">
        <div
          className={`${maxWidthClass} mx-auto px-4 h-16 flex items-center justify-between gap-2`}
        >
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <QrCode className="w-5 h-5" />
              </div>
              <div className="leading-tight">
                <span className="font-bold text-base tracking-tight block">
                  QuizGate
                </span>
                <span className="text-[11px] font-medium text-[var(--ink-muted)] block">
                  Grade 10 · Offline PWA
                </span>
              </div>
            </Link>

            <nav
              className="hidden sm:flex items-center gap-1"
              aria-label="Primary navigation"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      active
                        ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Offline / Online indicator */}
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border ${
                isOnline
                  ? "bg-[var(--success-soft)] text-[var(--success)] border-transparent"
                  : "bg-[var(--warning-soft)] text-[var(--warning)] border-transparent"
              }`}
              title={
                isOnline
                  ? swReady
                    ? "Connected online · Offline cache ready"
                    : "Connected online"
                  : "Offline mode active — data saved locally in IndexedDB"
              }
            >
              {isOnline ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span className="hidden xs:inline">
                {isOnline ? (swReady ? "Ready Offline" : "Online") : "Offline"}
              </span>
            </div>

            {canInstall && (
              <button
                type="button"
                onClick={handleInstall}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 min-h-[36px]"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Install App</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              className="w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {session ? (
              <button
                type="button"
                onClick={handleSignOut}
                title={`Signed in as ${session.name} (${session.role}) — Tap to sign out`}
                className="inline-flex items-center gap-1.5 px-2.5 h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--ink)] hover:border-red-400"
              >
                <UserCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span className="hidden md:inline max-w-[110px] truncate">
                  {session.name}
                </span>
                <LogOut className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              </button>
            ) : (
              <Link
                href="/auth"
                className="inline-flex items-center justify-center px-3 h-10 rounded-xl bg-[var(--primary)] text-white text-xs font-semibold hover:bg-[var(--primary-hover)]"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className={`flex-1 w-full ${maxWidthClass} mx-auto px-4 py-5 pb-24 sm:pb-10`}
      >
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md no-print"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Mobile bottom navigation"
      >
        <div className="grid grid-cols-4 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                  active ? "text-[var(--primary)]" : "text-[var(--ink-muted)]"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
