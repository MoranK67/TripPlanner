import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

/**
 * The single Supabase client. Internal to src/data — never export it from the
 * data layer's public index (PROJECT_PLAN §4.3).
 */
export function getSupabase(): SupabaseClient {
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).',
    );
  }
  client ??= createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

/** Lightweight reachability check against the Supabase Auth health endpoint. */
export async function checkServerConnection(): Promise<boolean> {
  if (!url || !publishableKey) return false;
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: publishableKey } });
    return res.ok;
  } catch {
    return false;
  }
}
