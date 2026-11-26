"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  FileKey2,
  GraduationCap,
  Link2,
  LogIn,
  QrCode,
  ScanLine,
  Upload,
  UserPlus,
} from "lucide-react";
import { decryptQuizPack, type EncryptedQuizPack } from "@/lib/crypto/quizVault";
import { offlineDb, type ActiveSession, type LinkStudentAttemptRecord } from "@/lib/offline/storage";
import { QrCanvas } from "./QrCanvas";

export function HomeScreen() {
  const router = useRouter();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [cachedLinks, setCachedLinks] = useState<
    { runId: string; title: string; className: string; status?: string; shareUrl: string }[]
  >([]);
  const [quizLinkInput, setQuizLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [showMyQr, setShowMyQr] = useState(false);

  const [pendingLockedPack, setPendingLockedPack] = useState<EncryptedQuizPack | null>(null);
  const [packPasscode, setPackPasscode] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => {
      if (offlineDb) {
        offlineDb.session
          .get("active")
          .then((s) => setSession(s || null))
          .catch(() => {});
        Promise.all([offlineDb.cachedLinkPacks.toArray(), offlineDb.linkAttempts.toArray()])
          .then(([packs, atts]) => {
            const attMap = new Map<string, LinkStudentAttemptRecord>();
            atts.forEach((a) => attMap.set(a.runId, a));
            const items = packs.map((p) => {
              let title = p.runId;
              let className = "";
              try {
                const env = JSON.parse(p.envelopeJson);
                title = env.title || p.runId;
                className = env.className || "";
              } catch {
                // ignore
              }
              return {
                runId: p.runId,
                title,
                className,
                status: attMap.get(p.runId)?.status,
                shareUrl: p.shareUrl || `/q/${p.runId}`,
              };
            });
            setCachedLinks(items);
          })
          .catch(() => {});
      }
    };
    sync();
    window.addEventListener("qg:session-updated", sync);
    return () => window.removeEventListener("qg:session-updated", sync);
  }, []);

  const handleOpenQuizLink = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    const raw = quizLinkInput.trim();
    if (!raw) return;
    const qIdx = raw.indexOf("/q/");
    if (qIdx >= 0) {
      window.location.assign(raw.slice(qIdx));
      return;
    }
    if (raw.startsWith("L3.")) {
      setLinkError("Paste the full Quiz Link starting with /q/... from your teacher.");
      return;
    }
    router.push(`/q/${encodeURIComponent(raw)}`);
  };

  const handleImportPackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result)) as EncryptedQuizPack;
        if (parsed.kind !== "QGATE_PACK") {
          throw new Error("Not a valid encrypted .qpack.json quiz file.");
        }
        if (parsed.lockedWithPasscode) {
          setPendingLockedPack(parsed);
          return;
        }
        await decryptQuizPack(parsed);
        await offlineDb.importedPacks.put({
          id: parsed.id,
          pack: parsed,
          importedAt: new Date().toISOString(),
          source: "file",
        });
        setImportSuccess(`Imported "${parsed.title}" (${parsed.questionCount} items). Ready offline.`);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Failed to read quiz file.");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleUnlockPendingPack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingLockedPack) return;
    setImportError(null);
    try {
      await decryptQuizPack(pendingLockedPack, packPasscode);
      await offlineDb.importedPacks.put({
        id: pendingLockedPack.id,
        pack: pendingLockedPack,
        importedAt: new Date().toISOString(),
        source: "file",
      });
      setImportSuccess(
        `Unlocked and saved "${pendingLockedPack.title}". Open Student Workspace to take it.`
      );
      setPendingLockedPack(null);
      setPackPasscode("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Incorrect passcode.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Active Account Card if signed in */}
      {session && (
        <section className="qg-card p-5 border-l-4 border-l-[var(--primary)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                  {session.role === "teacher" ? "Teacher Account" : "Student Account"}
                </span>
                <span className="text-xs font-medium text-[var(--ink-muted)]">
                  {session.authMode === "supabase" ? "Cloud Synced" : "Offline Local Mode"}
                </span>
              </div>
              <h2 className="text-xl font-bold mt-1.5">{session.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                ID: <span className="font-mono">{session.identifier}</span>
                {session.classCode ? ` · Class ${session.classCode}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {session.role === "student" && session.qrPayload && (
                <button
                  type="button"
                  onClick={() => setShowMyQr((v) => !v)}
                  className="qg-btn qg-btn-secondary text-xs"
                >
                  <QrCode className="w-4 h-4" />
                  <span>{showMyQr ? "Hide ID QR" : "Show ID QR"}</span>
                </button>
              )}
              <Link
                href={session.role === "teacher" ? "/teacher" : "/student"}
                className="qg-btn qg-btn-primary text-sm"
              >
                <span>
                  Open {session.role === "teacher" ? "Teacher Console" : "Student Workspace"}
                </span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {showMyQr && session.qrPayload && (
            <div className="mt-4 max-w-xs mx-auto">
              <QrCanvas
                value={session.qrPayload}
                title="Student Identity QR"
                subtitle={`${session.name} · ${session.identifier}`}
                filename={`student-qr-${session.identifier}.png`}
              />
            </div>
          )}
        </section>
      )}

      {/* Main Entry Hub: Student & Teacher Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Student Entry */}
        <div className="qg-card p-5 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center shrink-0">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Student Portal</h1>
                <p className="text-xs text-[var(--ink-muted)]">
                  No account or registration needed — open your teacher&apos;s Quiz Link directly or study offline
                </p>
              </div>
            </div>

            <form onSubmit={handleOpenQuizLink} className="space-y-2 mt-4">
              <label
                htmlFor="home-quiz-link"
                className="block text-xs font-semibold text-[var(--ink-muted)]"
              >
                Open Teacher&apos;s Quiz Link
              </label>
              <div className="flex gap-2">
                <input
                  id="home-quiz-link"
                  className="qg-input text-xs font-mono"
                  placeholder="Paste /q/<runId>#... link from teacher"
                  value={quizLinkInput}
                  onChange={(e) => setQuizLinkInput(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={!quizLinkInput.trim()}
                  className="qg-btn qg-btn-primary shrink-0"
                >
                  <Link2 className="w-4 h-4" />
                  <span>Open</span>
                </button>
              </div>
              {linkError && (
                <p className="text-xs text-[var(--danger)]">{linkError}</p>
              )}
            </form>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex flex-wrap gap-3">
            <Link
              href="/student"
              className="text-xs font-semibold text-[var(--primary)] hover:underline inline-flex items-center gap-1 py-1"
            >
              <span>Browse Grade 10 Offline Modules</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-[var(--border)]">|</span>
            <Link
              href="/student?tab=results"
              className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 py-1"
            >
              <span>Saved Submissions &amp; QR Receipts</span>
            </Link>
          </div>
        </div>

        {/* Teacher Entry */}
        <div className="qg-card p-5 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center shrink-0">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Teacher Console</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Manage classes, generate QR sheets, export encrypted packs, and verify scores
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <Link
                href="/auth?role=teacher&tab=login"
                className="qg-btn qg-btn-secondary border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
              >
                <LogIn className="w-4 h-4" />
                <span>Teacher Login</span>
              </Link>
              <Link href="/auth?role=teacher&tab=register" className="qg-btn qg-btn-secondary">
                <UserPlus className="w-4 h-4" />
                <span>Teacher Register</span>
              </Link>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex flex-wrap gap-3">
            <Link
              href="/verify"
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1.5 py-1"
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Verify Result QR / File</span>
            </Link>
            <span className="text-[var(--border)]">|</span>
            <Link
              href="/teacher"
              className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 py-1"
            >
              <span>Open Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Cached Offline Runs & Encrypted Offline Pack Loader */}
      <section className="qg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileKey2 className="w-5 h-5 text-[var(--primary)]" />
          <h3 className="font-bold text-base">Saved Offline Quizzes &amp; Encrypted Pack Loader</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-[var(--ink-muted)]">
              Cached Quiz Links on This Device
            </span>
            {cachedLinks.length === 0 ? (
              <p className="text-xs text-[var(--ink-muted)] py-2">
                No cached Quiz Links yet. When you open a teacher&apos;s <code>/q/...</code> link,
                it caches automatically so you can reopen offline anytime.
              </p>
            ) : (
              <div className="space-y-1.5">
                {cachedLinks.map((item) => (
                  <a
                    key={item.runId}
                    href={item.shareUrl}
                    className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--primary)] text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold truncate">{item.title}</p>
                      <p className="text-[var(--ink-muted)] truncate">
                        {item.className ? `${item.className} · ` : ""}
                        Run {item.runId}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] font-semibold shrink-0">
                      {item.status || "Cached"}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-semibold text-[var(--ink-muted)]">
              Offline? Import an encrypted <code>.qpack.json</code> quiz file
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.qpack.json"
              className="hidden"
              onChange={handleImportPackFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="qg-btn qg-btn-secondary w-full"
            >
              <Upload className="w-4 h-4" />
              <span>Select Encrypted Quiz File (.qpack.json)</span>
            </button>
          </div>
        </div>

        {pendingLockedPack && (
          <form
            onSubmit={handleUnlockPendingPack}
            className="p-4 rounded-xl border border-amber-300 bg-[var(--warning-soft)] space-y-3"
          >
            <p className="text-sm font-semibold">
              &ldquo;{pendingLockedPack.title}&rdquo; is locked with a class passcode.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                className="qg-input"
                placeholder="Enter teacher passcode"
                value={packPasscode}
                onChange={(e) => setPackPasscode(e.target.value)}
              />
              <button type="submit" className="qg-btn qg-btn-primary shrink-0">
                Decrypt Quiz
              </button>
            </div>
          </form>
        )}

        {importError && (
          <p className="text-sm font-medium text-[var(--danger)]">{importError}</p>
        )}
        {importSuccess && (
          <div className="p-3 rounded-xl bg-[var(--success-soft)] text-[var(--success)] text-sm font-semibold flex items-center justify-between gap-2 flex-wrap">
            <span>{importSuccess}</span>
            <Link href="/student" className="underline">
              Open Student Workspace →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
