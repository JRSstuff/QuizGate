"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileKey2,
  Link2,
  Play,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Sparkles,
  Square,
  Upload,
  Users,
} from "lucide-react";
import {
  buildOfflineStudentIdQr,
  decryptResultPacket,
  encodeCompactQuizQr,
  encodeUtf8Base64Url,
  verifyOfflineOrFormatQr,
  type EncryptedResultPacket,
} from "@/lib/crypto/quizVault";
import { GRADE10_BLUEPRINTS } from "@/lib/data/grade10Math";
import {
  buildEncryptedPackFromTeacherQuiz,
  mergeLocalAttemptsIntoRun,
  upsertStudentScoreInRun,
} from "@/lib/offline/runRosterSync";
import {
  offlineDb,
  type ActiveSession,
  type LocalTeacherClass,
  type LocalTeacherQuiz,
  type LocalTeacherRun,
} from "@/lib/offline/storage";
import { calculateRemainingSeconds, formatCountdown } from "@/lib/timer/clockSync";
import { QrCanvas } from "./QrCanvas";
import { TeacherLinkPanel } from "./TeacherLinkPanel";

type TeacherTab = "links" | "classes" | "quizzes" | "print";

interface CloudRunResultRow {
  student_id: string;
  student_name: string;
  student_no: string;
  status: string;
  answered_count: number;
  score: number;
  max_score: number;
  late_answers: number;
  is_verified: boolean;
}

const DEMO_STUDENTS = [
  { name: "Dela Cruz, Juan", studentNo: "2026-0101" },
  { name: "Santos, Maria Clara", studentNo: "2026-0102" },
  { name: "Luna, Antonio M.", studentNo: "2026-0103" },
  { name: "Reyes, Ana Gabriela", studentNo: "2026-0104" },
  { name: "Mendoza, Jose Miguel", studentNo: "2026-0105" },
];

