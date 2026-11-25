import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabasePublicUrl,
  getSupabasePublishableKey,
} from "@/utils/supabase/env";
import { isSupabasePublicConfigured } from "./config";

function getSupabaseServiceKey(): string | undefined {
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  )?.trim();
  return key || undefined;
}

export function isSupabaseServiceConfigured(): boolean {
  return Boolean(getSupabasePublicUrl() && getSupabaseServiceKey());
}

/**
 * Server-only service role client for student RPC execution (`student_*` functions).
 * Never import this module into `"use client"` components.
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
