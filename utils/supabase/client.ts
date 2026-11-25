import { createBrowserClient } from "@supabase/ssr";
import {
  getSupabasePublicUrl,
  getSupabasePublishableKey,
} from "./env";

/** Creates a browser Supabase client using SSR cookie storage. */
export const createClient = () => {
  const supabaseUrl = getSupabasePublicUrl();
  const supabaseKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  return createBrowserClient(supabaseUrl, supabaseKey);
};
