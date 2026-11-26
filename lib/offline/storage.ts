import Dexie, { type EntityTable } from "dexie";
import type {
  EncryptedQuizPack,
  OfflineResultPlainPayload,
  StudentSubmissionAnswer,
  VerifiedResultQr,
} from "../crypto/quizVault";
import type { TeacherLinkRunRecord } from "../teacher/submissionMerge";

export interface LocalAccount {
  id: string;
  role: "student" | "teacher";
  name: string;
  identifier: string; // student_no or teacher username
  pinHash: string;
  classCode?: string;
  className?: string;
  qrPayload?: string;
  createdAt: string;
}

export interface ActiveSession {
  key: "active";
  role: "student" | "teacher";
  userId: string;
  name: string;
  identifier: string;
  classId?: string;
  classCode?: string;
  className?: string;
  qrPayload?: string;
  authMode: "supabase" | "offline";
  sessionToken?: string;
}

export interface ImportedPackRecord {
  id: string;
  pack: EncryptedQuizPack;
  importedAt: string;
  source: "file" | "link" | "builtin" | "qr";
}

export interface QueuedAnswerRecord {
  id?: number;
  attemptId: string;
  packOrRunId: string;
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  answeredAt: string;
  syncStatus: "pending" | "synced" | "offline_only";
}

export interface LocalAttemptRecord {
  id: string;
  packOrRunId: string;
  title: string;
  studentId: string;
  studentName: string;
  studentNo: string;
  status: "in_progress" | "submitted";
  score: number;
  maxScore: number;
  startedAt: string;
  submittedAt?: string;
  lateCount: number;
  resultQr?: string;
  syncStatus: "synced" | "pending_sync" | "offline_only";
  payload?: OfflineResultPlainPayload;
}

export interface StudyProgressRecord {
  key: "current";
  completedSteps: Record<string, boolean>;
  reflections: Record<string, string>;
  points: number;
  preScore?: { score: number; total: number; date: string; byTopic: Record<string, [number, number]> };
  postScore?: { score: number; total: number; date: string; byTopic: Record<string, [number, number]> };
  masteryScore?: { score: number; total: number; date: string };
}

export interface LocalTeacherClass {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  students: {
    id: string;
    name: string;
    studentNo: string;
    qrPayload: string;
    createdAt: string;
  }[];
}

export interface LocalTeacherQuiz {
  id: string;
  title: string;
  classId: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  status: "ready" | "running" | "ended";
  startedAt?: string;
  endsAt?: string;
  questions: {
    id: string;
    prompt: string;
    options: string[];
    correctIndex: number;
    points: number;
  }[];
  createdAt: string;
}

export interface LocalRunStudentScore {
  studentId: string;
  studentName: string;
  studentNo: string;
  status: "not_started" | "in_progress" | "submitted";
  answeredCount: number;
  score: number;
  maxScore: number;
  lateAnswers: number;
  verified: boolean;
  verifiedVia?: "offline_qr" | "result_file" | "local_device" | "supabase";
  recordedAt?: string;
}

export interface LocalTeacherRun {
  id: string;
  quizId: string;
  quizTitle: string;
  classId: string;
  className: string;
  joinCode: string;
  durationMinutes: number;
  status: "running" | "ended";
  startedAt: string;
  endsAt: string;
  maxScore: number;
  results: LocalRunStudentScore[];
}

export interface TeacherVerificationEntry {
  id?: number;
  scannedAt: string;
  studentName: string;
  studentNo: string;
  scoreLabel: string;
  valid: boolean;
  source: "qr" | "result_file";
  verifiedVia: VerifiedResultQr["verifiedVia"];
  rawCode: string;
}

/** Link-based student flow IndexedDB records */
export interface LinkDeviceMeta {
  key: "device";
  deviceId: string;
}

export interface CachedLinkPackRecord {
  runId: string;
  versionHash: string;
  envelopeJson: string;
  shareUrl: string;
  cachedAt: string;
  packVerified: boolean;
}

