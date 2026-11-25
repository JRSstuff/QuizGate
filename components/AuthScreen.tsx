"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  GraduationCap,
  KeyRound,
  QrCode,
  User,
  UserPlus,
} from "lucide-react";
import {
  parseStudentIdQr,
  sha256Hex,
} from "@/lib/crypto/quizVault";
import { offlineDb } from "@/lib/offline/storage";
import { QrCanvas } from "./QrCanvas";

type RoleMode = "student" | "teacher";
type AuthTab = "login" | "register" | "qr";

function AuthScreenInner() {
  const router = useRouter();
  const params = useSearchParams();

  const initialRole = params.get("role") === "teacher" ? "teacher" : "student";
  const paramTab = params.get("tab");
  const initialTab: AuthTab =
    paramTab === "register" ? "register" : paramTab === "qr" ? "qr" : "login";
  const initialJoin = params.get("join") || "";

  const [role, setRole] = useState<RoleMode>(initialRole);
  const [tab, setTab] = useState<AuthTab>(initialTab);

  // Student form state
  const [studentName, setStudentName] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [classCode, setClassCode] = useState(initialJoin || "SELF");
  const [studentPin, setStudentPin] = useState("");
  const [qrInput, setQrInput] = useState("");

  // Teacher form state (string username + password, zero email required)
  const [teacherName, setTeacherName] = useState("");
  const [teacherUsername, setTeacherUsername] = useState("");
  const [teacherPass, setTeacherPass] = useState("");

  // Scanner & UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredQrCard, setRegisteredQrCard] = useState<{
    name: string;
    studentNo: string;
    qrPayload: string;
    classCode: string;
  } | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  useEffect(() => {
    setError(null);
  }, [role, tab]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current
            .stop()
            .then(() => scannerRef.current?.clear())
            .catch(() => {});
        } catch {
          // Ignore camera cleanup failures
        }
      }
    };
  }, []);

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore stop failure
      }
      scannerRef.current = null;
      setCameraActive(false);
    }
  };

  const startQrScanner = async () => {
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopCamera();
      const qr = new Html5Qrcode("student-auth-qr-reader");
      scannerRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          setQrInput(decoded);
          handleStudentQrLogin(decoded);
        },
        () => {}
      );
      setCameraActive(true);
    } catch {
      setError("Camera access unavailable. Paste your Student QR code text below.");
      setCameraActive(false);
    }
  };

  const handleStudentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = studentName.trim();
    const cleanNo = studentNo.trim();
    const cleanCode = classCode.trim().toUpperCase() || "SELF";
    const cleanPin = studentPin.trim();

    if (!cleanName || !cleanNo || cleanPin.length < 4) {
      setError("Enter your full name, student number, and a PIN/password (at least 4 characters).");
      return;
    }

    setLoading(true);
    try {
      let data: {
        mode: "supabase" | "offline";
        session_token: string;
        qr_payload: string;
        student: {
          id: string;
          name: string;
          student_no: string;
          class_id?: string;
          class_code?: string;
          class_name?: string;
        };
      };

      if (navigator.onLine) {
        const res = await fetch("/api/student/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            joinCode: cleanCode,
            name: cleanName,
            studentNo: cleanNo,
            pin: cleanPin,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Registration failed.");
        data = json;
      } else {
        // Offline client registration fallback when offline
        const { buildOfflineStudentIdQr } = await import("@/lib/crypto/quizVault");
        const sid = crypto.randomUUID();
        const qr = await buildOfflineStudentIdQr(sid, cleanNo, cleanName, cleanCode);
        data = {
          mode: "offline",
          session_token: `offline_${sid}`,
          qr_payload: qr,
          student: {
            id: sid,
            name: cleanName,
            student_no: cleanNo,
            class_code: cleanCode,
            class_name: cleanCode === "SELF" ? "Grade 10 Independent" : `Class ${cleanCode}`,
          },
        };
      }

      // If registering locally/offline with a Teacher class code present on this device, enroll in that class roster & any active run!
      let matchedClassName = data.student.class_name;
      let matchedClassId = data.student.class_id;
      if (data.mode === "offline" && cleanCode !== "SELF") {
        const allClasses = await offlineDb.teacherClasses.toArray();
        const localCls = allClasses.find((c) => c.joinCode.toUpperCase() === cleanCode);
        if (localCls) {
          matchedClassId = localCls.id;
          matchedClassName = localCls.name;
          const alreadyEnrolled = localCls.students.some(
            (s) => s.studentNo.toLowerCase() === data.student.student_no.toLowerCase()
          );
          if (!alreadyEnrolled) {
            await offlineDb.teacherClasses.put({
              ...localCls,
              students: [
                ...localCls.students,
                {
                  id: data.student.id,
                  name: data.student.name,
                  studentNo: data.student.student_no,
                  qrPayload: data.qr_payload,
                  createdAt: new Date().toISOString(),
                },
              ],
            });
          }

          // Also add student to any currently running local runs for this class
          const activeRuns = await offlineDb.teacherRuns
            .where("classId")
            .equals(localCls.id)
            .toArray();
          for (const run of activeRuns) {
            const existsInRun = run.results.some(
              (r) => r.studentNo.toLowerCase() === data.student.student_no.toLowerCase()
            );
            if (!existsInRun) {
              await offlineDb.teacherRuns.put({
                ...run,
                results: [
                  ...run.results,
                  {
                    studentId: data.student.id,
                    studentName: data.student.name,
                    studentNo: data.student.student_no,
                    status: "not_started",
                    answeredCount: 0,
                    score: 0,
                    maxScore: run.maxScore,
                    lateAnswers: 0,
                    verified: false,
                  },
                ],
              });
            }
          }
        }
      }

      const pinHash = await sha256Hex(`${cleanNo.toLowerCase()}:${cleanPin}`);
      await offlineDb.accounts.put({
        id: data.student.id,
        role: "student",
        name: data.student.name,
        identifier: data.student.student_no.toLowerCase(),
        pinHash,
        classCode: cleanCode,
        className: matchedClassName,
        qrPayload: data.qr_payload,
        createdAt: new Date().toISOString(),
      });

      await offlineDb.session.put({
        key: "active",
        role: "student",
        userId: data.student.id,
        name: data.student.name,
        identifier: data.student.student_no,
        classId: matchedClassId,
        classCode: cleanCode,
        className: matchedClassName,
        qrPayload: data.qr_payload,
        authMode: data.mode,
        sessionToken: data.session_token,
      });

      window.dispatchEvent(new CustomEvent("qg:session-updated"));
      setRegisteredQrCard({
        name: data.student.name,
        studentNo: data.student.student_no,
        qrPayload: data.qr_payload,
        classCode: cleanCode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register.");
    } finally {
      setLoading(false);
    }
  };

  const handleStudentCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanNo = studentNo.trim();
    const cleanCode = classCode.trim().toUpperCase() || "SELF";
    const cleanPin = studentPin.trim();

    if (!cleanNo || !cleanPin) {
      setError("Enter your student number and PIN/password.");
      return;
    }

    setLoading(true);
    try {
      // Check local IndexedDB accounts first for instant offline login
      const localAcc = await offlineDb.accounts
        .where("identifier")
        .equals(cleanNo.toLowerCase())
        .and((a) => a.role === "student" && (!a.classCode || a.classCode === cleanCode))
        .first();

      const pinHash = await sha256Hex(`${cleanNo.toLowerCase()}:${cleanPin}`);

      if (navigator.onLine && cleanCode !== "SELF") {
        const res = await fetch("/api/student/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinCode: cleanCode, studentNo: cleanNo, pin: cleanPin }),
        });
        if (res.ok) {
          const data = await res.json();
          await offlineDb.session.put({
            key: "active",
            role: "student",
            userId: data.student.id,
            name: data.student.name,
            identifier: data.student.student_no,
            classId: data.student.class_id,
            classCode: cleanCode,
            className: data.student.class_name,
            qrPayload: localAcc?.qrPayload,
            authMode: "supabase",
            sessionToken: data.session_token,
          });
          window.dispatchEvent(new CustomEvent("qg:session-updated"));
          router.push("/student");
          return;
        }
        // If remote login rejected (401), fail unless offline local matches explicitly
        if (res.status === 401 && !localAcc) {
          const errJson = await res.json();
          throw new Error(errJson.error || "Invalid credentials.");
        }
      }

      if (!localAcc) {
        throw new Error("Account not found on this device. Register first or scan your Student QR.");
      }
      if (localAcc.pinHash !== pinHash) {
        throw new Error("Incorrect PIN/password.");
      }

      await offlineDb.session.put({
        key: "active",
        role: "student",
        userId: localAcc.id,
        name: localAcc.name,
        identifier: localAcc.identifier,
        classCode: localAcc.classCode,
        className: localAcc.className,
        qrPayload: localAcc.qrPayload,
        authMode: "offline",
        sessionToken: `offline_${localAcc.id}`,
      });
      window.dispatchEvent(new CustomEvent("qg:session-updated"));
      router.push("/student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleStudentQrLogin = async (rawQr: string) => {
    setError(null);
    const clean = rawQr.trim();
    if (!clean) return;
    setLoading(true);
    try {
      const parsed = await parseStudentIdQr(clean);
      if (!parsed.valid) {
        throw new Error(parsed.reason || "Invalid student QR code.");
      }

      if (parsed.kind === "supabase_qr") {
        const res = await fetch("/api/student/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrPayload: clean }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "QR sign-in rejected.");

        await offlineDb.session.put({
          key: "active",
          role: "student",
          userId: data.student.id,
          name: data.student.name,
          identifier: data.student.student_no,
          classId: data.student.class_id,
          qrPayload: clean,
          authMode: "supabase",
          sessionToken: data.session_token,
        });
      } else {
        const cleanCode = (parsed.classCode || "SELF").toUpperCase();
        let matchedClassId: string | undefined;
        let matchedClassName: string | undefined;
        if (cleanCode !== "SELF") {
          const allClasses = await offlineDb.teacherClasses.toArray();
          const localCls = allClasses.find((c) => c.joinCode.toUpperCase() === cleanCode);
          if (localCls) {
            matchedClassId = localCls.id;
            matchedClassName = localCls.name;
            const sNo = parsed.studentNo || "UNREG";
            if (!localCls.students.some((s) => s.studentNo.toLowerCase() === sNo.toLowerCase())) {
              await offlineDb.teacherClasses.put({
                ...localCls,
                students: [
                  ...localCls.students,
                  {
                    id: parsed.studentId,
                    name: parsed.studentName || "Student",
                    studentNo: sNo,
                    qrPayload: clean,
                    createdAt: new Date().toISOString(),
                  },
                ],
              });
            }
          }
        }
        await offlineDb.session.put({
          key: "active",
          role: "student",
          userId: parsed.studentId,
          name: parsed.studentName || "Student",
          identifier: parsed.studentNo || "UNREG",
          classId: matchedClassId,
          classCode: cleanCode,
          className: matchedClassName,
          qrPayload: clean,
          authMode: "offline",
          sessionToken: `offline_${parsed.studentId}`,
        });
      }

      await stopCamera();
      window.dispatchEvent(new CustomEvent("qg:session-updated"));
      router.push("/student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in with QR.");
    } finally {
      setLoading(false);
    }
  };

  const handleTeacherAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanUser = teacherUsername.trim().toLowerCase();
    const cleanPass = teacherPass.trim();
    if (cleanUser.length < 2 || /\s/.test(cleanUser) || cleanPass.length < 6) {
      setError("Enter a username (at least 2 characters, no spaces) and a 6+ character password.");
      return;
    }

    setLoading(true);
    try {
      if (navigator.onLine) {
        const res = await fetch("/api/teacher/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: tab === "register" ? "register" : "login",
            username: cleanUser,
            displayName: teacherName.trim() || cleanUser,
            password: cleanPass,
          }),
        });
        const data = await res.json();

        if (res.ok && data.mode === "supabase") {
          await offlineDb.session.put({
            key: "active",
            role: "teacher",
            userId: data.teacher.id,
            name: data.teacher.display_name || cleanUser,
            identifier: data.teacher.username || cleanUser,
            authMode: "supabase",
            sessionToken: data.session_token,
          });
          window.dispatchEvent(new CustomEvent("qg:session-updated"));
          router.push("/teacher");
          return;
        }

        // Reject actual invalid credentials/duplicate username rather than silently masking with offline mode
        if (res.status !== 503) {
          throw new Error(data.error || "Teacher authentication failed.");
        }
      }

      // Offline / Local Device Teacher Classroom Account (string username + password)
      const pinHash = await sha256Hex(`teacher:${cleanUser}:${cleanPass}`);
      if (tab === "register") {
        const existing = await offlineDb.accounts
          .where("identifier")
          .equals(cleanUser)
          .and((a) => a.role === "teacher")
          .first();
        if (existing) {
          throw new Error("A teacher account with this username already exists on this device.");
        }
        const tid = crypto.randomUUID();
        const display = teacherName.trim() || cleanUser;
        await offlineDb.accounts.put({
          id: tid,
          role: "teacher",
          name: display,
          identifier: cleanUser,
          pinHash,
          createdAt: new Date().toISOString(),
        });
        await offlineDb.session.put({
          key: "active",
          role: "teacher",
          userId: tid,
          name: display,
          identifier: cleanUser,
          authMode: "offline",
          sessionToken: `offline_teacher_${tid}`,
        });
      } else {
        const existing = await offlineDb.accounts
          .where("identifier")
          .equals(cleanUser)
          .and((a) => a.role === "teacher")
          .first();
        if (!existing || existing.pinHash !== pinHash) {
          throw new Error("Invalid teacher username or password on this device.");
        }
        await offlineDb.session.put({
          key: "active",
          role: "teacher",
          userId: existing.id,
          name: existing.name,
          identifier: existing.identifier,
          authMode: "offline",
          sessionToken: `offline_teacher_${existing.id}`,
        });
      }

      window.dispatchEvent(new CustomEvent("qg:session-updated"));
      router.push("/teacher");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teacher authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  if (registeredQrCard) {
    return (
      <div className="max-w-md mx-auto space-y-5">
        <div className="qg-card p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[var(--success-soft)] text-[var(--success)] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Registration Complete</h1>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              Save your personal Student Identity QR below. Scan it anytime on any phone to sign
              back in without typing your password.
            </p>
          </div>

          <QrCanvas
            value={registeredQrCard.qrPayload}
            title={registeredQrCard.name}
            subtitle={`Student No: ${registeredQrCard.studentNo} · Class ${registeredQrCard.classCode}`}
            filename={`student-id-${registeredQrCard.studentNo}.png`}
          />

          <button
            type="button"
            onClick={() => router.push("/student")}
            className="qg-btn qg-btn-primary w-full"
          >
            <span>Continue to Student Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* Role Selector */}
      <div className="grid grid-cols-2 gap-2 p-1.5 qg-card">
        <button
          type="button"
          onClick={() => setRole("student")}
          className={`qg-btn text-sm ${
            role === "student" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <User className="w-4 h-4" />
          <span>Student</span>
        </button>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setRole("teacher");
            if (tab === "qr") setTab("login");
          }}
          className={`qg-btn text-sm ${
            role === "teacher" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Teacher</span>
        </button>
      </div>

      {/* Mode Card */}
      <div className="qg-card p-5 space-y-5">
        <div className="flex border-b border-[var(--border)] gap-2 pb-3">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setTab("login");
            }}
            className={`px-3 py-2 rounded-lg text-sm font-semibold min-h-[40px] ${
              tab === "login"
                ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setTab("register");
            }}
            className={`px-3 py-2 rounded-lg text-sm font-semibold min-h-[40px] inline-flex items-center gap-1.5 ${
              tab === "register"
                ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Register</span>
          </button>
          {role === "student" && (
            <button
              type="button"
              onClick={() => setTab("qr")}
              className={`px-3 py-2 rounded-lg text-sm font-semibold min-h-[40px] inline-flex items-center gap-1.5 ${
                tab === "qr"
                  ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "text-[var(--ink-muted)]"
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>Scan QR</span>
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] text-sm font-medium">
            {error}
          </div>
        )}

        {role === "student" && tab === "register" && (
          <form onSubmit={handleStudentRegister} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Full Name
              </label>
              <input
                className="qg-input"
                placeholder="e.g. Dela Cruz, Juan M."
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                  Student Number
                </label>
                <input
                  className="qg-input font-mono"
                  placeholder="2026-0001"
                  value={studentNo}
                  onChange={(e) => setStudentNo(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                  Class Join Code
                </label>
                <input
                  className="qg-input uppercase font-mono"
                  placeholder="SELF"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Create PIN / Password (min 4 chars)
              </label>
              <input
                type="password"
                className="qg-input"
                placeholder="Enter PIN or password"
                value={studentPin}
                onChange={(e) => setStudentPin(e.target.value)}
                minLength={4}
                required
              />
            </div>

            <p className="text-xs text-[var(--ink-muted)]">
              No teacher code? Leave Class Code as <code>SELF</code> to unlock all Grade 10
              offline lessons and self-check quizzes.
            </p>

            <button
              type="submit"
              disabled={loading}
              className="qg-btn qg-btn-primary w-full"
            >
              {loading ? "Creating Student ID..." : "Create Student Account & QR Pass"}
            </button>
          </form>
        )}

        {role === "student" && tab === "login" && (
          <form onSubmit={handleStudentCredentialLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Class Join Code (or SELF)
              </label>
              <input
                className="qg-input uppercase font-mono"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Student Number
              </label>
              <input
                className="qg-input font-mono"
                placeholder="2026-0001"
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                PIN / Password
              </label>
              <input
                type="password"
                className="qg-input"
                placeholder="Your PIN or password"
                value={studentPin}
                onChange={(e) => setStudentPin(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="qg-btn qg-btn-primary w-full"
            >
              <KeyRound className="w-4 h-4" />
              <span>{loading ? "Signing In..." : "Sign In"}</span>
            </button>
          </form>
        )}

        {role === "student" && tab === "qr" && (
          <div className="space-y-4">
            <div className="w-full aspect-square max-w-[280px] mx-auto rounded-2xl overflow-hidden bg-slate-900 relative border border-[var(--border)]">
              <div id="student-auth-qr-reader" className="w-full h-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-white text-center bg-slate-900">
                  <Camera className="w-10 h-10 text-slate-400 mb-3" />
                  <button
                    type="button"
                    onClick={startQrScanner}
                    className="qg-btn qg-btn-primary text-xs"
                  >
                    Open Camera Scanner
                  </button>
                </div>
              )}
            </div>

            {cameraActive && (
              <button
                type="button"
                onClick={stopCamera}
                className="qg-btn qg-btn-secondary w-full text-xs"
              >
                Turn Off Camera
              </button>
            )}

            <div className="space-y-2 pt-2 border-t border-[var(--border)]">
              <label className="block text-xs font-semibold text-[var(--ink-muted)]">
                Or paste QR payload text
              </label>
              <div className="flex gap-2">
                <input
                  className="qg-input font-mono text-xs"
                  placeholder="QG1.... or QG1L...."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                />
                <button
                  type="button"
                  disabled={loading || !qrInput.trim()}
                  onClick={() => handleStudentQrLogin(qrInput)}
                  className="qg-btn qg-btn-primary shrink-0"
                >
                  Sign In
                </button>
              </div>
            </div>
          </div>
        )}

        {role === "teacher" && (
          <form onSubmit={handleTeacherAuth} className="space-y-3.5">
            {tab === "register" && (
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                  Display Name
                </label>
                <input
                  className="qg-input"
                  placeholder="e.g. Ms. Lyn Dioso"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Username
              </label>
              <input
                className="qg-input"
                autoComplete="username"
                placeholder="e.g. teacher_dioso or ms_rivera"
                value={teacherUsername}
                onChange={(e) => setTeacherUsername(e.target.value)}
                minLength={2}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Password (min 6 chars)
              </label>
              <input
                type="password"
                className="qg-input"
                placeholder="Password"
                value={teacherPass}
                onChange={(e) => setTeacherPass(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="qg-btn qg-btn-primary w-full"
            >
              {loading
                ? "Processing..."
                : tab === "register"
                  ? "Register Teacher Account"
                  : "Sign In to Teacher Console"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AuthScreen() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto qg-card p-6 text-sm text-[var(--ink-muted)]">
          Loading authentication screen...
        </div>
      }
    >
      <AuthScreenInner />
    </Suspense>
  );
}
