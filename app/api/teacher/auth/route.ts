import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/ratelimit";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = checkRateLimit(`teacher_auth:${ip}`, 40, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many teacher login attempts. Wait a minute before retrying." },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json()) as {
      action?: "login" | "register";
      username?: string;
      displayName?: string;
      password?: string;
    };

    const action = body.action === "register" ? "register" : "login";
    const username = (body.username || "").trim().toLowerCase();
    const displayName = (body.displayName || "").trim();
    const password = (body.password || "").trim();

    if (!username || username.length < 2 || /\s/.test(username)) {
      return NextResponse.json(
        { error: "Username must be at least 2 characters with no spaces." },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServiceClient();
    if (!supabase) {
      return NextResponse.json(
        {
          mode: "offline",
          error:
            "Server database secret key (SUPABASE_SERVICE_ROLE_KEY) is not set; using local device classroom mode.",
        },
        { status: 503 }
      );
    }

    const rpcName =
      action === "register" ? "teacher_register_username" : "teacher_login_username";
    const rpcArgs =
      action === "register"
        ? { p_username: username, p_display_name: displayName || username, p_password: password }
        : { p_username: username, p_password: password };

    const { data, error } = await supabase.rpc(rpcName, rpcArgs);
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: action === "register" ? 400 : 401 }
      );
    }

    return NextResponse.json({
      mode: "supabase",
      session_token: data.session_token,
      teacher: data.teacher,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Authentication failed." },
      { status: 400 }
    );
  }
}