export interface LinkStudentAttemptRecord {
  runId: string;
  versionHash: string;
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  status: "waiting" | "in_progress" | "submitted";
  unlocked: boolean;
  startedAtMs?: number;
  endsAtMs?: number;
  lastTickWallMs?: number;
  accumulatedElapsedMs: number;
  clockTampered: boolean;
  answers: Record<string, StudentSubmissionAnswer>;
  score?: number;
  maxScore?: number;
  submittedAt?: string;
  submittedOffline: boolean;
  lateAfterEnd: boolean;
  resultPacketJson?: string;
  resultQr?: string;
  autoDownloaded?: boolean;
  syncedToServer?: boolean;
  staleVersion?: boolean;
}

export class QuizGateOfflineDB extends Dexie {
  accounts!: EntityTable<LocalAccount, "id">;
  session!: EntityTable<ActiveSession, "key">;
  importedPacks!: EntityTable<ImportedPackRecord, "id">;
  answerQueue!: EntityTable<QueuedAnswerRecord, "id">;
  attempts!: EntityTable<LocalAttemptRecord, "id">;
  studyProgress!: EntityTable<StudyProgressRecord, "key">;
  teacherClasses!: EntityTable<LocalTeacherClass, "id">;
  teacherQuizzes!: EntityTable<LocalTeacherQuiz, "id">;
  teacherRuns!: EntityTable<LocalTeacherRun, "id">;
  verificationLogs!: EntityTable<TeacherVerificationEntry, "id">;

  // Link-based QuizGate v3 tables
  linkDeviceMeta!: EntityTable<LinkDeviceMeta, "key">;
  cachedLinkPacks!: EntityTable<CachedLinkPackRecord, "runId">;
  linkAttempts!: EntityTable<LinkStudentAttemptRecord, "runId">;
  teacherLinkRuns!: EntityTable<TeacherLinkRunRecord, "runId">;

  constructor() {
    super("QuizGateOfflineDB_v2");
    this.version(1).stores({
      accounts: "id, role, identifier, classCode",
      session: "key",
      importedPacks: "id, importedAt",
      answerQueue: "++id, attemptId, packOrRunId, questionId, syncStatus",
      attempts: "id, packOrRunId, studentId, status, syncStatus",
      studyProgress: "key",
      teacherClasses: "id, joinCode",
      teacherQuizzes: "id, classId, status",
      verificationLogs: "++id, scannedAt, studentName, valid",
    });
    this.version(2).stores({
      accounts: "id, role, identifier, classCode",
      session: "key",
      importedPacks: "id, importedAt",
      answerQueue: "++id, attemptId, packOrRunId, questionId, syncStatus",
      attempts: "id, packOrRunId, studentId, status, syncStatus",
      studyProgress: "key",
      teacherClasses: "id, joinCode",
      teacherQuizzes: "id, classId, status",
      teacherRuns: "id, quizId, classId, status, startedAt",
      verificationLogs: "++id, scannedAt, studentName, valid",
    });
    this.version(3).stores({
      accounts: "id, role, identifier, classCode",
      session: "key",
      importedPacks: "id, importedAt",
      answerQueue: "++id, attemptId, packOrRunId, questionId, syncStatus",
      attempts: "id, packOrRunId, studentId, status, syncStatus",
      studyProgress: "key",
      teacherClasses: "id, joinCode",
      teacherQuizzes: "id, classId, status",
      teacherRuns: "id, quizId, classId, status, startedAt",
      verificationLogs: "++id, scannedAt, studentName, valid",
      linkDeviceMeta: "key",
      cachedLinkPacks: "runId, versionHash",
      linkAttempts: "runId, attemptId, status",
      teacherLinkRuns: "runId, quizId, status, createdAtSec",
    });
  }
}

export const offlineDb =
  typeof window !== "undefined" ? new QuizGateOfflineDB() : (null as unknown as QuizGateOfflineDB);
