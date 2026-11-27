-- ============================================================================
-- Go Driver Mobilidade — SQL INCREMENTAL MÍNIMO (Acumulado Seguro)
-- Execute este script no SQL Editor do Supabase.
-- Seguro e idempotente: NÃO recria tabelas existentes nem apaga dados.
-- ============================================================================

-- 1. Colunas de leitura direta na tabela app_notifications (se ainda não existirem)
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS lida BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- 2. Tabela de leituras por usuário (para avisos em grupo/todos)
CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID NOT NULL REFERENCES public.app_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id, read_at DESC);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para leitura e marcação persistente
DROP POLICY IF EXISTS "notification_reads_own" ON public.notification_reads;
CREATE POLICY "notification_reads_own"
  ON public.notification_reads FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "app_notifications_mark_own_read" ON public.app_notifications;
CREATE POLICY "app_notifications_mark_own_read"
  ON public.app_notifications FOR UPDATE
  TO authenticated
  USING (target_scope = 'user' AND target_user_id = auth.uid())
  WITH CHECK (target_scope = 'user' AND target_user_id = auth.uid());

-- 4. RPC segura para marcar 1 ou várias notificações como lidas de forma atômica
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_notification_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF p_notification_ids IS NULL OR array_length(p_notification_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'marked', 0);
  END IF;

  INSERT INTO public.notification_reads (notification_id, user_id, read_at)
  SELECT n.id, v_uid, v_now
  FROM public.app_notifications n
  WHERE n.id = ANY(p_notification_ids)
  ON CONFLICT (notification_id, user_id)
  DO UPDATE SET read_at = COALESCE(public.notification_reads.read_at, EXCLUDED.read_at);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.app_notifications
  SET lida = TRUE,
      read_at = COALESCE(read_at, v_now)
  WHERE id = ANY(p_notification_ids)
    AND target_scope = 'user'
    AND target_user_id = v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'marked', v_count, 'read_at', v_now);
END;
$$;

-- ============================================================================
-- 5. Modalidade do Motorista (service_mode) + Toggles Pix Automático/Manual
-- ============================================================================
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS service_mode TEXT NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'driver_profiles_service_mode_check'
      AND conrelid = 'public.driver_profiles'::regclass
  ) THEN
    ALTER TABLE public.driver_profiles
      ADD CONSTRAINT driver_profiles_service_mode_check
      CHECK (service_mode IN ('only_delivery', 'only_passenger', 'both'));
  END IF;
END $$;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS mp_auto_pix_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS manual_pix_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DROP FUNCTION IF EXISTS public.get_online_drivers_public();
CREATE OR REPLACE FUNCTION public.get_online_drivers_public()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  avatar_url TEXT,
  rating_avg NUMERIC,
  vehicle_type TEXT,
  service_mode TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  heading DOUBLE PRECISION
) AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.rating_avg,
    dp.vehicle_type,
    COALESCE(dp.service_mode, 'both') AS service_mode,
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

-- ============================================================================
-- 6. Pix Automático (Mercado Pago 24h) + Pix Manual Admin (Recarga & Corrida)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pagamentos_pix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  corrida_id UUID NULL REFERENCES public.rides(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('recarga', 'recarga_carteira', 'corrida', 'pagamento_corrida')),
  metodo_confirmacao TEXT NOT NULL DEFAULT 'mercadopago_auto' CHECK (metodo_confirmacao IN ('mercadopago_auto', 'manual_admin')),
  mp_payment_id TEXT UNIQUE,
  valor NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  qr_code TEXT,
  qr_code_base64 TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'cancelado', 'expirado')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aprovado_em TIMESTAMPTZ
);

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.pagamentos_pix'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE public.pagamentos_pix DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.pagamentos_pix
    ADD CONSTRAINT pagamentos_pix_tipo_check
    CHECK (tipo IN ('recarga', 'recarga_carteira', 'corrida', 'pagamento_corrida'));
END $$;

CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_user_date
  ON public.pagamentos_pix (usuario_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_corrida
  ON public.pagamentos_pix (corrida_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_status
  ON public.pagamentos_pix (status);

ALTER TABLE public.pagamentos_pix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pagamentos_pix_select_own_or_admin" ON public.pagamentos_pix;
CREATE POLICY "pagamentos_pix_select_own_or_admin"
  ON public.pagamentos_pix FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "pagamentos_pix_insert_own_pending" ON public.pagamentos_pix;
CREATE POLICY "pagamentos_pix_insert_own_pending"
  ON public.pagamentos_pix FOR INSERT
  TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND status = 'pendente');

DROP POLICY IF EXISTS "pagamentos_pix_admin_all" ON public.pagamentos_pix;
CREATE POLICY "pagamentos_pix_admin_all"
  ON public.pagamentos_pix FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.pagamentos_pix REPLICA IDENTITY FULL;
ALTER TABLE public.rides REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pagamentos_pix;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.process_mercadopago_pix_approved(p_mp_payment_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pix public.pagamentos_pix%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_already_driver BOOLEAN;
  v_ride_amount NUMERIC(10,2);
BEGIN
  -- Executado por service_role (auth.uid() IS NULL) ou Administrador autenticado
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado para confirmação automática de Pix';
  END IF;

  SELECT * INTO v_pix
  FROM public.pagamentos_pix
  WHERE mp_payment_id = p_mp_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pagamento Pix não encontrado');
  END IF;

  IF v_pix.status = 'aprovado' THEN
    RETURN jsonb_build_object('ok', TRUE, 'already_approved', TRUE, 'id', v_pix.id);
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.pagamentos_pix
  SET status = 'aprovado',
      aprovado_em = NOW()
  WHERE id = v_pix.id;

  IF v_pix.tipo IN ('recarga', 'recarga_carteira') THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_pix.valor)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_pix.usuario_id;

    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (
      v_pix.usuario_id,
      v_pix.valor,
      'deposit',
      'Recarga Pix Automático (Mercado Pago) #' || RIGHT(v_pix.id::TEXT, 4)
    );

    INSERT INTO public.app_notifications (title, message, category, target_scope, target_user_id)
    VALUES (
      'Pix confirmado automaticamente!',
      'Sua recarga Pix de R$ ' || REPLACE(TO_CHAR(v_pix.valor, 'FM9999990D00'), '.', ',') || ' já está disponível na sua carteira GoPay.',
      'wallet',
      'user',
      v_pix.usuario_id
    );
  ELSIF v_pix.tipo IN ('corrida', 'pagamento_corrida') AND v_pix.corrida_id IS NOT NULL THEN
    SELECT * INTO v_ride FROM public.rides WHERE id = v_pix.corrida_id FOR UPDATE;
    IF FOUND THEN
      v_ride_amount := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, v_pix.valor)::NUMERIC, 2);

      UPDATE public.rides
      SET payment_method = 'pix',
          payment_status = 'paid_pix',
          final_fare = COALESCE(final_fare, v_ride_amount),
          pix_declared_at = COALESCE(pix_declared_at, NOW())
      WHERE id = v_ride.id;

      IF v_ride.driver_id IS NOT NULL AND v_ride_amount > 0 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.wallet_transactions
          WHERE ride_id = v_ride.id
            AND user_id = v_ride.driver_id
            AND type IN ('ride_earning', 'dispute_settlement')
        ) INTO v_already_driver;

        IF NOT v_already_driver THEN
          UPDATE public.profiles
          SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_ride_amount)::NUMERIC, 2),
              updated_at = NOW()
          WHERE id = v_ride.driver_id;

          INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
          VALUES (
            v_ride.driver_id,
            v_ride.id,
            v_ride_amount,
            'ride_earning',
            'Corrida Pix Automático #' || RIGHT(v_ride.id::TEXT, 4)
          );
        END IF;

        INSERT INTO public.app_notifications (title, message, category, target_scope, target_user_id)
        VALUES (
          'Pagamento Pix confirmado!',
          'O Pix da corrida #' || RIGHT(v_ride.id::TEXT, 4) || ' foi confirmado automaticamente e creditado no seu GoPay.',
          'payment',
          'user',
          v_ride.driver_id
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'id', v_pix.id, 'tipo', v_pix.tipo);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_pagamento_pix(
  p_pagamento_id UUID,
  p_approve BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pix public.pagamentos_pix%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_already_driver BOOLEAN;
  v_ride_amount NUMERIC(10,2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente administrador';
  END IF;

  SELECT * INTO v_pix
  FROM public.pagamentos_pix
  WHERE id = p_pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro Pix não encontrado';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.pagamentos_pix
    SET status = 'cancelado'
    WHERE id = v_pix.id;
    RETURN jsonb_build_object('ok', TRUE, 'status', 'cancelado');
  END IF;

  IF v_pix.status = 'aprovado' THEN
    RETURN jsonb_build_object('ok', TRUE, 'already_approved', TRUE);
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.pagamentos_pix
  SET status = 'aprovado',
      aprovado_em = NOW()
  WHERE id = v_pix.id;

  IF v_pix.tipo IN ('recarga', 'recarga_carteira') THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_pix.valor)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_pix.usuario_id;

    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (
      v_pix.usuario_id,
      v_pix.valor,
      'deposit',
      'Recarga Pix aprovada pelo Administrador #' || RIGHT(v_pix.id::TEXT, 4)
    );
  ELSIF v_pix.tipo IN ('corrida', 'pagamento_corrida') AND v_pix.corrida_id IS NOT NULL THEN
    SELECT * INTO v_ride FROM public.rides WHERE id = v_pix.corrida_id FOR UPDATE;
    IF FOUND THEN
      v_ride_amount := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, v_pix.valor)::NUMERIC, 2);

      UPDATE public.rides
      SET payment_method = 'pix',
          payment_status = 'paid_pix',
          final_fare = COALESCE(final_fare, v_ride_amount),
          pix_declared_at = COALESCE(pix_declared_at, NOW())
      WHERE id = v_ride.id;

      IF v_ride.driver_id IS NOT NULL AND v_ride_amount > 0 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.wallet_transactions
          WHERE ride_id = v_ride.id
            AND user_id = v_ride.driver_id
            AND type IN ('ride_earning', 'dispute_settlement')
        ) INTO v_already_driver;

        IF NOT v_already_driver THEN
          UPDATE public.profiles
          SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_ride_amount)::NUMERIC, 2),
              updated_at = NOW()
          WHERE id = v_ride.driver_id;

          INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
          VALUES (
            v_ride.driver_id,
            v_ride.id,
            v_ride_amount,
            'ride_earning',
            'Corrida Pix aprovado pelo Admin #' || RIGHT(v_ride.id::TEXT, 4)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'aprovado');
END;
$$;
