import { NextRequest, NextResponse } from "next/server";
import { parseStudentIdQr } from "@/lib/crypto/quizVault";
import { checkRateLimit } from "@/lib/security/ratelimit";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = checkRateLimit(`student_login:${ip}`, 20, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait a minute before retrying." },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json()) as {
      qrPayload?: string;
      joinCode?: string;
      studentNo?: string;
      pin?: string;
    };

    const supabase = getSupabaseServiceClient();

    // Path 1: QR Card Sign-In
    if (body.qrPayload) {
      const cleanQr = body.qrPayload.trim();
      const parsed = await parseStudentIdQr(cleanQr);

      if (!parsed.valid) {
        return NextResponse.json(
          { error: parsed.reason || "Invalid student QR pass." },
          { status: 400 }
        );
      }

      if (parsed.kind === "supabase_qr") {
        if (!supabase) {
          return NextResponse.json(
            {
              error:
                "Supabase is not configured on this server. Use Offline ID login or register a local pass.",
            },
            { status: 503 }
          );
        }
        const { data, error } = await supabase.rpc("student_sign_in", {
          qr_payload: cleanQr,
        });
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 401 });
        }
        return NextResponse.json({
          mode: "supabase",
          session_token: data.session_token,
          student: data.student,
          qr_payload: cleanQr,
        });
      }

      // Offline ID QR Card verified cleanly
      return NextResponse.json({
        mode: "offline",
        session_token: `offline_${parsed.studentId}`,
        qr_payload: cleanQr,
        student: {
          id: parsed.studentId,
          name: parsed.studentName || "Student",
          student_no: parsed.studentNo || "UNREG",
          class_code: parsed.classCode || "SELF",
        },
      });
    }

    // Path 2: Credential Sign-In via Class Code + Student No + PIN
    if (body.joinCode && body.studentNo && body.pin) {
      if (!supabase) {
        return NextResponse.json(
          { error: "Cloud class lookup unavailable offline; checking local IndexedDB account." },
          { status: 503 }
        );
      }
      const { data, error } = await supabase.rpc("student_sign_in_with_pin", {
        p_join_code: body.joinCode.trim(),
        p_student_no: body.studentNo.trim(),
        p_pin: body.pin.trim(),
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      return NextResponse.json({
        mode: "supabase",
        session_token: data.session_token,
        student: data.student,
      });
    }

    return NextResponse.json(
      { error: "Provide a QR code or class join code with student number and PIN." },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sign-in failed." },
      { status: 400 }
    );
  }
}
