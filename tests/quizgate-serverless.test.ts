import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as healthGet } from "../app/api/health/route";
import { GET as timeGet } from "../app/api/time/route";
import { POST as studentRegisterPost } from "../app/api/student/register/route";
import { POST as studentLoginPost } from "../app/api/student/login/route";
import { POST as verifyResultPost } from "../app/api/teacher/verify-result/route";
import {
  buildOfflineResultQr,
  encryptResultPacket,
  type OfflineResultPlainPayload,
} from "../lib/crypto/quizVault";
import { isSupabasePublicConfigured } from "../lib/supabase/config";

describe("Vercel Serverless Endpoints (Student Auth, Health, QR & File Verification)", () => {
  it("responds with health status, public Supabase env detection, and un-cached server clock", async () => {
    const hRes = await healthGet();
    expect(hRes.status).toBe(200);
    const hData = (await hRes.json()) as {
      status: string;
      supabasePublicConfigured: boolean;
      server_time: number;
    };
    expect(hData.status).toBe("ok");
    expect(hData.supabasePublicConfigured).toBe(isSupabasePublicConfigured());

    const tRes = await timeGet();
    expect(tRes.status).toBe(200);
    expect(tRes.headers.get("Cache-Control")).toContain("no-store");
  });

  it("registers a student cleanly and authenticates their generated QR pass", async () => {
    const regReq = new NextRequest("http://localhost/api/student/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        joinCode: "SELF",
        name: "Juan Dela Cruz",
        studentNo: "2026-0001",
        pin: "4321",
      }),
    });
    const regRes = await studentRegisterPost(regReq);
    expect(regRes.status).toBe(200);
    const regData = (await regRes.json()) as {
      mode: string;
      qr_payload: string;
      student: { name: string };
    };
    expect(regData.mode).toBe("offline");
    expect(regData.qr_payload.startsWith("QG1L.")).toBe(true);
    expect(regData.student.name).toBe("Juan Dela Cruz");

    const loginReq = new NextRequest("http://localhost/api/student/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: regData.qr_payload }),
    });
    const loginRes = await studentLoginPost(loginReq);
    expect(loginRes.status).toBe(200);
    const loginData = (await loginRes.json()) as { student: { name: string } };
    expect(loginData.student.name).toBe("Juan Dela Cruz");
  });

  it("verifies both offline result QRs (QG1O) and encrypted .qres.json packets", async () => {
    const qr = await buildOfflineResultQr({
      packId: "g10-q2-quick5",
      studentNo: "2026-0002",
      studentName: "Maria Santos",
      score: 5,
      maxScore: 5,
    });

    const qrReq = new NextRequest("http://localhost/api/teacher/verify-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: qr }),
    });
    const qrRes = await verifyResultPost(qrReq);
    expect(qrRes.status).toBe(200);
    const qrData = (await qrRes.json()) as {
      valid: boolean;
      studentName: string;
      score: number;
      verifiedVia: string;
    };
    expect(qrData.valid).toBe(true);
    expect(qrData.studentName).toBe("Maria Santos");
    expect(qrData.score).toBe(5);
    expect(qrData.verifiedVia).toBe("serverless");

    const plainSub: OfflineResultPlainPayload = {
      id: "att-test",
      packId: "g10-q2-quick5",
      packTitle: "Quick 5",
      studentId: "stu-2",
      studentName: "Maria Santos",
      studentNo: "2026-0002",
      score: 5,
      maxScore: 5,
      lateCount: 0,
      submittedAt: "2026-11-26T00:00:00Z",
      answers: [],
    };
    const packet = await encryptResultPacket(plainSub);
    const fileReq = new NextRequest("http://localhost/api/teacher/verify-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultPacket: packet }),
    });
    const fileRes = await verifyResultPost(fileReq);
    expect(fileRes.status).toBe(200);
    const fileData = (await fileRes.json()) as {
      valid: boolean;
      submission: { studentName: string; score: number };
    };
    expect(fileData.valid).toBe(true);
    expect(fileData.submission.studentName).toBe("Maria Santos");
  });
});
