import { test, expect } from "@playwright/test";

test.describe("QuizGate PWA: Registration, Study Scenario Fix, Encrypted Offline Quiz, Demo Flow & QR Verification", () => {
  test("registers student, verifies Grade 10 scenario questions grade accurately, takes encrypted quiz offline, reloads offline, and verifies QR", async ({
    page,
    context,
  }) => {
    // 1. Load Home online so PWA Service Worker installs & warms all routes
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Student Portal");

    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    await page.waitForTimeout(900);

    // 2. Register Student Account -> get Personal Identity QR
    await page.locator("a:has-text('Register')").first().click();
    await page.waitForURL("**/auth**");

    await page.locator("input[placeholder*='Dela Cruz']").fill("Luna, Antonio M.");
    await page.locator("input[placeholder='2026-0001']").fill("2026-0199");
    await page.locator("input[placeholder='Enter PIN or password']").fill("123456");
    await page.locator("button:has-text('Create Student Account & QR Pass')").click();

    await expect(page.locator("h1")).toContainText("Registration Complete");
    await expect(page.locator("canvas[aria-label='Luna, Antonio M.']")).toBeVisible();

    await page.locator("button:has-text('Continue to Student Workspace')").click();
    await page.waitForURL("**/student");
    await expect(page.locator("h1")).toContainText("Hi, Luna, Antonio M.");

    // 3. GO COMPLETELY OFFLINE BEFORE STUDY + QUIZ
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // Verify Week 1 Study Module end-to-end including Scenario MCQs (regresses salt bug!)
    await page.locator("button:has-text('G10 Topics')").click();
    await page.locator("button:has-text('Rational Exponents & Radicals')").click();
    await page.locator("button:has-text('Continue to Matching Activity')").click();

    // Complete all 4 Week 1 matches (MathText renders √ and superscripts cleanly)
    const pairs: [RegExp, RegExp][] = [
      [/√49a/, /^7a3b2$/],
      [/81m/, /^3m2n3$/],
      [/27x/, /^3x3y$/],
      [/^82\/3$/, /^4$/],
    ];
    for (const [leftRe, rightRe] of pairs) {
      await page.locator("button", { hasText: leftRe }).first().click();
      await page.locator("button", { hasText: rightRe }).first().click();
    }
    await page.locator("button:has-text('Proceed to Quantitative Practice')").click();

    // Solve numeric practice checks (9 and 8; Check changes to Done once solved)
    const numInputs = page.locator("input[placeholder='Numeric answer']");
    await numInputs.nth(0).fill("9");
    await numInputs.nth(1).fill("8");
    await page.locator("button:has-text('Check')").first().click();
    await expect(page.locator("button:has-text('Done')")).toHaveCount(1);
    await page.locator("button:has-text('Check')").first().click();
    await expect(page.locator("button:has-text('Done')")).toHaveCount(2);
    await expect(page.locator("body")).toContainText("Correct (+5 pts).");
    await page.locator("button:has-text('Proceed to Word Problem')").click();

    // Confirm applied scenario MCQ options grade CORRECTLY!
    await page.locator("button", { hasText: /^12x2y3 m$/ }).click();
    await expect(page.locator("body")).toContainText("Correct (+10 pts).");
    await page.locator("button:has-text('Next Question')").click();
    await page.locator("button", { hasText: /^20√2 m$/ }).click();
    await expect(page.locator("body")).toContainText("Correct (+10 pts).");

    await page.locator("button:has-text('All Topics')").click();
    await page.locator("button:has-text('Quizzes')").click();

    // Start encrypted 5-item Quick Checkpoint pack offline
    const quickCard = page
      .locator(".qg-card", { hasText: "Quick Checkpoint (5 Items)" })
      .first();
    await quickCard.locator("button:has-text('Start Quiz')").click();
    await page.waitForURL("**/student/play**");

    // 4. Answer all 5 encrypted questions accurately offline (answers: B, C, B, C, B)
    const correctLetters = ["B", "C", "B", "C", "B"];
    for (let i = 0; i < 5; i++) {
      await expect(page.locator("body")).toContainText(`Question ${i + 1} of 5`);
      await page.locator("button", { hasText: new RegExp(`^${correctLetters[i]}`) }).first().click();

      // Should NOT show Incorrect modal when right answer is clicked!
      await expect(page.locator("div[role='dialog']")).toHaveCount(0);

      if (i < 4) {
        await page.locator("button:has-text('Next Question')").click();
      } else {
        await page.locator("button:has-text('Finish & Generate QR')").click();
      }
    }

    // 5. Verify 5 / 5 perfect score and signed Result QR pass
    await expect(page.locator("body")).toContainText("5 / 5");
    await expect(page.locator("canvas[aria-label='Verified Result QR Pass']")).toBeVisible();
    const resultQrCode = (await page.locator("code").last().textContent())?.trim() || "";
    expect(resultQrCode).toMatch(/^QG1O\./);

    // 6. Reload completely OFFLINE & confirm Service Worker + IndexedDB persist cleanly
    await page.reload();
    await expect(page.locator("canvas[aria-label='Verified Result QR Pass']")).toBeVisible();

    // 7. Open /verify while STILL OFFLINE and authenticate Result QR
    await page.goto("/verify");
    await expect(page.locator("h1")).toContainText("Verify Student Result");

    await page.locator("#manual-qr-input").fill(resultQrCode);
    await page.locator("button:has-text('Verify Code')").click();

    await expect(page.locator("body")).toContainText("Valid Student Result");
    await expect(page.locator("body")).toContainText("Luna, Antonio M.");
    await expect(page.locator("body")).toContainText("5/5");
    await expect(page.locator("body")).toContainText("Offline Signature Verifier");

    // 8. Reconnect online and verify again via Serverless API
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("button:has-text('Verify Code')").click();

    await expect(page.locator("body")).toContainText("Serverless Verifier API");
  });

  test("teacher registers with string username (no email), loads 5-student Demo Classroom, adds & prints QRs, and loads quiz", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Register Teacher account using string username only (zero email)
    await page.goto("/auth?role=teacher&tab=register");
    await page.locator("input[placeholder*='Lyn Dioso']").fill("Ms. Rivera");
    await page.locator("input[placeholder*='teacher_dioso']").fill("teacher_rivera");
    await page.locator("input[placeholder='Password']").fill("securepass123");
    await page.locator("button:has-text('Register Teacher Account')").click();

    await page.waitForURL("**/teacher");
    await expect(page.locator("h1")).toContainText("Teacher Console · Ms. Rivera");

    // 2. Click Load Demo Classroom -> creates 5 demo students + class + Grade 10 checkpoint quiz
    await page.locator("button:has-text('Load Demo Classroom')").click();
    await expect(page.locator("h2", { hasText: "Grade 10 - Demo Class" })).toBeVisible();
    await expect(page.locator("body")).toContainText("Enrolled Students (5)");
    await expect(page.locator("body")).toContainText("Dela Cruz, Juan");

    // Add a 6th student manually
    await page.locator("input[placeholder*='Juan Dela Cruz']").fill("Bonifacio, Andres");
    await page.locator("input[placeholder*='2026-0001']").fill("2026-0301");
    await page.locator("button:has-text('Add')").first().click();
    await expect(page.locator("body")).toContainText("Enrolled Students (6)");

    // Check Printable QR Sheet renders all student QR cards cleanly
    await page.getByRole("button", { name: "QR Sheet", exact: true }).click();
    await expect(page.locator("canvas[aria-label='Dela Cruz, Juan']")).toBeVisible();
    await expect(page.locator("canvas[aria-label='Bonifacio, Andres']")).toBeVisible();

    // Check Demo Grade 10 Quiz exists in Quizzes tab
    await page.getByRole("button", { name: /^Quizzes/ }).click();
    await expect(page.locator("body")).toContainText("Quick Checkpoint (5 Items)");
    await expect(page.locator("body")).toContainText("5 items");
  });
});
