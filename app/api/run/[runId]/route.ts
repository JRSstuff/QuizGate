import { NextRequest, NextResponse } from "next/server";
import {
  endServerRun,
  startServerRun,
  upsertServerRun,
} from "@/lib/server/runMemoryStore";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  try {
    const body = (await req.json()) as {
      action: "create" | "start" | "end";
      versionHash?: string;
      classId?: string;
      className?: string;
      quizId?: string;
      title?: string;
      durationMinutes?: number;
      createdAtSec?: number;
      startedAtSec?: number;
      startCode?: string;
      startQr?: string;
    };

    const supabase = getSupabaseServiceClient();

    if (body.action === "create") {
      const state = upsertServerRun({
        runId,
        versionHash: body.versionHash || "",
        classId: body.classId || "default",
        className: body.className || "Class",
        quizId: body.quizId || runId,
        title: body.title || "Classroom Quiz",
        durationMinutes: body.durationMinutes || 15,
        createdAtSec: body.createdAtSec || Math.floor(Date.now() / 1000),
      });
      if (supabase) {
        try {
          await supabase.from("link_runs").upsert(
            {
              run_id: runId,
              version_hash: state.versionHash,
              class_id: state.classId,
              class_name: state.className,
              quiz_id: state.quizId,
              title: state.title,
              duration_minutes: state.durationMinutes,
              status: state.status,
              created_at_sec: state.createdAtSec,
            },
            { onConflict: "run_id" }
          );
        } catch {
          // Table may not exist if schema migration not run yet; memory store remains active
        }
      }
      return NextResponse.json({ ok: true, mode: supabase ? "supabase" : "offline", run: state });
    }

    if (body.action === "start") {
      const state = startServerRun(runId, body);
      if (!state) {
        return NextResponse.json({ error: "Run metadata missing." }, { status: 400 });
      }
      if (supabase) {
        try {
          await supabase
            .from("link_runs")
            .update({
              status: "running",
              started_at_server: state.startedAtServer,
              ends_at_server: state.endsAtServer,
              start_code: state.startCode,
              start_qr: state.startQr,
            })
            .eq("run_id", runId);
        } catch {
          // Optional enhancement table
        }
      }
      return NextResponse.json({
        ok: true,
        status: state.status,
        startedAtServer: state.startedAtServer,
        endsAtServer: state.endsAtServer,
        startCode: state.startCode,
      });
    }

    if (body.action === "end") {
      const state = endServerRun(runId);
      if (supabase) {
        try {
          await supabase
            .from("link_runs")
            .update({ status: "ended", ended_at_server: Date.now() })
            .eq("run_id", runId);
        } catch {
          // Optional enhancement table
        }
      }
      return NextResponse.json({ ok: true, status: state?.status || "ended" });
    }

    return NextResponse.json({ error: "Unsupported run action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run action failed." },
      { status: 400 }
    );
  }
}
