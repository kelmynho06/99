-- ============================================================================
-- Velo99 Mobilidade — ATUALIZAÇÃO INCREMENTAL DO SUPABASE
-- Execute SOMENTE este script no SQL Editor do Supabase (não recria nada do zero)
-- ============================================================================

-- 1. Nova tabela de Configurações Globais (Pix Centralizado do Dono + Cidade)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_pix_key TEXT NOT NULL DEFAULT 'pix@velo99.app',
  platform_pix_receiver TEXT NOT NULL DEFAULT 'Velo99 Mobilidade Ltda',
  platform_city TEXT NOT NULL DEFAULT 'São Paulo, SP',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.platform_settings (id, platform_pix_key, platform_pix_receiver, platform_city)
VALUES (1, 'pix@velo99.app', 'Velo99 Mobilidade Ltda', 'São Paulo, SP')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Todos leem chave Pix da plataforma" ON public.platform_settings;
DROP POLICY IF EXISTS "Somente Admin altera config da plataforma" ON public.platform_settings;
CREATE POLICY "Todos leem chave Pix da plataforma"
  ON public.platform_settings FOR SELECT USING (TRUE);
CREATE POLICY "Somente Admin altera config da plataforma"
  ON public.platform_settings FOR ALL USING (public.is_admin());

-- 2. Colunas novas em public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS favorites JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Colunas novas em public.driver_profiles
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS completion_rate NUMERIC(5,2) NOT NULL DEFAULT 100.00;

-- 4. Colunas novas em public.rides
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS negotiated_fare NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS pix_declared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS passenger_rating_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS driver_rating_submitted BOOLEAN NOT NULL DEFAULT FALSE;

-- Garantir constraint de payment_status em rides
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rides'::regclass AND conname = 'rides_payment_status_check'
  ) THEN
    ALTER TABLE public.rides
      ADD CONSTRAINT rides_payment_status_check
      CHECK (payment_status IN ('pending', 'paid_pix', 'paid_cash', 'disputed', 'admin_settled'));
  END IF;
END $$;

-- 5. Atualizar constraints de category em pricing_settings e rides para as 5 modalidades
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.pricing_settings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.pricing_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;

  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.rides'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.rides DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.pricing_settings
  ADD CONSTRAINT pricing_settings_category_check
  CHECK (category IN ('moto', 'pop', 'negocia', 'delivery_moto', 'delivery_car'));

ALTER TABLE public.rides
  ADD CONSTRAINT rides_category_check
  CHECK (category IN ('moto', 'pop', 'negocia', 'delivery_moto', 'delivery_car', 'delivery'));

-- Remover categoria antiga genérica 'delivery' e inserir/atualizar as 5 modalidades
DELETE FROM public.pricing_settings WHERE category = 'delivery';

INSERT INTO public.pricing_settings (category, label, description, base_fare, per_km_rate, min_fare, active)
VALUES
  ('moto', 'Moto', 'Deslocamento rápido no trânsito', 3.00, 1.35, 6.00, TRUE),
  ('pop', 'Pop', 'Conforto com ar-condicionado', 4.50, 2.15, 8.50, TRUE),
  ('negocia', 'Negocia', 'Sugira o valor da sua viagem', 4.00, 1.90, 7.50, TRUE),
  ('delivery_moto', 'Entrega Moto', 'Envio ágil de pacotes com PIN', 3.50, 1.55, 7.00, TRUE),
  ('delivery_car', 'Entrega Carro', 'Volumes maiores com código PIN', 5.00, 2.25, 9.50, TRUE)
ON CONFLICT (category) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

-- 6. Permitir inserção em wallet_transactions (Motorista no fechamento e Admin nos repasses)
DROP POLICY IF EXISTS "Inserir transações na carteira" ON public.wallet_transactions;
CREATE POLICY "Inserir transações na carteira"
  ON public.wallet_transactions FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- 7. Regra automática de Super Admin (driver@admin.com) + criação de perfil via Trigger
CREATE OR REPLACE FUNCTION public.enforce_super_admin_email()
RETURNS TRIGGER AS $$
BEGIN
  IF LOWER(TRIM(NEW.email)) = 'driver@admin.com' THEN
    NEW.role := 'admin';
    NEW.status := 'active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_email ON public.profiles;
