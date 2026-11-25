import { test, expect } from "@playwright/test";

test.describe("QuizGate PWA: Registration, Encrypted Offline Quiz, Offline Reload & QR Verification", () => {
  test("registers student with QR ID, completes encrypted quiz completely offline, reloads offline, and verifies QR", async ({
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

    // 3. GO COMPLETELY OFFLINE BEFORE TAKING QUIZ
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // Start the encrypted 5-item Quick Checkpoint pack offline
    const quickCard = page
      .locator(".qg-card", { hasText: "Quick Checkpoint (5 Items)" })
      .first();
    await quickCard.locator("button:has-text('Start Quiz')").click();
    await page.waitForURL("**/student/play**");

    // 4. Answer all 5 encrypted questions offline
    for (let i = 0; i < 5; i++) {
      await expect(page.locator("body")).toContainText(`Question ${i + 1} of 5`);
      await page.locator("button", { hasText: /^A/ }).first().click();

      // Dismiss instant feedback modal if wrong answer selected
      const modalDialog = page.locator("div[role='dialog']");
      if (await modalDialog.isVisible().catch(() => false)) {
        await modalDialog.locator("button:has-text('Continue')").click();
      } else {
        await page.waitForTimeout(100);
        if (await modalDialog.isVisible().catch(() => false)) {
          await modalDialog.locator("button:has-text('Continue')").click();
        }
      }

      if (i < 4) {
        await page.locator("button:has-text('Next Question')").click();
      } else {
        await page.locator("button:has-text('Finish & Generate QR')").click();
      }
    }

    // 5. Verify signed Result QR & Offline .qres Export button appear
    await expect(page.locator("canvas[aria-label='Verified Result QR Pass']")).toBeVisible();
    const resultQrCode = (await page.locator("code").last().textContent())?.trim() || "";
    expect(resultQrCode).toMatch(/^QG1O\./);

    // 6. Reload completely OFFLINE & confirm Service Worker + IndexedDB persist cleanly
    await page.reload();
    await expect(page.locator("canvas[aria-label='Verified Result QR Pass']")).toBeVisible();

    // 7. Open /verify while STILL OFFLINE via mobile/top navigation and authenticate Result QR
    await page.goto("/verify");
    await expect(page.locator("h1")).toContainText("Verify Student Result");

    await page.locator("#manual-qr-input").fill(resultQrCode);
    await page.locator("button:has-text('Verify Code')").click();

    await expect(page.locator("body")).toContainText("Valid Student Result");
    await expect(page.locator("body")).toContainText("Luna, Antonio M.");
    await expect(page.locator("body")).toContainText("Offline Signature Verifier");

    // 8. Reconnect online and verify again via Serverless API
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("button:has-text('Verify Code')").click();

    await expect(page.locator("body")).toContainText("Serverless Verifier API");
  });

  test("teacher creates class, adds student QR, loads encrypted Grade 10 quiz, and student accesses study track", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Register Teacher account
    await page.goto("/auth?role=teacher&tab=register");
    await page.locator("input[placeholder*='Lyn Dioso']").fill("Ms. Rivera");
    await page.locator("input[placeholder*='teacher@school.edu']").fill("teacher_rivera");
    await page.locator("input[placeholder='Password']").fill("securepass123");
    await page.locator("button:has-text('Register Teacher Account')").click();

    await page.waitForURL("**/teacher");
    await expect(page.locator("h1")).toContainText("Teacher Console · Ms. Rivera");

    // 2. Create class and add student
    await page.locator("input[placeholder*='Grade 10 - Rizal']").fill("Grade 10 - Bonifacio");
    await page.locator("button:has-text('Create Class')").click();
    await expect(page.locator("h2", { hasText: "Grade 10 - Bonifacio" })).toBeVisible();

    await page.locator("input[placeholder*='Juan Dela Cruz']").fill("Reyes, Ana");
    await page.locator("input[placeholder*='2026-0001']").fill("2026-0301");
    await page.locator("button:has-text('Add')").first().click();
    await expect(page.locator("body")).toContainText("Reyes, Ana");

    // Check Print QR Sheet renders cleanly
    await page.getByRole("button", { name: "QR Sheet", exact: true }).click();
    await expect(page.locator("canvas[aria-label='Reyes, Ana']")).toBeVisible();

    // 3. Load Grade 10 Hardcoded Assessment into Teacher Quizzes
    await page.getByRole("button", { name: /^Quizzes/ }).click();
    await page.locator("button:has-text('Quick Checkpoint (5 Items)')").click();
    await expect(page.locator("body")).toContainText("Your Quizzes");
    await expect(page.locator("body")).toContainText("5 items");

    // 4. Open Student Workspace Grade 10 Study Track
    await page.goto("/student");
    await page.locator("button:has-text('G10 Topics')").click();
    await page.locator("button:has-text('Rational Exponents & Radicals')").click();
    await expect(page.locator("h2").first()).toContainText("Rational Exponents & Radicals");
    await page.locator("button:has-text('Continue to Matching Activity')").click();
    await expect(page.locator("h3").first()).toContainText("Match Equivalent Expressions");
  });
});
