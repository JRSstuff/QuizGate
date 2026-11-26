import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as healthGet } from "../app/api/health/route";
import { POST as teacherAuthPost } from "../app/api/teacher/auth/route";
import { POST as runControlPost } from "../app/api/run/[runId]/route";
import { GET as runStateGet, POST as runStatePost } from "../app/api/run/[runId]/state/route";
import { POST as runSubmitPost } from "../app/api/run/[runId]/submit/route";
import {
  createLinkQuizBundle,
  decodeLinkHashFragment,
  decryptLinkResultPacket,
  encryptLinkResultPacket,
  generateSignedStartCode,
  unlockLinkQuizBundle,
  verifyLinkResultQr,
  verifySignedStartCode,
} from "../lib/crypto/linkVault";
import {
  processUploadedResultFiles,
  renameOrMergeRosterStudent,
  type TeacherLinkRunRecord,
} from "../lib/teacher/submissionMerge";
import { evaluateMonotonicClockTick } from "../lib/timer/clockSync";

const SAMPLE_QUESTIONS = [
  {
    id: "q1",
    prompt: "What is the value of sqrt(81)?",
    options: ["7", "8", "9", "10"],
    correctIndex: 2,
    points: 1,
    explanation: "9 * 9 = 81",
  },
  {
    id: "q2",
    prompt: "Simplify 2^3 * 2^2.",
    options: ["16", "32", "64", "8"],
    correctIndex: 1,
    points: 1,
  },
  {
    id: "q3",
    prompt: "In x^2 + 6x + 9 = 0, what is the discriminant?",
    options: ["0", "36", "72", "-36"],
    correctIndex: 0,
    points: 2,
  },
];

describe("Section 0: Normal Classroom Offline Responses Without Service Key", () => {
  const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("GET /api/health returns { mode: 'offline', cloud: false } with no error field", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("offline");
    expect(data.cloud).toBe(false);
    expect(data.error).toBeUndefined();
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
  });

  it("POST /api/teacher/auth returns 200 { mode: 'offline', cloud: false } with zero error", async () => {
    const req = new NextRequest("http://localhost:3000/api/teacher/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "login",
        username: "mr_reyes",
        password: "password123",
      }),
    });
    const res = await teacherAuthPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("offline");
    expect(data.cloud).toBe(false);
    expect(data.error).toBeUndefined();
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
  });
});

