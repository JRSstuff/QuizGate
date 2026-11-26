import {
  decryptLinkResultPacket,
  type EncryptedLinkResultPacket,
  type LinkResultPlainPayload,
} from "../crypto/linkVault";

export interface TeacherLinkRosterEntry {
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  normalizedKey: string; // `${normName}::${normSection}`
  status: "joined" | "submitted";
  score: number;
  maxScore: number;
  answeredCount: number;
  totalQuestions: number;
  finishedAt?: string;
  submittedOffline: boolean;
  clockTampered: boolean;
  lateAfterEnd: boolean;
  beforeStart: boolean;
  staleVersion: boolean;
  sharedDeviceWith?: string;
  identicalAnswersWith?: string;
  answersFingerprint?: string;
  source: "online_submit" | "offline_file" | "joined_only";
  recordedAt: string;
}

export interface DuplicateAttemptNotice {
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  score: number;
  maxScore: number;
  finishedAt: string;
  reason: string;
}

export interface FileUploadReportItem {
  fileName: string;
  status: "accepted" | "duplicate" | "invalid" | "wrong_run" | "wrong_version";
  studentName?: string;
  section?: string;
  scoreLabel?: string;
  message: string;
}

export interface TeacherLinkRunRecord {
  runId: string;
  versionHash: string;
  classId: string;
  className: string;
  sections: string[];
  quizId: string;
  quizTitle: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  questionCount: number;
  createdAtSec: number;
  verifyKey: string;
  resultSecret: string;
  shareUrl: string;
  hashFragment: string;
  status: "waiting" | "running" | "ended";
  startedAtSec?: number;
  endsAtSec?: number;
  endedAtSec?: number;
  startCode?: string;
  startQr?: string;
  roster: TeacherLinkRosterEntry[];
  duplicates: DuplicateAttemptNotice[];
}

export function normalizeText(val: string): string {
  return val.trim().replace(/\s+/g, " ");
}

export function normalizeStudentKey(name: string, section: string): string {
  return `${normalizeText(name).toLowerCase()}::${normalizeText(section).toLowerCase()}`;
}

export function computeAnswersFingerprint(answers: LinkResultPlainPayload["answers"]): string {
  return answers
    .slice()
    .sort((a, b) => a.questionId.localeCompare(b.questionId))
    .map((a) => `${a.questionId}:${a.selectedIndex}`)
    .join("|");
}

/** Checks timing flags & anomaly cross-checks cleanly across the roster. */
export function recomputeRosterAnomalies(roster: TeacherLinkRosterEntry[]): TeacherLinkRosterEntry[] {
  const byDevice = new Map<string, TeacherLinkRosterEntry[]>();
  const byAnswers = new Map<string, TeacherLinkRosterEntry[]>();

  for (const row of roster) {
    if (row.status !== "submitted") continue;
    if (row.deviceId) {
      const list = byDevice.get(row.deviceId) || [];
      list.push(row);
      byDevice.set(row.deviceId, list);
    }
    if (row.answersFingerprint && row.totalQuestions >= 3 && row.answeredCount >= 3) {
      const list = byAnswers.get(row.answersFingerprint) || [];
      list.push(row);
      byAnswers.set(row.answersFingerprint, list);
    }
  }

  return roster.map((row) => {
    if (row.status !== "submitted") return row;

    const devMatches = (byDevice.get(row.deviceId) || []).filter(
      (other) => other.normalizedKey !== row.normalizedKey
    );
    const ansMatches = row.answersFingerprint
      ? (byAnswers.get(row.answersFingerprint) || []).filter(
          (other) => other.normalizedKey !== row.normalizedKey
        )
      : [];

    return {
      ...row,
      sharedDeviceWith: devMatches.map((m) => m.studentName).join(", ") || undefined,
      identicalAnswersWith: ansMatches.map((m) => m.studentName).join(", ") || undefined,
    };
  });
}

