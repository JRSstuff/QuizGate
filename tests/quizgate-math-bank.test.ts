import { describe, it, expect } from "vitest";
import { sha256Hex, syncSaltedHash } from "../lib/crypto/quizVault";
import {
  DIAGNOSTIC_25_ITEMS,
  GRADE10_BLUEPRINTS,
  GRADE10_MODULES,
  MASTERY_7_ITEMS,
  buildEncryptedPackFromBlueprint,
} from "../lib/data/grade10Math";
import {
  calculateClockOffsetMs,
  calculateRemainingSeconds,
  formatCountdown,
} from "../lib/timer/clockSync";

describe("Grade 10 Math Hardcoded Question Bank & Server Clock Rules", () => {
  it("contains 10 structured weekly modules, 25 diagnostic items, and 7 mastery items", () => {
    expect(GRADE10_MODULES).toHaveLength(10);
    expect(DIAGNOSTIC_25_ITEMS).toHaveLength(25);
    expect(MASTERY_7_ITEMS).toHaveLength(7);
    expect(GRADE10_BLUEPRINTS).toHaveLength(3);
  });

  it("matches every numerical practice answer hash across Weeks 1 to 10 (and rejects wrong values)", () => {
    const answers: [number, number][] = [
      [9, 8],
      [5, 7],
      [49, 16],
      [-7, 3],
      [9, 6],
      [13, 6],
      [7, 1],
      [20, 4],
      [8, 1],
      [34, 583],
    ];

    GRADE10_MODULES.forEach((mod, i) => {
      expect(syncSaltedHash(answers[i][0], mod.practiceItems[0].id)).toBe(
        mod.practiceItems[0].expectedHash
      );
      expect(syncSaltedHash(answers[i][0] + 1, mod.practiceItems[0].id)).not.toBe(
        mod.practiceItems[0].expectedHash
      );
      expect(syncSaltedHash(answers[i][1], mod.practiceItems[1].id)).toBe(
        mod.practiceItems[1].expectedHash
      );
      expect(syncSaltedHash(answers[i][1] + 1, mod.practiceItems[1].id)).not.toBe(
        mod.practiceItems[1].expectedHash
      );
    });
  });

  it("grades every applied scenario MCQ accurately across all 10 weekly modules", () => {
    // Ground-truth mathematical answer text for each Week 1..10 scenario question (20 total)
    const expectedScenarioTexts: Record<string, string> = {
      "w1-q1": "12x^2y^3 m",
      "w1-q2": "20sqrt(2) m",
      "w2-q1": "8sqrt(2) m",
      "w2-q2": "2sqrt(6) m",
      "w3-q1": "k = 9",
      "w3-q2": "Two distinct real roots (D = 16)",
      "w4-q1": "y = -(1/5)x^2 + 2x",
      "w4-q2": "3.2 m",
      "w5-q1": "200",
      "w5-q2": "x = 20",
      "w6-q1": "x = 4 only",
      "w6-q2": "The right side becomes -1, whereas a principal square root cannot be negative",
      "w7-q1": "(x - 4)^2 + (y + 2)^2 = 9",
      "w7-q2": "x^2 + y^2 - 8x + 4y + 11 = 0",
      "w8-q1": "On the boundary",
      "w8-q2": "(11, 13)",
      "w9-q1": "(x - 2)^2 + y^2 = 16",
      "w9-q2": "80 m",
      "w10-q1": "(x - 2)^2 + (y + 1)^2 = 34",
      "w10-q2": "583 m",
    };

    for (const mod of GRADE10_MODULES) {
      expect(mod.scenarioQuestions).toHaveLength(2);
      for (const q of mod.scenarioQuestions) {
        const expectedText = expectedScenarioTexts[q.id];
        expect(expectedText).toBeDefined();
        const rightIdx = q.options.indexOf(expectedText);
        expect(rightIdx).toBeGreaterThanOrEqual(0);
        // Must match Grade10ModuleDrawer check: syncSaltedHash(optIdx, q.salt)
        expect(syncSaltedHash(rightIdx, q.salt)).toBe(q.correctHash);
        // All other options must be marked wrong
        q.options.forEach((_, idx) => {
          if (idx !== rightIdx) {
            expect(syncSaltedHash(idx, q.salt)).not.toBe(q.correctHash);
          }
        });
      }
    }
  });

  it("verifies ground-truth answer text for all 25 Diagnostic + 7 Mastery questions", () => {
    const expectedDiag: Record<string, string> = {
      d1: "8",
      d2: "4sqrt(3)",
      d3: "sqrt(5)",
      d4: "7sqrt(2) m",
      d5: "6sqrt(3)",
      d6: "3sqrt(2)",
      d7: "sqrt(5)",
      d8: "6 - 3sqrt(2)",
      d9: "49",
      d10: "One real root (multiplicity two)",
      d11: "k = 10",
      d12: "y = x^2 - x - 6",
      d13: "y = x^2 - 4x + 3",
      d14: "4",
      d15: "u = x^2",
      d16: "400 m^2",
      d17: "45 m",
      d18: "x = 2",
      d19: "x = 2",
      d20: "45 m",
      d21: "C(4, -1), r = 6",
      d22: "x^2 + y^2 - 2x - 4y - 4 = 0",
      d23: "C(4, -3), r = 4",
      d24: "(x - 1)^2 + (y - 5)^2 = 25",
      d25: "(8, 7)",
    };
    const expectedMastery: Record<string, string> = {
      m1: "2sqrt(5) m",
      m2: "No, since D = -44 indicates no real roots",
      m3: "x = 10",
      m4: "4",
      m5: "(5, -2), r = 3",
      m6: "Inside the plaza",
      m7: "(x - 2)^2 + (y + 1)^2 = 25",
    };

    for (const q of DIAGNOSTIC_25_ITEMS) {
      expect(q.options[q.correctIndex]).toBe(expectedDiag[q.id]);
    }
    for (const q of MASTERY_7_ITEMS) {
      expect(q.options[q.correctIndex]).toBe(expectedMastery[q.id]);
    }
  });

  it("supports both offline FNV-1a and Postgres 64-char SHA-256 feedback hashes", async () => {
    const qId = "11111111-1111-1111-1111-111111111111";
    const salt = "abcd1234ef567890";
    const postgresHash = await sha256Hex(`${qId}:2:${salt}`);
    expect(postgresHash).toHaveLength(64);
    expect(await sha256Hex(`${qId}:0:${salt}`)).not.toBe(postgresHash);
    expect(await sha256Hex(`${qId}:2:${salt}`)).toBe(postgresHash);
  });

  it("builds encrypted packs from Grade 10 blueprints without plaintext leakage", async () => {
    const pack = await buildEncryptedPackFromBlueprint(GRADE10_BLUEPRINTS[0], "Teacher");
    expect(pack.questionCount).toBe(25);
    expect(JSON.stringify(pack)).not.toContain("discriminant of 2x^2");
  });

  it("computes server clock offset and countdown safely against tampered device clocks", () => {
    const trueServerMs = 1_700_000_000_000;
    const clientAheadT0 = trueServerMs + 600_000;
    const clientAheadT1 = clientAheadT0 + 40;
    const offset = calculateClockOffsetMs(trueServerMs, clientAheadT0, clientAheadT1);
    expect(offset).toBe(-600_020);

    const clientMidpoint = Math.round((clientAheadT0 + clientAheadT1) / 2);
    const endsAtIso = new Date(trueServerMs + 120_000).toISOString();
    const remaining = calculateRemainingSeconds(endsAtIso, offset, clientMidpoint);
    expect(remaining).toBe(120);
    expect(formatCountdown(remaining)).toBe("02:00");
  });
});
