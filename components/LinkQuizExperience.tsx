"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  QrCode,
  RefreshCw,
  Share2,
  ShieldAlert,
  Unlock,
  UploadCloud,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  decodeLinkHashFragment,
  encryptLinkResultPacket,
  unlockLinkQuizBundle,
  verifySignedStartCode,
  type EncryptedLinkResultPacket,
  type LinkQuizSecretPayload,
  type LinkRunEnvelope,
} from "@/lib/crypto/linkVault";
import {
  calculateClockOffsetMs,
  evaluateMonotonicClockTick,
  formatCountdown,
} from "@/lib/timer/clockSync";
import { offlineDb, type LinkStudentAttemptRecord } from "@/lib/offline/storage";
import { QrCanvas } from "./QrCanvas";

function sanitizeFilenamePart(val: string): string {
  return (
    val
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "student"
  );
}

function downloadResultPacketFile(
  packet: EncryptedLinkResultPacket,
  studentName: string,
  runId: string
) {
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quizgate-${sanitizeFilenamePart(studentName)}-${runId}.qres.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function ensureOfflineDeviceId(): Promise<string> {
  const existing = await offlineDb.linkDeviceMeta.get("device");
  if (existing?.deviceId) return existing.deviceId;
  const fresh = crypto.randomUUID();
  await offlineDb.linkDeviceMeta.put({ key: "device", deviceId: fresh });
  return fresh;
}

async function cacheRouteForOffline(pathname: string, versionHash: string) {
  if (typeof window !== "undefined" && navigator.onLine && typeof caches !== "undefined") {
    try {
      const cache = await caches.open("quizgate-pwa-cache-v4");
      const res = await fetch(pathname, { cache: "reload" });
      if (res && res.ok) {
        await cache.put(pathname, res.clone());
        if (versionHash) {
          await cache.put(`${pathname}?v=${encodeURIComponent(versionHash)}`, res);
        }
      }

      // Ensure static chunks/stylesheets needed by this page are cached before Ready Offline
      const assetUrls = new Set<string>();
      document.querySelectorAll('script[src], link[rel="stylesheet"]').forEach((el) => {
        const attr = el.getAttribute("src") || el.getAttribute("href");
        if (!attr) return;
        try {
          const u = new URL(attr, window.location.origin);
          if (u.origin === window.location.origin) assetUrls.add(u.pathname + u.search);
        } catch {
          // ignore
        }
      });
      await Promise.allSettled(
        Array.from(assetUrls).map(async (u) => {
          if (await cache.match(u)) return;
          const r = await fetch(u);
          if (r && r.ok) await cache.put(u, r);
        })
      );
    } catch {
      // Best-effort route/chunk caching
    }
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((res) => setTimeout(() => res(null), 1500)),
      ]);
      reg?.active?.postMessage({
        type: "CACHE_RUN_ROUTE",
        url: pathname,
        versionHash,
      });
      if (!navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
              once: true,
            });
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 1200)),
        ]);
      }
    } catch {
      // Ignore SW messaging failures cleanly
    }
  }
}

