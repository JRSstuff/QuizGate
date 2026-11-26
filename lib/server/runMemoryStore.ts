import type { LinkResultPlainPayload, EncryptedLinkResultPacket } from "../crypto/linkVault";

export interface JoinedOnlineStudent {
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  joinedAt: string;
}

export interface ServerLinkRunState {
  runId: string;
  versionHash: string;
  classId: string;
  className: string;
  quizId: string;
  title: string;
  durationMinutes: number;
  createdAtSec: number;
  status: "waiting" | "running" | "ended";
  startedAtServer?: number; // epoch ms when teacher clicked Start
  endsAtServer?: number;    // epoch ms = startedAtServer + duration
  endedAtServer?: number;
  startCode?: string;
  startQr?: string;
  joined: JoinedOnlineStudent[];
  submissions: {
    packet: EncryptedLinkResultPacket;
    plain: LinkResultPlainPayload;
    receivedAt: string;
  }[];
}

declare global {
  // eslint-disable-next-line no-var
  var __qgLinkRunsStore: Map<string, ServerLinkRunState> | undefined;
}

function getStore(): Map<string, ServerLinkRunState> {
  if (!globalThis.__qgLinkRunsStore) {
    globalThis.__qgLinkRunsStore = new Map<string, ServerLinkRunState>();
  }
  return globalThis.__qgLinkRunsStore;
}

export function upsertServerRun(input: {
  runId: string;
  versionHash: string;
  classId: string;
  className: string;
  quizId: string;
  title: string;
  durationMinutes: number;
  createdAtSec: number;
}): ServerLinkRunState {
  const store = getStore();
  const existing = store.get(input.runId);
  if (existing) {
    const updated: ServerLinkRunState = {
      ...existing,
      versionHash: input.versionHash,
      classId: input.classId,
      className: input.className,
      quizId: input.quizId,
      title: input.title,
      durationMinutes: input.durationMinutes,
    };
    store.set(input.runId, updated);
    return updated;
  }
  const fresh: ServerLinkRunState = {
    ...input,
    status: "waiting",
    joined: [],
    submissions: [],
  };
  store.set(input.runId, fresh);
  return fresh;
}

export function startServerRun(
  runId: string,
  meta: {
    versionHash?: string;
    classId?: string;
    className?: string;
    quizId?: string;
    title?: string;
    durationMinutes?: number;
    createdAtSec?: number;
    startCode?: string;
    startQr?: string;
    startedAtSec?: number;
  }
): ServerLinkRunState | null {
  const store = getStore();
  let run = store.get(runId);
  if (!run && meta.title && meta.durationMinutes) {
    run = upsertServerRun({
      runId,
      versionHash: meta.versionHash || "",
      classId: meta.classId || "default",
      className: meta.className || "Class",
      quizId: meta.quizId || runId,
      title: meta.title,
      durationMinutes: meta.durationMinutes,
      createdAtSec: meta.createdAtSec || Math.floor(Date.now() / 1000),
    });
  }
  if (!run) return null;

  // Idempotent: never overwrite existing start timestamp once started!
  if (run.status === "waiting") {
    const startMs = meta.startedAtSec ? meta.startedAtSec * 1000 : Date.now();
    run = {
      ...run,
      status: "running",
      startedAtServer: startMs,
      endsAtServer: startMs + run.durationMinutes * 60 * 1000,
      startCode: meta.startCode || run.startCode,
      startQr: meta.startQr || run.startQr,
    };
    store.set(runId, run);
  }
  return run;
}

export function endServerRun(runId: string): ServerLinkRunState | null {
  const store = getStore();
  const run = store.get(runId);
  if (!run) return null;
  const updated: ServerLinkRunState = {
    ...run,
    status: "ended",
    endedAtServer: run.endedAtServer ?? Date.now(),
  };
  store.set(runId, updated);
  return updated;
}

export function registerJoinedStudent(
  runId: string,
  stu: { attemptId: string; deviceId: string; studentName: string; section: string },
  fallbackMeta?: {
    versionHash: string;
    classId: string;
    className: string;
    quizId: string;
    title: string;
    durationMinutes: number;
    createdAtSec: number;
  }
): ServerLinkRunState | null {
  const store = getStore();
  let run = store.get(runId);
  if (!run && fallbackMeta) {
    run = upsertServerRun({ runId, ...fallbackMeta });
  }
  if (!run) return null;

  const exists = run.joined.some((j) => j.attemptId === stu.attemptId);
  if (!exists) {
    run = {
      ...run,
      joined: [
        ...run.joined,
        {
          ...stu,
          joinedAt: new Date().toISOString(),
        },
      ],
    };
    store.set(runId, run);
  }
  return run;
}

export function recordServerSubmission(
  runId: string,
  packet: EncryptedLinkResultPacket,
  plain: LinkResultPlainPayload
): { accepted: boolean; duplicate: boolean } {
  const store = getStore();
  let run = store.get(runId);
  if (!run) {
    run = upsertServerRun({
      runId,
      versionHash: plain.versionHash,
      classId: plain.classId,
      className: plain.className,
      quizId: plain.quizId,
      title: plain.quizTitle,
      durationMinutes: 15,
      createdAtSec: Math.floor(Date.now() / 1000),
    });
  }

  if (run.submissions.some((s) => s.plain.attemptId === plain.attemptId)) {
    return { accepted: false, duplicate: true };
  }

  run = {
    ...run,
    submissions: [
      ...run.submissions,
      { packet, plain, receivedAt: new Date().toISOString() },
    ],
  };
  store.set(runId, run);
  return { accepted: true, duplicate: false };
}

export function getServerRun(runId: string): ServerLinkRunState | null {
  return getStore().get(runId) || null;
}
