import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cole a sua URL do Supabase e a sua Chave Anon entre as aspas abaixo:
const supabaseUrl = 'https://SEU-PROJETO-AQUI.supabase.co';
const supabaseAnonKey = 'SUA-CHAVE-ANON-AQUI';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http')
);

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
