import { NextRequest, NextResponse } from "next/server";
import {
  decryptResultPacket,
  verifyOfflineOrFormatQr,
  type EncryptedResultPacket,
} from "@/lib/crypto/quizVault";
import { checkRateLimit } from "@/lib/security/ratelimit";
import {
  getSupabaseServiceClient,
  getSupabaseTeacherClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = checkRateLimit(`verify_result:${ip}`, 200, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { valid: false, reason: "Rate limit exceeded. Wait a minute." },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json()) as {
      code?: string;
      qr_content?: string;
      resultPacket?: EncryptedResultPacket;
    };

    // Case 1: Encrypted .qres.json offline submission file
    if (body.resultPacket) {
      const plain = await decryptResultPacket(body.resultPacket);
      return NextResponse.json({
        valid: true,
        source: "result_file",
        verifiedVia: "serverless",
        submission: plain,
      });
    }

    const code = (body.code || body.qr_content || "").trim();
    if (!code) {
      return NextResponse.json(
        { valid: false, reason: "QR code or encrypted submission file is required." },
        { status: 400 }
      );
    }

    // Case 2: Supabase QG1R.* QR code verified via string teacher session token OR legacy teacher JWT
    if (code.startsWith("QG1R.")) {
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!token || token.startsWith("offline_")) {
        return NextResponse.json(
          {
            valid: false,
            format: "supabase_qr",
            reason:
              "Sign in as a connected Supabase teacher while online to verify database-signed QG1R codes.",
          },
          { status: 401 }
        );
      }

      const isLegacyJwt = token.includes(".");
      if (!isLegacyJwt) {
        const service = getSupabaseServiceClient();
        if (!service) {
          return NextResponse.json(
            {
              valid: false,
              format: "supabase_qr",
              reason: "Server Supabase service key missing for QG1R verification.",
            },
            { status: 503 }
          );
        }
        const { data, error } = await service.rpc("teacher_verify_result", {
          p_token: token,
          p_code: code,
        });
        if (error) {
          return NextResponse.json(
            { valid: false, format: "supabase_qr", reason: error.message },
            { status: 400 }
          );
        }
        return NextResponse.json({
          valid: Boolean(data.is_valid),
          format: "supabase_qr",
          verifiedVia: "supabase",
          studentName: data.student_name,
          studentNo: data.student_no,
          score: data.score_in_code,
          maxScore: data.max_score,
          scoreInDb: data.score_in_db,
          matchesDb: data.matches,
          signatureValid: data.signature_valid,
        });
      }

      const supabase = getSupabaseTeacherClient(token);
      if (!supabase) {
        return NextResponse.json(
          {
            valid: false,
            format: "supabase_qr",
            reason:
              "Sign in as a connected Supabase teacher while online to verify database-signed QG1R codes.",
          },
          { status: 401 }
        );
      }

      const { data, error } = await supabase.rpc("verify_result", { code });
      if (error) {
        return NextResponse.json(
          { valid: false, format: "supabase_qr", reason: error.message },
          { status: 400 }
        );
      }

      return NextResponse.json({
        valid: Boolean(data.is_valid),
        format: "supabase_qr",
        verifiedVia: "supabase",
        studentName: data.student_name,
        score: data.score_in_code,
        scoreInDb: data.score_in_db,
        matchesDb: data.matches,
        signatureValid: data.signature_valid,
      });
    }

    // Case 3: Offline-signed Result QR code (QG1O.*)
    const verified = await verifyOfflineOrFormatQr(code);
    return NextResponse.json({
      ...verified,
      verifiedVia: "serverless",
    });
  } catch (err) {
    return NextResponse.json(
      {
        valid: false,
        reason: err instanceof Error ? err.message : "Verification failed.",
      },
      { status: 400 }
    );
  }
}
