"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Download,
  FileKey2,
  Lock,
  Play,
  QrCode,
  RefreshCw,
  Share2,
  Upload,
} from "lucide-react";
import {
  decodeUtf8Base64Url,
  decryptQuizPack,
  encryptResultPacket,
  type EncryptedQuizPack,
} from "@/lib/crypto/quizVault";
import {
  GRADE10_BLUEPRINTS,
  GRADE10_MODULES,
  buildEncryptedPackFromBlueprint,
} from "@/lib/data/grade10Math";
import {
  offlineDb,
  type ActiveSession,
  type ImportedPackRecord,
  type LocalAttemptRecord,
  type StudyProgressRecord,
} from "@/lib/offline/storage";
import { Grade10ModuleDrawer } from "./Grade10ModuleDrawer";
import { QrCanvas } from "./QrCanvas";

type StudentTab = "quizzes" | "study" | "results";

interface RemoteRunInfo {
  run: {
    id: string;
    quiz_id: string;
    status: "running" | "ended";
    started_at: string;
    ends_at: string;
  } | null;
  quiz: {
    id: string;
    title: string;
    description: string | null;
    duration_minutes: number;
    instant_feedback: boolean;
    allow_retry: boolean;
  } | null;
  attempt: {
    id: string;
    status: "in_progress" | "submitted";
    score: number;
    max_score: number;
  } | null;
}

const DEFAULT_STUDY: StudyProgressRecord = {
  key: "current",
  completedSteps: {},
  reflections: {},
  points: 0,
};

