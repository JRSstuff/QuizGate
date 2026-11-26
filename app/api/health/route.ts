import { NextResponse } from "next/server";
import { isSupabasePublicConfigured } from "@/lib/supabase/config";
import { isSupabaseServiceConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cloud = isSupabaseServiceConfigured();
  return NextResponse.json(
    {
      status: "ok",
      app: "QuizGate",
      mode: cloud ? "supabase" : "offline",
      cloud,
      supabasePublicConfigured: isSupabasePublicConfigured(),
      supabaseServiceConfigured: cloud,
      supabaseConfigured: isSupabasePublicConfigured() && cloud,
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
