import { NextRequest, NextResponse } from "next/server";
import type { EncryptedLinkResultPacket, LinkResultPlainPayload } from "@/lib/crypto/linkVault";
import { recordServerSubmission } from "@/lib/server/runMemoryStore";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  try {
    const body = (await req.json()) as {
      packet?: EncryptedLinkResultPacket;
      plain?: LinkResultPlainPayload;
    };

    if (!body.packet || !body.plain || body.packet.kind !== "QGATE_LINK_RESULT") {
      return NextResponse.json(
        { error: "Encrypted v3 submission packet is required." },
        { status: 400 }
      );
    }
    if (body.packet.runId !== runId || body.plain.runId !== runId) {
      return NextResponse.json(
        { error: "Submission runId mismatch." },
        { status: 400 }
      );
    }

    const memRes = recordServerSubmission(runId, body.packet, body.plain);

    const supabase = getSupabaseServiceClient();
    if (supabase) {
      try {
        await supabase.from("link_submissions").upsert(
          {
            run_id: runId,
            attempt_id: body.plain.attemptId,
            packet: body.packet,
            plain: body.plain,
          },
          { onConflict: "attempt_id" }
        );
      } catch {
        // Optional Supabase table
      }
    }

    return NextResponse.json({
      ok: true,
      accepted: memRes.accepted,
      duplicate: memRes.duplicate,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Submission failed." },
      { status: 400 }
    );
  }
}
