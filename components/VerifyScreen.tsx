"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  FileKey2,
  QrCode,
  Upload,
  XCircle,
} from "lucide-react";
import {
  decryptResultPacket,
  verifyOfflineOrFormatQr,
  type EncryptedResultPacket,
  type OfflineResultPlainPayload,
  type VerifiedResultQr,
} from "@/lib/crypto/quizVault";
import {
  offlineDb,
  type TeacherVerificationEntry,
} from "@/lib/offline/storage";
import { getSupabaseBrowserClient } from "@/lib/supabase/config";

export function VerifyScreen() {
  const [mode, setMode] = useState<"qr" | "file">("qr");
  const [qrInput, setQrInput] = useState("");
  const [qrOutcome, setQrOutcome] = useState<{
    valid: boolean;
    reason?: string;
    studentName?: string;
    studentNo?: string;
    score?: number;
    maxScore?: number;
    lateCount?: number;
    verifiedVia?: string;
  } | null>(null);

  const [fileOutcome, setFileOutcome] = useState<{
    valid: boolean;
    reason?: string;
    submission?: OfflineResultPlainPayload;
  } | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<TeacherVerificationEntry[]>([]);

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadLogs = async () => {
    if (!offlineDb) return;
    try {
      const items = await offlineDb.verificationLogs.orderBy("id").reverse().limit(50).toArray();
      setLogs(items);
    } catch {
      // Ignore DB access issue
    }
  };

  useEffect(() => {
    loadLogs();
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current
            .stop()
            .then(() => scannerRef.current?.clear())
            .catch(() => {});
        } catch {
          // Ignore unmount cleanup error
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

  const startCamera = async () => {
    setCameraError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopCamera();
      const qr = new Html5Qrcode("qg-verify-qr-reader");
      scannerRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          setQrInput(decoded);
          verifyQr(decoded);
        },
        () => {}
      );
      setCameraActive(true);
    } catch {
      setCameraError("Camera access unavailable. Paste the QR code payload below.");
      setCameraActive(false);
    }
  };

  const verifyQr = async (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) return;
    setLoading(true);
    setQrOutcome(null);

    let outcome: VerifiedResultQr & {
      scoreInDb?: number;
      matchesDb?: boolean;
    };

    try {
      if (navigator.onLine) {
        let authHeader: Record<string, string> = {};
        const activeSess = offlineDb ? await offlineDb.session.get("active") : null;
        if (
          activeSess?.role === "teacher" &&
          activeSess.authMode === "supabase" &&
          activeSess.sessionToken &&
          !activeSess.sessionToken.startsWith("offline_")
        ) {
          authHeader = { Authorization: `Bearer ${activeSess.sessionToken}` };
        } else {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data: sessData } = await supabase.auth.getSession();
            if (sessData.session?.access_token) {
              authHeader = { Authorization: `Bearer ${sessData.session.access_token}` };
            }
          }
        }

        const res = await fetch("/api/teacher/verify-result", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ code: clean }),
        });

        if (res.ok || res.status === 400 || res.status === 401) {
          outcome = await res.json();
        } else {
          outcome = {
            ...(await verifyOfflineOrFormatQr(clean)),
            verifiedVia: "offline",
          };
        }
      } else {
        outcome = {
          ...(await verifyOfflineOrFormatQr(clean)),
          verifiedVia: "offline",
        };
      }
    } catch {
      outcome = {
        ...(await verifyOfflineOrFormatQr(clean)),
        verifiedVia: "offline",
      };
    }

    setQrOutcome({
      valid: outcome.valid,
      reason: outcome.reason,
      studentName: outcome.studentName,
      studentNo: outcome.studentNo,
      score: outcome.score,
      maxScore: outcome.maxScore,
      lateCount: outcome.lateCount,
      verifiedVia: outcome.verifiedVia,
    });

    if (offlineDb) {
      await offlineDb.verificationLogs.add({
        scannedAt: new Date().toISOString(),
        studentName: outcome.studentName || "Unknown",
        studentNo: outcome.studentNo || "-",
        scoreLabel:
          typeof outcome.score === "number"
            ? `${outcome.score}/${outcome.maxScore ?? "?"}`
            : "Invalid",
        valid: outcome.valid,
        source: "qr",
        verifiedVia: outcome.verifiedVia || "offline",
        rawCode: clean,
      });
      loadLogs();
    }

    setLoading(false);
  };

  const handleUploadResultFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    let verifiedCount = 0;
    let failedCount = 0;
    let lastValidSub: OfflineResultPlainPayload | undefined;
    let lastError = "";

    for (const file of files) {
      try {
        const text = await file.text();
        const packet = JSON.parse(text) as EncryptedResultPacket;
        const plain = await decryptResultPacket(packet);
        verifiedCount += 1;
        lastValidSub = plain;

        if (offlineDb) {
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
        }
      } catch (err) {
        failedCount += 1;
        lastError = err instanceof Error ? err.message : "Could not verify encrypted result file.";
      }
    }

    if (files.length === 1 && lastValidSub && failedCount === 0) {
      setFileOutcome({ valid: true, submission: lastValidSub });
    } else if (verifiedCount > 0) {
      setFileOutcome({
        valid: true,
        submission: lastValidSub,
        reason: `Verified ${verifiedCount} of ${files.length} files (${failedCount} invalid).`,
      });
    } else {
      setFileOutcome({
        valid: false,
        reason: lastError || "Could not verify uploaded file(s).",
      });
    }

    await loadLogs();
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportCsv = () => {
    if (logs.length === 0) return;
    const escapeCell = (val: string | number | boolean) =>
      `"${String(val).replace(/"/g, '""')}"`;
    const header = ["Scanned At", "Student", "Student No", "Score", "Status", "Source", "Mode"];
    const rows = logs.map((l) => [
      escapeCell(l.scannedAt),
      escapeCell(l.studentName),
      escapeCell(l.studentNo),
      escapeCell(l.scoreLabel),
      escapeCell(l.valid ? "VALID" : "INVALID"),
      escapeCell(l.source),
      escapeCell(l.verifiedVia || "offline"),
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quizgate_verified_results_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="qg-card p-5 space-y-1">
        <h1 className="text-xl font-bold">Verify Student Result</h1>
        <p className="text-xs sm:text-sm text-[var(--ink-muted)]">
          Authenticate student Result QR codes (online via Supabase/Serverless or completely offline)
          or import encrypted <code>.qres.json</code> files.
        </p>
      </div>

      {/* Mode Switch */}
      <div className="grid grid-cols-2 gap-2 p-1.5 qg-card">
        <button
          type="button"
          onClick={() => setMode("qr")}
          className={`qg-btn text-sm ${
            mode === "qr" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>Scan / Paste QR</span>
        </button>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setMode("file");
          }}
          className={`qg-btn text-sm ${
            mode === "file" ? "qg-btn-primary" : "bg-transparent text-[var(--ink-muted)]"
          }`}
        >
          <FileKey2 className="w-4 h-4" />
          <span>Import .qres File</span>
        </button>
      </div>

      {mode === "qr" ? (
        <div className="space-y-4">
          <div className="qg-card p-5 text-center space-y-3">
            <div className="w-full max-w-[280px] aspect-square mx-auto rounded-2xl overflow-hidden bg-slate-900 relative border border-[var(--border)]">
              {/* Isolated empty DOM container for html5-qrcode */}
              <div id="qg-verify-qr-reader" className="w-full h-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-slate-900 text-white">
                  <Camera className="w-10 h-10 text-slate-400 mb-3" />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={startCamera}
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
                className="qg-btn qg-btn-secondary text-xs"
              >
                Turn Off Camera
              </button>
            )}
            {cameraError && (
              <p className="text-xs font-medium text-[var(--danger)]">{cameraError}</p>
            )}
          </div>

          <div className="qg-card p-4 space-y-2.5">
            <label
              htmlFor="manual-qr-input"
              className="block text-xs font-semibold text-[var(--ink-muted)]"
            >
              Or paste Result QR string (<code>QG1O....</code> or <code>QG1R....</code>)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="manual-qr-input"
                className="qg-input font-mono text-xs flex-1"
                placeholder="QG1O.g10-q2-diagnostic...."
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") verifyQr(qrInput);
                }}
              />
              <button
                type="button"
                disabled={loading || !qrInput.trim()}
                onClick={() => verifyQr(qrInput)}
                className="qg-btn qg-btn-primary shrink-0"
              >
                {loading ? "Verifying..." : "Verify Code"}
              </button>
            </div>
          </div>

          {qrOutcome && (
            <div
              className={`qg-card p-5 border-t-4 space-y-2 ${
                qrOutcome.valid
                  ? "border-t-[var(--success)]"
                  : "border-t-[var(--danger)]"
              }`}
            >
              <div
                className={`flex items-center gap-2 font-bold text-lg ${
                  qrOutcome.valid ? "text-[var(--success)]" : "text-[var(--danger)]"
                }`}
              >
                {qrOutcome.valid ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <XCircle className="w-6 h-6" />
                )}
                <span>{qrOutcome.valid ? "Valid Student Result" : "Invalid / Unverified"}</span>
              </div>

              {qrOutcome.valid ? (
                <div className="text-sm space-y-1">
                  <p>
                    <b>Student:</b> {qrOutcome.studentName}{" "}
                    {qrOutcome.studentNo ? `(${qrOutcome.studentNo})` : ""}
                  </p>
                  <p className="tabular-nums">
                    <b>Score:</b> {qrOutcome.score} / {qrOutcome.maxScore}
                    {qrOutcome.lateCount ? ` (${qrOutcome.lateCount} late sync)` : ""}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Verified via{" "}
                    {qrOutcome.verifiedVia === "supabase"
                      ? "Supabase Database"
                      : qrOutcome.verifiedVia === "serverless"
                        ? "Serverless Verifier API"
                        : "Offline Signature Verifier"}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--danger)]">{qrOutcome.reason}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="qg-card p-6 text-center space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".json,.qres.json"
              multiple
              className="hidden"
              onChange={handleUploadResultFile}
            />
            <Upload className="w-10 h-10 text-[var(--primary)] mx-auto" />
            <div>
              <h2 className="font-bold text-base">Import Student .qres.json Submission(s)</h2>
              <p className="text-xs text-[var(--ink-muted)] mt-1">
                Select one or multiple encrypted submission files to verify scores and export CSV.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="qg-btn qg-btn-primary"
            >
              Choose .qres.json File(s)
            </button>
          </div>

          {fileOutcome && (
            <div
              className={`qg-card p-5 border-t-4 space-y-2 ${
                fileOutcome.valid ? "border-t-[var(--success)]" : "border-t-[var(--danger)]"
              }`}
            >
              {fileOutcome.valid && fileOutcome.submission ? (
                <>
                  <div className="flex items-center gap-2 text-[var(--success)] font-bold text-lg">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>Submission Decrypted &amp; Verified</span>
                  </div>
                  <p className="text-sm">
                    <b>Student:</b> {fileOutcome.submission.studentName} (
                    {fileOutcome.submission.studentNo})
                  </p>
                  <p className="text-sm tabular-nums">
                    <b>Quiz:</b> {fileOutcome.submission.packTitle} ·{" "}
                    <b>
                      {fileOutcome.submission.score}/{fileOutcome.submission.maxScore}
                    </b>
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Submitted at {new Date(fileOutcome.submission.submittedAt).toLocaleString()} ·{" "}
                    {fileOutcome.submission.answers.length} recorded responses
                  </p>
                </>
              ) : (
                <div className="text-[var(--danger)] text-sm font-semibold">
                  {fileOutcome.reason}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Verification History Log */}
      <div className="qg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-sm">Verified Scans ({logs.length})</h2>
          {logs.length > 0 && (
            <button type="button" onClick={exportCsv} className="qg-btn qg-btn-secondary text-xs min-h-[36px]">
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>

        {logs.length === 0 ? (
          <p className="text-xs text-[var(--ink-muted)]">No scans logged on this device yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-1.5 pr-2">Student</th>
                  <th className="py-1.5 pr-2">Score</th>
                  <th className="py-1.5 pr-2">Mode</th>
                  <th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--border)]">
                    <td className="py-1.5 pr-2 font-semibold">{l.studentName}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{l.scoreLabel}</td>
                    <td className="py-1.5 pr-2 capitalize">{l.verifiedVia}</td>
                    <td
                      className={`py-1.5 font-bold ${
                        l.valid ? "text-[var(--success)]" : "text-[var(--danger)]"
                      }`}
                    >
                      {l.valid ? "VALID" : "INVALID"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
