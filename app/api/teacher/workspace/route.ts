import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

export async function GET(req: NextRequest) {
  const token = extractToken(req);
  if (!token || token.startsWith("offline_")) {
    return NextResponse.json({ error: "Missing cloud teacher session." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database service key not configured." },
      { status: 503 }
    );
  }

  const runResultsId = req.nextUrl.searchParams.get("runResults");
  if (runResultsId) {
    const { data, error } = await supabase.rpc("teacher_get_run_results", {
      p_token: token,
      p_run_id: runResultsId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabase.rpc("teacher_get_workspace", {
    p_token: token,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (!token || token.startsWith("offline_")) {
    return NextResponse.json({ error: "Missing cloud teacher session." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database service key not configured." },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as {
      action: string;
      name?: string;
      classId?: string;
      studentNo?: string;
      studentId?: string;
      rows?: { name: string; student_no: string }[];
      quizId?: string;
      runId?: string;
      title?: string;
      description?: string;
      durationMinutes?: number;
      instantFeedback?: boolean;
      allowRetry?: boolean;
      questions?: unknown[];
    };

    switch (body.action) {
      case "create_class": {
        const { data, error } = await supabase.rpc("teacher_create_class", {
          p_token: token,
          p_name: body.name || "",
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json(data);
      }

      case "add_student": {
        const { data, error } = await supabase.rpc("teacher_add_student", {
          p_token: token,
          p_class_id: body.classId,
          p_name: body.name || "",
          p_student_no: body.studentNo || "",
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json(data);
      }

      case "import_students": {
        const { data, error } = await supabase.rpc("teacher_import_students", {
          p_token: token,
          p_class_id: body.classId,
          p_rows: body.rows || [],
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json(data);
      }

      case "regenerate_qr": {
        const { data, error } = await supabase.rpc("teacher_regenerate_student_qr", {
          p_token: token,
          p_student_id: body.studentId,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ qr_payload: data });
      }

      case "create_quiz": {
        const { data, error } = await supabase.rpc("teacher_create_quiz", {
          p_token: token,
          p_class_id: body.classId,
          p_title: body.title || "",
          p_description: body.description || "",
          p_duration_minutes: body.durationMinutes ?? 15,
          p_instant_feedback: body.instantFeedback ?? true,
          p_allow_retry: body.allowRetry ?? false,
          p_questions: body.questions || [],
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json(data);
      }

      case "start_run": {
        const { data, error } = await supabase.rpc("teacher_start_run", {
          p_token: token,
          p_quiz_id: body.quizId,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json(data);
      }

      case "end_run": {
        const { data, error } = await supabase.rpc("teacher_end_run", {
          p_token: token,
          p_run_id: body.runId,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ended: Boolean(data) });
      }

      default:
        return NextResponse.json({ error: "Unsupported workspace action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Workspace action failed." },
      { status: 400 }
    );
  }
}
