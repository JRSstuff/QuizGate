"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { QuizRunner } from "@/components/QuizRunner";

function PlayQueryInner() {
  const params = useSearchParams();
  const [resolvedId, setResolvedId] = useState<string>("");
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const fromParam = params.get("id") || "";
    const fromHash =
      typeof window !== "undefined" && window.location.hash.length > 1
        ? decodeURIComponent(window.location.hash.slice(1))
        : "";
    const fromSession =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("qg_active_play_id") || ""
        : "";
    const id = fromParam || fromHash || fromSession;
    if (id && typeof window !== "undefined") {
      window.sessionStorage.setItem("qg_active_play_id", id);
    }
    setResolvedId(id);
    setChecked(true);
  }, [params]);

  if (!checked) {
    return (
      <div className="max-w-md mx-auto qg-card p-6 text-sm text-[var(--ink-muted)]">
        Loading quiz...
      </div>
    );
  }

  if (!resolvedId) {
    return (
      <div className="max-w-md mx-auto qg-card p-6 text-sm text-[var(--ink-muted)]">
        Missing quiz identifier. Return to Student Workspace to select a quiz.
      </div>
    );
  }

  return <QuizRunner targetId={resolvedId} />;
}

export default function StaticPlayQuizPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="max-w-md mx-auto qg-card p-6 text-sm text-[var(--ink-muted)]">
            Loading quiz...
          </div>
        }
      >
        <PlayQueryInner />
      </Suspense>
    </AppShell>
  );
}