export function LinkQuizExperience({ runId }: { runId: string }) {
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);

  const [envelope, setEnvelope] = useState<LinkRunEnvelope | null>(null);
  const [packReady, setPackReady] = useState(false);
  const [attempt, setAttempt] = useState<LinkStudentAttemptRecord | null>(null);
  const [unlockedPayload, setUnlockedPayload] = useState<LinkQuizSecretPayload | null>(null);

  // Join form inputs
  const [fullName, setFullName] = useState("");
  const [section, setSection] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Waiting room & offline start code
  const [isOnline, setIsOnline] = useState(true);
  const [startCodeInput, setStartCodeInput] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  // Quiz taking & timer state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [syncingUpload, setSyncingUpload] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const clockOffsetMsRef = useRef<number>(0);
  const lastPerfRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  const finalizingRef = useRef(false);
  const attemptRef = useRef<LinkStudentAttemptRecord | null>(null);
  const envelopeRef = useRef<LinkRunEnvelope | null>(null);
  const unlockedRef = useRef<LinkQuizSecretPayload | null>(null);
  const qrScannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  attemptRef.current = attempt;
  envelopeRef.current = envelope;
  unlockedRef.current = unlockedPayload;

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const stopCamera = useCallback(async () => {
    if (qrScannerRef.current) {
      try {
        await qrScannerRef.current.stop();
        qrScannerRef.current.clear();
      } catch {
        // Ignore camera cleanup issues
      }
      qrScannerRef.current = null;
    }
    setScanOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // Complete, grade, encrypt, auto-download ONCE, and auto-POST if online
  const finalizeAttempt = useCallback(
    async (reason: "manual" | "auto_timer" | "reopen_expired") => {
      if (finalizingRef.current) return;
      const curAttempt = attemptRef.current;
      const curEnv = envelopeRef.current;
      if (!curAttempt || !curEnv || curAttempt.status === "submitted") return;

      finalizingRef.current = true;
      try {
        const secretData = unlockedRef.current || (await unlockLinkQuizBundle(curEnv));
        if (!unlockedRef.current) {
          unlockedRef.current = secretData;
          setUnlockedPayload(secretData);
        }

        let score = 0;
        let maxScore = 0;
        const answersList = secretData.questions
          .map((q) => {
            maxScore += q.points;
            const recorded = curAttempt.answers[q.id];
            if (!recorded) return null;
            const isCorrect = recorded.selectedIndex === q.correctIndex;
            if (isCorrect) score += q.points;
            return {
              questionId: q.id,
              selectedIndex: recorded.selectedIndex,
              isCorrect,
              answeredAt: recorded.answeredAt,
              lateSync: false,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const nowMs = Date.now();
        const endsAtMs = curAttempt.endsAtMs || nowMs;
        const startedAtMs = curAttempt.startedAtMs || nowMs;
        const submittedOffline = typeof navigator !== "undefined" ? !navigator.onLine : false;
        const lateAfterEnd = reason !== "manual" ? reason === "reopen_expired" && nowMs > endsAtMs + 15_000 : nowMs > endsAtMs + 15_000;
        const submittedAtIso = new Date(nowMs).toISOString();

        const { packet, plain, resultQr } = await encryptLinkResultPacket(
          {
            v: 3,
            runId: curEnv.runId,
            versionHash: curEnv.versionHash,
            quizId: curEnv.quizId,
            quizTitle: curEnv.title,
            classId: curEnv.classId,
            className: curEnv.className,
            attemptId: curAttempt.attemptId,
            deviceId: curAttempt.deviceId,
            studentName: curAttempt.studentName,
            section: curAttempt.section,
            score,
            maxScore,
            answeredCount: answersList.length,
            totalQuestions: secretData.questions.length,
            startedAt: new Date(startedAtMs).toISOString(),
            endsAt: new Date(endsAtMs).toISOString(),
            submittedAt: submittedAtIso,
            submittedOffline,
            clockTampered: curAttempt.clockTampered,
            lateAfterEnd,
            answers: answersList,
          },
          secretData.resultSecret
        );

        let syncedOnline = false;
        if (typeof navigator !== "undefined" && navigator.onLine) {
          try {
            const res = await fetch(`/api/run/${encodeURIComponent(curEnv.runId)}/submit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packet, plain }),
            });
            syncedOnline = res.ok;
          } catch {
            syncedOnline = false;
          }
        }

        const completedRecord: LinkStudentAttemptRecord = {
          ...curAttempt,
          status: "submitted",
          score,
          maxScore,
          submittedAt: submittedAtIso,
          submittedOffline,
          lateAfterEnd,
          resultPacketJson: JSON.stringify(packet),
          resultQr,
          autoDownloaded: true,
          syncedToServer: syncedOnline,
        };

        await offlineDb.linkAttempts.put(completedRecord);
        attemptRef.current = completedRecord;
        setAttempt(completedRecord);
        setRemainingSeconds(0);

        // Auto-download `.qres.json` once on transition into submitted state
        if (!curAttempt.autoDownloaded) {
          downloadResultPacketFile(packet, completedRecord.studentName, curEnv.runId);
        }
      } finally {
        finalizingRef.current = false;
      }
    },
    []
  );

  // Unlock questions ONLY once run start is verified (online server start or offline Start Code)
  const unlockQuizFromStart = useCallback(
    async (startedAtMs: number, endsAtMs: number) => {
      const curAttempt = attemptRef.current;
      const curEnv = envelopeRef.current;
      if (!curAttempt || !curEnv) return;
      if (curAttempt.status === "submitted") return;

      // Idempotent guard: never overwrite original start/deadline timestamps
      const finalStartedMs = curAttempt.startedAtMs ?? startedAtMs;
      const finalEndsMs = curAttempt.endsAtMs ?? endsAtMs;

      const secretPayload = await unlockLinkQuizBundle(curEnv);
      unlockedRef.current = secretPayload;
      setUnlockedPayload(secretPayload);

      const nowMs = Date.now();
      const tick = evaluateMonotonicClockTick({
        startedAtMs: finalStartedMs,
        endsAtMs: finalEndsMs,
        prevWallMs: curAttempt.lastTickWallMs ?? nowMs,
        prevAccumElapsedMs: curAttempt.accumulatedElapsedMs ?? 0,
        nowWallMs: nowMs,
        tabPerfDeltaMs: 0,
        alreadyTampered: curAttempt.clockTampered,
      });

      const nextRecord: LinkStudentAttemptRecord = {
        ...curAttempt,
        status: "in_progress",
        unlocked: true,
        startedAtMs: finalStartedMs,
        endsAtMs: finalEndsMs,
        lastTickWallMs: tick.nextWallMs,
        accumulatedElapsedMs: tick.nextAccumElapsedMs,
        clockTampered: tick.clockTampered,
      };

      await offlineDb.linkAttempts.put(nextRecord);
      attemptRef.current = nextRecord;
      setAttempt(nextRecord);
      setRemainingSeconds(tick.remainingSeconds);
      lastPerfRef.current = performance.now();

      if (tick.expired) {
        await finalizeAttempt("reopen_expired");
      }
    },
    [finalizeAttempt]
  );

  // Initial load: IndexedDB probe + decrypt/verify hash + cache offline pack & route
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        // 1. Storage & quota probe (Private Mode protection)
        if (!offlineDb) {
          throw new Error("IndexedDB storage is required to take quizzes.");
        }
        try {
          await ensureOfflineDeviceId();
        } catch {
          if (!active) return;
          setStorageWarning(
            "Browser storage is blocked (possibly Private/Incognito mode). Turn off Private Mode so your answers stay saved offline."
          );
          setLoading(false);
          return;
        }

        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (est.quota && est.quota < 500_000) {
            setStorageWarning(
              "Very low browser storage detected. Free device space so your quiz answers can save reliably."
            );
          }
        }

        // 2. Decode hash fragment or recover verified cached bundle from IndexedDB
        const rawHash = typeof window !== "undefined" ? window.location.hash : "";
        let loadedEnvelope: LinkRunEnvelope | null = null;
        const cached = await offlineDb.cachedLinkPacks.get(runId);

        if (rawHash && rawHash.length > 5) {
          loadedEnvelope = await decodeLinkHashFragment(rawHash);
          if (loadedEnvelope.runId !== runId) {
            throw new Error(`Quiz link mismatch: expected run ${runId}, got ${loadedEnvelope.runId}.`);
          }
          if (cached && cached.versionHash !== loadedEnvelope.versionHash) {
            setStaleWarning(
              "Teacher updated this quiz link. Using the latest version from your URL."
            );
          }
          await offlineDb.cachedLinkPacks.put({
            runId,
            versionHash: loadedEnvelope.versionHash,
            envelopeJson: JSON.stringify(loadedEnvelope),
            shareUrl: `${window.location.pathname}${window.location.hash}`,
            cachedAt: new Date().toISOString(),
            packVerified: true,
          });
        } else if (cached?.packVerified && cached.envelopeJson) {
          loadedEnvelope = JSON.parse(cached.envelopeJson) as LinkRunEnvelope;
        } else {
          throw new Error(
            "Quiz data missing from link and not cached on this device yet. Open the full link shared by your teacher."
          );
        }

        if (!active) return;
        envelopeRef.current = loadedEnvelope;
        setEnvelope(loadedEnvelope);
        if (loadedEnvelope.sections.length > 0) {
          setSection((prev) => prev || loadedEnvelope!.sections[0]);
        }

        // Trigger SW/Cache Storage route caching for offline reloads
        await cacheRouteForOffline(window.location.pathname, loadedEnvelope.versionHash);
        if (!active) return;
        setPackReady(true);

        // 3. Recover any existing attempt cleanly
        const existingAttempt = await offlineDb.linkAttempts.get(runId);
        if (existingAttempt) {
          if (existingAttempt.versionHash !== loadedEnvelope.versionHash && !existingAttempt.staleVersion) {
            existingAttempt.staleVersion = true;
            setStaleWarning(
              "Warning: Your cached attempt used an earlier version of this quiz link."
            );
          }
          attemptRef.current = existingAttempt;
          setAttempt(existingAttempt);

          if (existingAttempt.status === "in_progress" && existingAttempt.unlocked) {
            const secretPayload = await unlockLinkQuizBundle(loadedEnvelope);
            if (!active) return;
            unlockedRef.current = secretPayload;
            setUnlockedPayload(secretPayload);

            const nowMs = Date.now();
            const tick = evaluateMonotonicClockTick({
              startedAtMs: existingAttempt.startedAtMs || nowMs,
              endsAtMs: existingAttempt.endsAtMs || nowMs,
              prevWallMs: existingAttempt.lastTickWallMs || nowMs,
              prevAccumElapsedMs: existingAttempt.accumulatedElapsedMs || 0,
              nowWallMs: nowMs,
              tabPerfDeltaMs: 0,
              alreadyTampered: existingAttempt.clockTampered,
            });

            const syncedRec: LinkStudentAttemptRecord = {
              ...existingAttempt,
              lastTickWallMs: tick.nextWallMs,
              accumulatedElapsedMs: tick.nextAccumElapsedMs,
              clockTampered: tick.clockTampered,
            };
            await offlineDb.linkAttempts.put(syncedRec);
            attemptRef.current = syncedRec;
            setAttempt(syncedRec);
            setRemainingSeconds(tick.remainingSeconds);
            lastPerfRef.current = performance.now();

            if (tick.expired) {
              await finalizeAttempt("reopen_expired");
            }
          }
        }
      } catch (err) {
        if (!active) return;
        setFatalError(err instanceof Error ? err.message : "Could not open Quiz Link.");
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [runId, finalizeAttempt]);

  // Online Waiting Room 3-second poll + /api/time offset sync
  useEffect(() => {
    if (!attempt || attempt.status !== "waiting" || !isOnline || !envelope) return;

    let cancelled = false;
    const pollRunState = async () => {
      try {
        const reqStart = Date.now();
        const res = await fetch(`/api/run/${encodeURIComponent(runId)}/state`, {
          cache: "no-store",
        });
        const reqEnd = Date.now();
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          exists?: boolean;
          status?: "waiting" | "running" | "ended";
          versionHash?: string;
          startedAtServer?: number;
          endsAtServer?: number;
          serverNow?: number;
        };

        if (typeof data.serverNow === "number") {
          clockOffsetMsRef.current = calculateClockOffsetMs(data.serverNow, reqStart, reqEnd);
        }

        if (data.exists && data.versionHash && data.versionHash !== envelope.versionHash) {
          setStaleWarning(
            "Teacher published a newer version of this quiz. Ask for the updated link and reload."
          );
        }

        if (data.status === "running" && data.startedAtServer) {
          const offset = clockOffsetMsRef.current;
          const localStart = data.startedAtServer - offset;
          const localEnd = data.endsAtServer
            ? data.endsAtServer - offset
            : localStart + envelope.durationMinutes * 60_000;
          await unlockQuizFromStart(localStart, localEnd);
        }
      } catch {
        // Offline / network drop is normal; student can use Start Code offline
      }
    };

    pollRunState();
    const timer = setInterval(pollRunState, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [attempt, envelope, isOnline, runId, unlockQuizFromStart]);

  // Monotonic + wall-clock active quiz ticker & visibility guard
  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress" || !attempt.unlocked) return;

    lastPerfRef.current = performance.now();

    const runTick = async () => {
      const cur = attemptRef.current;
      if (!cur || cur.status !== "in_progress" || !cur.startedAtMs || !cur.endsAtMs) return;

      const nowPerf = performance.now();
      const perfDelta = Math.max(0, nowPerf - lastPerfRef.current);
      lastPerfRef.current = nowPerf;

      const tick = evaluateMonotonicClockTick({
        startedAtMs: cur.startedAtMs,
        endsAtMs: cur.endsAtMs,
        prevWallMs: cur.lastTickWallMs ?? cur.startedAtMs,
        prevAccumElapsedMs: cur.accumulatedElapsedMs,
        nowWallMs: Date.now(),
        tabPerfDeltaMs: perfDelta,
        alreadyTampered: cur.clockTampered,
      });

      setRemainingSeconds(tick.remainingSeconds);

      if (tick.clockTampered && !cur.clockTampered) {
        const updated: LinkStudentAttemptRecord = {
          ...cur,
          lastTickWallMs: tick.nextWallMs,
          accumulatedElapsedMs: tick.nextAccumElapsedMs,
          clockTampered: true,
        };
        attemptRef.current = updated;
        setAttempt(updated);
        await offlineDb.linkAttempts.put(updated);
      } else {
        await offlineDb.linkAttempts.update(cur.runId, {
          lastTickWallMs: tick.nextWallMs,
          accumulatedElapsedMs: tick.nextAccumElapsedMs,
          clockTampered: tick.clockTampered,
        });
      }

      if (tick.expired) {
        await finalizeAttempt("auto_timer");
      }
    };

    const interval = setInterval(runTick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        runTick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [attempt?.status, attempt?.unlocked, finalizeAttempt]);

  const handleJoinWaitingRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    if (!envelope || !packReady || storageWarning) return;

    const cleanName = fullName.trim().replace(/\s+/g, " ");
    const cleanSection = section.trim().replace(/\s+/g, " ");
    if (!cleanName || !cleanSection) {
      setJoinError("Enter both your Full Name and Section.");
      return;
    }

    setJoining(true);
    try {
      const deviceId = await ensureOfflineDeviceId();
      const newAttempt: LinkStudentAttemptRecord = {
        runId: envelope.runId,
        versionHash: envelope.versionHash,
        attemptId: crypto.randomUUID(),
        deviceId,
        studentName: cleanName,
        section: cleanSection,
        status: "waiting",
        unlocked: false,
        accumulatedElapsedMs: 0,
        clockTampered: false,
        answers: {},
        submittedOffline: false,
        lateAfterEnd: false,
      };
      await offlineDb.linkAttempts.put(newAttempt);
      attemptRef.current = newAttempt;
      setAttempt(newAttempt);

      if (navigator.onLine) {
        try {
          await fetch(`/api/run/${encodeURIComponent(envelope.runId)}/state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attemptId: newAttempt.attemptId,
              deviceId,
              studentName: cleanName,
              section: cleanSection,
              meta: {
                versionHash: envelope.versionHash,
                classId: envelope.classId,
                className: envelope.className,
                quizId: envelope.quizId,
                title: envelope.title,
                durationMinutes: envelope.durationMinutes,
                createdAtSec: envelope.createdAtSec,
              },
            }),
          });
        } catch {
          // Offline waiting room works identically without server call
        }
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not enter Waiting Room.");
    } finally {
      setJoining(false);
    }
  };

  const handleVerifyStartCode = async (rawCode: string) => {
    if (!envelope) return;
    setStartError(null);
    setUnlocking(true);
    try {
      const check = await verifySignedStartCode(rawCode, envelope);
      if (!check.valid || !check.startEpochSec) {
        setStartError(check.reason || "Invalid Start Code.");
        return;
      }
      await stopCamera();
      const startMs = check.startEpochSec * 1000;
      const endMs = startMs + envelope.durationMinutes * 60_000;
      await unlockQuizFromStart(startMs, endMs);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to verify Start Code.");
    } finally {
      setUnlocking(false);
    }
  };

  const startQrScanner = async () => {
    setStartError(null);
    setScanOpen(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qg-start-qr-reader");
      qrScannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          await handleVerifyStartCode(decodedText);
        },
        () => {}
      );
    } catch (err) {
      setScanOpen(false);
      setStartError(
        err instanceof Error
          ? err.message
          : "Camera permission denied. Type the 10-character Start Code instead."
      );
    }
  };

  const handleSelectOption = async (questionId: string, selectedIndex: number) => {
    const cur = attemptRef.current;
    const payload = unlockedRef.current;
    if (!cur || !payload || cur.status !== "in_progress" || !cur.unlocked) return;
    if (finalizingRef.current || remainingSeconds <= 0) return;

    const q = payload.questions.find((item) => item.id === questionId);
    if (!q) return;

    const updated: LinkStudentAttemptRecord = {
      ...cur,
      answers: {
        ...cur.answers,
        [questionId]: {
          questionId,
          selectedIndex,
          isCorrect: selectedIndex === q.correctIndex,
          answeredAt: new Date().toISOString(),
          lateSync: false,
        },
      },
    };
    attemptRef.current = updated;
    setAttempt(updated);
    await offlineDb.linkAttempts.put(updated);
  };

  const parsedResultPacket = useMemo<EncryptedLinkResultPacket | null>(() => {
    if (!attempt?.resultPacketJson) return null;
    try {
      return JSON.parse(attempt.resultPacketJson) as EncryptedLinkResultPacket;
    } catch {
      return null;
    }
  }, [attempt?.resultPacketJson]);

  const handleShareResultFile = async () => {
    if (!parsedResultPacket || !attempt || !envelope) return;
    setShareNote(null);
    const filename = `quizgate-${sanitizeFilenamePart(attempt.studentName)}-${envelope.runId}.qres.json`;
    const file = new File([JSON.stringify(parsedResultPacket, null, 2)], filename, {
      type: "application/json",
    });

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `QuizGate Result: ${attempt.studentName}`,
            text: `${attempt.studentName} (${attempt.section}) — ${attempt.score}/${attempt.maxScore}`,
            files: [file],
          });
          setShareNote("Shared submission file successfully.");
          return;
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    downloadResultPacketFile(parsedResultPacket, attempt.studentName, envelope.runId);
    setShareNote("Downloaded .qres.json file — attach and send it to your teacher.");
  };

  const handleRetryOnlineSync = async () => {
    if (!parsedResultPacket || !attempt || !envelope) return;
    setSyncingUpload(true);
    setShareNote(null);
    try {
      const secretData = unlockedPayload || (await unlockLinkQuizBundle(envelope));
      const answersList = Object.values(attempt.answers);
      const { packet, plain } = await encryptLinkResultPacket(
        {
          v: 3,
          runId: envelope.runId,
          versionHash: envelope.versionHash,
          quizId: envelope.quizId,
          quizTitle: envelope.title,
          classId: envelope.classId,
          className: envelope.className,
          attemptId: attempt.attemptId,
          deviceId: attempt.deviceId,
          studentName: attempt.studentName,
          section: attempt.section,
          score: attempt.score || 0,
          maxScore: attempt.maxScore || 0,
          answeredCount: answersList.length,
          totalQuestions: secretData.questions.length,
          startedAt: new Date(attempt.startedAtMs || Date.now()).toISOString(),
          endsAt: new Date(attempt.endsAtMs || Date.now()).toISOString(),
          submittedAt: attempt.submittedAt || new Date().toISOString(),
          submittedOffline: attempt.submittedOffline,
          clockTampered: attempt.clockTampered,
          lateAfterEnd: attempt.lateAfterEnd,
          answers: answersList,
        },
        secretData.resultSecret
      );
      const res = await fetch(`/api/run/${encodeURIComponent(envelope.runId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet, plain }),
      });
      if (res.ok) {
        const updated = { ...attempt, syncedToServer: true };
        await offlineDb.linkAttempts.put(updated);
        setAttempt(updated);
        setShareNote("Synced to teacher server!");
      } else {
        setShareNote("Server unavailable right now — send your .qres.json file instead.");
      }
    } catch {
      setShareNote("Could not sync online yet. Use Download / Share .qres.json.");
    } finally {
      setSyncingUpload(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-xl mx-auto qg-card p-6 text-center space-y-2">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[var(--primary)]" />
        <p className="text-sm font-semibold">Preparing encrypted quiz for offline use...</p>
      </div>
    );
  }

  if (storageWarning || fatalError || !envelope) {
    return (
      <div className="max-w-xl mx-auto qg-card p-6 space-y-4">
        <div className="flex items-start gap-3 text-[var(--danger)]">
          <ShieldAlert className="w-6 h-6 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-lg font-bold">Cannot Open Quiz Link</h1>
            <p className="text-sm mt-1">{storageWarning || fatalError}</p>
          </div>
        </div>
        <Link href="/" className="qg-btn qg-btn-secondary text-xs">
          Back to Home
        </Link>
      </div>
    );
  }

  const questions = unlockedPayload?.questions || [];
  const activeQuestion = questions[currentIdx];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header Metadata & Offline Status */}
      <div className="qg-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wider">
              {envelope.className} · Run {envelope.runId}
            </p>
            <h1 className="text-xl font-bold mt-0.5">{envelope.title}</h1>
          </div>

          <div className="flex items-center gap-2">
            {packReady && (
              <span
                data-testid="ready-offline-badge"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--success-soft)] text-[var(--success)]"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Ready Offline</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--surface-subtle)] border border-[var(--border)]">
              {isOnline ? <Wifi className="w-3.5 h-3.5 text-[var(--success)]" /> : <WifiOff className="w-3.5 h-3.5 text-[var(--warning)]" />}
              <span>{isOnline ? "Online" : "Offline"}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-[var(--ink-muted)]">
          <span>Duration: <strong>{envelope.durationMinutes} min</strong></span>
          <span>Questions: <strong>{envelope.questionCount}</strong></span>
          <span>Instant Feedback: <strong>{envelope.instantFeedback ? "Yes" : "After Submit"}</strong></span>
        </div>

        {staleWarning && (
          <div className="p-3 rounded-xl bg-[var(--warning-soft)] text-[var(--warning)] text-xs font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{staleWarning}</span>
          </div>
        )}
      </div>

      {/* Stage 1: No login/register — Full Name + Section */}
      {!attempt && (
        <form onSubmit={handleJoinWaitingRoom} className="qg-card p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold">Enter Your Name to Join</h2>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              No password or student number needed. Your answers are saved safely on this device even if internet drops.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="student-full-name" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Full Name
              </label>
              <input
                id="student-full-name"
                className="qg-input"
                placeholder="e.g. Maria Santos"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="student-section" className="block text-xs font-semibold text-[var(--ink-muted)] mb-1">
                Section
              </label>
              {envelope.sections.length > 0 ? (
                <select
                  id="student-section"
                  className="qg-input"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  required
                >
                  {envelope.sections.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="student-section"
                  className="qg-input"
                  placeholder="e.g. 10-Rizal"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          {joinError && (
            <p className="text-xs text-[var(--danger)] font-medium">{joinError}</p>
          )}

          <button
            type="submit"
            disabled={!packReady || joining || !fullName.trim() || !section.trim()}
            className="qg-btn qg-btn-primary w-full"
          >
            {joining ? "Joining Waiting Room..." : "Enter Waiting Room"}
          </button>
        </form>
      )}

      {/* Stage 2: Waiting Room (Encrypted until teacher starts) */}
      {attempt?.status === "waiting" && (
        <div className="qg-card p-5 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Waiting Room — Questions Are Locked</h2>
              <p className="text-xs text-[var(--ink-muted)] mt-1">
                Joined as <strong>{attempt.studentName}</strong> ({attempt.section}).
                {isOnline
                  ? " Automatically listening for your teacher to click Start, or enter the Start Code below."
                  : " You are offline — type or scan your teacher's Start Code below to begin."}
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerifyStartCode(startCodeInput);
            }}
            className="space-y-3 pt-3 border-t border-[var(--border)]"
          >
            <label htmlFor="start-code-input" className="block text-xs font-semibold text-[var(--ink-muted)]">
              Enter Teacher&apos;s Start Code (Offline or Online)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="start-code-input"
                className="qg-input uppercase font-mono tracking-wider"
                placeholder="e.g. 4K8M2-P9QWR"
                value={startCodeInput}
                onChange={(e) => setStartCodeInput(e.target.value)}
              />
              <button
                type="submit"
                disabled={unlocking || !startCodeInput.trim()}
                className="qg-btn qg-btn-primary shrink-0"
              >
                <Unlock className="w-4 h-4" />
                <span>{unlocking ? "Verifying..." : "Unlock Quiz"}</span>
              </button>
              <button
                type="button"
                onClick={scanOpen ? stopCamera : startQrScanner}
                className="qg-btn qg-btn-secondary shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>{scanOpen ? "Stop" : "Scan QR"}</span>
              </button>
            </div>
            {startError && (
              <div className="p-3 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-semibold">
                {startError}
              </div>
            )}
          </form>

          {scanOpen && (
            <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-black/5 p-2">
              <div id="qg-start-qr-reader" className="w-full max-w-xs mx-auto" />
            </div>
          )}
        </div>
      )}

      {/* Stage 3: Unlocked Active Quiz */}
      {attempt?.status === "in_progress" && activeQuestion && (
        <div className="qg-card p-5 space-y-5">
          {/* Timer + Question Counter */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
            <div className="text-xs font-semibold text-[var(--ink-muted)]">
              Question {currentIdx + 1} of {questions.length} ·{" "}
              <span className="text-[var(--ink)]">{attempt.studentName}</span>
            </div>

            <div className="flex items-center gap-2">
              {attempt.clockTampered && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--danger-soft)] text-[var(--danger)]">
                  Clock Jump Flagged
                </span>
              )}
              <div
                data-testid="quiz-timer"
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-mono font-bold tabular-nums ${
                  remainingSeconds <= 60
                    ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                    : "bg-[var(--primary-soft)] text-[var(--primary)]"
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>{formatCountdown(remainingSeconds)}</span>
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold leading-snug">{activeQuestion.prompt}</h2>
            <p className="text-xs text-[var(--ink-muted)]">{activeQuestion.points} point(s) · Saved instantly offline</p>

            <div className="space-y-2.5">
              {activeQuestion.options.map((opt, idx) => {
                const chosen = attempt.answers[activeQuestion.id]?.selectedIndex === idx;
                const lockedOut = remainingSeconds <= 0 || finalizingRef.current;
                const showCorrect =
                  envelope.instantFeedback && chosen && idx === activeQuestion.correctIndex;
                const showWrong =
                  envelope.instantFeedback && chosen && idx !== activeQuestion.correctIndex;

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={lockedOut}
                    onClick={() => handleSelectOption(activeQuestion.id, idx)}
                    className={`w-full text-left p-3.5 rounded-xl border text-sm font-medium transition min-h-[48px] flex items-center justify-between gap-2 ${
                      showCorrect
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : showWrong
                          ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300"
                          : chosen
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--primary)]"
                    }`}
                  >
                    <span>
                      <strong className="mr-2 font-mono">{String.fromCharCode(65 + idx)}.</strong>
                      {opt}
                    </span>
                    {chosen && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {envelope.instantFeedback && attempt.answers[activeQuestion.id] && activeQuestion.explanation && (
              <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] text-xs text-[var(--ink-muted)]">
                <strong>Explanation:</strong> {activeQuestion.explanation}
              </div>
            )}
          </div>

          {/* Navigation + Finish */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="qg-btn qg-btn-secondary text-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>

            <div className="flex flex-wrap gap-1.5">
              {questions.map((q, idx) => {
                const answered = Boolean(attempt.answers[q.id]);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold ${
                      idx === currentIdx
                        ? "bg-[var(--primary)] text-white"
                        : answered
                          ? "bg-[var(--success-soft)] text-[var(--success)]"
                          : "bg-[var(--surface-subtle)] text-[var(--ink-muted)]"
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {currentIdx < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                className="qg-btn qg-btn-primary text-xs"
              >
                <span>Next</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => finalizeAttempt("manual")}
                className="qg-btn qg-btn-primary text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Finish &amp; Generate File</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stage 4: Result Screen + Auto-Download / Web Share / Result QR */}
      {attempt?.status === "submitted" && parsedResultPacket && (
        <div className="qg-card p-5 space-y-5">
          <div className="p-4 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/25 space-y-1">
            <p className="text-sm font-bold text-[var(--primary)]">
              Send this file to your teacher
            </p>
            <p className="text-xs text-[var(--ink)]">
              Your encrypted submission file (<code>.qres.json</code>) is saved and signed.
              {attempt.syncedToServer
                ? " It also synced automatically to your teacher's online dashboard."
                : " Send the downloaded file via chat, USB, Bluetooth, or show the Result QR below."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--ink-muted)]">
                {attempt.studentName} · Section {attempt.section}
              </p>
              <h2 className="text-2xl font-bold mt-0.5 tabular-nums">
                Score: {attempt.score} / {attempt.maxScore}
              </h2>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {attempt.syncedToServer && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--success-soft)] text-[var(--success)]">
                  Synced Online
                </span>
              )}
              {attempt.submittedOffline && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--warning-soft)] text-[var(--warning)]">
                  Submitted Offline
                </span>
              )}
              {attempt.clockTampered && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--danger-soft)] text-[var(--danger)]">
                  Clock Tampered
                </span>
              )}
              {attempt.lateAfterEnd && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--danger-soft)] text-[var(--danger)]">
                  Submitted After Deadline
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => downloadResultPacketFile(parsedResultPacket, attempt.studentName, envelope.runId)}
              className="qg-btn qg-btn-primary text-xs"
            >
              <Download className="w-4 h-4" />
              <span>Download .qres.json</span>
            </button>

            <button
              type="button"
              onClick={handleShareResultFile}
              className="qg-btn qg-btn-secondary text-xs"
            >
              <Share2 className="w-4 h-4" />
              <span>Share File</span>
            </button>

            {isOnline && !attempt.syncedToServer && (
              <button
                type="button"
                disabled={syncingUpload}
                onClick={handleRetryOnlineSync}
                className="qg-btn qg-btn-secondary text-xs"
              >
                <UploadCloud className="w-4 h-4" />
                <span>{syncingUpload ? "Uploading..." : "Upload Online Now"}</span>
              </button>
            )}
          </div>

          {shareNote && (
            <p className="text-xs text-[var(--primary)] font-medium">{shareNote}</p>
          )}

          {attempt.resultQr && (
            <div className="pt-4 border-t border-[var(--border)] flex flex-col items-center space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-muted)]">
                <QrCode className="w-4 h-4" />
                <span>Result Verification QR (Teacher Backup)</span>
              </div>
              <div className="max-w-xs w-full">
                <QrCanvas
                  value={attempt.resultQr}
                  title={`${attempt.studentName} (${attempt.section})`}
                  subtitle={`Score: ${attempt.score}/${attempt.maxScore} · Run ${envelope.runId}`}
                  filename={`quizgate-qr-${envelope.runId}.png`}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
