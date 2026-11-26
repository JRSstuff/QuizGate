import { NextRequest, NextResponse } from "next/server";
import {
  getServerRun,
  registerJoinedStudent,
} from "@/lib/server/runMemoryStore";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  const serverNow = Date.now();

  const supabase = getSupabaseServiceClient();
  if (supabase) {
    try {
      const { data: dbRun } = await supabase
        .from("link_runs")
        .select("*")
        .eq("run_id", runId)
        .maybeSingle();

      if (dbRun) {
        const [{ data: joins }, { data: subs }] = await Promise.all([
          supabase.from("link_joins").select("*").eq("run_id", runId),
          supabase.from("link_submissions").select("*").eq("run_id", runId),
        ]);
        return NextResponse.json(
          {
            exists: true,
            cloud: true,
            runId,
            status: dbRun.status,
            versionHash: dbRun.version_hash,
            startedAtServer: dbRun.started_at_server ?? undefined,
            endsAtServer: dbRun.ends_at_server ?? undefined,
            endedAtServer: dbRun.ended_at_server ?? undefined,
            startCode: dbRun.start_code ?? undefined,
            startQr: dbRun.start_qr ?? undefined,
            serverNow,
            joined: (joins || []).map((j) => ({
              attemptId: j.attempt_id,
              deviceId: j.device_id,
              studentName: j.student_name,
              section: j.section,
              joinedAt: j.joined_at,
            })),
            submissions: (subs || []).map((s) => ({
              packet: s.packet,
              plain: s.plain,
              receivedAt: s.received_at,
            })),
          },
          { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
        );
      }
    } catch {
      // Optional Supabase tables absent; fall through seamlessly to memory store
    }
  }

  const memRun = getServerRun(runId);
  if (!memRun) {
    return NextResponse.json(
      {
        exists: false,
        cloud: false,
        runId,
        status: "waiting",
        serverNow,
        joined: [],
        submissions: [],
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  return NextResponse.json(
    {
      exists: true,
      cloud: Boolean(supabase),
      runId: memRun.runId,
      status: memRun.status,
      versionHash: memRun.versionHash,
      startedAtServer: memRun.startedAtServer,
      endsAtServer: memRun.endsAtServer,
      endedAtServer: memRun.endedAtServer,
      startCode: memRun.startCode,
      startQr: memRun.startQr,
      serverNow,
      joined: memRun.joined,
      submissions: memRun.submissions,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  try {
    const body = (await req.json()) as {
      attemptId: string;
      deviceId: string;
      studentName: string;
      section: string;
      meta?: {
        versionHash: string;
        classId: string;
        className: string;
        quizId: string;
        title: string;
        durationMinutes: number;
        createdAtSec: number;
      };
    };

    if (!body.attemptId || !body.studentName?.trim()) {
      return NextResponse.json({ error: "attemptId and studentName are required." }, { status: 400 });
    }

    const state = registerJoinedStudent(
      runId,
      {
        attemptId: body.attemptId,
        deviceId: body.deviceId || "",
        studentName: body.studentName.trim(),
        section: (body.section || "").trim(),
      },
      body.meta
    );

    const supabase = getSupabaseServiceClient();
    if (supabase) {
      try {
        await supabase.from("link_joins").upsert(
          {
            run_id: runId,
            attempt_id: body.attemptId,
            device_id: body.deviceId || "",
            student_name: body.studentName.trim(),
            section: (body.section || "").trim(),
          },
          { onConflict: "attempt_id" }
        );
      } catch {
        // Optional enhancement table
      }
    }

    return NextResponse.json({
      ok: true,
      serverNow: Date.now(),
      status: state?.status || "waiting",
      startedAtServer: state?.startedAtServer,
      endsAtServer: state?.endsAtServer,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to join waiting room." },
      { status: 400 }
    );
  }
}
