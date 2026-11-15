import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cole a sua URL do Supabase e a sua Chave Anon entre as aspas abaixo:
const supabaseUrl = 'https://qonemlkgaoxolajrcnha.supabase.co/rest/v1/';
const supabaseAnonKey = 'sb_publishable_mx8M_cWJw-UAyMgg1ddt6Q_qJucyBsY';

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
