"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __qgInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function ServiceWorkerRegister() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Prefetch all app routes so Next.js RSC payloads & JS chunks are cached immediately
    for (const route of ["/auth", "/student", "/student/play", "/teacher", "/verify"]) {
      try {
        router.prefetch(route);
      } catch {
        // Ignore prefetch error if offline
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      window.__qgInstallPrompt = e as BeforeInstallPromptEvent;
      window.dispatchEvent(new CustomEvent("qg:install-ready"));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    if ("serviceWorker" in navigator) {
      const initSw = async () => {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

          const warmAssets = () => {
            const worker = reg.active || navigator.serviceWorker.controller;
            if (!worker) return;
            const urls = new Set<string>([
              "/",
              "/auth",
              "/student",
              "/student/play",
              "/teacher",
              "/verify",
              "/manifest.json",
            ]);
            try {
              const entries = performance.getEntriesByType(
                "resource"
              ) as PerformanceResourceTiming[];
              for (const entry of entries) {
                if (
                  entry.name.startsWith(window.location.origin) &&
                  (entry.name.includes("/_next/static/") || entry.name.includes("_rsc="))
                ) {
                  const u = new URL(entry.name);
                  urls.add(u.pathname + u.search);
                }
              }
            } catch {
              // Ignore resource timing errors
            }
            worker.postMessage({ type: "CACHE_URLS", urls: Array.from(urls) });
          };

          if (reg.active) warmAssets();
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing;
            installing?.addEventListener("statechange", () => {
              if (installing.state === "activated") warmAssets();
            });
          });
          navigator.serviceWorker.ready.then(() => {
            setTimeout(warmAssets, 300);
            window.dispatchEvent(new CustomEvent("qg:offline-ready"));
          });
        } catch {
          // Ignore registration restrictions
        }
      };
      initSw();
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, [router]);

  return null;
}