export function TeacherConsole() {
  const [tab, setTab] = useState<TeacherTab>("links");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [classes, setClasses] = useState<LocalTeacherClass[]>([]);
  const [quizzes, setQuizzes] = useState<LocalTeacherQuiz[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [serviceDbConfigured, setServiceDbConfigured] = useState<boolean | null>(null);

  // Create class & add students
  const [newClassName, setNewClassName] = useState("");
  const [stuName, setStuName] = useState("");
  const [stuNo, setStuNo] = useState("");
  const [csvBulk, setCsvBulk] = useState("");

  // Create custom quiz
  const [quizTitle, setQuizTitle] = useState("");
  const [quizMins, setQuizMins] = useState(15);
  const [instantFb, setInstantFb] = useState(true);
  const [allowRetry, setAllowRetry] = useState(false);
  const [qPrompt, setQPrompt] = useState("");
  const [qOpts, setQOpts] = useState<string[]>(["", "", "", ""]);
  const [qCorrectIdx, setQCorrectIdx] = useState(0);
  const [draftQuestions, setDraftQuestions] = useState<LocalTeacherQuiz["questions"]>([]);

  // Export & sharing
  const [exportPasscode, setExportPasscode] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Cloud Live Roster state
  const [activeCloudRunId, setActiveCloudRunId] = useState<string | null>(null);
  const [cloudRunResults, setCloudRunResults] = useState<CloudRunResultRow[]>([]);
  const [refreshingRoster, setRefreshingRoster] = useState(false);

  // Offline / Local Classroom Run + Score Collector state
  const [localRuns, setLocalRuns] = useState<LocalTeacherRun[]>([]);
  const [selectedLocalRunId, setSelectedLocalRunId] = useState<string | null>(null);
  const [localRunRemainingSecs, setLocalRunRemainingSecs] = useState<number | null>(null);
  const [runQuizQr, setRunQuizQr] = useState<{ title: string; qr: string } | null>(null);
  const [runResultQrInput, setRunResultQrInput] = useState("");
  const [runCameraOpen, setRunCameraOpen] = useState(false);

  const qrPayloadMemoryRef = useRef<Record<string, string>>({});
  const runPanelRef = useRef<HTMLDivElement | null>(null);
  const resultFileRef = useRef<HTMLInputElement | null>(null);
  const runScannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const flashMsg = (ok: boolean, text: string) => {
    setStatusMsg({ ok, text });
    setTimeout(() => setStatusMsg(null), 5500);
  };

  const stopRunScanner = async () => {
    if (runScannerRef.current) {
      try {
        await runScannerRef.current.stop();
        runScannerRef.current.clear();
      } catch {
        // Ignore cleanup failure
      }
      runScannerRef.current = null;
      setRunCameraOpen(false);
    }
  };

  const fetchCloudRunResults = async (token: string, runId: string) => {
    setRefreshingRoster(true);
    try {
      const res = await fetch(
        `/api/teacher/workspace?runResults=${encodeURIComponent(runId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setCloudRunResults((data.results || []) as CloudRunResultRow[]);
        if (data.run?.status === "ended") {
          setActiveCloudRunId(null);
        }
      }
    } catch {
      // Keep last known roster
    } finally {
      setRefreshingRoster(false);
    }
  };

  const loadLocalRuns = async (preferredId?: string) => {
    if (!offlineDb) return;
    const rawRuns = await offlineDb.teacherRuns.orderBy("startedAt").reverse().toArray();
    const mergedRuns: LocalTeacherRun[] = [];
    for (const r of rawRuns) {
      const m = await mergeLocalAttemptsIntoRun(r);
      if (m !== r) await offlineDb.teacherRuns.put(m);
      mergedRuns.push(m);
    }
    setLocalRuns(mergedRuns);
    if (preferredId) {
      setSelectedLocalRunId(preferredId);
    } else if (!selectedLocalRunId && mergedRuns.length > 0) {
      const running = mergedRuns.find((r) => r.status === "running");
      setSelectedLocalRunId((running || mergedRuns[0]).id);
    }
  };

  const loadWorkspace = async () => {
    if (!offlineDb) return;
    const sess = (await offlineDb.session.get("active")) || null;
    const activeTeacher = sess?.role === "teacher" ? sess : null;
    setSession(activeTeacher);

    if (navigator.onLine) {
      fetch("/api/health")
        .then((r) => r.json())
        .then((h) => setServiceDbConfigured(Boolean(h.supabaseServiceConfigured)))
        .catch(() => {});
    }

    if (
      activeTeacher?.authMode === "supabase" &&
      activeTeacher.sessionToken &&
      !activeTeacher.sessionToken.startsWith("offline_") &&
      navigator.onLine
    ) {
      try {
        const res = await fetch("/api/teacher/workspace", {
          headers: { Authorization: `Bearer ${activeTeacher.sessionToken}` },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            classes: {
              id: string;
              name: string;
              join_code?: string;
              created_at: string;
              students?: { id: string; name: string; student_no: string; created_at: string }[];
            }[];
            quizzes: {
              id: string;
              title: string;
              class_id: string;
              duration_minutes: number;
              instant_feedback: boolean;
              allow_retry: boolean;
              created_at: string;
              questions?: {
                id: string;
                question_text: string;
                options: string[] | { text?: string }[];
                correct_index: number;
                points: number;
              }[];
            }[];
            active_runs?: { id: string }[];
          };

          const mappedClasses: LocalTeacherClass[] = (data.classes || []).map((c) => ({
            id: c.id,
            name: c.name,
            joinCode: c.join_code || c.id.slice(0, 6).toUpperCase(),
            createdAt: c.created_at,
            students: (c.students || []).map((s) => ({
              id: s.id,
              name: s.name,
              studentNo: s.student_no,
              qrPayload:
                qrPayloadMemoryRef.current[s.id] ||
                `Cloud Student (${s.student_no}) — tap Regenerate QR to print`,
              createdAt: s.created_at,
            })),
          }));
          setClasses(mappedClasses);
          if (!selectedClassId && mappedClasses.length > 0) {
            setSelectedClassId(mappedClasses[0].id);
          }

          const mappedQuizzes: LocalTeacherQuiz[] = (data.quizzes || []).map((q) => ({
            id: q.id,
            title: q.title,
            classId: q.class_id,
            durationMinutes: q.duration_minutes,
            instantFeedback: q.instant_feedback,
            allowRetry: q.allow_retry,
            status: "ready",
            createdAt: q.created_at,
            questions: (q.questions || []).map((qq) => ({
              id: qq.id,
              prompt: qq.question_text,
              options: Array.isArray(qq.options)
                ? qq.options.map((o) => (typeof o === "string" ? o : o.text || ""))
                : [],
              correctIndex: qq.correct_index,
              points: qq.points || 1,
            })),
          }));
          setQuizzes(mappedQuizzes);

          const latestActive = data.active_runs?.[0]?.id || null;
          if (latestActive) {
            setActiveCloudRunId(latestActive);
            fetchCloudRunResults(activeTeacher.sessionToken, latestActive);
          }
          return;
        }
      } catch {
        // Fallback to local classroom storage
      }
    }

    const localCls = await offlineDb.teacherClasses.toArray();
    setClasses(localCls);
    if (!selectedClassId && localCls.length > 0) setSelectedClassId(localCls[0].id);

    const localQz = await offlineDb.teacherQuizzes.toArray();
    setQuizzes(localQz);

    await loadLocalRuns();
  };

  useEffect(() => {
    loadWorkspace();
    const onSess = () => loadWorkspace();
    const onFocus = () => {
      if (!document.hidden) loadWorkspace();
    };
    window.addEventListener("qg:session-updated", onSess);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopRunScanner();
      window.removeEventListener("qg:session-updated", onSess);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll cloud live roster every 5s when running
  useEffect(() => {
    if (!activeCloudRunId || !session?.sessionToken || session.authMode !== "supabase") return;
    const token = session.sessionToken;
    const id = setInterval(() => {
      if (navigator.onLine) fetchCloudRunResults(token, activeCloudRunId);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCloudRunId, session?.sessionToken, session?.authMode]);

  const selectedLocalRun = localRuns.find((r) => r.id === selectedLocalRunId) || null;

  // Tick local teacher run countdown timer every second while running
  useEffect(() => {
    if (!selectedLocalRun || selectedLocalRun.status !== "running") {
      setLocalRunRemainingSecs(null);
      return;
    }
    const tick = () => setLocalRunRemainingSecs(calculateRemainingSeconds(selectedLocalRun.endsAt, 0));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selectedLocalRun]);

  const callCloudAction = async (payload: Record<string, unknown>) => {
    if (!session?.sessionToken) throw new Error("Teacher session missing.");
    const res = await fetch("/api/teacher/workspace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Cloud workspace request failed.");
    return json;
  };

  const isCloudSession = Boolean(
    session?.authMode === "supabase" &&
      session.sessionToken &&
      !session.sessionToken.startsWith("offline_") &&
      typeof navigator !== "undefined" &&
      navigator.onLine
  );

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newClassName.trim();
    if (!clean) return;

    if (isCloudSession) {
      try {
        const data = await callCloudAction({ action: "create_class", name: clean });
        setNewClassName("");
        setSelectedClassId(data.id);
        flashMsg(true, `Created cloud class "${data.name}" (Code: ${data.join_code}).`);
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not create class.");
      }
      return;
    }

    const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const newCls: LocalTeacherClass = {
      id: crypto.randomUUID(),
      name: clean,
      joinCode,
      createdAt: new Date().toISOString(),
      students: [],
    };
    await offlineDb.teacherClasses.put(newCls);
    setClasses((prev) => [newCls, ...prev]);
    setSelectedClassId(newCls.id);
    setNewClassName("");
    flashMsg(true, `Created class "${clean}" (Join Code: ${joinCode}).`);
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !stuName.trim() || !stuNo.trim()) return;
    const cls = classes.find((c) => c.id === selectedClassId);
    if (!cls) return;

    if (isCloudSession) {
      try {
        const data = await callCloudAction({
          action: "add_student",
          classId: cls.id,
          name: stuName.trim(),
          studentNo: stuNo.trim(),
        });
        qrPayloadMemoryRef.current[data.id] = data.qr_payload;
        setStuName("");
        setStuNo("");
        flashMsg(true, `Added ${data.name} with printable QR card.`);
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not add student.");
      }
      return;
    }

    if (cls.students.some((s) => s.studentNo.toLowerCase() === stuNo.trim().toLowerCase())) {
      flashMsg(false, `Student number ${stuNo.trim()} already exists in this class.`);
      return;
    }

    const sid = crypto.randomUUID();
    const qrPayload = await buildOfflineStudentIdQr(sid, stuNo.trim(), stuName.trim(), cls.joinCode);
    const newStudent = {
      id: sid,
      name: stuName.trim(),
      studentNo: stuNo.trim(),
      qrPayload,
      createdAt: new Date().toISOString(),
    };
    const updated: LocalTeacherClass = { ...cls, students: [...cls.students, newStudent] };
    await offlineDb.teacherClasses.put(updated);
    setClasses((prev) => prev.map((c) => (c.id === cls.id ? updated : c)));

    // Add student to active local runs for this class too
    const classRuns = await offlineDb.teacherRuns.where("classId").equals(cls.id).toArray();
    for (const run of classRuns) {
      if (run.status === "running") {
        await offlineDb.teacherRuns.put(
          upsertStudentScoreInRun(run, {
            studentId: sid,
            studentName: newStudent.name,
            studentNo: newStudent.studentNo,
            status: "not_started",
            answeredCount: 0,
            score: 0,
            maxScore: run.maxScore,
            lateAnswers: 0,
            verified: false,
          })
        );
      }
    }
    await loadLocalRuns();

    setStuName("");
    setStuNo("");
    flashMsg(true, `Enrolled ${newStudent.name} with printable QR card.`);
  };

  const handleCsvImport = async () => {
    if (!selectedClassId || !csvBulk.trim()) return;
    const cls = classes.find((c) => c.id === selectedClassId);
    if (!cls) return;

    const lines = csvBulk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedRows: { name: string; student_no: string }[] = [];
    for (const line of lines) {
      const [n, num] = line.split(",").map((x) => x.trim());
      if (n && num) parsedRows.push({ name: n, student_no: num });
    }
    if (parsedRows.length === 0) {
      flashMsg(false, "Format each row as: Full Name, Student Number");
      return;
    }

    if (isCloudSession) {
      try {
        const data = await callCloudAction({
          action: "import_students",
          classId: cls.id,
          rows: parsedRows,
        });
        for (const s of data.created || []) {
          qrPayloadMemoryRef.current[s.id] = s.qr_payload;
        }
        setCsvBulk("");
        flashMsg(
          true,
          `Imported ${data.created_count} students (skipped ${data.skipped_count} duplicates).`
        );
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Bulk import failed.");
      }
      return;
    }

    const addedStudents = [];
    let skipped = 0;
    for (const row of parsedRows) {
      if (cls.students.some((s) => s.studentNo.toLowerCase() === row.student_no.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const sid = crypto.randomUUID();
      const qrPayload = await buildOfflineStudentIdQr(sid, row.student_no, row.name, cls.joinCode);
      addedStudents.push({
        id: sid,
        name: row.name,
        studentNo: row.student_no,
        qrPayload,
        createdAt: new Date().toISOString(),
      });
    }
    const updated: LocalTeacherClass = { ...cls, students: [...cls.students, ...addedStudents] };
    await offlineDb.teacherClasses.put(updated);
    setClasses((prev) => prev.map((c) => (c.id === cls.id ? updated : c)));
    setCsvBulk("");
    flashMsg(
      true,
      `Added ${addedStudents.length} student QR passes${skipped > 0 ? ` (${skipped} duplicates skipped)` : ""}.`
    );
  };

  const handleRegenerateQr = async (studentId: string, studentName: string) => {
    if (!isCloudSession) return;
    try {
      const data = await callCloudAction({ action: "regenerate_qr", studentId });
      qrPayloadMemoryRef.current[studentId] = data.qr_payload;
      setClasses((prev) =>
        prev.map((c) => ({
          ...c,
          students: c.students.map((s) =>
            s.id === studentId ? { ...s, qrPayload: data.qr_payload } : s
          ),
        }))
      );
      flashMsg(true, `Regenerated QR card for ${studentName} (ready to print).`);
    } catch (err) {
      flashMsg(false, err instanceof Error ? err.message : "Could not regenerate QR.");
    }
  };

  const handleLoadDemoClassroom = async () => {
    const bp = GRADE10_BLUEPRINTS[2]; // Quick Checkpoint (5 Items)

    if (isCloudSession) {
      try {
        const clsData = await callCloudAction({
          action: "create_class",
          name: "Grade 10 - Demo Class",
        });
        const imp = await callCloudAction({
          action: "import_students",
          classId: clsData.id,
          rows: DEMO_STUDENTS.map((s) => ({ name: s.name, student_no: s.studentNo })),
        });
        for (const s of imp.created || []) {
          qrPayloadMemoryRef.current[s.id] = s.qr_payload;
        }
        await callCloudAction({
          action: "create_quiz",
          classId: clsData.id,
          title: bp.title,
          description: bp.description,
          durationMinutes: bp.durationMinutes,
          instantFeedback: bp.instantFeedback,
          allowRetry: bp.allowRetry,
          questions: bp.items,
        });
        setSelectedClassId(clsData.id);
        flashMsg(true, "Loaded demo class with 5 students, QR sheet, and Grade 10 quiz!");
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Demo setup failed.");
      }
      return;
    }

    const clsId = crypto.randomUUID();
    const joinCode = "DEMO10";
    const students = await Promise.all(
      DEMO_STUDENTS.map(async (s) => {
        const sid = crypto.randomUUID();
        return {
          id: sid,
          name: s.name,
          studentNo: s.studentNo,
          qrPayload: await buildOfflineStudentIdQr(sid, s.studentNo, s.name, joinCode),
          createdAt: new Date().toISOString(),
        };
      })
    );
    const demoCls: LocalTeacherClass = {
      id: clsId,
      name: "Grade 10 - Demo Class",
      joinCode,
      createdAt: new Date().toISOString(),
      students,
    };
    const demoQuiz: LocalTeacherQuiz = {
      id: `${bp.id}-${Date.now()}`,
      title: bp.title,
      classId: clsId,
      durationMinutes: bp.durationMinutes,
      instantFeedback: bp.instantFeedback,
      allowRetry: bp.allowRetry,
      status: "ready",
      createdAt: new Date().toISOString(),
      questions: bp.items.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        options: item.options,
        correctIndex: item.correctIndex,
        points: item.points,
      })),
    };
    await offlineDb.teacherClasses.put(demoCls);
    await offlineDb.teacherQuizzes.put(demoQuiz);
    setClasses((prev) => [demoCls, ...prev]);
    setQuizzes((prev) => [demoQuiz, ...prev]);
    setSelectedClassId(clsId);
    flashMsg(true, "Loaded Demo Class (Code: DEMO10) with 5 students and Grade 10 quiz!");
  };

  const handleImportGrade10Quiz = async (blueprintId: string) => {
    const bp = GRADE10_BLUEPRINTS.find((b) => b.id === blueprintId);
    if (!bp) return;
    const classId = selectedClassId || classes[0]?.id || "local-default";

    if (isCloudSession && classId !== "local-default") {
      try {
        await callCloudAction({
          action: "create_quiz",
          classId,
          title: bp.title,
          description: bp.description,
          durationMinutes: bp.durationMinutes,
          instantFeedback: bp.instantFeedback,
          allowRetry: bp.allowRetry,
          questions: bp.items,
        });
        flashMsg(true, `Added "${bp.title}" (${bp.items.length} items) to cloud class.`);
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not import quiz.");
      }
      return;
    }

    const localQuiz: LocalTeacherQuiz = {
      id: `${bp.id}-${Date.now()}`,
      title: bp.title,
      classId,
      durationMinutes: bp.durationMinutes,
      instantFeedback: bp.instantFeedback,
      allowRetry: bp.allowRetry,
      status: "ready",
      createdAt: new Date().toISOString(),
      questions: bp.items.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        options: item.options,
        correctIndex: item.correctIndex,
        points: item.points,
      })),
    };
    await offlineDb.teacherQuizzes.put(localQuiz);
    setQuizzes((prev) => [localQuiz, ...prev]);
    flashMsg(true, `Added "${bp.title}". Tap Quizzes → Start Run to start with your class.`);
  };

  const handleAddDraftQuestion = () => {
    const cleanOptions = qOpts.map((o) => o.trim()).filter(Boolean);
    if (!qPrompt.trim() || cleanOptions.length < 2) {
      flashMsg(false, "Enter a question and at least 2 options.");
      return;
    }
    const safeIdx = Math.min(qCorrectIdx, cleanOptions.length - 1);
    setDraftQuestions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        prompt: qPrompt.trim(),
        options: cleanOptions,
        correctIndex: safeIdx,
        points: 1,
      },
    ]);
    setQPrompt("");
    setQOpts(["", "", "", ""]);
    setQCorrectIdx(0);
  };

  const handleSaveCustomQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quizTitle.trim() || draftQuestions.length === 0) {
      flashMsg(false, "Provide a quiz title and add at least 1 question.");
      return;
    }
    const classId = selectedClassId || classes[0]?.id || "local-default";

    if (isCloudSession && classId !== "local-default") {
      try {
        await callCloudAction({
          action: "create_quiz",
          classId,
          title: quizTitle.trim(),
          description: "Teacher authored quiz",
          durationMinutes: quizMins,
          instantFeedback: instantFb,
          allowRetry,
          questions: draftQuestions,
        });
        setQuizTitle("");
        setDraftQuestions([]);
        flashMsg(true, "Saved quiz to Supabase database.");
        await loadWorkspace();
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not save quiz.");
      }
      return;
    }

    const localQz: LocalTeacherQuiz = {
      id: `qz_${crypto.randomUUID().slice(0, 8)}`,
      title: quizTitle.trim(),
      classId,
      durationMinutes: quizMins,
      instantFeedback: instantFb,
      allowRetry,
      status: "ready",
      createdAt: new Date().toISOString(),
      questions: draftQuestions,
    };
    await offlineDb.teacherQuizzes.put(localQz);
    setQuizzes((prev) => [localQz, ...prev]);
    setQuizTitle("");
    setDraftQuestions([]);
    flashMsg(true, "Saved custom quiz cleanly.");
  };

  const handleExportEncryptedPack = async (quiz: LocalTeacherQuiz, asLink: boolean) => {
    const encrypted = await buildEncryptedPackFromTeacherQuiz(
      quiz,
      session?.name || "Teacher",
      exportPasscode
    );
    const jsonStr = JSON.stringify(encrypted, null, 2);

    if (asLink) {
      const token = encodeUtf8Base64Url(jsonStr);
      const shareUrl = `${window.location.origin}/student?pack=${token}`;
      await copyText(`link-${quiz.id}`, shareUrl);
      flashMsg(
        true,
        `Copied AES-256-GCM encrypted quiz link (${shareUrl.length} chars) to clipboard.`
      );
      return;
    }

    const safeTitle = quiz.title.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const filename = `${safeTitle}.qpack.json`;
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashMsg(true, `Downloaded encrypted "${filename}" (AES-256-GCM).`);
  };

  const handleShowRunQuizQr = async (quiz: LocalTeacherQuiz) => {
    if (runQuizQr?.title === quiz.title) {
      setRunQuizQr(null);
      return;
    }
    const encrypted = await buildEncryptedPackFromTeacherQuiz(
      quiz,
      session?.name || "Teacher",
      exportPasscode
    );
    const compact = await encodeCompactQuizQr(encrypted);
    if (compact.length > 2650) {
      flashMsg(
        false,
        `This quiz is ${compact.length} chars (${quiz.questions.length} items) — too dense for camera QR scanning. Download .qpack.json or Copy Link instead!`
      );
      return;
    }
    setRunQuizQr({ title: quiz.title, qr: compact });
  };

  const handleStartLiveRun = async (quiz: LocalTeacherQuiz) => {
    if (isCloudSession && session?.sessionToken) {
      try {
        const data = await callCloudAction({ action: "start_run", quizId: quiz.id });
        const runId = String(data.run_id);
        setActiveCloudRunId(runId);
        await fetchCloudRunResults(session.sessionToken, runId);
        flashMsg(true, "Started timed live run! Students in this class can now enter.");
        runPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not start live run.");
      }
      return;
    }

    // Start real Local / Offline Classroom Run persisted in IndexedDB!
    const cls = classes.find((c) => c.id === quiz.classId) || classes.find((c) => c.id === selectedClassId);
    const classId = cls?.id || quiz.classId || "local-default";
    const className = cls?.name || "Classroom";
    const joinCode = cls?.joinCode || "SELF";

    // Mark any prior running local runs for this class as ended
    const existingRuns = await offlineDb.teacherRuns.where("classId").equals(classId).toArray();
    for (const r of existingRuns) {
      if (r.status === "running") {
        await offlineDb.teacherRuns.put({ ...r, status: "ended" });
      }
    }

    const nowMs = Date.now();
    const maxScore = quiz.questions.reduce((acc, q) => acc + (q.points || 1), 0);
    const seedRoster = (cls?.students || []).map((st) => ({
      studentId: st.id,
      studentName: st.name,
      studentNo: st.studentNo,
      status: "not_started" as const,
      answeredCount: 0,
      score: 0,
      maxScore,
      lateAnswers: 0,
      verified: false,
    }));

    const initialRun: LocalTeacherRun = {
      id: `run_${quiz.id}_${nowMs}`,
      quizId: quiz.id,
      quizTitle: quiz.title,
      classId,
      className,
      joinCode,
      durationMinutes: quiz.durationMinutes,
      status: "running",
      startedAt: new Date(nowMs).toISOString(),
      endsAt: new Date(nowMs + quiz.durationMinutes * 60 * 1000).toISOString(),
      maxScore,
      results: seedRoster,
    };

    const hydratedRun = await mergeLocalAttemptsIntoRun(initialRun);
    await offlineDb.teacherRuns.put(hydratedRun);
    await offlineDb.teacherQuizzes.put({
      ...quiz,
      status: "running",
      startedAt: hydratedRun.startedAt,
      endsAt: hydratedRun.endsAt,
    });

    // Also prepare compact Quiz QR if <= 2,650 chars so teacher can display immediately!
    const enc = await buildEncryptedPackFromTeacherQuiz(quiz, session?.name || "Teacher", exportPasscode);
    const compactQr = await encodeCompactQuizQr(enc);
    setRunQuizQr(compactQr.length <= 2650 ? { title: quiz.title, qr: compactQr } : null);

    await loadLocalRuns(hydratedRun.id);
    flashMsg(true, `Quiz run started (${quiz.durationMinutes} min)! Collect offline scores via Result QR or .qres.json below.`);
    setTimeout(() => runPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const handleEndLocalRun = async () => {
    if (!selectedLocalRun) return;
    const ended: LocalTeacherRun = { ...selectedLocalRun, status: "ended" };
    await offlineDb.teacherRuns.put(ended);
    await loadLocalRuns(ended.id);
    await stopRunScanner();
    flashMsg(true, `Ended "${ended.quizTitle}" (${ended.results.filter((r) => r.status === "submitted").length} student scores recorded).`);
  };

  const recordOfflineResultIntoSelectedRun = async (rawCode: string) => {
    if (!selectedLocalRun) return;
    const clean = rawCode.trim();
    if (!clean) return;

    const verified = await verifyOfflineOrFormatQr(clean);
    if (!verified.valid) {
      flashMsg(false, verified.reason || "Invalid Result QR code.");
      return;
    }

    const stuNo = verified.studentNo || "OFFLINE";
    const stuName = verified.studentName || "Offline Student";
    const updatedRun = upsertStudentScoreInRun(selectedLocalRun, {
      studentId: stuNo,
      studentName: stuName,
      studentNo: stuNo,
      status: "submitted",
      answeredCount: verified.maxScore ?? selectedLocalRun.maxScore,
      score: verified.score ?? 0,
      maxScore: verified.maxScore ?? selectedLocalRun.maxScore,
      lateAnswers: verified.lateCount ?? 0,
      verified: true,
      verifiedVia: "offline_qr",
      recordedAt: verified.recordedAt || new Date().toISOString(),
    });

    await offlineDb.teacherRuns.put(updatedRun);

    // Also enroll student into teacherClasses if missing so roster stays accurate!
    const cls = classes.find((c) => c.id === selectedLocalRun.classId);
    if (cls && !cls.students.some((s) => s.studentNo.toLowerCase() === stuNo.toLowerCase())) {
      const sid = crypto.randomUUID();
      const stuQr = await buildOfflineStudentIdQr(sid, stuNo, stuName, cls.joinCode);
      const nextCls = {
        ...cls,
        students: [
          ...cls.students,
          { id: sid, name: stuName, studentNo: stuNo, qrPayload: stuQr, createdAt: new Date().toISOString() },
        ],
      };
      await offlineDb.teacherClasses.put(nextCls);
      setClasses((prev) => prev.map((c) => (c.id === cls.id ? nextCls : c)));
    }

    await offlineDb.verificationLogs.add({
      scannedAt: new Date().toISOString(),
      studentName: stuName,
      studentNo: stuNo,
      scoreLabel: `${verified.score}/${verified.maxScore}`,
      valid: true,
      source: "qr",
      verifiedVia: "offline",
      rawCode: clean,
    });

    setRunResultQrInput("");
    await loadLocalRuns(updatedRun.id);
    flashMsg(true, `Recorded ${stuName} (${stuNo}): ${verified.score}/${verified.maxScore} [Verified ✓]`);
  };

  const handleImportRunResultFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedLocalRun) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    let currentRun = selectedLocalRun;
    let importedCount = 0;
    let failedCount = 0;

    for (const file of files) {
      try {
        const packet = JSON.parse(await file.text()) as EncryptedResultPacket;
        const plain = await decryptResultPacket(packet);
        currentRun = upsertStudentScoreInRun(currentRun, {
          studentId: plain.studentId || plain.studentNo,
          studentName: plain.studentName,
          studentNo: plain.studentNo,
          status: "submitted",
          answeredCount: plain.answers.length,
          score: plain.score,
          maxScore: plain.maxScore,
          lateAnswers: plain.lateCount || 0,
          verified: true,
          verifiedVia: "result_file",
          recordedAt: plain.submittedAt,
        });
        await offlineDb.verificationLogs.add({
          scannedAt: new Date().toISOString(),
          studentName: plain.studentName,
          studentNo: plain.studentNo,
          scoreLabel: `${plain.score}/${plain.maxScore}`,
          valid: true,
          source: "result_file",
          verifiedVia: "offline",
          rawCode: packet.sig,
        });
        importedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    await offlineDb.teacherRuns.put(currentRun);
    await loadLocalRuns(currentRun.id);
    if (resultFileRef.current) resultFileRef.current.value = "";
    flashMsg(
      failedCount === 0,
      `Imported ${importedCount} student submission file(s) into roster${failedCount > 0 ? ` (${failedCount} invalid)` : ""}.`
    );
  };

  const startRunResultCamera = async () => {
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopRunScanner();
      const qr = new Html5Qrcode("teacher-run-result-qr-reader");
      runScannerRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decoded) => {
          recordOfflineResultIntoSelectedRun(decoded);
        },
        () => {}
      );
      setRunCameraOpen(true);
    } catch {
      flashMsg(false, "Camera unavailable; paste the student's Result QR payload below.");
    }
  };

  const handleEndCloudRun = async () => {
    if (!activeCloudRunId || !session?.sessionToken) return;
    try {
      await callCloudAction({ action: "end_run", runId: activeCloudRunId });
      await fetchCloudRunResults(session.sessionToken, activeCloudRunId);
      setActiveCloudRunId(null);
      flashMsg(true, "Ended live run and finalized all in-progress attempts.");
    } catch (err) {
      flashMsg(false, err instanceof Error ? err.message : "Could not end run.");
    }
  };

  const exportCsvRows = (
    rows: {
      name: string;
      studentNo: string;
      status: string;
      answered: number;
      score: number;
      maxScore: number;
      late: number;
      verified: boolean;
    }[]
  ) => {
    if (rows.length === 0) return;
    const esc = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;
    const headers = [
      "Student Name",
      "Student No",
      "Status",
      "Answered",
      "Score",
      "Max Score",
      "Late Sync Answers",
      "Verified",
    ];
    const lines = rows.map((r) => [
      esc(r.name),
      esc(r.studentNo),
      esc(r.status),
      esc(r.answered),
      esc(r.score),
      esc(r.maxScore),
      esc(r.late),
      esc(r.verified ? "YES" : "NO"),
    ]);
    const csv = [headers.join(","), ...lines.map((l) => l.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quizgate_class_results_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <div className="space-y-5">
      {/* Header Summary */}
      <div className="qg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            {session ? `Teacher Console · ${session.name}` : "Teacher Console"}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink-muted)] mt-0.5">
            {session?.authMode === "supabase"
              ? "Cloud Sync Active — Real-time multi-device rosters, runs, and scoreboards via Supabase."
              : serviceDbConfigured === false
                ? "Classroom Offline Mode — Share quizzes via Quiz QR or .qpack.json and collect student scores via Result QR or .qres.json. (Optional: set SUPABASE_SERVICE_ROLE_KEY for real-time Wi-Fi DB sync)"
                : "Offline Local Mode — Share quizzes via Quiz QR or .qpack.json and collect student scores via Result QR or .qres.json."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!session && (
            <Link href="/auth?role=teacher&tab=login" className="qg-btn qg-btn-primary text-xs">
              Teacher Login / Register
            </Link>
          )}
          <Link href="/verify" className="qg-btn qg-btn-secondary text-xs">
            <ScanLine className="w-4 h-4" />
            <span>Verify Tool</span>
          </Link>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`p-3 rounded-xl text-sm font-semibold ${
            statusMsg.ok
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Teacher Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 qg-card no-print">
        <button
          type="button"
          onClick={() => setTab("links")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "links" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Quiz Links</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("classes")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "classes" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Classes ({classes.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("quizzes")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "quizzes" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <FileKey2 className="w-4 h-4" />
          <span>Quizzes ({quizzes.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("print")}
          className={`qg-btn text-xs sm:text-sm ${
            tab === "print" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>QR Sheet</span>
        </button>
      </div>

      {tab === "links" && (
        <TeacherLinkPanel quizzes={quizzes} classes={classes} />
      )}

      {tab === "classes" && (
        <div className="space-y-4">
          <div className="qg-card p-4 flex flex-col sm:flex-row gap-2.5">
            <form onSubmit={handleCreateClass} className="flex flex-col sm:flex-row gap-2.5 flex-1">
              <input
                className="qg-input flex-1"
                placeholder="New class name (e.g. Grade 10 - Rizal)"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
              />
              <button type="submit" className="qg-btn qg-btn-primary shrink-0">
                <Plus className="w-4 h-4" />
                <span>Create Class</span>
              </button>
            </form>
            <button
              type="button"
              onClick={handleLoadDemoClassroom}
              className="qg-btn qg-btn-secondary shrink-0 text-xs"
            >
              <Sparkles className="w-4 h-4 text-[var(--primary)]" />
              <span>Load Demo Classroom</span>
            </button>
          </div>

          {classes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClassId(c.id)}
                  className={`qg-btn text-xs ${
                    c.id === selectedClassId ? "qg-btn-primary" : "qg-btn-secondary"
                  }`}
                >
                  {c.name} ({c.students.length})
                </button>
              ))}
            </div>
          )}

          {selectedClass && (
            <div className="qg-card p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
                <div>
                  <h2 className="font-bold text-lg">{selectedClass.name}</h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Student Join Code:{" "}
                    <code className="font-mono font-bold text-[var(--primary)]">
                      {selectedClass.joinCode}
                    </code>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `join-${selectedClass.id}`,
                        `${window.location.origin}/auth?role=student&tab=register&join=${selectedClass.joinCode}`
                      )
                    }
                    className="qg-btn qg-btn-secondary text-xs"
                  >
                    {copiedId === `join-${selectedClass.id}` ? (
                      <Check className="w-4 h-4 text-[var(--success)]" />
                    ) : (
                      <Link2 className="w-4 h-4" />
                    )}
                    <span>Copy Student Invite Link</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("print")}
                    className="qg-btn qg-btn-primary text-xs"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print QR Sheet</span>
                  </button>
                </div>
              </div>

              {/* Manual Add + CSV Import */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <form onSubmit={handleAddStudent} className="space-y-2.5">
                  <h3 className="text-sm font-bold">Add Student</h3>
                  <input
                    className="qg-input"
                    placeholder="Full Name (e.g. Juan Dela Cruz)"
                    value={stuName}
                    onChange={(e) => setStuName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      className="qg-input font-mono"
                      placeholder="Student No (2026-0001)"
                      value={stuNo}
                      onChange={(e) => setStuNo(e.target.value)}
                    />
                    <button type="submit" className="qg-btn qg-btn-primary shrink-0">
                      Add
                    </button>
                  </div>
                </form>

                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold">Bulk CSV Import (Name, Student No)</h3>
                  <textarea
                    className="qg-input min-h-[96px] text-xs font-mono"
                    placeholder={"Maria Santos, 2026-0002\nAntonio Luna, 2026-0003"}
                    value={csvBulk}
                    onChange={(e) => setCsvBulk(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleCsvImport}
                    className="qg-btn qg-btn-secondary text-xs w-full"
                  >
                    Import Roster Rows
                  </button>
                </div>
              </div>

              {/* Student Roster List */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold">
                  Enrolled Students ({selectedClass.students.length})
                </h3>
                {selectedClass.students.length === 0 ? (
                  <p className="text-xs text-[var(--ink-muted)]">
                    Add students above to print QR cards, share the Join Link on the same device, or collect offline student Result QRs/files directly when running a quiz.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
                    {selectedClass.students.map((st) => (
                      <div
                        key={st.id}
                        className="p-3 bg-[var(--surface)] flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <span className="font-semibold">{st.name}</span>{" "}
                          <span className="text-xs font-mono text-[var(--ink-muted)]">
                            ({st.studentNo})
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {isCloudSession && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateQr(st.id, st.name)}
                              className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)] inline-flex items-center gap-1"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Regenerate QR</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => copyText(`stu-${st.id}`, st.qrPayload)}
                            className="text-xs font-semibold text-[var(--primary)] inline-flex items-center gap-1"
                          >
                            {copiedId === `stu-${st.id}` ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>Copy QR Payload</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "quizzes" && (
        <div className="space-y-5">
          {/* Active/Selected Local Offline Classroom Run Dashboard */}
          {!isCloudSession && selectedLocalRun && (
            <div
              ref={runPanelRef}
              className="qg-card p-5 space-y-4 border-l-4 border-l-[var(--primary)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        selectedLocalRun.status === "running"
                          ? "bg-[var(--success-soft)] text-[var(--success)]"
                          : "bg-[var(--surface-subtle)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {selectedLocalRun.status === "running" ? "Live Run Active" : "Run Ended"}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {selectedLocalRun.className} (Code{" "}
                      <code className="font-mono font-bold">{selectedLocalRun.joinCode}</code>)
                    </span>
                  </div>
                  <h2 className="font-bold text-lg mt-1">{selectedLocalRun.quizTitle}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedLocalRun.status === "running" && localRunRemainingSecs !== null && (
                    <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold px-3 py-1.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] tabular-nums">
                      <Clock className="w-4 h-4" />
                      <span>{formatCountdown(localRunRemainingSecs)}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => loadLocalRuns(selectedLocalRun.id)}
                    className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh Scores</span>
                  </button>
                  {selectedLocalRun.status === "running" && (
                    <button
                      type="button"
                      onClick={handleEndLocalRun}
                      className="qg-btn qg-btn-secondary text-xs text-red-600 min-h-[38px]"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>End Run</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Run History Switcher if multiple runs exist */}
              {localRuns.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {localRuns.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedLocalRunId(r.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                        r.id === selectedLocalRun.id
                          ? "bg-[var(--primary)] text-white border-transparent"
                          : "bg-[var(--surface-subtle)] border-[var(--border)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {r.quizTitle.slice(0, 22)} ({r.status})
                    </button>
                  ))}
                </div>
              )}

              {/* Step 1: Classroom Quiz QR display if toggled or compact */}
              {runQuizQr && (
                <div className="p-4 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-full max-w-[240px]">
                    <QrCanvas
                      value={runQuizQr.qr}
                      title="Classroom Quiz QR"
                      subtitle="Students scan in Student Workspace → Scan Quiz QR"
                      size={200}
                      filename="classroom-quiz-qr.png"
                    />
                  </div>
                  <div className="text-xs space-y-2 text-[var(--ink-muted)]">
                    <p className="font-bold text-sm text-[var(--ink)]">
                      How students load this quiz offline:
                    </p>
                    <p>
                      1. Students open <b>Student Workspace → Scan Quiz QR</b> and point their phone
                      camera at this QR code (zero internet needed).
                    </p>
                    <p>
                      2. Or send them the <code>.qpack.json</code> file / Encrypted Link from below.
                    </p>
                    <button
                      type="button"
                      onClick={() => setRunQuizQr(null)}
                      className="qg-btn qg-btn-secondary text-xs"
                    >
                      Hide Quiz QR
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Collect Student Offline Scores Right Inside This Run */}
              <div className="p-4 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">
                      Collect Offline Student Scores (
                      {selectedLocalRun.results.filter((r) => r.status === "submitted").length}/
                      {selectedLocalRun.results.length} Recorded)
                    </h3>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Scan each student&apos;s Result QR (<code>QG1O.*</code>) or import their{" "}
                      <code>.qres.json</code> files to update scores below.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => (runCameraOpen ? stopRunScanner() : startRunResultCamera())}
                      className="qg-btn qg-btn-primary text-xs min-h-[38px]"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{runCameraOpen ? "Stop Camera" : "Scan Result QR"}</span>
                    </button>
                    <input
                      ref={resultFileRef}
                      type="file"
                      accept=".json,.qres.json"
                      multiple
                      className="hidden"
                      onChange={handleImportRunResultFiles}
                    />
                    <button
                      type="button"
                      onClick={() => resultFileRef.current?.click()}
                      className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Import .qres.json File(s)</span>
                    </button>
                  </div>
                </div>

                {runCameraOpen && (
                  <div className="w-full max-w-[240px] aspect-square mx-auto rounded-xl overflow-hidden bg-slate-900 border border-[var(--border)]">
                    <div id="teacher-run-result-qr-reader" className="w-full h-full" />
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    className="qg-input text-xs font-mono"
                    placeholder="Or paste Student Result QR code (QG1O....) to record score"
                    value={runResultQrInput}
                    onChange={(e) => setRunResultQrInput(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!runResultQrInput.trim()}
                    onClick={() => recordOfflineResultIntoSelectedRun(runResultQrInput)}
                    className="qg-btn qg-btn-secondary text-xs shrink-0"
                  >
                    Record Score
                  </button>
                </div>
              </div>

              {/* Step 3: Live Roster & Export Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">Class Run Roster &amp; Scores</h3>
                  {selectedLocalRun.results.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        exportCsvRows(
                          selectedLocalRun.results.map((r) => ({
                            name: r.studentName,
                            studentNo: r.studentNo,
                            status: r.status,
                            answered: r.answeredCount,
                            score: r.score,
                            maxScore: r.maxScore,
                            late: r.lateAnswers,
                            verified: r.verified,
                          }))
                        )
                      }
                      className="qg-btn qg-btn-secondary text-xs min-h-[34px]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Class CSV</span>
                    </button>
                  )}
                </div>

                {selectedLocalRun.results.length === 0 ? (
                  <p className="text-xs text-[var(--ink-muted)] p-3 rounded-xl bg-[var(--surface-subtle)]">
                    No students recorded yet. Enroll students in your class, or scan their Result QR
                    / import <code>.qres.json</code> files above as students finish!
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[var(--surface-subtle)]">
                        <tr className="border-b border-[var(--border)]">
                          <th className="py-2 px-3">Student</th>
                          <th className="py-2 px-3">Student No</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Score</th>
                          <th className="py-2 px-3">Verification</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLocalRun.results.map((r) => (
                          <tr key={`${r.studentNo}-${r.studentId}`} className="border-b border-[var(--border)]">
                            <td className="py-2 px-3 font-semibold">{r.studentName}</td>
                            <td className="py-2 px-3 font-mono">{r.studentNo}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full font-semibold ${
                                  r.status === "submitted"
                                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                                    : r.status === "in_progress"
                                      ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                                      : "bg-[var(--surface-subtle)] text-[var(--ink-muted)]"
                                }`}
                              >
                                {r.status === "submitted"
                                  ? "Scored"
                                  : r.status === "in_progress"
                                    ? `Answering (${r.answeredCount})`
                                    : "Waiting"}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-bold tabular-nums">
                              {r.score}/{r.maxScore}
                            </td>
                            <td className="py-2 px-3">
                              {r.verified ? (
                                <span className="inline-flex items-center gap-1 text-[var(--success)] font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>
                                    {r.verifiedVia === "offline_qr"
                                      ? "Result QR"
                                      : r.verifiedVia === "result_file"
                                        ? ".qres File"
                                        : "Device Sync"}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[var(--ink-muted)]">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick-Import Grade 10 Hardcoded Bank */}
          <div className="qg-card p-5 space-y-3">
            <h2 className="font-bold text-base">Load Hardcoded Grade 10 Math Assessments</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              Add built-in Grade 10 Quarter 2 assessments to export as AES-256-GCM encrypted files or
              run with your class.
            </p>
            <div className="flex flex-wrap gap-2">
              {GRADE10_BLUEPRINTS.map((bp) => (
                <button
                  key={bp.id}
                  type="button"
                  onClick={() => handleImportGrade10Quiz(bp.id)}
                  className="qg-btn qg-btn-secondary text-xs"
                >
                  <Plus className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span>{bp.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Author Custom Quiz */}
          <form onSubmit={handleSaveCustomQuiz} className="qg-card p-5 space-y-4">
            <h2 className="font-bold text-base">Create Custom Quiz</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                  Quiz Title
                </label>
                <input
                  className="qg-input"
                  placeholder="e.g. Week 3 Discriminant Check"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                  Time Limit (minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  className="qg-input font-mono"
                  value={quizMins}
                  onChange={(e) => setQuizMins(Number(e.target.value) || 15)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={instantFb}
                  onChange={(e) => setInstantFb(e.target.checked)}
                />
                <span>Instant feedback popup on wrong answers</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowRetry}
                  onChange={(e) => setAllowRetry(e.target.checked)}
                />
                <span>Allow answer changes</span>
              </label>
            </div>

            <div className="p-4 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                Add Question ({draftQuestions.length} added)
              </h3>
              <input
                className="qg-input"
                placeholder="Question prompt (supports sqrt(...) and ^2)"
                value={qPrompt}
                onChange={(e) => setQPrompt(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {qOpts.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correctOpt"
                      checked={qCorrectIdx === idx}
                      onChange={() => setQCorrectIdx(idx)}
                      aria-label={`Mark option ${idx + 1} correct`}
                    />
                    <input
                      className="qg-input text-sm"
                      placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                      value={opt}
                      onChange={(e) => {
                        const next = qOpts.slice();
                        next[idx] = e.target.value;
                        setQOpts(next);
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddDraftQuestion}
                className="qg-btn qg-btn-secondary text-xs"
              >
                + Append Question to Quiz
              </button>
            </div>

            <button
              type="submit"
              disabled={draftQuestions.length === 0 || !quizTitle.trim()}
              className="qg-btn qg-btn-primary w-full sm:w-auto"
            >
              Save Quiz ({draftQuestions.length} Questions)
            </button>
          </form>

          {/* Saved Quizzes & Run Controls */}
          <div className="qg-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-base">Your Quizzes</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Click <b>Start Run</b> to open the classroom timer &amp; score roster, show Quiz
                  QR, or export <code>.qpack.json</code>.
                </p>
              </div>
              <input
                type="password"
                className="qg-input sm:w-56 text-xs"
                placeholder="Optional export passcode"
                value={exportPasscode}
                onChange={(e) => setExportPasscode(e.target.value)}
              />
            </div>

            {quizzes.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No quizzes added yet. Click any Grade 10 assessment above or author your own.
              </p>
            ) : (
              <div className="space-y-3">
                {quizzes.map((qz) => (
                  <div
                    key={qz.id}
                    className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <h3 className="font-bold text-sm">{qz.title}</h3>
                      <p className="text-xs text-[var(--ink-muted)] tabular-nums">
                        {qz.questions.length} items · {qz.durationMinutes} min ·{" "}
                        {qz.instantFeedback ? "Instant feedback" : "Silent"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleShowRunQuizQr(qz)}
                        className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Quiz QR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportEncryptedPack(qz, false)}
                        className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.qpack.json</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportEncryptedPack(qz, true)}
                        className="qg-btn qg-btn-secondary text-xs min-h-[38px]"
                      >
                        {copiedId === `link-${qz.id}` ? (
                          <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        <span>Copy Link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartLiveRun(qz)}
                        className="qg-btn qg-btn-primary text-xs min-h-[38px]"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Start Run</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cloud Live Run Roster */}
            {cloudRunResults.length > 0 && (
              <div ref={runPanelRef} className="p-4 rounded-xl border border-blue-500/40 bg-[var(--primary-soft)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-sm">
                    Cloud Live Run Roster ({cloudRunResults.length} Students)
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeCloudRunId && session?.sessionToken && (
                      <button
                        type="button"
                        onClick={() =>
                          session.sessionToken && fetchCloudRunResults(session.sessionToken, activeCloudRunId)
                        }
                        className="qg-btn qg-btn-secondary text-xs min-h-[34px]"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${refreshingRoster ? "animate-spin" : ""}`}
                        />
                        <span>Refresh</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        exportCsvRows(
                          cloudRunResults.map((r) => ({
                            name: r.student_name,
                            studentNo: r.student_no,
                            status: r.status,
                            answered: r.answered_count,
                            score: r.score,
                            maxScore: r.max_score,
                            late: r.late_answers,
                            verified: r.is_verified,
                          }))
                        )
                      }
                      className="qg-btn qg-btn-secondary text-xs min-h-[34px]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                    {activeCloudRunId && (
                      <button
                        type="button"
                        onClick={handleEndCloudRun}
                        className="qg-btn qg-btn-secondary text-xs text-red-600 min-h-[34px]"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>End Run</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="py-1.5 pr-3">Student</th>
                        <th className="py-1.5 pr-3">Status</th>
                        <th className="py-1.5 pr-3">Score</th>
                        <th className="py-1.5">Late</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cloudRunResults.map((r) => (
                        <tr key={r.student_id} className="border-b border-[var(--border)]">
                          <td className="py-1.5 pr-3 font-semibold">{r.student_name}</td>
                          <td className="py-1.5 pr-3">{r.status}</td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {r.score}/{r.max_score}
                          </td>
                          <td className="py-1.5 tabular-nums">{r.late_answers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "print" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 no-print">
            <div>
              <h2 className="font-bold text-lg">
                Printable QR Sheet · {selectedClass?.name || "Select a class"}
              </h2>
              <p className="text-xs text-[var(--ink-muted)]">
                Post the Class Self-Register QR on the board or print individual Student ID QR cards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="qg-btn qg-btn-primary text-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Print Sheet</span>
            </button>
          </div>

          {selectedClass && (
            <div className="max-w-xs qr-sheet-card">
              <QrCanvas
                value={
                  typeof window !== "undefined"
                    ? `${window.location.origin}/auth?role=student&tab=register&join=${selectedClass.joinCode}`
                    : selectedClass.joinCode
                }
                title={`Class Join Pass: ${selectedClass.name}`}
                subtitle={`Code: ${selectedClass.joinCode} · Scan to register`}
                size={160}
                filename={`join-class-${selectedClass.joinCode}.png`}
              />
            </div>
          )}

          {!selectedClass || selectedClass.students.length === 0 ? (
            <div className="qg-card p-6 text-sm text-[var(--ink-muted)]">
              Add students to a class first to generate individual printable Student ID QR cards.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedClass.students.map((st) => (
                <div key={st.id} className="qr-sheet-card">
                  <QrCanvas
                    value={st.qrPayload}
                    title={st.name}
                    subtitle={`${selectedClass.name} · ${st.studentNo}`}
                    size={160}
                    filename={`qr-${st.studentNo}.png`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
