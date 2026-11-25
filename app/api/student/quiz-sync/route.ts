import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase || token.startsWith("offline_")) {
    return NextResponse.json({
      mode: "offline",
      synced: false,
      reason: "Cloud sync not active; answers remain saved safely in IndexedDB.",
    });
  }

  try {
    const body = (await req.json()) as { runId?: string; answers?: unknown[] };
    if (!body.runId || !Array.isArray(body.answers)) {
      return NextResponse.json(
        { error: "runId and answers array are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("student_submit_answers", {
      token,
      run_id: body.runId,
      answers: body.answers,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ mode: "supabase", ...data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed." },
      { status: 400 }
    );
  }
}
