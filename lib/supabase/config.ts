import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { isSupabasePublicEnvConfigured } from "@/utils/supabase/env";

export function isSupabasePublicConfigured(): boolean {
  return isSupabasePublicEnvConfigured();
}

let cachedBrowserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (!isSupabasePublicConfigured()) return null;

  if (!cachedBrowserClient) {
    cachedBrowserClient = createClient();
  }
  return cachedBrowserClient;
}