CREATE TRIGGER trg_enforce_super_admin_email
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_super_admin_email();

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_status TEXT;
BEGIN
  IF LOWER(TRIM(COALESCE(NEW.email, ''))) = 'driver@admin.com' THEN
    v_role := 'admin';
    v_status := 'active';
  ELSE
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'passenger');
    IF v_role NOT IN ('passenger', 'driver', 'admin') THEN
      v_role := 'passenger';
    END IF;
    v_status := CASE WHEN v_role = 'driver' THEN 'pending' ELSE 'active' END;
  END IF;

  INSERT INTO public.profiles (
    id, role, status, full_name, phone, email, cpf, preferred_payment
  )
  VALUES (
    NEW.id,
    v_role,
    v_status,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(NEW.email, 'Usuário'), '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), ''),
    COALESCE(NEW.email, ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'cpf', ''), ''),
    'pix'
  )
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    email = EXCLUDED.email;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- 8. Funções RPC seguras para avaliações, motoristas online no mapa e repasses Admin
CREATE OR REPLACE FUNCTION public.get_online_drivers_public()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  rating_avg NUMERIC,
  vehicle_type TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  heading DOUBLE PRECISION
) AS $$
  SELECT
    p.id,
    p.full_name,
    p.rating_avg,
    dp.vehicle_type,
    dp.vehicle_model,
    dp.vehicle_color,
    dp.current_lat,
    dp.current_lng,
    COALESCE(dp.heading, 0)
  FROM public.profiles p
  JOIN public.driver_profiles dp ON dp.user_id = p.id
  WHERE p.role = 'driver'
    AND p.status = 'active'
    AND p.is_anonymized = FALSE
    AND dp.is_online = TRUE
    AND dp.current_lat IS NOT NULL
    AND dp.current_lng IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.submit_ride_rating(
  p_ride_id UUID,
  p_to_user_id UUID,
  p_stars INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_score INTEGER;
  v_new_count INTEGER;
  v_new_avg NUMERIC(3,2);
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_ride.passenger_id AND auth.uid() IS DISTINCT FROM v_ride.driver_id THEN
    RAISE EXCEPTION 'Sem permissão para avaliar esta corrida.';
  END IF;

  v_score := LEAST(5, GREATEST(1, COALESCE(p_stars, 5)));

  INSERT INTO public.ride_ratings (ride_id, from_user_id, to_user_id, stars, comment)
  VALUES (p_ride_id, auth.uid(), p_to_user_id, v_score, p_comment)
  ON CONFLICT (ride_id, from_user_id) DO NOTHING;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_to_user_id;
  IF FOUND THEN
    v_new_count := COALESCE(v_target.rating_count, 0) + 1;
    v_new_avg := ROUND(((COALESCE(v_target.rating_avg, 5.00) * COALESCE(v_target.rating_count, 0)) + v_score)::NUMERIC / v_new_count, 2);
    UPDATE public.profiles
    SET rating_count = v_new_count, rating_avg = v_new_avg, updated_at = NOW()
    WHERE id = p_to_user_id;
  END IF;

  IF auth.uid() = v_ride.passenger_id THEN
    UPDATE public.rides SET passenger_rating_submitted = TRUE WHERE id = p_ride_id;
  ELSIF auth.uid() = v_ride.driver_id THEN
    UPDATE public.rides SET driver_rating_submitted = TRUE WHERE id = p_ride_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_register_payout(
  p_driver_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_driver public.profiles%ROWTYPE;
  v_pay NUMERIC(10,2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin.';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Motorista não encontrado.';
  END IF;

  v_pay := ROUND(LEAST(COALESCE(p_amount, v_driver.wallet_balance), GREATEST(0, v_driver.wallet_balance)), 2);
  IF v_pay <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET wallet_balance = ROUND(GREATEST(0, wallet_balance - v_pay), 2),
      updated_at = NOW()
  WHERE id = p_driver_id;

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (
    p_driver_id,
    -v_pay,
    'payout',
    COALESCE(NULLIF(p_description, ''), 'Repasse Pix realizado pelo Super Admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Garantir novas tabelas no Supabase Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'platform_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pricing_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pricing_settings;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wallet_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
  END IF;
END $$;

-- 10. Personalização completa de perfil (foto + bio)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- 11. Configurações extras do site no Painel Admin
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT 'Velo99',
  ADD COLUMN IF NOT EXISTS support_whatsapp TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE;

-- 12. Eventos & Campanhas de Bônus para Motoboys / Motoristas (criados pelo Admin)
CREATE TABLE IF NOT EXISTS public.platform_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  bonus_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  target_role TEXT NOT NULL DEFAULT 'all' CHECK (target_role IN ('all', 'driver', 'delivery')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Todos leem eventos da plataforma" ON public.platform_events;
DROP POLICY IF EXISTS "Somente Admin gerencia eventos" ON public.platform_events;
CREATE POLICY "Todos leem eventos da plataforma"
  ON public.platform_events FOR SELECT USING (TRUE);
CREATE POLICY "Somente Admin gerencia eventos"
  ON public.platform_events FOR ALL USING (public.is_admin());

-- 13. Chat Direto Universal (Admin conversa com qualquer Cliente, Motorista ou Motoboy)
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'passenger',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_user_id ON public.direct_messages(user_id, created_at);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario e Admin leem chat direto" ON public.direct_messages;
DROP POLICY IF EXISTS "Usuario e Admin enviam chat direto" ON public.direct_messages;
CREATE POLICY "Usuario e Admin leem chat direto"
  ON public.direct_messages FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Usuario e Admin enviam chat direto"
  ON public.direct_messages FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- 14. RPC segura para Admin excluir/bloquear usuário mantendo integridade de corridas
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin.';
  END IF;

  UPDATE public.driver_profiles
  SET is_online = FALSE, updated_at = NOW()
  WHERE user_id = p_user_id;

  UPDATE public.profiles
  SET
    is_anonymized = TRUE,
    status = 'suspended',
    full_name = 'Conta Removida',
    phone = '',
    cpf = '',
    avatar_url = NULL,
    bio = NULL,
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'platform_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_events;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END $$;

