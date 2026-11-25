import { describe, it, expect } from "vitest";
import { syncSaltedHash } from "../lib/crypto/quizVault";
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

  it("matches every numerical practice answer hash across Weeks 1 to 10", () => {
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
      expect(syncSaltedHash(answers[i][1], mod.practiceItems[1].id)).toBe(
        mod.practiceItems[1].expectedHash
      );
    });
  });

  it("builds encrypted packs from Grade 10 blueprints without plaintext leakage", async () => {
    const pack = await buildEncryptedPackFromBlueprint(GRADE10_BLUEPRINTS[0], "Teacher");
    expect(pack.questionCount).toBe(25);
    expect(JSON.stringify(pack)).not.toContain("discriminant of 2x^2");
  });

  it("computes server clock offset and countdown safely against tampered device clocks", () => {
    // Device clock is 10 minutes ahead of server clock
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
