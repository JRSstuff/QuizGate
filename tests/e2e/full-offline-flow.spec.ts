import { test, expect } from "@playwright/test";
import fs from "node:fs";

test.describe("QuizGate PWA: Link-Based Offline Quiz Flow & Study Verification", () => {
  test("teacher creates quiz link -> 2 students go offline -> waiting room hides questions -> Start Code unlocks -> auto-submit timer -> teacher uploads both .qres.json offline -> CSV", async ({
    browser,
    context: teacherContext,
    page: teacherPage,
  }, testInfo) => {
    test.setTimeout(90000);

    // 1. Verify UI hides student Login/Register on HomeScreen and shows Classroom Offline Mode badge cleanly
    await teacherPage.goto("/");
    await expect(
      teacherPage.getByText("Student Quiz Portal").or(teacherPage.getByText("Student Portal"))
    ).toBeVisible();
    await expect(teacherPage.locator('a[href*="role=student"]')).toHaveCount(0);
    await expect(teacherPage.getByRole("link", { name: /^Register$/i })).toHaveCount(0);

    // 2. Teacher opens /teacher and creates a 15-second (0.25 min) Quiz Link
    await teacherPage.goto("/teacher");
    await expect(teacherPage.getByText(/Classroom Offline Mode —/i)).toBeVisible();

    await teacherPage.fill("#link-quiz-title", "Circles E2E Offline Test");
    await teacherPage.fill("#link-class-name", "Grade 10 - Rizal");
    await teacherPage.fill("#link-sections", "10-Rizal, 10-Bonifacio");
    await teacherPage.fill("#link-duration-mins", "0.25");

    await teacherPage.getByTestId("create-quiz-link-btn").click();
    const linkInput = teacherPage.getByTestId("generated-quiz-link");
    await expect(linkInput).toBeVisible();
    const shareUrl = await linkInput.inputValue();
    expect(shareUrl).toContain("/q/");
    expect(shareUrl).toContain("#L3.");

    // 3. Launch TWO isolated student mobile contexts opening the shareable link
    const student1Ctx = await browser.newContext({
      viewport: { width: 393, height: 851 },
      acceptDownloads: true,
    });
    const student2Ctx = await browser.newContext({
      viewport: { width: 393, height: 851 },
      acceptDownloads: true,
    });

    const s1Page = await student1Ctx.newPage();
    const s2Page = await student2Ctx.newPage();

    await Promise.all([s1Page.goto(shareUrl), s2Page.goto(shareUrl)]);

    // Wait until both students show Ready Offline (bundle in IndexedDB + SW route/assets cached)
    await expect(s1Page.getByTestId("ready-offline-badge")).toBeVisible({ timeout: 15000 });
    await expect(s2Page.getByTestId("ready-offline-badge")).toBeVisible({ timeout: 15000 });

    await s1Page.fill("#student-full-name", "Maria Santos");
    await s1Page.selectOption("#student-section", "10-Rizal");
    await s1Page.getByRole("button", { name: /Enter Waiting Room/i }).click();

    await s2Page.fill("#student-full-name", "Carlo Reyes");
    await s2Page.selectOption("#student-section", "10-Bonifacio");
    await s2Page.getByRole("button", { name: /Enter Waiting Room/i }).click();

    await expect(s1Page.getByText(/Waiting Room — Questions Are Locked/i)).toBeVisible();
    await expect(s2Page.getByText(/Waiting Room — Questions Are Locked/i)).toBeVisible();

    // 4. Cut internet on BOTH student devices AND verify quiz questions stay unreadable
    await student1Ctx.setOffline(true);
    await student2Ctx.setOffline(true);
    await expect(s1Page.getByTestId("quiz-timer")).toHaveCount(0);
    await expect(s1Page.getByRole("button", { name: /Finish & Generate File/i })).toHaveCount(0);

    // Wrong Start Code is rejected
    await s1Page.fill("#start-code-input", "22222-33333");
    await s1Page.getByRole("button", { name: /Unlock Quiz/i }).click();
    await expect(s1Page.getByText(/Wrong or tampered Start Code/i)).toBeVisible();

    // 5. Teacher clicks START QUIZ -> gets 10-char signed Start Code
    await teacherPage.getByTestId("teacher-start-btn").click();
    const startCodeEl = teacherPage.getByTestId("teacher-start-code");
    await expect(startCodeEl).toBeVisible();
    const startCode = (await startCodeEl.textContent())?.trim() || "";
    expect(startCode).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);

    // 6. Both students unlock OFFLINE using Start Code
    await s1Page.fill("#start-code-input", startCode);
    await s2Page.fill("#start-code-input", startCode);
    await Promise.all([
      s1Page.getByRole("button", { name: /Unlock Quiz/i }).click(),
      s2Page.getByRole("button", { name: /Unlock Quiz/i }).click(),
    ]);

    await expect(s1Page.getByTestId("quiz-timer")).toBeVisible();
    await expect(s2Page.getByTestId("quiz-timer")).toBeVisible();

    const parseSec = (txt: string | null) => {
      const m = (txt || "0:00").trim().match(/(\d+):(\d+)/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    };
    const s2BeforeReloadSec = parseSec(await s2Page.getByTestId("quiz-timer").textContent());

    // Attach download listener for Student 2 auto-submit BEFORE waiting for timer expiry
    const s2DlPromise = s2Page.waitForEvent("download", { timeout: 25000 });

    // Student 1 completes answers and manually clicks Finish
    await s1Page.locator("button:has(strong:text('A.'))").first().click();
    let s1FilePath = "";
    for (let step = 0; step < 10; step++) {
      const finishBtn = s1Page.getByRole("button", { name: /Finish & Generate File/i });
      if (await finishBtn.isVisible().catch(() => false)) {
        const dlPromise = s1Page.waitForEvent("download");
        await finishBtn.click();
        const dl1 = await dlPromise;
        s1FilePath = testInfo.outputPath("maria-santos.qres.json");
        await dl1.saveAs(s1FilePath);
        await expect(s1Page.getByText(/Send this file to your teacher/i)).toBeVisible();
        break;
      }
      await s1Page.getByRole("button", { name: /^Next$/i }).click();
    }
    expect(s1FilePath).not.toBe("");

    // Student 2 reloads offline mid-attempt -> verify cached page works offline AND timer was NOT reset
    await s2Page.waitForTimeout(1200);
    await s2Page.reload();
    await expect(s2Page.getByTestId("quiz-timer")).toBeVisible();
    const s2AfterReloadSec = parseSec(await s2Page.getByTestId("quiz-timer").textContent());
    expect(s2AfterReloadSec).toBeLessThanOrEqual(s2BeforeReloadSec);

    // Wait for Student 2's 15-second timer to expire -> auto-submits & triggers download once
    const dl2 = await s2DlPromise;
    const s2FilePath = testInfo.outputPath("carlo-reyes.qres.json");
    await dl2.saveAs(s2FilePath);
    await expect(s2Page.getByText(/Send this file to your teacher/i)).toBeVisible();

    // 7. Put Teacher COMPLETELY OFFLINE too, multi-upload BOTH .qres.json files, verify Roster + CSV
    await teacherContext.setOffline(true);
    await teacherPage
      .getByTestId("teacher-upload-qres")
      .setInputFiles([s1FilePath, s2FilePath]);

    await expect(teacherPage.getByText(/\[ACCEPTED\].*maria-santos/i).first()).toBeVisible();
    await expect(teacherPage.getByText(/\[ACCEPTED\].*carlo-reyes/i).first()).toBeVisible();
    await expect(teacherPage.getByRole("cell", { name: "Maria Santos" })).toBeVisible();
    await expect(teacherPage.getByRole("cell", { name: "Carlo Reyes" })).toBeVisible();

    const csvDlPromise = teacherPage.waitForEvent("download");
    await teacherPage.getByTestId("export-link-csv-btn").click();
    const csvDl = await csvDlPromise;
    const csvPath = testInfo.outputPath("class-results.csv");
    await csvDl.saveAs(csvPath);
    const csvBody = fs.readFileSync(csvPath, "utf8");
    expect(csvBody).toContain("Maria Santos");
    expect(csvBody).toContain("Carlo Reyes");
    expect(csvBody).toContain("10-Rizal");
    expect(csvBody).toContain("10-Bonifacio");

    await student1Ctx.close();
    await student2Ctx.close();
    await teacherContext.setOffline(false);
  });

  test("Grade 10 Study Track and /verify page work offline cleanly", async ({
    context,
    page,
  }) => {
    await page.goto("/student");
    await expect(page.getByRole("heading", { name: /Student Workspace/i })).toBeVisible();

    // Pre-cache /verify route while online via navigation
    await page.goto("/verify");
    await expect(page.getByRole("heading").first()).toBeVisible();

    await page.goto("/student");
    await page.getByRole("button", { name: /G10 Topics/i }).click();
    await expect(page.getByText(/Grade 10 Quarter 2 Math Track/i)).toBeVisible();

    // Wait briefly for SW to claim page, then test offline navigation cleanly
    await page.waitForTimeout(400);
    await context.setOffline(true);

    await page.getByRole("button", { name: /Week 1 · Topic A/i }).click();
    await page.getByRole("button", { name: /Continue to Matching Activity/i }).click();
    await expect(page.getByText(/Match Equivalent Expressions/i)).toBeVisible();

    await page.goto("/verify");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await context.setOffline(false);
  });
});
