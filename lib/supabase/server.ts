import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabasePublicConfigured } from "./config";

export function isSupabaseServiceConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Server-only service role client for student RPC execution (`student_*` functions).
 * Never import this module into `"use client"` components.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (!isSupabaseServiceConfigured()) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * User-scoped Supabase client using the authenticated teacher's Bearer access token.
 */
export function getSupabaseTeacherClient(accessToken?: string): SupabaseClient | null {
  if (!isSupabasePublicConfigured()) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
