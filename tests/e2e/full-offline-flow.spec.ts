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

  test("teacher registers (no email), creates class, starts live offline run, sees newly registered student in roster, and collects separate-phone student Result QR", async ({
    page,
    browser,
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

    // 2. Create class -> capture Join Code
    await page.locator("input[placeholder*='Grade 10 - Rizal']").fill("Grade 10 - Rizal");
    await page.locator("button:has-text('Create Class')").click();
    await expect(page.locator("h2", { hasText: "Grade 10 - Rizal" })).toBeVisible();
    const joinCode = (
      await page.locator("p:has-text('Student Join Code:') code").textContent()
    )?.trim() || "";
    expect(joinCode.length).toBeGreaterThanOrEqual(4);

    // 3. Load Grade 10 checkpoint quiz & Start Run -> must immediately show Live Run Dashboard + Classroom Quiz QR
    await page.getByRole("button", { name: /^Quizzes/ }).click();
    await page.locator("button:has-text('Quick Checkpoint (5 Items)')").click();
    await page.locator("button:has-text('Start Run')").first().click();

    await expect(page.locator("body")).toContainText("Live Run Active");
    await expect(page.locator("canvas[aria-label='Classroom Quiz QR']")).toBeVisible();
    const classroomQuizQrPayload =
      (
        await page
          .locator("code", { hasText: /^QPK[01]\./ })
          .first()
          .textContent()
      )?.trim() || "";
    expect(classroomQuizQrPayload).toMatch(/^QPK[01]\./);

    // 4. Same-device Student registers using Teacher's Join Code -> answers 5/5 -> auto-enrolls & updates roster
    await page.goto(`/auth?role=student&tab=register&join=${encodeURIComponent(joinCode)}`);
    await page.locator("input[placeholder*='Dela Cruz']").fill("Dela Cruz, Mateo");
    await page.locator("input[placeholder='2026-0001']").fill("2026-0777");
    await page.locator("input[placeholder='Enter PIN or password']").fill("123456");
    await page.locator("button:has-text('Create Student Account & QR Pass')").click();
    await page.locator("button:has-text('Continue to Student Workspace')").click();
    await page.waitForURL("**/student");

    await expect(page.locator("body")).toContainText("Teacher Started Classroom Quiz · Grade 10 - Rizal");
    await page.locator("button:has-text('Start Classroom Quiz')").click();
    await page.waitForURL("**/student/play**");

    const letters = ["B", "C", "B", "C", "B"];
    for (let i = 0; i < 5; i++) {
      await page.locator("button", { hasText: new RegExp(`^${letters[i]}`) }).first().click();
      if (i < 4) await page.locator("button:has-text('Next Question')").click();
      else await page.locator("button:has-text('Finish & Generate QR')").click();
    }
    await expect(page.locator("body")).toContainText("5 / 5");

    // 5. Simulate a SECOND separate phone offline (isolated browser context!) scanning Teacher's Quiz QR & scoring 4/5
    const phone2Ctx = await browser.newContext();
    const phone2Page = await phone2Ctx.newPage();
    await phone2Page.goto("/auth?role=student&tab=register&join=SELF");
    await phone2Page.locator("input[placeholder*='Dela Cruz']").fill("Santos, Ana");
    await phone2Page.locator("input[placeholder='2026-0001']").fill("2026-0888");
    await phone2Page.locator("input[placeholder='Enter PIN or password']").fill("654321");
    await phone2Page.locator("button:has-text('Create Student Account & QR Pass')").click();
    await phone2Page.locator("button:has-text('Continue to Student Workspace')").click();
    await phone2Page.waitForURL("**/student");

    await phone2Ctx.setOffline(true);
    await phone2Page.locator("button:has-text('Scan Quiz QR')").click();
    await phone2Page.locator("input[placeholder*='QPK1']").fill(classroomQuizQrPayload);
    await phone2Page.locator("button:has-text('Load')").first().click();

    await phone2Page.locator(".qg-card", { hasText: "Quick Checkpoint (5 Items)" }).first().locator("button:has-text('Start Quiz')").click();
    await phone2Page.waitForURL("**/student/play**");
    // Answer 4 right, 1st wrong -> dismiss modal -> 4/5
    const phone2Letters = ["A", "C", "B", "C", "B"];
    for (let i = 0; i < 5; i++) {
      await phone2Page.locator("button", { hasText: new RegExp(`^${phone2Letters[i]}`) }).first().click();
      const modal = phone2Page.locator("div[role='dialog']");
      if (await modal.isVisible().catch(() => false)) {
        await modal.locator("button:has-text('Continue')").click();
      }
      if (i < 4) await phone2Page.locator("button:has-text('Next Question')").click();
      else await phone2Page.locator("button:has-text('Finish & Generate QR')").click();
    }
    await expect(phone2Page.locator("body")).toContainText("4 / 5");
    const anaResultQr = (await phone2Page.locator("code").last().textContent())?.trim() || "";
    expect(anaResultQr).toMatch(/^QG1O\./);
    await phone2Ctx.close();

    // 6. Teacher logs back in on Teacher Console -> sees Enrolled Student (NOT 0!), Mateo's 5/5, AND collects Ana's 4/5 Result QR!
    await page.goto("/auth?role=teacher&tab=login");
    await page.locator("input[placeholder*='teacher_dioso']").fill("teacher_rivera");
    await page.locator("input[placeholder='Password']").fill("securepass123");
    await page.locator("button:has-text('Sign In to Teacher Console')").click();
    await page.waitForURL("**/teacher");

    await expect(page.locator("body")).toContainText("Enrolled Students (1)");
    await expect(page.locator("body")).toContainText("Dela Cruz, Mateo");

    await page.getByRole("button", { name: /^Quizzes/ }).click();
    await expect(page.locator("body")).toContainText("Dela Cruz, Mateo");
    await expect(page.locator("body")).toContainText("5/5");

    // Collect 2nd phone offline student Result QR directly inside Run Roster
    await page.locator("input[placeholder*='QG1O']").fill(anaResultQr);
    await page.locator("button:has-text('Record Score')").click();

    await expect(page.locator("body")).toContainText("2/2 Recorded");
    await expect(page.locator("body")).toContainText("Santos, Ana");
    await expect(page.locator("body")).toContainText("4/5");

    // End the Run cleanly
    await page.locator("button:has-text('End Run')").click();
    await expect(page.locator("body")).toContainText("Run Ended");
  });
});