export function integratePlainSubmissionIntoRun(
  run: TeacherLinkRunRecord,
  plain: LinkResultPlainPayload,
  source: "online_submit" | "offline_file"
): {
  run: TeacherLinkRunRecord;
  outcome: "accepted" | "duplicate_attempt_id" | "duplicate_student";
  message: string;
} {
  const normName = normalizeText(plain.studentName);
  const normSection = normalizeText(plain.section);
  const normKey = normalizeStudentKey(normName, normSection);

  // 1. Exact duplicate attemptId (re-uploading same submission file or online+file repeat)
  const exactExisting = run.roster.find(
    (r) => r.attemptId === plain.attemptId && r.status === "submitted"
  );
  if (exactExisting) {
    return {
      run,
      outcome: "duplicate_attempt_id",
      message: `Duplicate attemptId (${plain.attemptId.slice(0, 8)}) — already recorded for ${exactExisting.studentName}.`,
    };
  }

  const submittedMs = new Date(plain.submittedAt).getTime();
  const startMs = (run.startedAtSec ?? run.createdAtSec) * 1000;
  const endsMs = run.endsAtSec ? run.endsAtSec * 1000 : Number.MAX_SAFE_INTEGER;
  const beforeStart = Boolean(run.startedAtSec && submittedMs < startMs - 5000);
  const lateByDeadline = Boolean(run.endsAtSec && submittedMs > endsMs + 15_000);
  const lateByTeacherEnd = Boolean(run.status === "ended" && run.endedAtSec && submittedMs > run.endedAtSec * 1000);
  const lateAfterEnd = Boolean(plain.lateAfterEnd || lateByDeadline || lateByTeacherEnd);

  // 2. Same student (name + section) with a DIFFERENT attemptId -> keep first valid, flag duplicate!
  const sameStudentSubmitted = run.roster.find(
    (r) => r.normalizedKey === normKey && r.status === "submitted"
  );
  if (sameStudentSubmitted) {
    const dupNotice: DuplicateAttemptNotice = {
      attemptId: plain.attemptId,
      deviceId: plain.deviceId,
      studentName: normName,
      section: normSection,
      score: plain.score,
      maxScore: plain.maxScore,
      finishedAt: plain.submittedAt,
      reason: "Duplicate attempt (student already has a submitted attempt recorded; kept first).",
    };
    const alreadyDuped = run.duplicates.some((d) => d.attemptId === plain.attemptId);
    const nextRun: TeacherLinkRunRecord = alreadyDuped
      ? run
      : { ...run, duplicates: [...run.duplicates, dupNotice] };

    return {
      run: nextRun,
      outcome: "duplicate_student",
      message: `Duplicate attempt for ${normName} (${normSection}) — kept original score ${sameStudentSubmitted.score}/${sameStudentSubmitted.maxScore}.`,
    };
  }

  // 3. Upgrade joined row or append new submission row cleanly
  const fingerprint = computeAnswersFingerprint(plain.answers);
  const newEntry: TeacherLinkRosterEntry = {
    attemptId: plain.attemptId,
    deviceId: plain.deviceId,
    studentName: normName,
    section: normSection,
    normalizedKey: normKey,
    status: "submitted",
    score: plain.score,
    maxScore: plain.maxScore,
    answeredCount: plain.answeredCount,
    totalQuestions: plain.totalQuestions,
    finishedAt: plain.submittedAt,
    submittedOffline: plain.submittedOffline,
    clockTampered: plain.clockTampered,
    lateAfterEnd,
    beforeStart,
    staleVersion: plain.versionHash !== run.versionHash,
    answersFingerprint: fingerprint,
    source,
    recordedAt: new Date().toISOString(),
  };

  const joinedIdx = run.roster.findIndex((r) => r.normalizedKey === normKey && r.status === "joined");
  const nextRosterRaw = run.roster.slice();
  if (joinedIdx >= 0) {
    nextRosterRaw[joinedIdx] = newEntry;
  } else {
    nextRosterRaw.push(newEntry);
  }

  const nextRoster = recomputeRosterAnomalies(nextRosterRaw);
  return {
    run: { ...run, roster: nextRoster },
    outcome: "accepted",
    message: `Accepted ${normName} (${normSection}): ${plain.score}/${plain.maxScore}`,
  };
}

