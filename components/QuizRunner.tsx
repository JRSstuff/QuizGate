"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  Share2,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  buildOfflineResultQr,
  decryptQuizPack,
  encryptResultPacket,
  sha256Hex,
  syncSaltedHash,
  type OfflineResultPlainPayload,
  type StudentSubmissionAnswer,
} from "@/lib/crypto/quizVault";
import {
  offlineDb,
  type ActiveSession,
  type LocalAttemptRecord,
} from "@/lib/offline/storage";
import { flushStudentSyncQueue } from "@/lib/offline/syncEngine";
import {
  calculateRemainingSeconds,
  formatCountdown,
  synchronizeServerClock,
} from "@/lib/timer/clockSync";
import { MathText } from "./MathText";
import { QrCanvas } from "./QrCanvas";

interface PlayQuestion {
  id: string;
  prompt: string;
  options: string[];
  points: number;
  feedbackSalt?: string;
  correctHash?: string;
  correctIndex?: number; // present only inside decrypted local vault
  explanation?: string;
}

interface QuizRunnerProps {
  targetId: string;
}

export function QuizRunner({ targetId }: QuizRunnerProps) {
  const decodedId = decodeURIComponent(targetId);
  const isRemoteRun = decodedId.startsWith("run:");
  const actualId = isRemoteRun ? decodedId.slice(4) : decodedId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");

  const [quizTitle, setQuizTitle] = useState("");
  const [instantFeedback, setInstantFeedback] = useState(false);
  const [allowRetry, setAllowRetry] = useState(false);
  const [questions, setQuestions] = useState<PlayQuestion[]>([]);

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [answersMap, setAnswersMap] = useState<Record<string, StudentSubmissionAnswer>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  // Timer & Connectivity
  const [isOnline, setIsOnline] = useState(true);
  const [endsAtIso, setEndsAtIso] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [remainingSecs, setRemainingSecs] = useState<number | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Instant Feedback Modal & Finish Screen
  const [wrongFeedback, setWrongFeedback] = useState<{
    prompt: string;
    explanation?: string;
  } | null>(null);
  const [finishedRecord, setFinishedRecord] = useState<LocalAttemptRecord | null>(null);

  const loadQuiz = async (passcode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const sess = (await offlineDb.session.get("active")) || null;
      setSession(sess?.role === "student" ? sess : null);

      if (isRemoteRun) {
        if (!sess || sess.role !== "student" || !sess.sessionToken) {
          throw new Error("Sign in as a student to access a live Supabase quiz run.");
        }

        const clock = await synchronizeServerClock();
        setOffsetMs(clock.offsetMs);

        const res = await fetch("/api/student/quiz-state", {
          headers: { Authorization: `Bearer ${sess.sessionToken}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load remote quiz.");
        if (!data.run || data.run.id !== actualId) {
          throw new Error("Quiz run not found or inactive.");
        }

        const loadedQuestions: PlayQuestion[] = (data.questions || []).map(
          (q: {
            id: string;
            question_text: string;
            options: { text?: string }[] | string[];
            points: number;
            feedback_salt?: string;
            correct_hash?: string;
          }) => ({
            id: q.id,
            prompt: q.question_text,
            options: Array.isArray(q.options)
              ? q.options.map((o) => (typeof o === "string" ? o : o.text || ""))
              : [],
            points: q.points || 1,
            feedbackSalt: q.feedback_salt,
            correctHash: q.correct_hash,
          })
        );

        setQuizTitle(data.quiz.title);
        setInstantFeedback(Boolean(data.quiz.instant_feedback));
        setAllowRetry(Boolean(data.quiz.allow_retry));
        setEndsAtIso(data.run.ends_at);
        setQuestions(loadedQuestions);
        const attId = data.attempt?.id || crypto.randomUUID();
        setAttemptId(attId);

        const initialAns: Record<string, StudentSubmissionAnswer> = {};
        for (const a of data.answers || []) {
          initialAns[a.question_id] = {
            questionId: a.question_id,
            selectedIndex: a.selected_index,
            isCorrect: Boolean(a.is_correct),
            answeredAt: a.answered_at,
            lateSync: Boolean(a.late_sync),
          };
        }
        setAnswersMap(initialAns);

        if (data.attempt?.status === "submitted") {
          const finRes = await fetch("/api/student/quiz-finish", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sess.sessionToken}`,
            },
            body: JSON.stringify({ runId: actualId }),
          });
          const finJson = await finRes.json();
          setFinishedRecord({
            id: attId,
            packOrRunId: actualId,
            title: data.quiz.title,
            studentId: sess.userId,
            studentName: sess.name,
            studentNo: sess.identifier,
            status: "submitted",
            score: data.attempt.score,
            maxScore: data.attempt.max_score,
            startedAt: data.attempt.started_at,
            submittedAt: data.attempt.submitted_at,
            lateCount: 0,
            resultQr: finJson.result_code,
            syncStatus: "synced",
          });
        }
      } else {
        // Offline Encrypted Quiz Pack
        const stored = await offlineDb.importedPacks.get(actualId);
        if (!stored) {
          throw new Error("Encrypted quiz pack not found on this device.");
        }
        if (stored.pack.lockedWithPasscode && !passcode) {
          setQuizTitle(stored.pack.title);
          setNeedsPasscode(true);
          setLoading(false);
          return;
        }

        const plain = await decryptQuizPack(stored.pack, passcode);
        setNeedsPasscode(false);
        setQuizTitle(plain.title);
        setInstantFeedback(plain.instantFeedback);
        setAllowRetry(plain.allowRetry);

        const loaded: PlayQuestion[] = plain.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: q.options,
          points: q.points,
          feedbackSalt: q.feedbackSalt,
          correctHash: q.correctHash,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        }));
        setQuestions(loaded);

        const attId = `att_${actualId}_${sess?.userId || "guest"}`;
        setAttemptId(attId);

        const prev = await offlineDb.attempts.get(attId);
        if (prev && prev.status === "submitted") {
          setFinishedRecord(prev);
          setLoading(false);
          return;
        }

        const startedIso = prev?.startedAt || new Date().toISOString();
        const endDate = new Date(
          Date.parse(startedIso) + plain.durationMinutes * 60 * 1000
        ).toISOString();
        setEndsAtIso(endDate);

        if (!prev) {
          const maxInit = loaded.reduce((acc, q) => acc + q.points, 0);
          await offlineDb.attempts.put({
            id: attId,
            packOrRunId: actualId,
            title: plain.title,
            studentId: sess?.userId || "guest",
            studentName: sess?.name || "Offline Student",
            studentNo: sess?.identifier || "OFFLINE",
            status: "in_progress",
            score: 0,
            maxScore: maxInit,
            startedAt: startedIso,
            lateCount: 0,
            syncStatus: "offline_only",
          });
        }

        if (prev && prev.status === "in_progress" && prev.payload) {
          const restored: Record<string, StudentSubmissionAnswer> = {};
          for (const a of prev.payload.answers) {
            restored[a.questionId] = a;
          }
          setAnswersMap(restored);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quiz.");
    } finally {
      setLoading(false);
    }
  };

  const flushSyncQueue = async () => {
    if (!isRemoteRun) return;
    const pendingBefore = await offlineDb.answerQueue
      .where("syncStatus")
      .equals("pending")
      .and((x) => x.packOrRunId === actualId)
      .count();
    setPendingSyncCount(pendingBefore);

    const result = await flushStudentSyncQueue(actualId);
    if (result.revoked) {
      setError("Signed in on another device. Scan your Student QR pass again to resume here.");
      return;
    }

    const pendingAfter = await offlineDb.answerQueue
      .where("syncStatus")
      .equals("pending")
      .and((x) => x.packOrRunId === actualId)
      .count();
    setPendingSyncCount(pendingAfter);

    const updatedAtt = await offlineDb.attempts.get(attemptId);
    if (updatedAtt && updatedAtt.syncStatus === "synced" && updatedAtt.resultQr) {
      setFinishedRecord(updatedAtt);
    }
  };

  useEffect(() => {
    setIsOnline(navigator.onLine);
    loadQuiz();

    const handleOnline = () => {
      setIsOnline(true);
      flushSyncQueue();
    };
    const handleOffline = () => setIsOnline(false);
    const handleFocusSync = () => {
      if (navigator.onLine && !document.hidden) {
        flushSyncQueue();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocusSync);
    document.addEventListener("visibilitychange", handleFocusSync);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocusSync);
      document.removeEventListener("visibilitychange", handleFocusSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedId]);

  useEffect(() => {
    if (!endsAtIso || finishedRecord) return;
    const tick = () => {
      const secs = calculateRemainingSeconds(endsAtIso, offsetMs);
      setRemainingSecs(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAtIso, offsetMs, finishedRecord]);

  // Poll remote run state every 15s to detect early teacher End Run or cross-device handover
  useEffect(() => {
    if (!isRemoteRun || !session?.sessionToken || finishedRecord) return;
    const id = setInterval(async () => {
      if (!navigator.onLine || !session.sessionToken) return;
      try {
        const res = await fetch("/api/student/quiz-state", {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
        });
        if (res.status === 401) {
          setError("Signed in on another device. Scan your Student QR pass to resume.");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.run?.ends_at) setEndsAtIso(data.run.ends_at);
          if (data.run?.status === "ended" && !finishedRecord) {
            await handleFinishQuiz();
          }
        }
      } catch {
        // Ignore transient offline error
      }
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRemoteRun, session?.sessionToken, finishedRecord]);

  const handleSelectOption = async (optionIdx: number) => {
    const q = questions[currentIdx];
    if (!q || finishedRecord) return;
    if (remainingSecs !== null && remainingSecs <= 0) return;

    const already = answersMap[q.id];
    if (already && !allowRetry) return;

    // Corrected client timestamp using synchronized offset
    const answeredAt = new Date(Date.now() + offsetMs).toISOString();
    let isCorrect = false;
    if (typeof q.correctIndex === "number") {
      isCorrect = q.correctIndex === optionIdx;
    } else if (q.feedbackSalt && q.correctHash) {
      isCorrect =
        q.correctHash.length === 64
          ? (await sha256Hex(`${q.id}:${optionIdx}:${q.feedbackSalt}`)) === q.correctHash
          : syncSaltedHash(optionIdx, `${q.id}:${q.feedbackSalt}`) === q.correctHash;
    }

    const answerRecord: StudentSubmissionAnswer = {
      questionId: q.id,
      selectedIndex: optionIdx,
      isCorrect,
      answeredAt,
      lateSync: false,
    };

    const nextMap = { ...answersMap, [q.id]: answerRecord };
    setAnswersMap(nextMap);

    // Show wrong-answer modal immediately on tap without blocking on IndexedDB write completion
    if (instantFeedback && !isCorrect) {
      setWrongFeedback({ prompt: q.prompt, explanation: q.explanation });
    }

    // 1. Write immediately to IndexedDB (never block UI)
    await offlineDb.answerQueue.add({
      attemptId,
      packOrRunId: actualId,
      questionId: q.id,
      selectedIndex: optionIdx,
      isCorrect,
      answeredAt,
      syncStatus: isRemoteRun ? "pending" : "offline_only",
    });

    if (!isRemoteRun) {
      const stuName = session?.name || "Offline Student";
      const stuNo = session?.identifier || "OFFLINE";
      const answersArr = Object.values(nextMap);
      const scoreNow = answersArr.reduce((acc, a) => {
        const qMatch = questions.find((qq) => qq.id === a.questionId);
        return acc + (a.isCorrect ? qMatch?.points || 1 : 0);
      }, 0);
      const maxNow = questions.reduce((acc, qq) => acc + qq.points, 0);

      await offlineDb.attempts.put({
        id: attemptId,
        packOrRunId: actualId,
        title: quizTitle,
        studentId: session?.userId || "guest",
        studentName: stuName,
        studentNo: stuNo,
        status: "in_progress",
        score: scoreNow,
        maxScore: maxNow,
        startedAt: new Date().toISOString(),
        lateCount: 0,
        syncStatus: "offline_only",
        payload: {
          id: attemptId,
          packId: actualId,
          packTitle: quizTitle,
          studentId: session?.userId || "guest",
          studentName: stuName,
          studentNo: stuNo,
          score: scoreNow,
          maxScore: maxNow,
          lateCount: 0,
          submittedAt: "",
          answers: answersArr,
        },
      });
    } else {
      await flushSyncQueue();
    }
  };

  const handleFinishQuiz = async () => {
    const answersArr = Object.values(answersMap);
    const maxScore = questions.reduce((acc, q) => acc + q.points, 0);
    const score = answersArr.reduce((acc, a) => {
      const q = questions.find((qq) => qq.id === a.questionId);
      return acc + (a.isCorrect ? q?.points || 1 : 0);
    }, 0);
    const submittedAt = new Date().toISOString();
    const stuName = session?.name || "Offline Student";
    const stuNo = session?.identifier || "OFFLINE";

    if (isRemoteRun && session?.sessionToken && navigator.onLine) {
      try {
        await flushSyncQueue();
        const res = await fetch("/api/student/quiz-finish", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ runId: actualId }),
        });
        const data = await res.json();
        if (res.ok && data.result_code) {
          const rec: LocalAttemptRecord = {
            id: attemptId,
            packOrRunId: actualId,
            title: quizTitle,
            studentId: session.userId,
            studentName: stuName,
            studentNo: stuNo,
            status: "submitted",
            score: data.score ?? score,
            maxScore: data.max_score ?? maxScore,
            startedAt: submittedAt,
            submittedAt: data.submitted_at || submittedAt,
            lateCount: 0,
            resultQr: data.result_code,
            syncStatus: "synced",
          };
          await offlineDb.attempts.put(rec);
          setFinishedRecord(rec);
          return;
        }
      } catch {
        // Fallback below if offline
      }
    }

    const resultQr = await buildOfflineResultQr({
      packId: actualId,
      studentNo: stuNo,
      studentName: stuName,
      score,
      maxScore,
      lateCount: 0,
    });

    const plainPayload: OfflineResultPlainPayload = {
      id: attemptId,
      packId: actualId,
      packTitle: quizTitle,
      studentId: session?.userId || "guest",
      studentName: stuName,
      studentNo: stuNo,
      classCode: session?.classCode,
      score,
      maxScore,
      lateCount: 0,
      submittedAt,
      answers: answersArr,
    };

    const rec: LocalAttemptRecord = {
      id: attemptId,
      packOrRunId: actualId,
      title: quizTitle,
      studentId: session?.userId || "guest",
      studentName: stuName,
      studentNo: stuNo,
      status: "submitted",
      score,
      maxScore,
      startedAt: submittedAt,
      submittedAt,
      lateCount: 0,
      resultQr,
      syncStatus: isRemoteRun ? "pending_sync" : "offline_only",
      payload: plainPayload,
    };

    await offlineDb.attempts.put(rec);
    setFinishedRecord(rec);
  };

  const handleDownloadResultFile = async () => {
    if (!finishedRecord?.payload) return;
    const encrypted = await encryptResultPacket(finishedRecord.payload);
    const json = JSON.stringify(encrypted, null, 2);
    const safeNo = finishedRecord.studentNo.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Result_${safeNo}_${finishedRecord.score}of${finishedRecord.maxScore}.qres.json`;

    try {
      const file = new File([json], filename, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${finishedRecord.title} Submission`,
          text: `${finishedRecord.studentName}: ${finishedRecord.score}/${finishedRecord.maxScore}`,
        });
        return;
      }
    } catch {
      // Fallback to download
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto qg-card p-6 text-center text-sm text-[var(--ink-muted)]">
        Decrypting quiz questions...
      </div>
    );
  }

  if (needsPasscode) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadQuiz(passcodeInput);
        }}
        className="max-w-md mx-auto qg-card p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-[var(--warning)]">
          <Lock className="w-5 h-5" />
          <h2 className="font-bold text-lg">Passcode Required</h2>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">
          Enter the teacher&apos;s quiz passcode to decrypt &ldquo;{quizTitle}&rdquo;.
        </p>
        {error && <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>}
        <input
          type="password"
          className="qg-input"
          placeholder="Passcode"
          value={passcodeInput}
          onChange={(e) => setPasscodeInput(e.target.value)}
          required
        />
        <div className="flex gap-2">
          <Link href="/student" className="qg-btn qg-btn-secondary">
            Back
          </Link>
          <button type="submit" className="qg-btn qg-btn-primary flex-1">
            Unlock &amp; Start
          </button>
        </div>
      </form>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto qg-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-[var(--danger)]">
          <AlertCircle className="w-5 h-5" />
          <h2 className="font-bold text-lg">Cannot Load Quiz</h2>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">{error}</p>
        <Link href="/student" className="qg-btn qg-btn-secondary">
          Return to Student Workspace
        </Link>
      </div>
    );
  }

  if (finishedRecord) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="qg-card p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[var(--success-soft)] text-[var(--success)] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{finishedRecord.title}</h1>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              {finishedRecord.studentName} ({finishedRecord.studentNo})
            </p>
          </div>

          <div className="py-3 px-6 rounded-2xl bg-[var(--surface-subtle)] border border-[var(--border)] inline-block">
            <div className="text-xs uppercase font-bold text-[var(--ink-muted)]">Score</div>
            <div className="text-4xl font-extrabold tabular-nums text-[var(--primary)]">
              {finishedRecord.score} / {finishedRecord.maxScore}
            </div>
          </div>

          {finishedRecord.syncStatus === "pending_sync" && (
            <div className="p-3 rounded-xl bg-[var(--warning-soft)] text-[var(--warning)] text-xs font-semibold text-left">
              Waiting to Sync: Answers are saved offline on this phone. Reconnect online and QuizGate will automatically sync your score and issue your server QR.
            </div>
          )}

          {finishedRecord.resultQr && (
            <div className="pt-2">
              <QrCanvas
                value={finishedRecord.resultQr}
                title="Verified Result QR Pass"
                subtitle="Present this QR to your teacher's scanner"
                filename={`result-${finishedRecord.studentNo}.png`}
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            {finishedRecord.payload && (
              <button
                type="button"
                onClick={handleDownloadResultFile}
                className="qg-btn qg-btn-primary flex-1"
              >
                <Share2 className="w-4 h-4" />
                <span>Export .qres.json Offline File</span>
              </button>
            )}
            <Link href="/student" className="qg-btn qg-btn-secondary flex-1">
              Done · Back to Workspace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIdx];
  if (!currentQ) return null;

  const picked = answersMap[currentQ.id];
  const answeredCount = Object.keys(answersMap).length;
  const isExpired = remainingSecs !== null && remainingSecs <= 0;
  const isLockedQuestion = Boolean((picked && !allowRetry) || isExpired);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Runner Status Header */}
      <div className="qg-card p-3.5 sm:p-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href="/student"
              className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Exit</span>
            </Link>
            <span className="text-xs font-bold text-[var(--primary)] truncate">
              {quizTitle}
            </span>
          </div>
          <div className="text-xs text-[var(--ink-muted)] mt-0.5 tabular-nums">
            Question {currentIdx + 1} of {questions.length} · {answeredCount} answered
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
              isOnline
                ? "bg-[var(--success-soft)] text-[var(--success)]"
                : "bg-[var(--warning-soft)] text-[var(--warning)]"
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>
              {isOnline
                ? pendingSyncCount > 0
                  ? `${pendingSyncCount} Syncing`
                  : "Synced"
                : "Saved Offline"}
            </span>
          </span>

          {remainingSecs !== null && (
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-mono font-bold px-3 py-1 rounded-full tabular-nums ${
                remainingSecs < 60
                  ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                  : "bg-[var(--surface-subtle)] border border-[var(--border)]"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{formatCountdown(remainingSecs)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Progress Strip */}
      <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full bg-[var(--primary)] transition-all duration-300"
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question Card */}
      <div className="qg-card p-5 sm:p-6 space-y-5">
        <h2 className="text-lg sm:text-xl font-bold leading-snug">
          <MathText text={currentQ.prompt} />
        </h2>

        <div className="space-y-2.5">
          {currentQ.options.map((opt, idx) => {
            const isSelected = picked?.selectedIndex === idx;
            const letter = String.fromCharCode(65 + idx);
            return (
              <button
                key={idx}
                type="button"
                disabled={isLockedQuestion && !isSelected}
                onClick={() => handleSelectOption(idx)}
                className={`w-full min-h-[54px] px-4 py-3 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                  isSelected
                    ? "bg-[var(--primary-soft)] border-[var(--primary)] ring-2 ring-[var(--primary)]"
                    : isLockedQuestion
                      ? "bg-[var(--surface-subtle)] border-[var(--border)] opacity-60 cursor-default"
                      : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--primary)]"
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                    isSelected
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--surface-subtle)] text-[var(--ink-muted)] border border-[var(--border)]"
                  }`}
                >
                  {letter}
                </span>
                <span className="text-sm sm:text-base font-medium">
                  <MathText text={opt} />
                </span>
              </button>
            );
          })}
        </div>

        {isExpired ? (
          <p className="text-xs text-[var(--danger)] font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>Time limit reached — finish and submit to generate your Result QR.</span>
          </p>
        ) : (
          isLockedQuestion && (
            <p className="text-xs text-[var(--ink-muted)] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Answer recorded in local storage. Retries are disabled for this quiz.</span>
            </p>
          )
        )}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={currentIdx === 0}
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          className="qg-btn qg-btn-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Previous</span>
        </button>

        {currentIdx + 1 < questions.length ? (
          <button
            type="button"
            onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
            className="qg-btn qg-btn-primary"
          >
            <span>Next Question</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinishQuiz}
            className="qg-btn qg-btn-primary bg-emerald-600 hover:bg-emerald-700"
          >
            <span>Finish &amp; Generate QR</span>
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Instant Feedback Wrong-Answer Modal */}
      {wrongFeedback && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="qg-card max-w-md w-full p-6 space-y-4 border-t-4 border-t-[var(--danger)]">
            <div className="flex items-center gap-2.5 text-[var(--danger)]">
              <XCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold">Incorrect Answer Recorded</h3>
            </div>
            <p className="text-sm text-[var(--ink-muted)]">
              Your answer was saved to your attempt record. Review the question or continue to the
              next item.
            </p>
            {wrongFeedback.explanation && (
              <div className="p-3 rounded-xl bg-[var(--warning-soft)] text-xs leading-relaxed">
                <MathText text={wrongFeedback.explanation} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setWrongFeedback(null)}
              className="qg-btn qg-btn-primary w-full"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
