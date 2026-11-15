import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://qonemlkgaoxolajrcnha.supabase.co';
const FALLBACK_SUPABASE_KEY = 'sb_publishable_mx8M_cWJw-UAyMgg1ddt6Q_qJucyBsY';

function normalizeSupabaseUrl(raw?: string): string {
  const value = (raw || '').trim();
  if (!value) return FALLBACK_SUPABASE_URL;
  return value.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

const envUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseUrl = normalizeSupabaseUrl(envUrl || FALLBACK_SUPABASE_URL);
export const supabaseAnonKey = (envKey || FALLBACK_SUPABASE_KEY).trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http')
);

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
