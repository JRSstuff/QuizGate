import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getSupabasePublicUrl,
  getSupabasePublishableKey,
} from "./env";

/** Creates a Next.js Server Component / Route Handler Supabase client bound to request cookies. */
export const createClient = (
  cookieStore: Awaited<ReturnType<typeof cookies>>
) => {
  const supabaseUrl = getSupabasePublicUrl();
  const supabaseKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component; middleware handles cookie refresh writes.
        }
      },
    },
  });
};
