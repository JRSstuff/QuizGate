import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase || token.startsWith("offline_")) {
    return NextResponse.json({
      mode: "offline",
      server_now: new Date().toISOString(),
      run: null,
    });
  }

  const { data, error } = await supabase.rpc("student_get_state", { token });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ mode: "supabase", ...data });
}
