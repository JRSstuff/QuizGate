import { NextResponse } from "next/server";
import { isSupabasePublicConfigured } from "@/lib/supabase/config";
import { isSupabaseServiceConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      app: "QuizGate",
      supabasePublicConfigured: isSupabasePublicConfigured(),
      supabaseServiceConfigured: isSupabaseServiceConfigured(),
      supabaseConfigured:
        isSupabasePublicConfigured() && isSupabaseServiceConfigured(),
      server_time: Date.now(),
      iso: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
