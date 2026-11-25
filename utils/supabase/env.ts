/**
 * Public Supabase configuration accessors shared by client, server, and middleware helpers.
 * Uses static property reads so Next.js safely inlines `NEXT_PUBLIC_*` values in client bundles.
 */
export function getSupabasePublicUrl(): string | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return url || undefined;
}

export function getSupabasePublishableKey(): string | undefined {
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  return key || undefined;
}

export function isSupabasePublicEnvConfigured(): boolean {
  return Boolean(getSupabasePublicUrl() && getSupabasePublishableKey());
}
