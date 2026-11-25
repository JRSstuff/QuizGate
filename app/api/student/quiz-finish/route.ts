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
      submitted: true,
    });
  }

  try {
    const body = (await req.json()) as { runId?: string };
    if (!body.runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("student_finish", {
      token,
      run_id: body.runId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ mode: "supabase", ...data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Finish request failed." },
      { status: 400 }
    );
  }
}
