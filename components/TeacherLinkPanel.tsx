"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Link2,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  createLinkQuizBundle,
  generateSignedStartCode,
  verifyLinkResultQr,
  type LinkQuizQuestionInput,
} from "@/lib/crypto/linkVault";
import { GRADE10_BLUEPRINTS } from "@/lib/data/grade10Math";
import { offlineDb, type LocalTeacherClass, type LocalTeacherQuiz } from "@/lib/offline/storage";
import {
  integratePlainSubmissionIntoRun,
  processUploadedResultFiles,
  recomputeRosterAnomalies,
  renameOrMergeRosterStudent,
  type FileUploadReportItem,
  type TeacherLinkRosterEntry,
  type TeacherLinkRunRecord,
} from "@/lib/teacher/submissionMerge";
import { formatCountdown } from "@/lib/timer/clockSync";
import { QrCanvas } from "./QrCanvas";

function buildDefaultPresetQuestions(): LinkQuizQuestionInput[] {
  const bp = GRADE10_BLUEPRINTS[0];
  if (!bp) {
    return [
      {
        id: "q-1",
        prompt: "Simplify sqrt(50).",
        options: ["5*sqrt(2)", "2*sqrt(5)", "25", "10*sqrt(2)"],
        correctIndex: 0,
        points: 1,
        explanation: "50 = 25 * 2, so sqrt(50) = 5*sqrt(2).",
      },
    ];
  }
  return bp.items.slice(0, 5).map((item) => ({
    id: item.id,
    prompt: item.prompt,
    options: item.options,
    correctIndex: item.correctIndex,
    points: item.points,
    explanation: item.explanation,
  }));
}

