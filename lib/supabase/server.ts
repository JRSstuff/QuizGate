import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabasePublicUrl,
  getSupabasePublishableKey,
} from "@/utils/supabase/env";
import { isSupabasePublicConfigured } from "./config";

let warnedMissingServiceKey = false;

function getSupabaseServiceKey(): string | undefined {
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  )?.trim();
  if (!key && !warnedMissingServiceKey) {
    warnedMissingServiceKey = true;
    console.warn(
      "[QuizGate] SUPABASE_SERVICE_ROLE_KEY is not set; running in Classroom Offline Mode (server cloud sync disabled)."
    );
  }
  return key || undefined;
}

export function isSupabaseServiceConfigured(): boolean {
  return Boolean(getSupabasePublicUrl() && getSupabaseServiceKey());
}

/**
 * Server-only service role client for optional cloud RPC execution.
 * Returns null cleanly when running in Offline / Serverless-only mode.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  const supabaseUrl = getSupabasePublicUrl();
  const serviceKey = getSupabaseServiceKey();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * User-scoped Supabase client using the authenticated teacher's Bearer access token.
 */
export function getSupabaseTeacherClient(accessToken?: string): SupabaseClient | null {
  const supabaseUrl = getSupabasePublicUrl();
  const publishableKey = getSupabasePublishableKey();
  if (!isSupabasePublicConfigured() || !supabaseUrl || !publishableKey) return null;
  return createClient(supabaseUrl, publishableKey, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