describe("Sections 1-6: Link Bundle Crypto, Signed Start Code, Clock Tamper & Offline Merge", () => {
  it("keeps questions/answers encrypted before unlock and rejects tampered link hash fragments", async () => {
    const bundle = await createLinkQuizBundle({
      classId: "g10-rizal",
      className: "Grade 10 - Rizal",
      sections: ["10-Rizal", "10-Bonifacio"],
      quizId: "quiz-1",
      title: "Quarter 2 Practice",
      durationMinutes: 10,
      instantFeedback: true,
      allowRetry: false,
      questions: SAMPLE_QUESTIONS,
    });

    // Questions & correct answers must NOT appear plaintext inside ciphertext or hashFragment
    expect(bundle.envelope.ciphertext).not.toContain("sqrt(81)");
    expect(bundle.hashFragment.startsWith("L3.")).toBe(true);
    expect(bundle.hashFragment).not.toContain("sqrt(81)");

    const decoded = await decodeLinkHashFragment(`#${bundle.hashFragment}`);
    expect(decoded.runId).toBe(bundle.runId);
    expect(decoded.versionHash).toBe(bundle.versionHash);
    expect(decoded.sections).toEqual(["10-Rizal", "10-Bonifacio"]);

    // Tampered fragment must be rejected
    const broken = `${bundle.hashFragment.slice(0, -4)}XXXX`;
    await expect(decodeLinkHashFragment(broken)).rejects.toThrow();

    // Unlock releases questions, feedback salts, and per-run resultSecret
    const unlocked = await unlockLinkQuizBundle(decoded);
    expect(unlocked.questions).toHaveLength(3);
    expect(unlocked.questions[0].correctIndex).toBe(2);
    expect(unlocked.resultSecret).toBe(bundle.resultSecret);
  });

  it("signs 10-char Start Code + QR, accepts valid codes offline, and rejects wrong or forged codes", async () => {
    const bundle = await createLinkQuizBundle({
      classId: "cls1",
      className: "Grade 10",
      quizId: "q1",
      title: "Radicals Quiz",
      durationMinutes: 15,
      instantFeedback: true,
      allowRetry: false,
      questions: SAMPLE_QUESTIONS,
    });

    const startEpoch = bundle.createdAtSec + 120;
    const { formattedCode, startCode, startQr } = await generateSignedStartCode({
      runId: bundle.runId,
      startEpochSec: startEpoch,
      createdAtSec: bundle.createdAtSec,
      verifyKey: bundle.verifyKey,
    });

    expect(startCode).toHaveLength(10);
    expect(formattedCode).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);

    // Verify hyphenated, lowercase unhyphenated, and QR formats
    const v1 = await verifySignedStartCode(formattedCode, bundle.envelope);
    expect(v1.valid).toBe(true);
    expect(v1.startEpochSec).toBe(startEpoch);

    const v2 = await verifySignedStartCode(startCode.toLowerCase(), bundle.envelope);
    expect(v2.valid).toBe(true);
    expect(v2.startEpochSec).toBe(startEpoch);

    const v3 = await verifySignedStartCode(startQr, bundle.envelope);
    expect(v3.valid).toBe(true);
    expect(v3.startEpochSec).toBe(startEpoch);

    // Reject forged code (flipped last character)
    const flippedLast = startCode.slice(0, -1) + (startCode.endsWith("A") ? "B" : "A");
    const badFlip = await verifySignedStartCode(flippedLast, bundle.envelope);
    expect(badFlip.valid).toBe(false);

    // Reject QR belonging to another runId
    const wrongQr = startQr.replace(bundle.runId, "otherRun9");
    const badQr = await verifySignedStartCode(wrongQr, bundle.envelope);
    expect(badQr.valid).toBe(false);
  });

  it("detects backward clock jump & monotonic/wall drift tamper and expires reliably", () => {
    const startedAtMs = 1_700_000_000_000;
    const endsAtMs = startedAtMs + 60_000;

    // 1. Normal tick 10s in
    const t1 = evaluateMonotonicClockTick({
      startedAtMs,
      endsAtMs,
      prevWallMs: startedAtMs,
      prevAccumElapsedMs: 0,
      nowWallMs: startedAtMs + 10_000,
      tabPerfDeltaMs: 10_000,
    });
    expect(t1.clockTampered).toBe(false);
    expect(t1.remainingSeconds).toBe(50);
    expect(t1.expired).toBe(false);

    // 2. Student sets OS clock BACKWARD by 2 minutes
    const t2 = evaluateMonotonicClockTick({
      startedAtMs,
      endsAtMs,
      prevWallMs: t1.nextWallMs,
      prevAccumElapsedMs: t1.nextAccumElapsedMs,
      nowWallMs: startedAtMs - 110_000,
      tabPerfDeltaMs: 5_000,
      alreadyTampered: t1.clockTampered,
    });
    expect(t2.clockTampered).toBe(true);
    expect(t2.nextAccumElapsedMs).toBeGreaterThanOrEqual(15_000);
    expect(t2.remainingSeconds).toBeLessThanOrEqual(45);

    // 3. Monotonic elapsed reaches deadline even though Date.now() is still pulled back
    const t3 = evaluateMonotonicClockTick({
      startedAtMs,
      endsAtMs,
      prevWallMs: t2.nextWallMs,
      prevAccumElapsedMs: t2.nextAccumElapsedMs,
      nowWallMs: startedAtMs - 105_000,
      tabPerfDeltaMs: 46_000,
      alreadyTampered: t2.clockTampered,
    });
    expect(t3.clockTampered).toBe(true);
    expect(t3.expired).toBe(true);
    expect(t3.remainingSeconds).toBe(0);
  });

  it("encrypts per-run results, rejects wrong-run/wrong-version/forged packets, deduplicates attempts, and flags anomalies", async () => {
    const bundle = await createLinkQuizBundle({
      classId: "g10",
      className: "Grade 10 - Rizal",
      sections: ["10-Rizal"],
      quizId: "quiz-r2",
      title: "Discriminant Check",
      durationMinutes: 15,
      instantFeedback: true,
      allowRetry: false,
      questions: SAMPLE_QUESTIONS,
    });

    const otherBundle = await createLinkQuizBundle({
      classId: "g10",
      className: "Grade 10 - Rizal",
      quizId: "quiz-r2",
      title: "Other Run",
      durationMinutes: 15,
      instantFeedback: true,
      allowRetry: false,
      questions: SAMPLE_QUESTIONS,
    });

    const startedAt = new Date((bundle.createdAtSec + 10) * 1000).toISOString();
    const endsAt = new Date((bundle.createdAtSec + 910) * 1000).toISOString();
    const onTimeSub = new Date((bundle.createdAtSec + 120) * 1000).toISOString();

    const makeSub = async (opts: {
      attemptId: string;
      deviceId: string;
      name: string;
      section: string;
      score: number;
      submittedAt?: string;
      secret?: string;
      targetBundle?: typeof bundle;
    }) => {
      const b = opts.targetBundle || bundle;
      return encryptLinkResultPacket(
        {
          v: 3,
          runId: b.runId,
          versionHash: b.versionHash,
          quizId: b.envelope.quizId,
          quizTitle: b.envelope.title,
          classId: b.envelope.classId,
          className: b.envelope.className,
          attemptId: opts.attemptId,
          deviceId: opts.deviceId,
          studentName: opts.name,
          section: opts.section,
          score: opts.score,
          maxScore: 4,
          answeredCount: 3,
          totalQuestions: 3,
          startedAt,
          endsAt,
          submittedAt: opts.submittedAt || onTimeSub,
          submittedOffline: true,
          clockTampered: false,
          lateAfterEnd: false,
          answers: [
            { questionId: "q1", selectedIndex: 2, isCorrect: true, answeredAt: onTimeSub, lateSync: false },
            { questionId: "q2", selectedIndex: 1, isCorrect: true, answeredAt: onTimeSub, lateSync: false },
            { questionId: "q3", selectedIndex: 0, isCorrect: true, answeredAt: onTimeSub, lateSync: false },
          ],
        },
        opts.secret ?? b.resultSecret
      );
    };

    const s1 = await makeSub({
      attemptId: "att-1",
      deviceId: "dev-shared",
      name: "Maria Santos",
      section: "10-Rizal",
      score: 4,
    });
    const s1DuplicateStudent = await makeSub({
      attemptId: "att-1-retry",
      deviceId: "dev-other",
      name: "maria   santos ",
      section: "10-rizal",
      score: 2,
    });
    const s2SharedAndIdentical = await makeSub({
      attemptId: "att-2",
      deviceId: "dev-shared",
      name: "Carlo Reyes",
      section: "10-Rizal",
      score: 4,
    });
    const wrongRunSub = await makeSub({
      attemptId: "att-wrong",
      deviceId: "dev-3",
      name: "Liza Cruz",
      section: "10-Rizal",
      score: 4,
      targetBundle: otherBundle,
    });
    const forgedSecretSub = await makeSub({
      attemptId: "att-forged",
      deviceId: "dev-4",
      name: "Hacker Student",
      section: "10-Rizal",
      score: 4,
      secret: "wrong-secret-00000",
    });

    // Verify Result QR signature check
    expect((await verifyLinkResultQr(s1.resultQr, { runId: bundle.runId, resultSecret: bundle.resultSecret })).valid).toBe(true);
    expect((await verifyLinkResultQr(s1.resultQr, { runId: bundle.runId, resultSecret: "bad" })).valid).toBe(false);

    // Wrong secret decryption check
    const forgedDecrypt = await decryptLinkResultPacket(forgedSecretSub.packet, {
      runId: bundle.runId,
      versionHash: bundle.versionHash,
      resultSecret: bundle.resultSecret,
    });
    expect(forgedDecrypt.ok).toBe(false);
    expect(forgedDecrypt.reason).toBe("tampered");

    const baseRun: TeacherLinkRunRecord = {
      runId: bundle.runId,
      versionHash: bundle.versionHash,
      classId: bundle.envelope.classId,
      className: bundle.envelope.className,
      sections: ["10-Rizal"],
      quizId: bundle.envelope.quizId,
      quizTitle: bundle.envelope.title,
      durationMinutes: 15,
      instantFeedback: true,
      allowRetry: false,
      questionCount: 3,
      createdAtSec: bundle.createdAtSec,
      verifyKey: bundle.verifyKey,
      resultSecret: bundle.resultSecret,
      shareUrl: `https://example.com/q/${bundle.runId}`,
      hashFragment: bundle.hashFragment,
      status: "running",
      startedAtSec: bundle.createdAtSec + 10,
      endsAtSec: bundle.createdAtSec + 910,
      roster: [],
      duplicates: [],
    };

    const { updatedRun, report } = await processUploadedResultFiles(baseRun, [
      { fileName: "maria.qres.json", rawText: JSON.stringify(s1.packet) },
      { fileName: "maria-reupload.qres.json", rawText: JSON.stringify(s1.packet) },
      { fileName: "maria-retry.qres.json", rawText: JSON.stringify(s1DuplicateStudent.packet) },
      { fileName: "carlo.qres.json", rawText: JSON.stringify(s2SharedAndIdentical.packet) },
      { fileName: "wrong-run.qres.json", rawText: JSON.stringify(wrongRunSub.packet) },
      { fileName: "forged.qres.json", rawText: JSON.stringify(forgedSecretSub.packet) },
    ]);

    expect(report.map((r) => r.status)).toEqual([
      "accepted",
      "duplicate",
      "duplicate",
      "accepted",
      "wrong_run",
      "invalid",
    ]);

    expect(updatedRun.roster).toHaveLength(2);
    expect(updatedRun.duplicates).toHaveLength(1);
    const mariaRow = updatedRun.roster.find((r) => r.attemptId === "att-1");
    expect(mariaRow?.score).toBe(4); // Kept first score, did NOT overwrite with retry's 2
    expect(mariaRow?.sharedDeviceWith).toContain("Carlo Reyes");
    expect(mariaRow?.identicalAnswersWith).toContain("Carlo Reyes");

    // Rename & merge test
    const renamed = renameOrMergeRosterStudent(updatedRun, "att-2", "Maria Santos", "10-Rizal");
    expect(renamed.roster).toHaveLength(1);
    expect(renamed.duplicates.length).toBe(2);
  });

  it("handles /api/run/[runId] online lifecycle idempotently", async () => {
    const runId = `ut_${Date.now()}`;
    const bundle = await createLinkQuizBundle({
      runId,
      classId: "c1",
      className: "Grade 10 - Gold",
      quizId: "qz1",
      title: "API Run Test",
      durationMinutes: 10,
      instantFeedback: true,
      allowRetry: false,
      questions: SAMPLE_QUESTIONS,
    });

    // 1. Create
    const createRes = await runControlPost(
      new NextRequest(`http://localhost/api/run/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          versionHash: bundle.versionHash,
          classId: "c1",
          className: "Grade 10 - Gold",
          quizId: "qz1",
          title: "API Run Test",
          durationMinutes: 10,
          createdAtSec: bundle.createdAtSec,
        }),
      }),
      { params: Promise.resolve({ runId }) }
    );
    expect(createRes.status).toBe(200);

    // 2. Join waiting room
    const joinRes = await runStatePost(
      new NextRequest(`http://localhost/api/run/${runId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId: "att-online-1",
          deviceId: "dev-1",
          studentName: "Alex Tan",
          section: "10-Gold",
        }),
      }),
      { params: Promise.resolve({ runId }) }
    );
    expect(joinRes.status).toBe(200);

    // 3. Start twice -> second start must keep the exact same startedAtServer & endsAtServer!
    const start1 = await (
      await runControlPost(
        new NextRequest(`http://localhost/api/run/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", startedAtSec: bundle.createdAtSec + 20 }),
        }),
        { params: Promise.resolve({ runId }) }
      )
    ).json();

    const start2 = await (
      await runControlPost(
        new NextRequest(`http://localhost/api/run/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", startedAtSec: bundle.createdAtSec + 999 }),
        }),
        { params: Promise.resolve({ runId }) }
      )
    ).json();

    expect(start2.startedAtServer).toBe(start1.startedAtServer);
    expect(start2.endsAtServer).toBe(start1.endsAtServer);

    // 4. Submit encrypted payload
    const nowIso = new Date().toISOString();
    const { packet, plain } = await encryptLinkResultPacket(
      {
        v: 3,
        runId,
        versionHash: bundle.versionHash,
        quizId: "qz1",
        quizTitle: "API Run Test",
        classId: "c1",
        className: "Grade 10 - Gold",
        attemptId: "att-online-1",
        deviceId: "dev-1",
        studentName: "Alex Tan",
        section: "10-Gold",
        score: 3,
        maxScore: 4,
        answeredCount: 3,
        totalQuestions: 3,
        startedAt: nowIso,
        endsAt: nowIso,
        submittedAt: nowIso,
        submittedOffline: false,
        clockTampered: false,
        lateAfterEnd: false,
        answers: [],
      },
      bundle.resultSecret
    );

    const subRes = await runSubmitPost(
      new NextRequest(`http://localhost/api/run/${runId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet, plain }),
      }),
      { params: Promise.resolve({ runId }) }
    );
    expect(subRes.status).toBe(200);
    expect((await subRes.json()).accepted).toBe(true);

    const stateRes = await runStateGet(
      new NextRequest(`http://localhost/api/run/${runId}/state`),
      { params: Promise.resolve({ runId }) }
    );
    const stateData = await stateRes.json();
    expect(stateData.status).toBe("running");
    expect(stateData.joined).toHaveLength(1);
    expect(stateData.submissions).toHaveLength(1);
  });
});
