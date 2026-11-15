-- ============================================================================
-- Velo99 Mobilidade Urbana — Schema Completo e Idempotente (Supabase + RLS Estrito)
-- ============================================================================

-- 1. Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tabela de Perfis de Usuários (Cliente, Motorista/Entregador e Super Admin)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('passenger', 'driver', 'admin')) DEFAULT 'passenger',
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected', 'suspended')) DEFAULT 'active',
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  cpf TEXT NOT NULL,
  avatar_url TEXT,
  home_address TEXT,
  home_lat DOUBLE PRECISION,
  home_lng DOUBLE PRECISION,
  work_address TEXT,
  work_lat DOUBLE PRECISION,
  work_lng DOUBLE PRECISION,
  preferred_payment TEXT NOT NULL CHECK (preferred_payment IN ('pix', 'cash', 'card_machine')) DEFAULT 'pix',
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  rating_count INTEGER NOT NULL DEFAULT 0,
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  is_anonymized BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de Veículos, Documentos & Telemetria do Motorista/Entregador
CREATE TABLE IF NOT EXISTS public.driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  cnh_url TEXT NOT NULL,
  crlv_url TEXT NOT NULL,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('car', 'moto', 'delivery')) DEFAULT 'car',
  vehicle_model TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  vehicle_color TEXT NOT NULL,
  pix_key TEXT NOT NULL,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  heading DOUBLE PRECISION DEFAULT 0,
  acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  completion_rate NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabela de Tarifas por Categoria (Configurável pelo Super Admin)
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  category TEXT PRIMARY KEY CHECK (category IN ('pop', 'moto', 'delivery')),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  base_fare NUMERIC(8,2) NOT NULL DEFAULT 4.50,
  per_km_rate NUMERIC(8,2) NOT NULL DEFAULT 2.10,
  min_fare NUMERIC(8,2) NOT NULL DEFAULT 7.50,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.pricing_settings (category, label, description, base_fare, per_km_rate, min_fare)
VALUES
  ('pop', 'Viagem Carro', 'Carros econômicos com ar-condicionado', 4.50, 2.20, 8.50),
  ('moto', 'Viagem Moto', 'Deslocamentos rápidos no trânsito', 3.00, 1.45, 6.00),
  ('delivery', 'Entrega / Coleta', 'Envio expresso de pacotes com validação PIN', 3.50, 1.65, 7.00)
ON CONFLICT (category) DO NOTHING;

-- 5. Tabela de Corridas e Entregas
CREATE TABLE IF NOT EXISTS public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('pop', 'moto', 'delivery')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'card_machine')),
  status TEXT NOT NULL CHECK (status IN ('searching', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled')) DEFAULT 'searching',
  origin_address TEXT NOT NULL,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lng DOUBLE PRECISION NOT NULL,
  destination_address TEXT NOT NULL,
  destination_lat DOUBLE PRECISION NOT NULL,
  destination_lng DOUBLE PRECISION NOT NULL,
  distance_km NUMERIC(8,2) NOT NULL,
  estimated_fare NUMERIC(10,2) NOT NULL,
  final_fare NUMERIC(10,2),
  pin_code CHAR(4) NOT NULL,
  delivery_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 6. Chat em Tempo Real da Corrida
CREATE TABLE IF NOT EXISTS public.ride_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Avaliações Mútuas (1 a 5 estrelas)
CREATE TABLE IF NOT EXISTS public.ride_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, from_user_id)
);

-- 8. Carteira e Transações Financeiras
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ride_earning', 'ride_payment', 'payout')),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Storage Bucket Privado para Documentos (CNH e CRLV)
INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-documents', 'driver-documents', FALSE)
ON CONFLICT (id) DO NOTHING;

-- 10. Habilitar Row Level Security (RLS Estrito)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Funções auxiliares de segurança (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_anonymized = FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_online_approved_driver()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.driver_profiles dp ON dp.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.role = 'driver'
      AND p.status = 'active'
      AND p.is_anonymized = FALSE
      AND dp.is_online = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Função LGPD de anonimização / exclusão de conta pelo próprio usuário
CREATE OR REPLACE FUNCTION public.anonymize_own_account()
RETURNS VOID AS $$
BEGIN
  UPDATE public.driver_profiles
  SET
    is_online = FALSE,
    cnh_url = 'REDACTED',
    crlv_url = 'REDACTED',
    vehicle_plate = 'REDACTED',
    pix_key = 'REDACTED',
    current_lat = NULL,
    current_lng = NULL,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  UPDATE public.profiles
  SET
    full_name = 'Usuário Anonimizado',
    phone = '00000000000',
    email = CONCAT('deleted_', id, '@anon.local'),
    cpf = '000.000.000-00',
    avatar_url = NULL,
    home_address = NULL,
    work_address = NULL,
    status = 'suspended',
    is_anonymized = TRUE,
    deleted_at = NOW(),
    updated_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Limpeza idempotente de políticas anteriores
DROP POLICY IF EXISTS "Usuário vê próprio perfil ou participantes da corrida" ON public.profiles;
DROP POLICY IF EXISTS "Usuário cria próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário cria/atualiza próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil ou Admin atualiza qualquer perfil" ON public.profiles;

-- RLS Estrito: Profiles (Passageiro só vê motorista durante corrida ATIVA)
CREATE POLICY "Usuário vê próprio perfil ou participante em corrida ativa"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status IN ('accepted', 'arrived', 'in_progress')
        AND (
          (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
          OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)
        )
    )
  );

