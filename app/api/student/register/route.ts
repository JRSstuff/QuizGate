import { NextRequest, NextResponse } from "next/server";
import {
  buildOfflineStudentIdQr,
  sha256Hex,
} from "@/lib/crypto/quizVault";
import { checkRateLimit } from "@/lib/security/ratelimit";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = checkRateLimit(`student_reg:${ip}`, 15, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait a minute." },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json()) as {
      joinCode?: string;
      name?: string;
      studentNo?: string;
      pin?: string;
    };

    const joinCode = (body.joinCode || "SELF").trim();
    const name = (body.name || "").trim();
    const studentNo = (body.studentNo || "").trim();
    const pin = (body.pin || "").trim();

    if (!name || !studentNo || pin.length < 4) {
      return NextResponse.json(
        { error: "Full name, student number, and a 4+ character PIN/password are required." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServiceClient();
    if (supabase && joinCode.toUpperCase() !== "SELF") {
      const { data, error } = await supabase.rpc("student_register_with_code", {
        p_join_code: joinCode,
        p_name: name,
        p_student_no: studentNo,
        p_pin: pin,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({
        mode: "supabase",
        session_token: data.session_token,
        qr_payload: data.qr_payload,
        student: data.student,
      });
    }

    // Offline / Standalone local classroom registration mode
    const studentId = crypto.randomUUID();
    const qrPayload = await buildOfflineStudentIdQr(studentId, studentNo, name, joinCode);
    const pinHash = await sha256Hex(`${studentNo.toLowerCase()}:${pin}`);

    return NextResponse.json({
      mode: "offline",
      session_token: `offline_${studentId}`,
      qr_payload: qrPayload,
      pin_hash: pinHash,
      student: {
        id: studentId,
        name,
        student_no: studentNo,
        class_code: joinCode.toUpperCase(),
        class_name: joinCode.toUpperCase() === "SELF" ? "Grade 10 Independent" : `Class ${joinCode.toUpperCase()}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Registration failed." },
      { status: 400 }
    );
  }
}
