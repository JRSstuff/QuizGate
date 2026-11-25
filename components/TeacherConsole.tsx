"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
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
  Users,
} from "lucide-react";
import {
  buildOfflineStudentIdQr,
  encodeUtf8Base64Url,
  encryptQuizPack,
} from "@/lib/crypto/quizVault";
import { GRADE10_BLUEPRINTS, toVaultQuestions } from "@/lib/data/grade10Math";
import {
  offlineDb,
  type ActiveSession,
  type LocalTeacherClass,
  type LocalTeacherQuiz,
} from "@/lib/offline/storage";
import { QrCanvas } from "./QrCanvas";

type TeacherTab = "classes" | "quizzes" | "print";

interface RunResultRow {
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
  const [tab, setTab] = useState<TeacherTab>("classes");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [classes, setClasses] = useState<LocalTeacherClass[]>([]);
  const [quizzes, setQuizzes] = useState<LocalTeacherQuiz[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

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

  // Supabase Live Roster state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<RunResultRow[]>([]);
  const [refreshingRoster, setRefreshingRoster] = useState(false);

  // Remember newly generated/regenerated cloud student QR payloads in memory for printing
  const qrPayloadMemoryRef = useRef<Record<string, string>>({});

  const flashMsg = (ok: boolean, text: string) => {
    setStatusMsg({ ok, text });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const fetchRunResults = async (token: string, runId: string) => {
    setRefreshingRoster(true);
    try {
      const res = await fetch(
        `/api/teacher/workspace?runResults=${encodeURIComponent(runId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setRunResults((data.results || []) as RunResultRow[]);
        if (data.run?.status === "ended") {
          setActiveRunId(null);
        }
      }
    } catch {
      // Keep last known roster when transiently offline
    } finally {
      setRefreshingRoster(false);
    }
  };

  const loadWorkspace = async () => {
    if (!offlineDb) return;
    const sess = (await offlineDb.session.get("active")) || null;
    const activeTeacher = sess?.role === "teacher" ? sess : null;
    setSession(activeTeacher);

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
            setActiveRunId(latestActive);
            fetchRunResults(activeTeacher.sessionToken, latestActive);
          }
          return;
        }
      } catch {
        // Fallback cleanly to local classroom storage
      }
    }

    const localCls = await offlineDb.teacherClasses.toArray();
    setClasses(localCls);
    if (!selectedClassId && localCls.length > 0) setSelectedClassId(localCls[0].id);

    const localQz = await offlineDb.teacherQuizzes.toArray();
    setQuizzes(localQz);
  };

  useEffect(() => {
    loadWorkspace();
    const onSess = () => loadWorkspace();
    window.addEventListener("qg:session-updated", onSess);
    return () => window.removeEventListener("qg:session-updated", onSess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll live classroom roster every 5 seconds while a cloud run is active
  useEffect(() => {
    if (!activeRunId || !session?.sessionToken || session.authMode !== "supabase") return;
    const token = session.sessionToken;
    const id = setInterval(() => {
      if (navigator.onLine) fetchRunResults(token, activeRunId);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, session?.sessionToken, session?.authMode]);

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
    flashMsg(true, `Created offline class "${clean}" (Code: ${joinCode}).`);
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
    const updated: LocalTeacherClass = {
      ...cls,
      students: [
        ...cls.students,
        {
          id: sid,
          name: stuName.trim(),
          studentNo: stuNo.trim(),
          qrPayload,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    await offlineDb.teacherClasses.put(updated);
    setClasses((prev) => prev.map((c) => (c.id === cls.id ? updated : c)));
    setStuName("");
    setStuNo("");
    flashMsg(true, "Added student QR card.");
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
    const updated: LocalTeacherClass = {
      ...cls,
      students: [...cls.students, ...addedStudents],
    };
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
        flashMsg(true, "Loaded demo class with 5 students, QR sheet, and Grade 10 checkpoint quiz!");
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
    flashMsg(true, "Loaded offline Demo Class (Code: DEMO10) with 5 students and Grade 10 quiz!");
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
    flashMsg(true, `Added "${bp.title}" offline.`);
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
    flashMsg(true, "Saved offline quiz cleanly.");
  };

  const handleExportEncryptedPack = async (quiz: LocalTeacherQuiz, asLink: boolean) => {
    const encrypted = await encryptQuizPack(
      {
        id: quiz.id,
        title: quiz.title,
        subject: "Classroom Quiz",
        description: `${quiz.questions.length} items · ${quiz.durationMinutes} mins`,
        durationMinutes: quiz.durationMinutes,
        instantFeedback: quiz.instantFeedback,
        allowRetry: quiz.allowRetry,
        createdBy: session?.name || "Teacher",
        createdAt: new Date().toISOString(),
        questions: toVaultQuestions(
          quiz.questions.map((q) => ({
            id: q.id,
            topicCode: "CUSTOM",
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            points: q.points,
          }))
        ),
      },
      exportPasscode.trim() || undefined
    );

    const jsonStr = JSON.stringify(encrypted, null, 2);

    if (asLink) {
      const token = encodeUtf8Base64Url(JSON.stringify(encrypted));
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

  const handleStartLiveRun = async (quizId: string) => {
    if (isCloudSession && session?.sessionToken) {
      try {
        const data = await callCloudAction({ action: "start_run", quizId });
        const runId = String(data.run_id);
        setActiveRunId(runId);
        await fetchRunResults(session.sessionToken, runId);
        flashMsg(true, "Started timed live run! Students in this class can now enter.");
      } catch (err) {
        flashMsg(false, err instanceof Error ? err.message : "Could not start live run.");
      }
      return;
    }
    flashMsg(
      true,
      "Offline mode: Export the .qpack.json file or Copy Encrypted Link to share with students, then verify their Result QR or .qres files."
    );
  };

  const handleEndLiveRun = async () => {
    if (!activeRunId || !session?.sessionToken) return;
    try {
      await callCloudAction({ action: "end_run", runId: activeRunId });
      await fetchRunResults(session.sessionToken, activeRunId);
      setActiveRunId(null);
      flashMsg(true, "Ended live run and finalized all in-progress attempts.");
    } catch (err) {
      flashMsg(false, err instanceof Error ? err.message : "Could not end run.");
    }
  };

  const handleExportRunCsv = () => {
    if (runResults.length === 0) return;
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
    const lines = runResults.map((r) => [
      esc(r.student_name),
      esc(r.student_no),
      esc(r.status),
      esc(r.answered_count),
      esc(r.score),
      esc(r.max_score),
      esc(r.late_answers),
      esc(r.is_verified ? "YES" : "NO"),
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
          <p className="text-xs sm:text-sm text-[var(--ink-muted)]">
            {session?.authMode === "supabase"
              ? "Cloud Database Connected — Classes, rosters, live runs & QRs sync via username/password."
              : "Offline Local Mode — Create classes, print Student QRs, and export encrypted .qpack.json quizzes."}
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
            <span>Verify Student Results</span>
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
      <div className="grid grid-cols-3 gap-2 p-1.5 qg-card no-print">
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
                    Add students above or share the Join Link so students register themselves.
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
          {/* Quick-Import Grade 10 Hardcoded Bank */}
          <div className="qg-card p-5 space-y-3">
            <h2 className="font-bold text-base">Load Hardcoded Grade 10 Math Assessments</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              Add built-in Grade 10 Quarter 2 assessments to export as AES-256-GCM encrypted files or
              run live with your class.
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

          {/* Saved Quizzes & Export Controls */}
          <div className="qg-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-base">Your Quizzes</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Download encrypted <code>.qpack.json</code> files or copy encrypted quiz links.
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
                        <span>Copy Encrypted Link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartLiveRun(qz.id)}
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

            {runResults.length > 0 && (
              <div className="p-4 rounded-xl border border-blue-500/40 bg-[var(--primary-soft)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-sm">
                    Live Run Roster ({runResults.length} Students)
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeRunId && session?.sessionToken && (
                      <button
                        type="button"
                        onClick={() =>
                          session.sessionToken && fetchRunResults(session.sessionToken, activeRunId)
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
                      onClick={handleExportRunCsv}
                      className="qg-btn qg-btn-secondary text-xs min-h-[34px]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                    {activeRunId && (
                      <button
                        type="button"
                        onClick={handleEndLiveRun}
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
                      {runResults.map((r) => (
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
                Cut and hand one personal login QR card to each student.
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

          {!selectedClass || selectedClass.students.length === 0 ? (
            <div className="qg-card p-6 text-sm text-[var(--ink-muted)]">
              Add students to a class first to generate printable QR cards.
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
