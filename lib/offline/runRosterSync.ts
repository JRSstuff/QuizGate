import {
  buildEncryptedPackFromBlueprint,
  toVaultQuestions,
} from "../data/grade10Math";
import {
  encryptQuizPack,
  type EncryptedQuizPack,
} from "../crypto/quizVault";
import {
  offlineDb,
  type LocalRunStudentScore,
  type LocalTeacherQuiz,
  type LocalTeacherRun,
} from "./storage";

export function upsertStudentScoreInRun(
  run: LocalTeacherRun,
  incoming: LocalRunStudentScore
): LocalTeacherRun {
  const cleanNo = incoming.studentNo.trim().toLowerCase();
  const idx = run.results.findIndex(
    (r) =>
      r.studentNo.trim().toLowerCase() === cleanNo ||
      (incoming.studentId && r.studentId === incoming.studentId)
  );

  const nextResults = run.results.slice();
  if (idx >= 0) {
    const prev = nextResults[idx];
    // Preserve finalized submitted score over an older in_progress update unless new entry is submitted
    if (prev.status === "submitted" && prev.verified && incoming.status !== "submitted") {
      return run;
    }
    nextResults[idx] = { ...prev, ...incoming };
  } else {
    nextResults.push(incoming);
  }

  return { ...run, results: nextResults };
}

export async function buildEncryptedPackFromTeacherQuiz(
  quiz: LocalTeacherQuiz,
  authorName: string,
  passcode?: string
): Promise<EncryptedQuizPack> {
  return encryptQuizPack(
    {
      id: quiz.id,
      title: quiz.title,
      subject: "Classroom Quiz",
      description: `${quiz.questions.length} items · ${quiz.durationMinutes} mins`,
      durationMinutes: quiz.durationMinutes,
      instantFeedback: quiz.instantFeedback,
      allowRetry: quiz.allowRetry,
      createdBy: authorName,
      createdAt: quiz.createdAt || new Date().toISOString(),
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
    passcode?.trim() || undefined
  );
}

/**
 * Ensures any builtin Grade 10 packs exist locally, plus converts any active local teacher quiz into
 * an imported pack so a student in the same browser can enter the teacher's started run immediately.
 */
export async function ensureLocalTeacherQuizImported(
  quizId: string
): Promise<EncryptedQuizPack | null> {
  if (!offlineDb) return null;
  const existing = await offlineDb.importedPacks.get(quizId);
  if (existing) return existing.pack;

  const teacherQuiz = await offlineDb.teacherQuizzes.get(quizId);
  if (teacherQuiz) {
    const encrypted = await buildEncryptedPackFromTeacherQuiz(teacherQuiz, "Teacher");
    await offlineDb.importedPacks.put({
      id: encrypted.id,
      pack: encrypted,
      importedAt: new Date().toISOString(),
      source: "builtin",
    });
    return encrypted;
  }
  return null;
}

/**
 * Merges matching local IndexedDB attempts into an active/created LocalTeacherRun
 * so teacher & student testing on the same device immediately reflects scores.
 */
export async function mergeLocalAttemptsIntoRun(
  run: LocalTeacherRun
): Promise<LocalTeacherRun> {
  if (!offlineDb) return run;
  const allAttempts = await offlineDb.attempts.toArray();
  const enrolledNos = new Set(run.results.map((r) => r.studentNo.toLowerCase()));
  let merged = run;

  for (const att of allAttempts) {
    const matchesPack =
      att.packOrRunId === run.quizId ||
      att.packOrRunId === run.id ||
      att.title === run.quizTitle;
    const belongsToClass =
      enrolledNos.has(att.studentNo.toLowerCase()) ||
      (att.payload?.classCode &&
        att.payload.classCode.toUpperCase() === run.joinCode.toUpperCase());

    if (matchesPack && (belongsToClass || run.results.length === 0)) {
      merged = upsertStudentScoreInRun(merged, {
        studentId: att.studentId,
        studentName: att.studentName,
        studentNo: att.studentNo,
        status: att.status,
        answeredCount: att.payload?.answers.length ?? (att.status === "submitted" ? run.maxScore : 0),
        score: att.score,
        maxScore: att.maxScore || run.maxScore,
        lateAnswers: att.lateCount || 0,
        verified: att.status === "submitted",
        verifiedVia: "local_device",
        recordedAt: att.submittedAt || att.startedAt,
      });
    }
  }

  return merged;
}

/** Syncs student's in-progress or submitted offline attempt into any matching LocalTeacherRun on the same device. */
export async function syncStudentAttemptToLocalRuns(params: {
  packOrRunId: string;
  title: string;
  studentId: string;
  studentName: string;
  studentNo: string;
  classId?: string;
  classCode?: string;
  status: "in_progress" | "submitted";
  answeredCount: number;
  score: number;
  maxScore: number;
  lateCount?: number;
  recordedAt?: string;
}): Promise<void> {
  if (!offlineDb) return;
  const runs = await offlineDb.teacherRuns.toArray();

  for (const run of runs) {
    const quizMatch = run.quizId === params.packOrRunId || run.quizTitle === params.title;
    const classMatch =
      (!params.classId && !params.classCode) ||
      params.classId === run.classId ||
      (params.classCode && params.classCode.toUpperCase() === run.joinCode.toUpperCase()) ||
      run.results.some((r) => r.studentNo.toLowerCase() === params.studentNo.toLowerCase());

    if (quizMatch && classMatch) {
      const updated = upsertStudentScoreInRun(run, {
        studentId: params.studentId,
        studentName: params.studentName,
        studentNo: params.studentNo,
        status: params.status,
        answeredCount: params.answeredCount,
        score: params.score,
        maxScore: params.maxScore,
        lateAnswers: params.lateCount ?? 0,
        verified: params.status === "submitted",
        verifiedVia: "local_device",
        recordedAt: params.recordedAt || new Date().toISOString(),
      });
      await offlineDb.teacherRuns.put(updated);
    }
  }
}

export async function seedBuiltinPacksIfNeeded() {
  if (!offlineDb) return;
  const existing = await offlineDb.importedPacks.toArray();
  if (existing.length === 0) {
    const { GRADE10_BLUEPRINTS } = await import("../data/grade10Math");
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
}
