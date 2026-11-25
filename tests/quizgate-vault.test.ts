import { describe, it, expect } from "vitest";
import {
  buildOfflineResultQr,
  buildOfflineStudentIdQr,
  decodeUtf8Base64Url,
  decryptQuizPack,
  decryptResultPacket,
  encodeUtf8Base64Url,
  encryptQuizPack,
  encryptResultPacket,
  parseStudentIdQr,
  verifyOfflineOrFormatQr,
  type OfflineResultPlainPayload,
  type QuizPackPlainPayload,
} from "../lib/crypto/quizVault";

describe("QuizGate AES-256-GCM Encrypted Vault & QR Cryptography", () => {
  const samplePlain: QuizPackPlainPayload = {
    id: "pack-algebra-1",
    title: "Discriminant Quick Quiz",
    subject: "Mathematics 10",
    description: "Offline encrypted test",
    durationMinutes: 10,
    instantFeedback: true,
    allowRetry: false,
    createdBy: "Teacher Lyn",
    createdAt: "2026-11-26T00:00:00Z",
    questions: [
      {
        id: "q1",
        prompt: "What is the discriminant of x^2 - 4x + 4 = 0?",
        options: ["0", "16", "-16", "8"],
        correctIndex: 0,
        points: 1,
        feedbackSalt: "s1",
        correctHash: "h1",
      },
    ],
  };

  it("encrypts quiz packs with AES-256-GCM so questions/answers are hidden until decrypted", async () => {
    const encrypted = await encryptQuizPack(samplePlain);
    expect(encrypted.kind).toBe("QGATE_PACK");
    expect(encrypted.ciphertext).toBeTruthy();
    expect(JSON.stringify(encrypted)).not.toContain("discriminant of x^2");
    expect(JSON.stringify(encrypted)).not.toContain("correctIndex");

    const decrypted = await decryptQuizPack(encrypted);
    expect(decrypted.title).toBe("Discriminant Quick Quiz");
    expect(decrypted.questions).toHaveLength(1);
    expect(decrypted.questions[0].correctIndex).toBe(0);
  });

  it("protects passcode-locked packs and rejects tampering or wrong passcodes", async () => {
    const locked = await encryptQuizPack(samplePlain, "grade10math");
    expect(locked.lockedWithPasscode).toBe(true);

    await expect(decryptQuizPack(locked, "wrongpass")).rejects.toThrow(/Incorrect quiz passcode/);

    const unlocked = await decryptQuizPack(locked, "grade10math");
    expect(unlocked.questions[0].id).toBe("q1");

    const tampered = { ...locked, ciphertext: locked.ciphertext.slice(0, -4) + "AAAA" };
    await expect(decryptQuizPack(tampered, "grade10math")).rejects.toThrow(/integrity check failed/);
  });

  it("encrypts and verifies student .qres.json offline submission packets", async () => {
    const submission: OfflineResultPlainPayload = {
      id: "att-1",
      packId: "pack-algebra-1",
      packTitle: "Discriminant Quick Quiz",
      studentId: "stu-1",
      studentName: "Juan Dela Cruz",
      studentNo: "2026-0042",
      score: 1,
      maxScore: 1,
      lateCount: 0,
      submittedAt: "2026-11-26T01:00:00Z",
      answers: [
        {
          questionId: "q1",
          selectedIndex: 0,
          isCorrect: true,
          answeredAt: "2026-11-26T00:59:00Z",
          lateSync: false,
        },
      ],
    };

    const packet = await encryptResultPacket(submission);
    expect(packet.kind).toBe("QGATE_RESULT");
    const decrypted = await decryptResultPacket(packet);
    expect(decrypted.studentName).toBe("Juan Dela Cruz");
    expect(decrypted.answers).toHaveLength(1);

    const forged = { ...packet, score: 100 };
    await expect(decryptResultPacket(forged)).rejects.toThrow(/signature check failed/);
  });

  it("builds and verifies signed Student ID QRs (QG1L) and Result QRs (QG1O)", async () => {
    const idQr = await buildOfflineStudentIdQr("stu-99", "2026-0099", "María Clara", "MATH10");
    const parsedId = await parseStudentIdQr(idQr);
    expect(parsedId.valid).toBe(true);
    expect(parsedId.studentName).toBe("María Clara");
    expect(parsedId.classCode).toBe("MATH10");

    const resultQr = await buildOfflineResultQr({
      packId: "g10-q2-diagnostic",
      studentNo: "2026-0099",
      studentName: "María Clara",
      score: 22,
      maxScore: 25,
      lateCount: 1,
    });
    const verified = await verifyOfflineOrFormatQr(resultQr);
    expect(verified.valid).toBe(true);
    expect(verified.studentName).toBe("María Clara");
    expect(verified.score).toBe(22);
    expect(verified.maxScore).toBe(25);
    expect(verified.lateCount).toBe(1);

    // Reject altered score in QR
    const tamperedQr = resultQr.replace(".22.25.", ".25.25.");
    const bad = await verifyOfflineOrFormatQr(tamperedQr);
    expect(bad.valid).toBe(false);

    // Unicode URL-safe base64 roundtrip
    const encoded = encodeUtf8Base64Url("José & María");
    expect(decodeUtf8Base64Url(encoded)).toBe("José & María");
  });
});