export function exportLinkRunCsv(run: TeacherLinkRunRecord) {
  const esc = (v: string | number | boolean) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Run ID",
    "Quiz Title",
    "Class",
    "Student Name",
    "Section",
    "Status",
    "Score",
    "Max Score",
    "Source",
    "Submitted Offline",
    "Clock Tampered",
    "Late After End",
    "Before Start",
    "Stale Version",
    "Shared Device With",
    "Identical Answers With",
    "Finished At",
  ];
  const rows = run.roster.map((r) => [
    esc(run.runId),
    esc(run.quizTitle),
    esc(run.className),
    esc(r.studentName),
    esc(r.section),
    esc(r.status === "submitted" ? "Submitted" : "No submission"),
    esc(r.status === "submitted" ? r.score : ""),
    esc(r.maxScore),
    esc(r.source),
    esc(r.submittedOffline ? "YES" : "NO"),
    esc(r.clockTampered ? "YES" : "NO"),
    esc(r.lateAfterEnd ? "YES" : "NO"),
    esc(r.beforeStart ? "YES" : "NO"),
    esc(r.staleVersion ? "YES" : "NO"),
    esc(r.sharedDeviceWith || ""),
    esc(r.identicalAnswersWith || ""),
    esc(r.finishedAt || ""),
  ]);
  const csv = [headers.join(","), ...rows.map((line) => line.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quizgate-run-${run.runId}-results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TeacherLinkPanel({
  quizzes,
  classes,
}: {
  quizzes: LocalTeacherQuiz[];
  classes: LocalTeacherClass[];
}) {
  const [runs, setRuns] = useState<TeacherLinkRunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // Builder fields
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    GRADE10_BLUEPRINTS[0]?.id || "custom"
  );
  const [quizTitle, setQuizTitle] = useState(
    GRADE10_BLUEPRINTS[0]?.title || "Grade 10 Math Quick Check"
  );
  const [className, setClassName] = useState("Grade 10 - Rizal");
  const [sectionsRaw, setSectionsRaw] = useState("10-Rizal, 10-Bonifacio");
  const [durationMins, setDurationMins] = useState("15");
  const [instantFeedback, setInstantFeedback] = useState(true);
  const [questions, setQuestions] = useState<LinkQuizQuestionInput[]>(() =>
    buildDefaultPresetQuestions()
  );

  // Optional inline new question fields
  const [newQPrompt, setNewQPrompt] = useState("");
  const [newQOpts, setNewQOpts] = useState(["", "", "", ""]);
  const [newQCorrect, setNewQCorrect] = useState(0);

  // Live run UI state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showLinkQr, setShowLinkQr] = useState(false);
  const [showStartQr, setShowStartQr] = useState(true);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [uploadReport, setUploadReport] = useState<FileUploadReportItem[]>([]);
  const [qrVerifyInput, setQrVerifyInput] = useState("");
  const [qrVerifyResult, setQrVerifyResult] = useState<string | null>(null);
  const [editingAttemptId, setEditingAttemptId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSection, setEditSection] = useState("");
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const initClassRef = useRef(false);

  useEffect(() => {
    if (!offlineDb) return;
    offlineDb.teacherLinkRuns
      .orderBy("createdAtSec")
      .reverse()
      .toArray()
      .then((list) => {
        setRuns(list);
        if (list.length > 0) setActiveRunId((prev) => prev || list[0].runId);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initClassRef.current && classes.length > 0) {
      initClassRef.current = true;
      setClassName(classes[0].name);
    }
  }, [classes]);

  const activeRun = useMemo(
    () => runs.find((r) => r.runId === activeRunId) || runs[0] || null,
    [runs, activeRunId]
  );

  const persistRun = useCallback(async (updated: TeacherLinkRunRecord) => {
    if (offlineDb) {
      await offlineDb.teacherLinkRuns.put(updated);
    }
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.runId === updated.runId);
      if (idx === -1) return [updated, ...prev];
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });
  }, []);

  // Countdown tick for active running quiz
  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [activeRun?.runId, activeRun?.status]);

  // Live 3s poll for online joined & submitted students
  const syncActiveRunOnline = useCallback(async () => {
    if (!activeRun || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    try {
      const res = await fetch(`/api/run/${encodeURIComponent(activeRun.runId)}/state`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        exists?: boolean;
        status?: "waiting" | "running" | "ended";
        startedAtServer?: number;
        endsAtServer?: number;
        startCode?: string;
        startQr?: string;
        joined?: {
          attemptId: string;
          deviceId: string;
          studentName: string;
          section: string;
          joinedAt: string;
        }[];
        submissions?: {
          plain: Parameters<typeof integratePlainSubmissionIntoRun>[1];
        }[];
      };
      if (!data.exists) return;

      let working = activeRun;
      let changed = false;

      // Sync joined waiting-room students
      for (const j of data.joined || []) {
        const cleanName = j.studentName.trim().replace(/\s+/g, " ");
        const cleanSection = j.section.trim().replace(/\s+/g, " ");
        const key = `${cleanName.toLowerCase()}::${cleanSection.toLowerCase()}`;
        const exists = working.roster.some(
          (r) => r.attemptId === j.attemptId || r.normalizedKey === key
        );
        if (!exists) {
          const entry: TeacherLinkRosterEntry = {
            attemptId: j.attemptId,
            deviceId: j.deviceId || "",
            studentName: cleanName,
            section: cleanSection,
            normalizedKey: key,
            status: "joined",
            score: 0,
            maxScore: working.questionCount,
            answeredCount: 0,
            totalQuestions: working.questionCount,
            submittedOffline: false,
            clockTampered: false,
            lateAfterEnd: false,
            beforeStart: false,
            staleVersion: false,
            source: "joined_only",
            recordedAt: j.joinedAt || new Date().toISOString(),
          };
          working = { ...working, roster: recomputeRosterAnomalies([...working.roster, entry]) };
          changed = true;
        }
      }

      // Sync online auto-submitted payloads
      for (const sub of data.submissions || []) {
        if (!sub?.plain) continue;
        const integrated = integratePlainSubmissionIntoRun(working, sub.plain, "online_submit");
        if (integrated.run !== working) {
          working = integrated.run;
          changed = true;
        }
      }

      if (changed) {
        await persistRun(working);
      }
    } catch {
      // Offline mode continues uninterrupted
    }
  }, [activeRun, persistRun]);

  useEffect(() => {
    if (!activeRun) return;
    syncActiveRunOnline();
    const timer = setInterval(syncActiveRunOnline, 3000);
    return () => clearInterval(timer);
  }, [activeRun?.runId, syncActiveRunOnline]);

  const handleSelectSource = (id: string) => {
    setSelectedPresetId(id);
    const bp = GRADE10_BLUEPRINTS.find((b) => b.id === id);
    if (bp) {
      setQuizTitle(bp.title);
      setDurationMins(String(bp.durationMinutes));
      setInstantFeedback(bp.instantFeedback);
      setQuestions(
        bp.items.map((item) => ({
          id: item.id,
          prompt: item.prompt,
          options: item.options,
          correctIndex: item.correctIndex,
          points: item.points,
          explanation: item.explanation,
        }))
      );
      return;
    }
    const localQ = quizzes.find((q) => q.id === id);
    if (localQ) {
      setQuizTitle(localQ.title);
      setDurationMins(String(localQ.durationMinutes));
      setInstantFeedback(localQ.instantFeedback);
      setQuestions(
        localQ.questions.map((item) => ({
          id: item.id,
          prompt: item.prompt,
          options: item.options,
          correctIndex: item.correctIndex,
          points: item.points,
        }))
      );
    }
  };

  const handleAddInlineQuestion = () => {
    const cleanPrompt = newQPrompt.trim();
    const cleanOpts = newQOpts.map((o) => o.trim()).filter(Boolean);
    if (!cleanPrompt || cleanOpts.length < 2) return;
    setQuestions((prev) => [
      ...prev,
      {
        id: `q-${Date.now()}-${prev.length + 1}`,
        prompt: cleanPrompt,
        options: cleanOpts,
        correctIndex: Math.min(newQCorrect, cleanOpts.length - 1),
        points: 1,
      },
    ]);
    setNewQPrompt("");
    setNewQOpts(["", "", "", ""]);
    setNewQCorrect(0);
  };

  const handleCreateQuizLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    if (questions.length === 0) {
      setBanner({ ok: false, text: "Add at least one question before creating a Quiz Link." });
      return;
    }
    const mins = Math.max(0.05, Number.parseFloat(durationMins) || 15);
    const cleanClass = className.trim() || "Grade 10 Class";
    const cleanTitle = quizTitle.trim() || "Classroom Quiz";
    const sections = sectionsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setCreating(true);
    try {
      const bundle = await createLinkQuizBundle({
        classId: cleanClass.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "class",
        className: cleanClass,
        sections,
        quizId: selectedPresetId || `quiz-${Date.now()}`,
        title: cleanTitle,
        durationMinutes: mins,
        instantFeedback,
        allowRetry: false,
        questions,
      });

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const shareUrl = `${origin}/q/${bundle.runId}#${bundle.hashFragment}`;

      const record: TeacherLinkRunRecord = {
        runId: bundle.runId,
        versionHash: bundle.versionHash,
        classId: bundle.envelope.classId,
        className: cleanClass,
        sections,
        quizId: bundle.envelope.quizId,
        quizTitle: cleanTitle,
        durationMinutes: mins,
        instantFeedback,
        allowRetry: false,
        questionCount: questions.length,
        createdAtSec: bundle.createdAtSec,
        verifyKey: bundle.verifyKey,
        resultSecret: bundle.resultSecret,
        shareUrl,
        hashFragment: bundle.hashFragment,
        status: "waiting",
        roster: [],
        duplicates: [],
      };

      await persistRun(record);
      setActiveRunId(record.runId);
      setUploadReport([]);

      // Register run metadata on server if online (questions stay encrypted client-side only)
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          await fetch(`/api/run/${encodeURIComponent(record.runId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              versionHash: record.versionHash,
              classId: record.classId,
              className: record.className,
              quizId: record.quizId,
              title: record.quizTitle,
              durationMinutes: record.durationMinutes,
              createdAtSec: record.createdAtSec,
            }),
          });
        } catch {
          // Offline mode still creates valid standalone links + Start Codes
        }
      }

      setBanner({
        ok: true,
        text: `Created Quiz Link for "${cleanTitle}" (${questions.length} items). Share the link or QR below.`,
      });
    } catch (err) {
      setBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to create Quiz Link.",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleStartRun = async () => {
    if (!activeRun || activeRun.status !== "waiting") return;
    const startedAtSec = Math.floor(Date.now() / 1000);
    const durationSec = Math.max(3, Math.round(activeRun.durationMinutes * 60));
    const endsAtSec = startedAtSec + durationSec;

    const { formattedCode, startQr } = await generateSignedStartCode({
      runId: activeRun.runId,
      startEpochSec: startedAtSec,
      createdAtSec: activeRun.createdAtSec,
      verifyKey: activeRun.verifyKey,
    });

    const updated: TeacherLinkRunRecord = {
      ...activeRun,
      status: "running",
      startedAtSec,
      endsAtSec,
      startCode: formattedCode,
      startQr,
    };
    await persistRun(updated);
    setNowSec(startedAtSec);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        await fetch(`/api/run/${encodeURIComponent(activeRun.runId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            versionHash: activeRun.versionHash,
            classId: activeRun.classId,
            className: activeRun.className,
            quizId: activeRun.quizId,
            title: activeRun.quizTitle,
            durationMinutes: activeRun.durationMinutes,
            createdAtSec: activeRun.createdAtSec,
            startedAtSec,
            startCode: formattedCode,
            startQr,
          }),
        });
      } catch {
        // Offline Start Code still unlocks student devices deterministically
      }
    }

    setBanner({
      ok: true,
      text: `Quiz STARTED! Share Start Code ${formattedCode} for offline students.`,
    });
  };

  const handleEndRun = async () => {
    if (!activeRun || activeRun.status !== "running") return;
    const endedAtSec = Math.floor(Date.now() / 1000);
    const updated: TeacherLinkRunRecord = {
      ...activeRun,
      status: "ended",
      endedAtSec,
    };
    await persistRun(updated);
    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        await fetch(`/api/run/${encodeURIComponent(activeRun.runId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end" }),
        });
      } catch {
        // Ignore network failure cleanly
      }
    }
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeRun) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const payloads = await Promise.all(
      files.map(async (f) => ({
        fileName: f.name,
        rawText: await f.text(),
      }))
    );

    const { updatedRun, report } = await processUploadedResultFiles(activeRun, payloads);
    await persistRun(updatedRun);
    setUploadReport(report);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  const handleVerifyResultQrText = async () => {
    if (!activeRun || !qrVerifyInput.trim()) return;
    const res = await verifyLinkResultQr(qrVerifyInput, {
      runId: activeRun.runId,
      resultSecret: activeRun.resultSecret,
    });
    if (res.valid) {
      setQrVerifyResult(
        `VALID QR: ${res.displayName} scored ${res.score}/${res.maxScore} (Attempt ${res.attemptPrefix}...)`
      );
    } else {
      setQrVerifyResult(`INVALID: ${res.reason}`);
    }
  };

  const handleSaveRename = async (attemptId: string) => {
    if (!activeRun) return;
    const updated = renameOrMergeRosterStudent(activeRun, attemptId, editName, editSection);
    await persistRun(updated);
    setEditingAttemptId(null);
  };

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Fallback ignored
    }
  };

  const runRemainingSec =
    activeRun?.status === "running" && activeRun.endsAtSec
      ? Math.max(0, activeRun.endsAtSec - nowSec)
      : 0;

  return (
    <div className="space-y-5">
      {banner && (
        <div
          className={`p-3 rounded-xl text-xs sm:text-sm font-semibold ${
            banner.ok
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Create Quiz Link Card */}
      <form onSubmit={handleCreateQuizLink} className="qg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-base">Create Shareable Quiz Link (Online + Offline Ready)</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              Packs questions &amp; per-run encryption inside one <code>/q/...</code> URL. Zero student accounts needed.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
            {questions.length} Question(s)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="link-preset-select" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
              Quiz Template
            </label>
            <select
              id="link-preset-select"
              className="qg-input text-xs"
              value={selectedPresetId}
              onChange={(e) => handleSelectSource(e.target.value)}
            >
              {GRADE10_BLUEPRINTS.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  G10: {bp.title} ({bp.items.length}q)
                </option>
              ))}
              {quizzes.map((q) => (
                <option key={q.id} value={q.id}>
                  Custom: {q.title} ({q.questions.length}q)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="link-quiz-title" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
              Quiz Title
            </label>
            <input
              id="link-quiz-title"
              className="qg-input text-xs"
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="link-class-name" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
              Class Name
            </label>
            <input
              id="link-class-name"
              className="qg-input text-xs"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="link-duration-mins" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
              Duration (minutes)
            </label>
            <input
              id="link-duration-mins"
              type="number"
              step="any"
              min="0.05"
              max="180"
              className="qg-input text-xs"
              value={durationMins}
              onChange={(e) => setDurationMins(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <div>
            <label htmlFor="link-sections" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
              Sections (comma-separated, optional — blank lets students type freely)
            </label>
            <input
              id="link-sections"
              className="qg-input text-xs"
              placeholder="e.g. 10-Rizal, 10-Bonifacio"
              value={sectionsRaw}
              onChange={(e) => setSectionsRaw(e.target.value)}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-semibold pt-4">
            <input
              type="checkbox"
              checked={instantFeedback}
              onChange={(e) => setInstantFeedback(e.target.checked)}
            />
            <span>Reveal instant feedback after each answer (locked before quiz starts)</span>
          </label>
        </div>

        {/* Compact inline question list / quick adder */}
        <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <summary className="text-xs font-bold cursor-pointer select-none">
            Review or Add Questions ({questions.length} included)
          </summary>
          <div className="mt-3 space-y-2.5">
            {questions.map((q, idx) => (
              <div key={q.id} className="flex items-center justify-between gap-2 text-xs bg-[var(--surface)] p-2 rounded-lg border border-[var(--border)]">
                <span className="truncate">
                  <strong>Q{idx + 1}.</strong> {q.prompt}
                </span>
                <button
                  type="button"
                  onClick={() => setQuestions((prev) => prev.filter((item) => item.id !== q.id))}
                  className="text-[var(--danger)] p-1 shrink-0"
                  title="Remove question"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="pt-2 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="qg-input text-xs sm:col-span-2"
                placeholder="Add quick question prompt..."
                value={newQPrompt}
                onChange={(e) => setNewQPrompt(e.target.value)}
              />
              {newQOpts.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="link-newq-correct"
                    checked={newQCorrect === idx}
                    onChange={() => setNewQCorrect(idx)}
                  />
                  <input
                    className="qg-input text-xs"
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                    value={opt}
                    onChange={(e) =>
                      setNewQOpts((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddInlineQuestion}
                className="qg-btn qg-btn-secondary text-xs sm:col-span-2"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Question to Link Bundle</span>
              </button>
            </div>
          </div>
        </details>

        <button
          type="submit"
          disabled={creating}
          data-testid="create-quiz-link-btn"
          className="qg-btn qg-btn-primary"
        >
          <Link2 className="w-4 h-4" />
          <span>{creating ? "Encrypting Quiz Link..." : "Create Quiz Link"}</span>
        </button>
      </form>

      {/* Run Switcher */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {runs.map((r) => (
            <button
              key={r.runId}
              type="button"
              onClick={() => setActiveRunId(r.runId)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                activeRun?.runId === r.runId
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {r.quizTitle} · {r.runId} ({r.status})
            </button>
          ))}
        </div>
      )}

      {/* Active Link Run Control & Roster */}
      {activeRun && (
        <div className="qg-card p-5 space-y-5 border-l-4 border-l-[var(--primary)]">
          {/* Shareable URL & QR */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--primary)]">
                  Run {activeRun.runId} · Version {activeRun.versionHash}
                </span>
                <h3 className="text-lg font-bold">{activeRun.quizTitle}</h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  {activeRun.className} · {activeRun.durationMinutes} min · {activeRun.questionCount} questions
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--surface-subtle)] border border-[var(--border)]">
                  Status: {activeRun.status.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={syncActiveRunOnline}
                  className="qg-btn qg-btn-secondary text-xs"
                  title="Refresh online waiting room & submissions"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sync Now</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                readOnly
                data-testid="generated-quiz-link"
                value={activeRun.shareUrl}
                className="qg-input text-xs font-mono flex-1"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={() => copyValue("link", activeRun.shareUrl)}
                className="qg-btn qg-btn-primary text-xs shrink-0"
              >
                {copiedKey === "link" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedKey === "link" ? "Copied" : "Copy Link"}</span>
              </button>
              <a
                href={activeRun.shareUrl}
                target="_blank"
                rel="noreferrer"
                className="qg-btn qg-btn-secondary text-xs shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open</span>
              </a>
              <button
                type="button"
                onClick={() => setShowLinkQr((v) => !v)}
                className="qg-btn qg-btn-secondary text-xs shrink-0"
              >
                <QrCode className="w-4 h-4" />
                <span>{showLinkQr ? "Hide Link QR" : "Show Link QR"}</span>
              </button>
            </div>

            {showLinkQr && (
              <div className="max-w-xs">
                <QrCanvas
                  value={activeRun.shareUrl}
                  title={activeRun.quizTitle}
                  subtitle={`Scan to open Run ${activeRun.runId}`}
                  filename={`quizgate-link-${activeRun.runId}.png`}
                />
              </div>
            )}
          </div>

          {/* BIG START BUTTON + Timer + Start Code */}
          <div className="p-4 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="teacher-start-btn"
                  disabled={activeRun.status !== "waiting"}
                  onClick={handleStartRun}
                  className="qg-btn bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-3 text-sm font-bold"
                >
                  <Play className="w-4 h-4" />
                  <span>
                    {activeRun.status === "waiting"
                      ? "START QUIZ"
                      : activeRun.status === "running"
                        ? "QUIZ RUNNING"
                        : "RUN ENDED"}
                  </span>
                </button>

                {activeRun.status === "running" && (
                  <button
                    type="button"
                    onClick={handleEndRun}
                    className="qg-btn qg-btn-secondary text-xs text-[var(--danger)]"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>End Run</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <Users className="w-4 h-4 text-[var(--primary)]" />
                  <span>Joined: {activeRun.roster.length}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />
                  <span>Submitted: {activeRun.roster.filter((r) => r.status === "submitted").length}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] font-mono text-sm font-bold">
                  <Clock className="w-4 h-4" />
                  <span>{formatCountdown(runRemainingSec)}</span>
                </span>
              </div>
            </div>

            {activeRun.startCode && (
              <div className="pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--ink-muted)]">
                    Signed Offline Start Code (write on board or share QR — same deadline for all devices)
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid="teacher-start-code"
                      className="text-2xl font-mono font-extrabold tracking-widest text-[var(--primary)]"
                    >
                      {activeRun.startCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyValue("startCode", activeRun.startCode!)}
                      className="qg-btn qg-btn-secondary text-xs"
                    >
                      {copiedKey === "startCode" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copy</span>
                    </button>
                    {activeRun.startQr && (
                      <button
                        type="button"
                        onClick={() => setShowStartQr((v) => !v)}
                        className="qg-btn qg-btn-secondary text-xs"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>{showStartQr ? "Hide QR" : "Start QR"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {showStartQr && activeRun.startQr && (
                  <div className="w-44 shrink-0">
                    <QrCanvas
                      value={activeRun.startQr}
                      title="Start Code QR"
                      subtitle={activeRun.startCode}
                      filename={`quizgate-start-${activeRun.runId}.png`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Multi-file Offline .qres.json Collector + QR Backup */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-dashed border-[var(--border)] space-y-2.5">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[var(--primary)]" />
                <h4 className="font-bold text-sm">Record Student .qres.json Files (Offline Ready)</h4>
              </div>
              <p className="text-xs text-[var(--ink-muted)]">
                Select one or many submitted <code>.qres.json</code> files from students. Verified and merged into the roster below even offline.
              </p>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept=".json,.qres.json"
                data-testid="teacher-upload-qres"
                onChange={handleUploadFiles}
                className="block w-full text-xs"
              />
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] space-y-2.5">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-[var(--primary)]" />
                <h4 className="font-bold text-sm">Quick Check Result QR String</h4>
              </div>
              <div className="flex gap-2">
                <input
                  className="qg-input text-xs font-mono"
                  placeholder="Paste QG3R.* QR text..."
                  value={qrVerifyInput}
                  onChange={(e) => setQrVerifyInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleVerifyResultQrText}
                  className="qg-btn qg-btn-secondary text-xs shrink-0"
                >
                  Verify
                </button>
              </div>
              {qrVerifyResult && (
                <p className="text-xs font-semibold text-[var(--primary)]">{qrVerifyResult}</p>
              )}
            </div>
          </div>

          {/* Per-file upload verification log */}
          {uploadReport.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                Upload Verification Report ({uploadReport.length} file(s))
              </h4>
              {uploadReport.map((item, idx) => (
                <div
                  key={`${item.fileName}-${idx}`}
                  className={`p-2.5 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2 ${
                    item.status === "accepted"
                      ? "bg-[var(--success-soft)] text-[var(--success)]"
                      : item.status === "duplicate"
                        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]"
                  }`}
                >
                  <span>
                    <strong>[{item.status.toUpperCase()}]</strong> {item.fileName} — {item.message}
                  </span>
                  {item.scoreLabel && <span className="font-mono font-bold">{item.scoreLabel}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Roster & CSV Export */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold text-sm">
                Class Roster &amp; Submissions ({activeRun.roster.length})
              </h4>
              <button
                type="button"
                data-testid="export-link-csv-btn"
                disabled={activeRun.roster.length === 0}
                onClick={() => exportLinkRunCsv(activeRun)}
                className="qg-btn qg-btn-secondary text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Class CSV</span>
              </button>
            </div>

            {activeRun.roster.length === 0 ? (
              <p className="text-xs text-[var(--ink-muted)]">
                No students joined or uploaded yet. Share the link above or upload <code>.qres.json</code> files.
              </p>
            ) : (
              <div className="overflow-x-auto border border-[var(--border)] rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)]">
                    <tr>
                      <th className="p-2.5 font-bold">Student</th>
                      <th className="p-2.5 font-bold">Section</th>
                      <th className="p-2.5 font-bold">Status</th>
                      <th className="p-2.5 font-bold">Score</th>
                      <th className="p-2.5 font-bold">Flags &amp; Source</th>
                      <th className="p-2.5 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {activeRun.roster.map((row) => (
                      <tr key={row.attemptId}>
                        <td className="p-2.5 font-semibold">
                          {editingAttemptId === row.attemptId ? (
                            <input
                              className="qg-input text-xs py-1"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                            />
                          ) : (
                            row.studentName
                          )}
                        </td>
                        <td className="p-2.5">
                          {editingAttemptId === row.attemptId ? (
                            <input
                              className="qg-input text-xs py-1"
                              value={editSection}
                              onChange={(e) => setEditSection(e.target.value)}
                            />
                          ) : (
                            row.section
                          )}
                        </td>
                        <td className="p-2.5">
                          {row.status === "submitted" ? (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--success-soft)] text-[var(--success)] font-bold">
                              Submitted
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--warning-soft)] text-[var(--warning)] font-bold">
                              No submission
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono font-bold">
                          {row.status === "submitted" ? `${row.score}/${row.maxScore}` : "—"}
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-wrap gap-1">
                            <span className="px-1.5 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--border)]">
                              {row.source === "online_submit"
                                ? "Online"
                                : row.source === "offline_file"
                                  ? "Offline File"
                                  : "Joined Online"}
                            </span>
                            {row.submittedOffline && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--warning-soft)] text-[var(--warning)] font-semibold">
                                submittedOffline
                              </span>
                            )}
                            {row.clockTampered && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--danger-soft)] text-[var(--danger)] font-bold">
                                clockTampered
                              </span>
                            )}
                            {row.lateAfterEnd && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--danger-soft)] text-[var(--danger)] font-bold">
                                lateAfterEnd
                              </span>
                            )}
                            {row.beforeStart && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--danger-soft)] text-[var(--danger)] font-bold">
                                beforeStart
                              </span>
                            )}
                            {row.sharedDeviceWith && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--warning-soft)] text-[var(--warning)] font-bold inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                sharedDevice ({row.sharedDeviceWith})
                              </span>
                            )}
                            {row.identicalAnswersWith && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--warning-soft)] text-[var(--warning)] font-bold inline-flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3" />
                                identicalAnswers ({row.identicalAnswersWith})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5">
                          {editingAttemptId === row.attemptId ? (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveRename(row.attemptId)}
                                className="px-2 py-1 rounded bg-[var(--primary)] text-white font-semibold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingAttemptId(null)}
                                className="px-2 py-1 rounded border border-[var(--border)]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAttemptId(row.attemptId);
                                setEditName(row.studentName);
                                setEditSection(row.section);
                              }}
                              className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline font-semibold"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit / Merge</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Duplicate Attempts Review */}
          {activeRun.duplicates.length > 0 && (
            <div className="p-4 rounded-xl bg-[var(--warning-soft)] border border-[var(--warning)]/30 space-y-2">
              <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--warning)]">
                Duplicate Attempts For Review ({activeRun.duplicates.length})
              </h4>
              {activeRun.duplicates.map((dup) => (
                <div key={dup.attemptId} className="text-xs flex flex-wrap justify-between gap-2">
                  <span>
                    <strong>{dup.studentName}</strong> ({dup.section}) · Attempt {dup.attemptId.slice(0, 8)} — {dup.reason}
                  </span>
                  <span className="font-mono font-bold">
                    {dup.score}/{dup.maxScore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
