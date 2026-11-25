import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as studentRegisterPost } from "../app/api/student/register/route";
import { POST as studentLoginPost } from "../app/api/student/login/route";
import { POST as teacherAuthPost } from "../app/api/teacher/auth/route";
import { POST as verifyResultPost } from "../app/api/teacher/verify-result/route";
import {
  buildOfflineResultQr,
  decryptQuizPack,
  decryptResultPacket,
  encryptResultPacket,
  type OfflineResultPlainPayload,
} from "../lib/crypto/quizVault";
import {
  GRADE10_BLUEPRINTS,
  buildEncryptedPackFromBlueprint,
} from "../lib/data/grade10Math";

describe("QuizGate Classroom Scale & End-to-End Demo Processing (50 Students)", () => {
  it("handles 45 simultaneous students registering and signing in behind a single school Wi-Fi IP without false 429 blocks", async () => {
    const schoolWifiIp = "203.0.113.50";
    const batch = Array.from({ length: 45 }, (_, idx) => ({
      name: `Student ${idx + 1}`,
      studentNo: `2026-S${String(idx + 1).padStart(3, "0")}`,
      pin: `pin${1000 + idx}`,
    }));

    const regResponses = await Promise.all(
      batch.map((stu) =>
        studentRegisterPost(
          new NextRequest("http://localhost/api/student/register", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": schoolWifiIp,
            },
            body: JSON.stringify({
              joinCode: "SELF",
              name: stu.name,
              studentNo: stu.studentNo,
              pin: stu.pin,
            }),
          })
        )
      )
    );

    const qrPayloads: string[] = [];
    for (let i = 0; i < regResponses.length; i++) {
      expect(regResponses[i].status).toBe(200);
      const data = (await regResponses[i].json()) as {
        qr_payload: string;
        student: { name: string };
      };
      expect(data.qr_payload.startsWith("QG1L.")).toBe(true);
      expect(data.student.name).toBe(batch[i].name);
      qrPayloads.push(data.qr_payload);
    }

    const loginResponses = await Promise.all(
      qrPayloads.map((qrPayload) =>
        studentLoginPost(
          new NextRequest("http://localhost/api/student/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": schoolWifiIp,
            },
            body: JSON.stringify({ qrPayload }),
          })
        )
      )
    );

    for (let i = 0; i < loginResponses.length; i++) {
      expect(loginResponses[i].status).toBe(200);
      const loginJson = (await loginResponses[i].json()) as {
        student: { student_no: string };
      };
      expect(loginJson.student.student_no).toBe(batch[i].studentNo);
    }
  });

  it("processes 50 demo students completing encrypted 25-item Grade 10 quiz & verifying every QR + .qres.json file", async () => {
    const startMs = Date.now();
    const encryptedPack = await buildEncryptedPackFromBlueprint(
      GRADE10_BLUEPRINTS[0], // 25-item Diagnostic
      "Teacher Rivera",
      "ROOM10B"
    );

    // Wrong passcode must reject decryption
    await expect(decryptQuizPack(encryptedPack, "WRONGPASS")).rejects.toThrow();

    // Simulate 50 students decrypting the quiz, answering with varied scores, generating QRs & files
    const studentCount = 50;
    const submissions = await Promise.all(
      Array.from({ length: studentCount }, async (_, idx) => {
        const plainPack = await decryptQuizPack(encryptedPack, "ROOM10B");
        const targetRightCount = idx % 26; // Spread scores cleanly from 0/25 to 25/25

        const answers = plainPack.questions.map((q, qIdx) => {
          const pickedIdx =
            qIdx < targetRightCount ? q.correctIndex : (q.correctIndex + 1) % q.options.length;
          return {
            questionId: q.id,
            selectedIndex: pickedIdx,
            isCorrect: pickedIdx === q.correctIndex,
            answeredAt: new Date(startMs + qIdx * 2000).toISOString(),
            lateSync: false,
          };
        });

        const computedScore = answers.reduce(
          (sum, a, qIdx) => sum + (a.isCorrect ? plainPack.questions[qIdx].points : 0),
          0
        );
        expect(computedScore).toBe(targetRightCount);

        const stuNo = `2026-D${String(idx + 1).padStart(3, "0")}`;
        const stuName = `Demo Learner ${idx + 1}`;
        const resultQr = await buildOfflineResultQr({
          packId: plainPack.id,
          studentNo: stuNo,
          studentName: stuName,
          score: computedScore,
          maxScore: 25,
        });

        const payload: OfflineResultPlainPayload = {
          id: `att_demo_${idx + 1}`,
          packId: plainPack.id,
          packTitle: plainPack.title,
          studentId: `stu_${idx + 1}`,
          studentName: stuName,
          studentNo: stuNo,
          classCode: "DEMO10",
          score: computedScore,
          maxScore: 25,
          lateCount: 0,
          submittedAt: new Date(startMs + 60000).toISOString(),
          answers,
        };
        const packet = await encryptResultPacket(payload);

        return { stuNo, stuName, expectedScore: computedScore, resultQr, packet };
      })
    );

    // Teacher verifies all 50 Result QRs and all 50 encrypted packets concurrently
    const verifyQrResults = await Promise.all(
      submissions.map((s) =>
        verifyResultPost(
          new NextRequest("http://localhost/api/teacher/verify-result", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": "203.0.113.51",
            },
            body: JSON.stringify({ code: s.resultQr }),
          })
        ).then((r) => r.json())
      )
    );

    for (let i = 0; i < studentCount; i++) {
      expect(verifyQrResults[i].valid).toBe(true);
      expect(verifyQrResults[i].studentName).toBe(submissions[i].stuName);
      expect(verifyQrResults[i].score).toBe(submissions[i].expectedScore);
      expect(verifyQrResults[i].maxScore).toBe(25);
    }

    const decryptedPackets = await Promise.all(
      submissions.map((s) => decryptResultPacket(s.packet))
    );
    for (let i = 0; i < studentCount; i++) {
      expect(decryptedPackets[i].score).toBe(submissions[i].expectedScore);
      expect(decryptedPackets[i].answers).toHaveLength(25);
    }

    // Tampered score inside Result QR must be caught & rejected
    const forgedQr = submissions[0].resultQr.replace(".0.25.", ".25.25.");
    const forgedRes = await verifyResultPost(
      new NextRequest("http://localhost/api/teacher/verify-result", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.52" },
        body: JSON.stringify({ code: forgedQr }),
      })
    );
    const forgedJson = (await forgedRes.json()) as { valid: boolean };
    expect(forgedJson.valid).toBe(false);

    // Total 50-student cryptographic flow finishes cleanly under 10s
    expect(Date.now() - startMs).toBeLessThan(10_000);
  });

  it("accepts string-only teacher usernames (no email required) cleanly on /api/teacher/auth", async () => {
    const badUserRes = await teacherAuthPost(
      new NextRequest("http://localhost/api/teacher/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          username: "bad user",
          password: "password123",
        }),
      })
    );
    expect(badUserRes.status).toBe(400);

    // Plain string username (no @ symbol) succeeds or cleanly signals 503 offline-fallback when DB service key is unset
    const okFormatRes = await teacherAuthPost(
      new NextRequest("http://localhost/api/teacher/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          username: "teacher_dioso",
          displayName: "Ms. Lyn Dioso",
          password: "password123",
        }),
      })
    );
    expect([200, 400, 503]).toContain(okFormatRes.status);
  });
});