/**
 * Verifies and ingests a batch of uploaded `.qres.json` file contents offline or online.
 */
export async function processUploadedResultFiles(
  currentRun: TeacherLinkRunRecord,
  files: { fileName: string; rawText: string }[]
): Promise<{
  updatedRun: TeacherLinkRunRecord;
  report: FileUploadReportItem[];
}> {
  let working = currentRun;
  const report: FileUploadReportItem[] = [];

  for (const file of files) {
    try {
      const parsed = JSON.parse(file.rawText) as EncryptedLinkResultPacket;
      const verified = await decryptLinkResultPacket(parsed, {
        runId: working.runId,
        versionHash: working.versionHash,
        resultSecret: working.resultSecret,
      });

      if (!verified.ok || !verified.plain) {
        report.push({
          fileName: file.fileName,
          status:
            verified.reason === "wrong_run"
              ? "wrong_run"
              : verified.reason === "wrong_version"
                ? "wrong_version"
                : "invalid",
          studentName: parsed?.studentName,
          section: parsed?.section,
          message: verified.message || "Invalid submission file.",
        });
        continue;
      }

      const integrated = integratePlainSubmissionIntoRun(working, verified.plain, "offline_file");
      working = integrated.run;

      report.push({
        fileName: file.fileName,
        status: integrated.outcome === "accepted" ? "accepted" : "duplicate",
        studentName: verified.plain.studentName,
        section: verified.plain.section,
        scoreLabel: `${verified.plain.score}/${verified.plain.maxScore}`,
        message: integrated.message,
      });
    } catch {
      report.push({
        fileName: file.fileName,
        status: "invalid",
        message: "Unreadable JSON — expected an encrypted QuizGate .qres.json file.",
      });
    }
  }

  return { updatedRun: working, report };
}

/** Lets teachers fix name/section typos and merge a student entry into another cleanly. */
export function renameOrMergeRosterStudent(
  run: TeacherLinkRunRecord,
  attemptId: string,
  newName: string,
  newSection: string
): TeacherLinkRunRecord {
  const cleanName = normalizeText(newName);
  const cleanSection = normalizeText(newSection);
  if (!cleanName) return run;

  const newKey = normalizeStudentKey(cleanName, cleanSection);
  const target = run.roster.find((r) => r.attemptId === attemptId);
  if (!target) return run;

  // Check if another student row already holds the destination identity
  const existingDest = run.roster.find(
    (r) => r.attemptId !== attemptId && r.normalizedKey === newKey
  );

  let nextRoster: TeacherLinkRosterEntry[];
  let nextDuplicates = run.duplicates.slice();

  if (existingDest) {
    if (existingDest.status === "joined" && target.status === "submitted") {
      // Drop placeholder joined row and promote renamed submitted row
      nextRoster = run.roster
        .filter((r) => r.attemptId !== existingDest.attemptId)
        .map((r) =>
          r.attemptId === attemptId
            ? { ...r, studentName: cleanName, section: cleanSection, normalizedKey: newKey }
            : r
        );
    } else if (existingDest.status === "submitted" && target.status === "submitted") {
      // Keep first valid submission and move merged second attempt to duplicate review
      nextRoster = run.roster.filter((r) => r.attemptId !== attemptId);
      nextDuplicates.push({
        attemptId: target.attemptId,
        deviceId: target.deviceId,
        studentName: cleanName,
        section: cleanSection,
        score: target.score,
        maxScore: target.maxScore,
        finishedAt: target.finishedAt || target.recordedAt,
        reason: "Merged by teacher into existing submitted student.",
      });
    } else {
      nextRoster = run.roster.filter((r) => r.attemptId !== attemptId);
    }
  } else {
    nextRoster = run.roster.map((r) =>
      r.attemptId === attemptId
        ? { ...r, studentName: cleanName, section: cleanSection, normalizedKey: newKey }
        : r
    );
  }

  return {
    ...run,
    roster: recomputeRosterAnomalies(nextRoster),
    duplicates: nextDuplicates,
  };
}
