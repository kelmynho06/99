import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lê do ambiente do Vite ou utiliza os valores diretos para garantir funcionamento no APK nativo
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://sua-url-do-supabase.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'sua-chave-anon-public-aqui';

// Força a validação como verdadeira se a URL estiver presente
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