export function StudentWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<StudentTab>("quizzes");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [packs, setPacks] = useState<ImportedPackRecord[]>([]);
  const [attempts, setAttempts] = useState<LocalAttemptRecord[]>([]);
  const [studyProgress, setStudyProgress] = useState<StudyProgressRecord>(DEFAULT_STUDY);
  const [activeWeekIdx, setActiveWeekIdx] = useState<number | null>(null);

  const [remoteState, setRemoteState] = useState<RemoteRunInfo | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lockedPack, setLockedPack] = useState<EncryptedQuizPack | null>(null);
  const [packPin, setPackPin] = useState("");
  const [selectedAttemptQr, setSelectedAttemptQr] = useState<LocalAttemptRecord | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadLocalWorkspace = async () => {
    if (!offlineDb) return;
    const sess = (await offlineDb.session.get("active")) || null;
    setSession(sess?.role === "student" ? sess : null);

    // Ensure built-in hardcoded Grade 10 encrypted packs exist cleanly in IndexedDB
    const existing = await offlineDb.importedPacks.toArray();
    if (existing.length === 0) {
      for (const bp of GRADE10_BLUEPRINTS) {
        const encrypted = await buildEncryptedPackFromBlueprint(bp, "Grade 10 Curriculum");
        await offlineDb.importedPacks.put({
          id: encrypted.id,
          pack: encrypted,
          importedAt: new Date().toISOString(),
          source: "builtin",
        });
      }
    }

    // Import encrypted pack if opened via ?pack=<token> teacher link
    if (typeof window !== "undefined") {
      const packToken = new URLSearchParams(window.location.search).get("pack");
      if (packToken) {
        try {
          const decoded = JSON.parse(decodeUtf8Base64Url(packToken)) as EncryptedQuizPack;
          if (decoded.kind === "QGATE_PACK") {
            if (decoded.lockedWithPasscode) {
              setLockedPack(decoded);
            } else {
              await decryptQuizPack(decoded);
              await offlineDb.importedPacks.put({
                id: decoded.id,
                pack: decoded,
                importedAt: new Date().toISOString(),
                source: "link",
              });
              setImportMsg({
                ok: true,
                text: `Imported shared quiz "${decoded.title}" (${decoded.questionCount} questions).`,
              });
            }
          }
        } catch {
          setImportMsg({ ok: false, text: "Invalid or corrupted quiz link." });
        }
      }
    }

    const updatedPacks = await offlineDb.importedPacks.orderBy("importedAt").reverse().toArray();
    setPacks(updatedPacks);

    const allAttempts = await offlineDb.attempts.toArray();
    allAttempts.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
    setAttempts(allAttempts);

    const prog = await offlineDb.studyProgress.get("current");
    if (prog) setStudyProgress(prog);

    // Check if Supabase live classroom run exists
    if (
      sess?.role === "student" &&
      sess.authMode === "supabase" &&
      sess.sessionToken &&
      navigator.onLine
    ) {
      refreshRemoteState(sess.sessionToken);
    }
  };

  const refreshRemoteState = async (token: string) => {
    setSyncing(true);
    setRemoteError(null);
    try {
      const res = await fetch("/api/student/quiz-state", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setRemoteError(json.error || "Session expired or signed in on another device.");
        setRemoteState(null);
      } else if (json.mode === "supabase") {
        setRemoteState({
          run: json.run || null,
          quiz: json.quiz || null,
          attempt: json.attempt || null,
        });
      }
    } catch {
      // Stay offline silently
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadLocalWorkspace();
    const onSessChange = () => loadLocalWorkspace();
    window.addEventListener("qg:session-updated", onSessChange);
    return () => window.removeEventListener("qg:session-updated", onSessChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveStudyProgress = async (next: StudyProgressRecord) => {
    setStudyProgress(next);
    await offlineDb.studyProgress.put(next);
  };

  const handleImportPackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result)) as EncryptedQuizPack;
        if (parsed.kind !== "QGATE_PACK") {
          throw new Error("Invalid file. Expected an encrypted .qpack.json quiz file.");
        }
        if (parsed.lockedWithPasscode) {
          setLockedPack(parsed);
          return;
        }
        await decryptQuizPack(parsed);
        await offlineDb.importedPacks.put({
          id: parsed.id,
          pack: parsed,
          importedAt: new Date().toISOString(),
          source: "file",
        });
        setImportMsg({
          ok: true,
          text: `Added "${parsed.title}" (${parsed.questionCount} questions) for offline access.`,
        });
        loadLocalWorkspace();
      } catch (err) {
        setImportMsg({
          ok: false,
          text: err instanceof Error ? err.message : "Could not open quiz file.",
        });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleUnlockPack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockedPack) return;
    try {
      await decryptQuizPack(lockedPack, packPin);
      await offlineDb.importedPacks.put({
        id: lockedPack.id,
        pack: lockedPack,
        importedAt: new Date().toISOString(),
        source: "file",
      });
      setImportMsg({
        ok: true,
        text: `Unlocked and added "${lockedPack.title}". Ready offline.`,
      });
      setLockedPack(null);
      setPackPin("");
      loadLocalWorkspace();
    } catch (err) {
      setImportMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Incorrect passcode.",
      });
    }
  };

  const handleDownloadAttemptFile = async (attempt: LocalAttemptRecord) => {
    if (!attempt.payload) return;
    const encrypted = await encryptResultPacket(attempt.payload);
    const json = JSON.stringify(encrypted, null, 2);
    const safeName = attempt.studentNo.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `Result_${safeName}_${attempt.packOrRunId.slice(0, 12)}.qres.json`;
    const blob = new Blob([json], { type: "application/json" });

    try {
      const file = new File([json], fileName, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `QuizGate Submission - ${attempt.studentName}`,
          text: `${attempt.title}: ${attempt.score}/${attempt.maxScore}`,
        });
        return;
      }
    } catch {
      // Fallback to direct download
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const isStudyWeekUnlocked = (idx: number) => {
    if (idx === 0) return true;
    const prevWeek = `w${idx}`;
    return Boolean(studyProgress.completedSteps[`${prevWeek}-reflect`]);
  };

  const completedWeeksCount = GRADE10_MODULES.filter((m) =>
    Boolean(studyProgress.completedSteps[`w${m.weekNumber}-reflect`])
  ).length;

  if (activeWeekIdx !== null) {
    const mod = GRADE10_MODULES[activeWeekIdx];
    return (
      <Grade10ModuleDrawer
        module={mod}
        progress={studyProgress}
        unlocked={isStudyWeekUnlocked(activeWeekIdx)}
        onUpdateProgress={handleSaveStudyProgress}
        onClose={() => setActiveWeekIdx(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Identity Header */}
      <div className="qg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            {session ? `Hi, ${session.name}` : "Student Workspace"}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink-muted)]">
            {session
              ? `ID ${session.identifier} · ${session.className || session.classCode || "Offline Mode"}`
              : "Sign in or register to link results to your Student ID, or practice offline right away."}
          </p>
        </div>

        {!session ? (
          <div className="flex gap-2">
            <Link href="/auth?role=student&tab=login" className="qg-btn qg-btn-secondary text-xs">
              Log In
            </Link>
            <Link href="/auth?role=student&tab=register" className="qg-btn qg-btn-primary text-xs">
              Register Student ID
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs font-bold tabular-nums">
              {studyProgress.points} Study Pts
            </span>
            <button
              type="button"
              onClick={() => setTab("results")}
              className="qg-btn qg-btn-secondary text-xs"
            >
              <QrCode className="w-4 h-4" />
              <span>ID Pass</span>
            </button>
          </div>
        )}
      </div>

      {/* Section Tabs */}
      <div className="grid grid-cols-3 gap-2 p-1.5 qg-card">
        <button
          type="button"
          onClick={() => setTab("quizzes")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "quizzes" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Quizzes ({packs.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("study")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "study" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>G10 Topics ({completedWeeksCount}/10)</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("results")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "results" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <Award className="w-4 h-4" />
          <span>ID &amp; Results ({attempts.length})</span>
        </button>
      </div>

      {tab === "quizzes" && (
        <div className="space-y-4">
          {/* Live Cloud Classroom Run Card */}
          {session?.authMode === "supabase" && (
            <div className="qg-card p-5 space-y-3 border-l-4 border-l-[var(--primary)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--primary)]">
                  Live Classroom Quiz
                </span>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() =>
                    session.sessionToken && refreshRemoteState(session.sessionToken)
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {remoteError ? (
                <p className="text-sm text-[var(--danger)] font-medium">{remoteError}</p>
              ) : remoteState?.run && remoteState.quiz ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-base">{remoteState.quiz.title}</h3>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Status: <span className="font-semibold uppercase">{remoteState.run.status}</span> ·{" "}
                      {remoteState.quiz.duration_minutes} mins
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const target = `run:${remoteState.run!.id}`;
                      sessionStorage.setItem("qg_active_play_id", target);
                      router.push(`/student/play?id=${encodeURIComponent(target)}#${encodeURIComponent(target)}`);
                    }}
                    className="qg-btn qg-btn-primary text-sm"
                  >
                    <Play className="w-4 h-4" />
                    <span>
                      {remoteState.attempt?.status === "submitted"
                        ? "View Result QR"
                        : "Enter Quiz"}
                    </span>
                  </button>
                </div>
              ) : (
                <p className="text-sm text-[var(--ink-muted)]">
                  No quiz is currently active in your class. Wait for your teacher to start one,
                  or take an offline encrypted quiz pack below.
                </p>
              )}
            </div>
          )}

          {/* Import Teacher Offline File Bar */}
          <div className="qg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileKey2 className="w-5 h-5 text-[var(--primary)] shrink-0" />
              <div>
                <h2 className="text-sm font-bold">Encrypted Quiz Packs (Offline Ready)</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Questions stay AES-256-GCM encrypted until started; answers save offline to IndexedDB.
                </p>
              </div>
            </div>
            <div>
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
                className="qg-btn qg-btn-secondary text-xs w-full sm:w-auto"
              >
                <Upload className="w-4 h-4" />
                <span>Import .qpack.json</span>
              </button>
            </div>
          </div>

          {lockedPack && (
            <form
              onSubmit={handleUnlockPack}
              className="qg-card p-4 border-amber-400 bg-[var(--warning-soft)] space-y-3"
            >
              <p className="text-sm font-semibold">
                Enter passcode to decrypt &ldquo;{lockedPack.title}&rdquo;:
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="qg-input"
                  value={packPin}
                  onChange={(e) => setPackPin(e.target.value)}
                  placeholder="Quiz passcode"
                />
                <button type="submit" className="qg-btn qg-btn-primary shrink-0">
                  Unlock
                </button>
              </div>
            </form>
          )}

          {importMsg && (
            <div
              className={`p-3 rounded-xl text-sm font-semibold ${
                importMsg.ok
                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                  : "bg-[var(--danger-soft)] text-[var(--danger)]"
              }`}
            >
              {importMsg.text}
            </div>
          )}

          {/* Available Encrypted Packs */}
          <div className="grid grid-cols-1 gap-3">
            {packs.map((rec) => {
              const p = rec.pack;
              const prevAttempt = attempts.find((a) => a.packOrRunId === p.id);
              return (
                <div
                  key={p.id}
                  className="qg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                        {rec.source === "builtin" ? "Grade 10 Bank · Encrypted" : "Teacher Pack · Encrypted"}
                      </span>
                      <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                        {p.questionCount} questions · {p.durationMinutes} min
                      </span>
                    </div>
                    <h3 className="font-bold text-base">{p.title}</h3>
                    <p className="text-xs text-[var(--ink-muted)]">{p.description}</p>
                    {prevAttempt && (
                      <p className="text-xs font-semibold text-[var(--success)] tabular-nums">
                        Last score: {prevAttempt.score}/{prevAttempt.maxScore} (
                        {prevAttempt.status})
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem("qg_active_play_id", p.id);
                      router.push(`/student/play?id=${encodeURIComponent(p.id)}#${encodeURIComponent(p.id)}`);
                    }}
                    className="qg-btn qg-btn-primary text-sm shrink-0"
                  >
                    <Play className="w-4 h-4" />
                    <span>Start Quiz</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "study" && (
        <div className="space-y-3">
          <div className="qg-card p-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-base">Grade 10 Quarter 2 Math Track</h2>
              <p className="text-xs text-[var(--ink-muted)]">
                10 structured offline topics with examples, matching, numerical checks, and applied problems.
              </p>
            </div>
            <span className="text-sm font-bold text-[var(--primary)] tabular-nums shrink-0">
              {completedWeeksCount}/10
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {GRADE10_MODULES.map((mod, idx) => {
              const unlocked = isStudyWeekUnlocked(idx);
              const done = Boolean(studyProgress.completedSteps[`w${mod.weekNumber}-reflect`]);
              const stepCount = ["learn", "match", "s0", "s1", "scenario", "reflect"].filter(
                (s) => Boolean(studyProgress.completedSteps[`w${mod.weekNumber}-${s}`])
              ).length;

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setActiveWeekIdx(idx)}
                  className={`qg-card p-4 text-left flex items-start justify-between gap-3 transition-colors ${
                    unlocked
                      ? "hover:border-[var(--primary)] cursor-pointer"
                      : "opacity-65 cursor-pointer"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="text-[var(--primary)]">Week {mod.weekNumber}</span>
                      <span className="text-[var(--ink-muted)]">· Topic {mod.topicCode}</span>
                      {done && <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />}
                      {!unlocked && <Lock className="w-3.5 h-3.5 text-[var(--ink-muted)]" />}
                    </div>
                    <h3 className="font-bold text-sm">{mod.title}</h3>
                    <p className="text-xs text-[var(--ink-muted)] tabular-nums">
                      {stepCount}/6 checkpoints completed
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ink-muted)] shrink-0 mt-1" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "results" && (
        <div className="space-y-4">
          {/* Student ID QR */}
          {session?.qrPayload ? (
            <div className="max-w-sm mx-auto">
              <QrCanvas
                value={session.qrPayload}
                title="My Student Identity QR"
                subtitle={`${session.name} · ${session.identifier}`}
                filename={`student-qr-${session.identifier}.png`}
              />
            </div>
          ) : (
            <div className="qg-card p-5 text-center space-y-3">
              <p className="text-sm text-[var(--ink-muted)]">
                Register or sign in to generate your personal Student Identity QR card.
              </p>
              <Link href="/auth?role=student&tab=register" className="qg-btn qg-btn-primary text-xs">
                Register Student ID
              </Link>
            </div>
          )}

          {/* Completed Attempts */}
          <div className="qg-card p-4 space-y-3">
            <h2 className="font-bold text-base">Quiz Submissions &amp; Offline Result Files</h2>

            {attempts.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No completed quizzes yet. Results and verifiable QR passes appear here automatically.
              </p>
            ) : (
              <div className="space-y-3">
                {attempts.map((att) => (
                  <div
                    key={att.id}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-sm">{att.title}</h3>
                        <p className="text-xs text-[var(--ink-muted)] tabular-nums">
                          Score: <b>{att.score}/{att.maxScore}</b> · {att.status} ·{" "}
                          {att.syncStatus === "synced"
                            ? "Synced to Server"
                            : att.syncStatus === "pending_sync"
                              ? "Pending Sync"
                              : "Saved Offline"}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {att.resultQr && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedAttemptQr(selectedAttemptQr?.id === att.id ? null : att)
                            }
                            className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>{selectedAttemptQr?.id === att.id ? "Hide QR" : "Result QR"}</span>
                          </button>
                        )}
                        {att.payload && (
                          <button
                            type="button"
                            onClick={() => handleDownloadAttemptFile(att)}
                            className="qg-btn qg-btn-primary text-xs min-h-[38px]"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Export .qres File</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {selectedAttemptQr?.id === att.id && att.resultQr && (
                      <div className="max-w-xs mx-auto pt-2">
                        <QrCanvas
                          value={att.resultQr}
                          title={`Result QR: ${att.title}`}
                          subtitle={`${att.studentName} · Score ${att.score}/${att.maxScore}`}
                          filename={`result-${att.studentNo}-${att.score}of${att.maxScore}.png`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