CREATE POLICY "Usuário cria próprio perfil"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Usuário atualiza próprio perfil ou Admin atualiza qualquer perfil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin());

-- RLS Estrito: Driver Profiles (Localização/placa visíveis ao passageiro APENAS em corrida ativa)
DROP POLICY IF EXISTS "Leitura de dados de motorista" ON public.driver_profiles;
DROP POLICY IF EXISTS "Motorista insere seus documentos" ON public.driver_profiles;
DROP POLICY IF EXISTS "Motorista atualiza GPS/online ou Admin aprova/reprova" ON public.driver_profiles;

CREATE POLICY "Leitura restrita de motorista"
  ON public.driver_profiles FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.driver_id = driver_profiles.user_id
        AND r.passenger_id = auth.uid()
        AND r.status IN ('accepted', 'arrived', 'in_progress')
    )
  );

CREATE POLICY "Motorista insere seus documentos"
  ON public.driver_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Motorista atualiza GPS/online ou Admin aprova/reprova"
  ON public.driver_profiles FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin());

-- RLS: Tarifas
DROP POLICY IF EXISTS "Qualquer usuário autenticado lê tarifas" ON public.pricing_settings;
DROP POLICY IF EXISTS "Somente Admin altera tarifas" ON public.pricing_settings;

CREATE POLICY "Qualquer usuário autenticado lê tarifas"
  ON public.pricing_settings FOR SELECT
  USING (TRUE);

CREATE POLICY "Somente Admin altera tarifas"
  ON public.pricing_settings FOR ALL
  USING (public.is_admin());

-- RLS Estrito: Corridas (Motorista só vê ofertas se aprovado e ONLINE, e só vê corridas aceitas por ele)
DROP POLICY IF EXISTS "Passageiro vê suas corridas e motoristas ativos veem corridas abertas" ON public.rides;
DROP POLICY IF EXISTS "Passageiro cria corrida" ON public.rides;
DROP POLICY IF EXISTS "Participantes e Admin atualizam corrida" ON public.rides;

CREATE POLICY "Visibilidade estrita de corridas e entregas"
  ON public.rides FOR SELECT
  USING (
    passenger_id = auth.uid()
    OR driver_id = auth.uid()
    OR public.is_admin()
    OR (status = 'searching' AND public.is_online_approved_driver())
  );

CREATE POLICY "Passageiro cria corrida"
  ON public.rides FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Participantes e Admin atualizam corrida"
  ON public.rides FOR UPDATE
  USING (
    passenger_id = auth.uid()
    OR driver_id = auth.uid()
    OR (status = 'searching' AND public.is_online_approved_driver())
    OR public.is_admin()
  );

-- RLS: Chat da Corrida
DROP POLICY IF EXISTS "Participantes veem e enviam mensagens da corrida" ON public.ride_messages;
DROP POLICY IF EXISTS "Participantes enviam mensagens" ON public.ride_messages;

CREATE POLICY "Participantes veem mensagens da corrida"
  ON public.ride_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
    OR public.is_admin()
  );

CREATE POLICY "Participantes enviam mensagens"
  ON public.ride_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND r.status IN ('accepted', 'arrived', 'in_progress')
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

-- RLS: Avaliações e Carteira
DROP POLICY IF EXISTS "Leitura de avaliações" ON public.ride_ratings;
DROP POLICY IF EXISTS "Inserir avaliação da própria corrida" ON public.ride_ratings;
DROP POLICY IF EXISTS "Leitura da própria carteira" ON public.wallet_transactions;

CREATE POLICY "Leitura de avaliações"
  ON public.ride_ratings FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Inserir avaliação da própria corrida"
  ON public.ride_ratings FOR INSERT
  WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "Leitura da própria carteira"
  ON public.wallet_transactions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- Políticas de Storage (Bucket privado driver-documents)
DROP POLICY IF EXISTS "Motorista envia próprios documentos" ON storage.objects;
DROP POLICY IF EXISTS "Motorista e Admin visualizam documentos" ON storage.objects;

CREATE POLICY "Motorista envia próprios documentos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Motorista e Admin visualizam documentos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'driver-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- 11. Habilitar Supabase Realtime de forma idempotente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ride_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;
