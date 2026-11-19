-- ============================================================================
-- 66 Mobilidade / Meia Meia — Auditoria de Segurança, RLS, 66 Pay & Super Admin
-- Execute no SQL Editor do Supabase (100% idempotente, preserva dados existentes)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PILAR 3: SUPER ADMINISTRADOR SEM HARDCODING
-- ----------------------------------------------------------------------------

-- 1. Coluna explícita de privilégio administrativo na tabela profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Migra contas admin existentes e garante driver@admin.com como Super Admin ativo
UPDATE public.profiles
SET is_admin = TRUE, role = 'admin', status = 'active', updated_at = NOW()
WHERE LOWER(email) = 'driver@admin.com'
   OR (role = 'admin' AND COALESCE(is_anonymized, FALSE) = FALSE);

-- Remove gatilho antigo de auto-promoção no INSERT público, mantendo verificação segura via banco
DROP TRIGGER IF EXISTS trg_enforce_super_admin_email ON public.profiles;
DROP FUNCTION IF EXISTS public.enforce_super_admin_email();

-- Atualiza trigger de criação de usuário para NUNCA conceder admin no cadastro
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_status TEXT;
BEGIN
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'passenger');
  IF v_role NOT IN ('passenger', 'driver') THEN
    v_role := 'passenger';
  END IF;
  v_status := CASE WHEN v_role = 'driver' THEN 'pending' ELSE 'active' END;

  INSERT INTO public.profiles (
    id, role, is_admin, status, full_name, phone, email, cpf, preferred_payment
  )
  VALUES (
    NEW.id,
    v_role,
    FALSE,
    v_status,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(NEW.email, 'Usuário'), '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), ''),
    LOWER(COALESCE(NEW.email, '')),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'cpf', ''), ''),
    'pix'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Função central de verificação administrativa (usada por todas as políticas RLS e RPCs)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = TRUE OR role = 'admin')
      AND status = 'active'
      AND COALESCE(is_anonymized, FALSE) = FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- RPC para o Hook React (useAdminAuth) verificar em tempo real se a sessão é Super Admin
CREATE OR REPLACE FUNCTION public.check_my_admin_access()
RETURNS TABLE (
  is_admin BOOLEAN,
  role TEXT,
  status TEXT
) AS $$
  SELECT
    (COALESCE(p.is_admin, FALSE) OR p.role = 'admin')
      AND p.status = 'active'
      AND COALESCE(p.is_anonymized, FALSE) = FALSE AS is_admin,
    p.role,
    p.status
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ----------------------------------------------------------------------------
-- PILAR 2: PROTEÇÃO CONTRA ALTERAÇÃO DIRETA DE SALDO E PRIVILÉGIOS (TRIGGER)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_trusted TEXT;
  v_has_jwt BOOLEAN;
BEGIN
  v_trusted := current_setting('app.trusted_wallet_tx', true);
  v_has_jwt := auth.uid() IS NOT NULL;

  -- Permite operações internas do SQL Editor (sem JWT) ou RPCs confiáveis (app.trusted_wallet_tx = '1')
  IF NOT v_has_jwt OR v_trusted = '1' THEN
    RETURN NEW;
  END IF;

  -- Bloqueia auto-promoção para admin/status/saldo mesmo se o usuário tentar via REST client
  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Permissão negada: privilégio is_admin só pode ser alterado pelo banco.';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Permissão negada: não é permitido alterar o próprio cargo (role).';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Permissão negada: alteração de status restrita à administração.';
    END IF;
    IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
      RAISE EXCEPTION 'Permissão negada: saldo só pode ser movimentado via RPC segura 66 Pay.';
    END IF;
    IF NEW.pending_debt_amount IS DISTINCT FROM OLD.pending_debt_amount THEN
      RAISE EXCEPTION 'Permissão negada: débitos pendentes são controlados apenas pelo servidor.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_sensitive_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_sensitive_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_profile_columns();

-- Visão segura de carteira do usuário (sem expor outros usuários)
CREATE OR REPLACE VIEW public.user_wallets AS
SELECT
  id AS user_id,
  full_name,
  wallet_balance,
  pending_debt_amount,
  updated_at
FROM public.profiles
WHERE id = auth.uid() OR public.is_admin();

-- ----------------------------------------------------------------------------
-- PILAR 1 & 2: TIPOS DE TRANSAÇÃO, TABELA DE SAQUES E RPCs ATÔMICAS 66 PAY
-- ----------------------------------------------------------------------------

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ota_web_url TEXT,
  ADD COLUMN IF NOT EXISTS company_address TEXT,
  ADD COLUMN IF NOT EXISTS platform_pix_qr_url TEXT;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wallet_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'ride_earning',
    'payout',
    'dispute_settlement',
    'deposit',
    'ride_debit',
    'ride_refund',
    'admin_adjustment',
    'transfer_in',
    'transfer_out',
    'withdrawal',
    'withdrawal_refund'
  ));

CREATE TABLE IF NOT EXISTS public.wallet_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  pix_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- RPC de busca de destinatário 66 Pay (e-mail, telefone ou nome)
CREATE OR REPLACE FUNCTION public.lookup_wallet_recipient(p_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  avatar_url TEXT
) AS $$
DECLARE
  v_uid UUID;
  v_clean TEXT;
  v_digits TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_clean := TRIM(COALESCE(p_query, ''));
  IF LENGTH(v_clean) < 3 THEN
    RETURN;
  END IF;

  v_digits := regexp_replace(v_clean, '\D', '', 'g');

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.role,
    p.avatar_url
  FROM public.profiles p
  WHERE p.id <> v_uid
    AND COALESCE(p.is_anonymized, FALSE) = FALSE
    AND p.status = 'active'
    AND (
      LOWER(p.email) = LOWER(v_clean)
      OR (LENGTH(v_digits) >= 8 AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
      OR LOWER(p.full_name) LIKE '%' || LOWER(v_clean) || '%'
    )
  ORDER BY
    CASE WHEN LOWER(p.email) = LOWER(v_clean) THEN 0 ELSE 1 END,
    p.full_name ASC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC principal 66 Pay: transferir_saldo_66 (aceita UUID, e-mail ou telefone do destinatário)
CREATE OR REPLACE FUNCTION public.transferir_saldo_66(
  p_destinatario TEXT,
  p_valor NUMERIC,
  p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_from UUID;
  v_to UUID;
  v_clean TEXT;
  v_digits TEXT;
  v_amount NUMERIC(10,2);
  v_from_name TEXT;
  v_to_name TEXT;
  v_from_bal NUMERIC(10,2);
  v_from_status TEXT;
  v_from_tx_id UUID;
  v_to_tx_id UUID;
  v_tx_ts TIMESTAMPTZ := NOW();
  v_from_desc TEXT;
  v_to_desc TEXT;
BEGIN
  v_from := auth.uid();
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_clean := TRIM(COALESCE(p_destinatario, ''));
  IF v_clean = '' THEN
    RAISE EXCEPTION 'Informe o destinatário (UUID, e-mail ou telefone).';
  END IF;

  v_amount := ROUND(COALESCE(p_valor, 0)::NUMERIC, 2);
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'O valor mínimo para transferência 66 Pay é R$ 1,00.';
  END IF;

  -- Tenta interpretar como UUID direto, caso contrário busca por e-mail ou telefone exato
  BEGIN
    v_to := v_clean::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_digits := regexp_replace(v_clean, '\D', '', 'g');
    SELECT id INTO v_to
    FROM public.profiles
    WHERE COALESCE(is_anonymized, FALSE) = FALSE
      AND status = 'active'
      AND (
        LOWER(email) = LOWER(v_clean)
        OR (LENGTH(v_digits) >= 10 AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_digits)
      )
    LIMIT 1;
  END;

  IF v_to IS NULL OR v_to = v_from THEN
    RAISE EXCEPTION 'Destinatário não encontrado ou inválido para transferência.';
  END IF;

  -- Lock determinístico em ordem de UUID (anti-deadlock / anti-double-spend)
  IF v_from < v_to THEN
    PERFORM 1 FROM public.profiles WHERE id IN (v_from, v_to) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles WHERE id IN (v_to, v_from) ORDER BY id FOR UPDATE;
  END IF;

  SELECT full_name, COALESCE(wallet_balance, 0), status
  INTO v_from_name, v_from_bal, v_from_status
  FROM public.profiles
  WHERE id = v_from;

  IF v_from_status <> 'active' THEN
    RAISE EXCEPTION 'Sua conta não está ativa para movimentar saldo.';
  END IF;

  SELECT full_name INTO v_to_name
  FROM public.profiles
  WHERE id = v_to AND COALESCE(is_anonymized, FALSE) = FALSE AND status = 'active';

  IF v_to_name IS NULL THEN
    RAISE EXCEPTION 'Destinatário indisponível para receber transferências.';
  END IF;

  IF v_from_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira 66 Pay.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_from;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_to;

  v_from_desc := 'Enviado para ' || v_to_name || COALESCE(' · ' || NULLIF(TRIM(p_observacao), ''), '');
  v_to_desc := 'Recebido de ' || v_from_name || COALESCE(' · ' || NULLIF(TRIM(p_observacao), ''), '');

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (v_from, -v_amount, 'transfer_out', v_from_desc)
  RETURNING id, created_at INTO v_from_tx_id, v_tx_ts;

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (v_to, v_amount, 'transfer_in', v_to_desc)
  RETURNING id INTO v_to_tx_id;

  IF to_regclass('public.app_notifications') IS NOT NULL THEN
    INSERT INTO public.app_notifications (
      title, message, category, target_scope, target_user_id, action_tab, metadata, created_by
    )
    VALUES (
      'Transferência 66 Pay recebida',
      v_from_name || ' enviou R$ ' || REPLACE(TO_CHAR(v_amount, 'FM999999990.00'), '.', ',') || ' para sua conta 66 Pay.',
      'wallet',
      'user',
      v_to,
      'wallet',
      jsonb_build_object(
        'source', 'p2p_transfer',
        'tx', jsonb_build_object(
          'id', v_to_tx_id,
          'user_id', v_to,
          'amount', v_amount,
          'type', 'transfer_in',
          'description', v_to_desc,
          'created_at', v_tx_ts
        )
      ),
      v_from
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'amount', v_amount,
    'recipient_id', v_to,
    'recipient_name', v_to_name,
    'from_name', v_from_name,
    'new_balance', ROUND((v_from_bal - v_amount)::NUMERIC, 2),
    'tx_id', v_from_tx_id,
    'created_at', v_tx_ts,
    'description', v_from_desc
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Alias compatível por UUID direto
CREATE OR REPLACE FUNCTION public.transfer_wallet_balance(
  p_to_user_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  PERFORM public.transferir_saldo_66(p_to_user_id::TEXT, p_amount, p_note);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPCs Financeiras Protegidas (todas habilitam app.trusted_wallet_tx = '1')
CREATE OR REPLACE FUNCTION public.debit_own_wallet_for_ride(
  p_ride_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT 'Pagamento de corrida com Saldo 66 Pay'
)
RETURNS VOID AS $$
DECLARE
  v_uid UUID;
  v_balance NUMERIC(10,2);
  v_debit NUMERIC(10,2);
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_debit := ROUND(GREATEST(0, COALESCE(p_amount, 0))::NUMERIC, 2);
  IF v_debit <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_balance
  FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_balance < v_debit THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((wallet_balance - v_debit)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_uid;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_uid, p_ride_id, -v_debit, 'ride_debit', p_description);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.refund_wallet_for_cancelled_ride(p_ride_id UUID)
RETURNS VOID AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_already_refunded BOOLEAN;
  v_refund NUMERIC(10,2);
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF auth.uid() IS DISTINCT FROM v_ride.passenger_id
     AND auth.uid() IS DISTINCT FROM v_ride.driver_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para estornar esta corrida.';
  END IF;

  IF v_ride.payment_method <> 'wallet' OR v_ride.payment_status <> 'paid_wallet' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.passenger_id AND type = 'ride_refund'
  ) INTO v_already_refunded;

  IF v_already_refunded THEN
    RETURN;
  END IF;

  v_refund := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_refund <= 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_refund)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_ride.passenger_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.passenger_id, p_ride_id, v_refund, 'ride_refund', 'Estorno automático de corrida cancelada');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.credit_driver_wallet_for_ride(
  p_ride_id UUID,
  p_description TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'ride_earning'
)
RETURNS VOID AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_already BOOLEAN;
  v_amount NUMERIC(10,2);
  v_tx_type TEXT;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.driver_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS DISTINCT FROM v_ride.driver_id
     AND auth.uid() IS DISTINCT FROM v_ride.passenger_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para creditar esta corrida.';
  END IF;

  IF v_ride.payment_status NOT IN ('paid_pix', 'paid_wallet', 'admin_settled') THEN
    RETURN;
  END IF;

  v_tx_type := CASE WHEN p_type IN ('ride_earning', 'dispute_settlement') THEN p_type ELSE 'ride_earning' END;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id
      AND user_id = v_ride.driver_id
      AND type IN ('ride_earning', 'dispute_settlement')
  ) INTO v_already;

  IF v_already THEN
    RETURN;
  END IF;

  v_amount := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_amount <= 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_ride.driver_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (
    v_ride.driver_id,
    p_ride_id,
    v_amount,
    v_tx_type,
    COALESCE(NULLIF(TRIM(p_description), ''), 'Ganho de corrida #' || RIGHT(p_ride_id::TEXT, 4))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.pay_completed_ride_with_wallet(p_ride_id UUID)
RETURNS VOID AS $$
DECLARE
  v_uid UUID;
  v_ride public.rides%ROWTYPE;
  v_bal NUMERIC(10,2);
  v_fare NUMERIC(10,2);
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;

  IF v_ride.passenger_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para quitar esta corrida.';
  END IF;

  IF v_ride.payment_status IN ('paid_wallet', 'paid_pix', 'paid_cash', 'admin_settled') THEN
    RAISE EXCEPTION 'Esta corrida já foi quitada.';
  END IF;

  v_fare := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  SELECT COALESCE(wallet_balance, 0) INTO v_bal
  FROM public.profiles WHERE id = v_ride.passenger_id FOR UPDATE;

  IF v_bal < v_fare THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_fare)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_ride.passenger_id;

  UPDATE public.rides
  SET payment_method = 'wallet',
      payment_status = 'paid_wallet',
      final_fare = v_fare
  WHERE id = p_ride_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.passenger_id, p_ride_id, -v_fare, 'ride_debit', 'Pagamento pós-corrida 66 Pay #' || RIGHT(p_ride_id::TEXT, 4));

  IF v_ride.driver_id IS NOT NULL THEN
    PERFORM public.credit_driver_wallet_for_ride(p_ride_id, 'Corrida Saldo 66 Pay #' || RIGHT(p_ride_id::TEXT, 4), 'ride_earning');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.client_select_ride_payment_method(
  p_ride_id UUID,
  p_method TEXT
)
RETURNS VOID AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
BEGIN
  IF p_method NOT IN ('pix', 'cash') THEN
    RAISE EXCEPTION 'Método inválido.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;
  IF v_ride.passenger_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF v_ride.payment_status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.rides
  SET payment_method = p_method,
      pix_declared_at = CASE WHEN p_method = 'cash' THEN NULL ELSE pix_declared_at END
  WHERE id = p_ride_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(
  p_amount NUMERIC,
  p_pix_key TEXT
)
RETURNS UUID AS $$
DECLARE
  v_uid UUID;
  v_amount NUMERIC(10,2);
  v_bal NUMERIC(10,2);
  v_clean_pix TEXT;
  v_withdrawal_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0)::NUMERIC, 2);
  v_clean_pix := TRIM(COALESCE(p_pix_key, ''));
  IF v_amount < 5 THEN
    RAISE EXCEPTION 'Valor mínimo para saque é R$ 5,00.';
  END IF;
  IF LENGTH(v_clean_pix) < 4 THEN
    RAISE EXCEPTION 'Informe uma chave Pix válida para receber o saque.';
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_bal
  FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente para este saque.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_uid;

  INSERT INTO public.wallet_withdrawals (user_id, amount, pix_key, status)
  VALUES (v_uid, v_amount, v_clean_pix, 'pending')
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (v_uid, -v_amount, 'withdrawal', 'Solicitação de saque Pix (' || v_clean_pix || ')');

  RETURN v_withdrawal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_process_wallet_withdrawal(
  p_withdrawal_id UUID,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_w public.wallet_withdrawals%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem processar saques.';
  END IF;

  IF p_action NOT IN ('paid', 'rejected') THEN
    RAISE EXCEPTION 'Ação inválida para saque.';
  END IF;

  SELECT * INTO v_w
  FROM public.wallet_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de saque não encontrada.';
  END IF;
  IF v_w.status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.wallet_withdrawals
  SET status = p_action,
      note = COALESCE(NULLIF(TRIM(p_note), ''), note),
      reviewed_at = NOW()
  WHERE id = p_withdrawal_id;

  IF p_action = 'rejected' THEN
    PERFORM set_config('app.trusted_wallet_tx', '1', true);

    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_w.amount)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_w.user_id;

    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (
      v_w.user_id,
      v_w.amount,
      'withdrawal_refund',
      COALESCE(NULLIF(TRIM(p_note), ''), 'Saque Pix recusado · Saldo estornado')
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_approve_wallet_deposit(
  p_deposit_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_dep public.wallet_deposits%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem confirmar depósitos.';
  END IF;

  SELECT * INTO v_dep FROM public.wallet_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de depósito não encontrada.';
  END IF;
  IF v_dep.status = 'approved' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.wallet_deposits
  SET status = 'approved',
      note = COALESCE(NULLIF(TRIM(p_note), ''), note),
      reviewed_at = NOW()
  WHERE id = p_deposit_id;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_dep.amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_dep.user_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (
    v_dep.user_id,
    NULL,
    v_dep.amount,
    'deposit',
    COALESCE(NULLIF(TRIM(p_note), ''), 'Depósito Pix confirmado pelo Administrador')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_adjust_user_wallet(
  p_user_id UUID,
  p_new_balance NUMERIC,
  p_description TEXT DEFAULT 'Ajuste de saldo pelo Administrador'
)
RETURNS VOID AS $$
DECLARE
  v_current NUMERIC(10,2);
  v_target NUMERIC(10,2);
  v_delta NUMERIC(10,2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem editar saldos.';
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_current
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.';
  END IF;

  v_target := ROUND(GREATEST(0, COALESCE(p_new_balance, 0))::NUMERIC, 2);
  v_delta := ROUND((v_target - v_current)::NUMERIC, 2);

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = v_target,
      updated_at = NOW()
  WHERE id = p_user_id;

  IF v_delta <> 0 THEN
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (
      p_user_id,
      NULL,
      v_delta,
      'admin_adjustment',
      COALESCE(NULLIF(TRIM(p_description), ''), 'Ajuste de saldo pelo Administrador')
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

  SELECT * INTO v_driver FROM public.profiles WHERE id = p_driver_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Motorista não encontrado.';
  END IF;

  v_pay := ROUND(LEAST(COALESCE(p_amount, v_driver.wallet_balance), GREATEST(0, v_driver.wallet_balance)), 2);
  IF v_pay <= 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.anonymize_own_account()
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.trusted_wallet_tx', '1', true);

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
    favorites = '[]'::jsonb,
    status = 'suspended',
    is_admin = FALSE,
    is_anonymized = TRUE,
    deleted_at = NOW(),
    updated_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.driver_profiles
  SET is_online = FALSE, updated_at = NOW()
  WHERE user_id = p_user_id;

  UPDATE public.profiles
  SET
    is_anonymized = TRUE,
    is_admin = FALSE,
    status = 'suspended',
    full_name = 'Conta Removida',
    phone = '',
    cpf = '',
    avatar_url = NULL,
    bio = NULL,
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ----------------------------------------------------------------------------
-- PILAR 2: AUDITORIA COMPLETA DE POLÍTICAS RLS (TODAS AS TABELAS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_app ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. profiles (SELECT restrito, INSERT bloqueia saldo/admin inicial, DELETE proibido)
DROP POLICY IF EXISTS "Usuário vê próprio perfil ou participante em corrida ativa" ON public.profiles;
DROP POLICY IF EXISTS "Usuário cria próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil ou Admin atualiza qualquer perfil" ON public.profiles;

CREATE POLICY "profiles_select_strict"
  ON public.profiles FOR SELECT
  TO authenticated
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

CREATE POLICY "profiles_insert_own_safe"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role IN ('passenger', 'driver')
    AND COALESCE(is_admin, FALSE) = FALSE
    AND COALESCE(wallet_balance, 0) = 0
  );

CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- 2. wallet_transactions (IMUTÁVEL: nenhum usuário edita, apaga ou forja extrato)
DROP POLICY IF EXISTS "Leitura da própria carteira" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Inserir transações na carteira" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_select" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_insert_admin_only" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_no_update" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_no_delete" ON public.wallet_transactions;

CREATE POLICY "wallet_transactions_select"
  ON public.wallet_transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "wallet_transactions_insert_admin_only"
  ON public.wallet_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "wallet_transactions_no_update"
  ON public.wallet_transactions FOR UPDATE
  TO authenticated
  USING (FALSE);

CREATE POLICY "wallet_transactions_no_delete"
  ON public.wallet_transactions FOR DELETE
  TO authenticated
  USING (FALSE);

-- 3. wallet_deposits (cliente lê e solicita apenas pendente; só admin aprova/recusa)
DROP POLICY IF EXISTS "Cliente le proprios depositos ou Admin" ON public.wallet_deposits;
DROP POLICY IF EXISTS "Cliente solicita proprio deposito" ON public.wallet_deposits;
DROP POLICY IF EXISTS "Somente Admin gerencia depositos" ON public.wallet_deposits;

CREATE POLICY "wallet_deposits_select"
  ON public.wallet_deposits FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "wallet_deposits_insert_pending"
  ON public.wallet_deposits FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "wallet_deposits_update_admin"
  ON public.wallet_deposits FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4. wallet_withdrawals (criado apenas via RPC; só admin altera status)
DROP POLICY IF EXISTS "Usuario ve proprios saques" ON public.wallet_withdrawals;
DROP POLICY IF EXISTS "Admin atualiza saques" ON public.wallet_withdrawals;

CREATE POLICY "wallet_withdrawals_select"
  ON public.wallet_withdrawals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "wallet_withdrawals_update_admin"
  ON public.wallet_withdrawals FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5. Realtime para saques e transações
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wallet_withdrawals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_withdrawals;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wallet_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
  END IF;
END $$;

-- 6. Cancelamento com tolerância de 20s e taxa dinâmica (R$ 4,00 até 90% da corrida ao motorista)
CREATE OR REPLACE FUNCTION public.cancel_ride_with_fee(
  p_ride_id UUID,
  p_fee_amount NUMERIC DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_fare NUMERIC(10,2);
  v_elapsed_sec NUMERIC;
  v_max_fee NUMERIC(10,2);
  v_fee NUMERIC(10,2) := 0;
  v_refund NUMERIC(10,2) := 0;
  v_pax_bal NUMERIC(10,2) := 0;
  v_debit_now NUMERIC(10,2) := 0;
  v_debt_add NUMERIC(10,2) := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corrida não encontrada.'; END IF;

  IF v_ride.passenger_id <> v_uid AND v_ride.driver_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para cancelar esta corrida.';
  END IF;

  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', TRUE, 'fee', 0, 'refund', 0);
  END IF;

  IF v_ride.status = 'completed' THEN
    RAISE EXCEPTION 'Corrida já concluída.';
  END IF;

  IF v_ride.status = 'in_progress' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não é possível cancelar após o embarque iniciado.';
  END IF;

  v_fare := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);

  IF v_uid = v_ride.passenger_id AND v_ride.driver_id IS NOT NULL AND v_ride.accepted_at IS NOT NULL THEN
    v_elapsed_sec := EXTRACT(EPOCH FROM (NOW() - v_ride.accepted_at));
    IF v_elapsed_sec > 20 THEN
      v_max_fee := ROUND((v_fare * 0.90)::NUMERIC, 2);
      v_fee := LEAST(v_max_fee, GREATEST(LEAST(4.00, v_max_fee), ROUND(COALESCE(p_fee_amount, 4.00)::NUMERIC, 2)));
    END IF;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.rides
  SET status = 'cancelled'
  WHERE id = p_ride_id;

  IF v_ride.payment_method = 'wallet' AND v_ride.payment_status = 'paid_wallet' THEN
    v_refund := GREATEST(0, ROUND((v_fare - v_fee)::NUMERIC, 2));
    IF v_refund > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_refund)::NUMERIC, 2), updated_at = NOW()
      WHERE id = v_ride.passenger_id;

      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (
        v_ride.passenger_id,
        p_ride_id,
        v_refund,
        'ride_refund',
        CASE WHEN v_fee > 0
          THEN 'Estorno parcial após taxa de cancelamento #' || RIGHT(p_ride_id::TEXT, 4)
          ELSE 'Estorno automático de corrida cancelada #' || RIGHT(p_ride_id::TEXT, 4)
        END
      );
    END IF;
  ELSIF v_fee > 0 THEN
    SELECT COALESCE(wallet_balance, 0) INTO v_pax_bal FROM public.profiles WHERE id = v_ride.passenger_id FOR UPDATE;
    v_debit_now := LEAST(v_pax_bal, v_fee);
    v_debt_add := ROUND((v_fee - v_debit_now)::NUMERIC, 2);

    IF v_debit_now > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_debit_now)::NUMERIC, 2), updated_at = NOW()
      WHERE id = v_ride.passenger_id;

      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (v_ride.passenger_id, p_ride_id, -v_debit_now, 'ride_debit', 'Taxa de cancelamento #' || RIGHT(p_ride_id::TEXT, 4));
    END IF;

    IF v_debt_add > 0 THEN
      UPDATE public.profiles
      SET pending_debt_amount = ROUND((COALESCE(pending_debt_amount, 0) + v_debt_add)::NUMERIC, 2),
          pending_debt_note = 'Taxa de cancelamento corrida #' || RIGHT(p_ride_id::TEXT, 4),
          updated_at = NOW()
      WHERE id = v_ride.passenger_id;
    END IF;
  END IF;

  IF v_fee > 0 AND v_ride.driver_id IS NOT NULL THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_fee)::NUMERIC, 2), updated_at = NOW()
    WHERE id = v_ride.driver_id;

    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (
      v_ride.driver_id,
      p_ride_id,
      v_fee,
      'ride_earning',
      'Taxa de cancelamento recebida #' || RIGHT(p_ride_id::TEXT, 4)
    );
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'fee', v_fee, 'refund', v_refund);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. Central de Notificações & Cupons de Desconto
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'payment', 'event', 'coupon', 'wallet')),
  target_scope TEXT NOT NULL DEFAULT 'all' CHECK (target_scope IN ('all', 'passengers', 'drivers', 'user')),
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_tab TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID NOT NULL REFERENCES public.app_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_notifications_select" ON public.app_notifications;
DROP POLICY IF EXISTS "app_notifications_admin_insert" ON public.app_notifications;
DROP POLICY IF EXISTS "app_notifications_admin_delete" ON public.app_notifications;
DROP POLICY IF EXISTS "notification_reads_own" ON public.notification_reads;

CREATE POLICY "app_notifications_select"
  ON public.app_notifications FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR target_scope = 'all'
    OR (target_scope = 'user' AND target_user_id = auth.uid())
    OR (
      target_scope = 'passengers'
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'passenger')
    )
    OR (
      target_scope = 'drivers'
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'driver')
    )
  );

CREATE POLICY "app_notifications_admin_insert"
  ON public.app_notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "app_notifications_admin_delete"
  ON public.app_notifications FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "notification_reads_own"
  ON public.notification_reads FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_discount NUMERIC(10,2),
  min_ride_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used', 'revoked')),
  used_ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_coupon_id UUID REFERENCES public.user_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coupons_select_assigned_or_admin" ON public.coupons;
DROP POLICY IF EXISTS "coupons_admin_all" ON public.coupons;
DROP POLICY IF EXISTS "user_coupons_select_own_or_admin" ON public.user_coupons;
DROP POLICY IF EXISTS "user_coupons_admin_insert" ON public.user_coupons;
DROP POLICY IF EXISTS "user_coupons_update_own_or_admin" ON public.user_coupons;
DROP POLICY IF EXISTS "user_coupons_admin_delete" ON public.user_coupons;

CREATE POLICY "coupons_select_assigned_or_admin"
  ON public.coupons FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_coupons uc
      WHERE uc.coupon_id = coupons.id
        AND uc.user_id = auth.uid()
    )
  );

CREATE POLICY "coupons_admin_all"
  ON public.coupons FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "user_coupons_select_own_or_admin"
  ON public.user_coupons FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "user_coupons_admin_insert"
  ON public.user_coupons FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "user_coupons_update_own_or_admin"
  ON public.user_coupons FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "user_coupons_admin_delete"
  ON public.user_coupons FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_grant_coupon(
  p_coupon_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_send_notification BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER AS $$
DECLARE
  v_coupon public.coupons%ROWTYPE;
  v_count INTEGER := 0;
  v_discount_label TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Restrito ao Admin.';
  END IF;

  SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cupom não encontrado.';
  END IF;

  v_discount_label := CASE
    WHEN v_coupon.discount_type = 'percent'
      THEN ROUND(v_coupon.discount_value, 0)::TEXT || '% OFF'
    ELSE 'R$ ' || REPLACE(TO_CHAR(v_coupon.discount_value, 'FM999999990.00'), '.', ',') || ' OFF'
  END;

  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_coupons
      WHERE coupon_id = p_coupon_id AND user_id = p_user_id AND status = 'available'
    ) THEN
      INSERT INTO public.user_coupons (coupon_id, user_id, status)
      VALUES (p_coupon_id, p_user_id, 'available');
      v_count := 1;
    END IF;

    IF p_send_notification THEN
      INSERT INTO public.app_notifications (
        title, message, category, target_scope, target_user_id, action_tab, metadata, created_by
      )
      VALUES (
        'Cupom liberado: ' || v_coupon.code,
        'Você ganhou ' || v_discount_label || ' (' || v_coupon.title || ') para usar na sua próxima corrida!',
        'coupon',
        'user',
        p_user_id,
        'coupons',
        jsonb_build_object('coupon_id', p_coupon_id, 'code', v_coupon.code),
        auth.uid()
      );
    END IF;
  ELSE
    WITH inserted AS (
      INSERT INTO public.user_coupons (coupon_id, user_id, status)
      SELECT p_coupon_id, p.id, 'available'
      FROM public.profiles p
      WHERE p.role = 'passenger'
        AND p.status = 'active'
        AND COALESCE(p.is_anonymized, FALSE) = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM public.user_coupons uc
          WHERE uc.coupon_id = p_coupon_id AND uc.user_id = p.id AND uc.status = 'available'
        )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;

    IF p_send_notification THEN
      INSERT INTO public.app_notifications (
        title, message, category, target_scope, target_user_id, action_tab, metadata, created_by
      )
      VALUES (
        'Novo cupom liberado: ' || v_coupon.code,
        'Você recebeu ' || v_discount_label || ' (' || v_coupon.title || '). Escolha ao pedir sua próxima corrida!',
        'coupon',
        'passengers',
        NULL,
        'coupons',
        jsonb_build_object('coupon_id', p_coupon_id, 'code', v_coupon.code),
        auth.uid()
      );
    END IF;
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.redeem_user_coupon(
  p_user_coupon_id UUID,
  p_ride_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  UPDATE public.user_coupons
  SET status = 'used',
      used_ride_id = p_ride_id,
      used_at = NOW()
  WHERE id = p_user_coupon_id
    AND user_id = v_uid
    AND status = 'available';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'app_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notifications;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'coupons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coupons;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_coupons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_coupons;
  END IF;
END $$;

-- ============================================================================
-- SEÇÃO 8: 66PAY CHAVE EXCLUSIVA, RESERVA DE SALDO & TRANSFERÊNCIA ATÔMICA
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pay66_key TEXT,
  ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_pay66_key_unique
  ON public.profiles (LOWER(pay66_key))
  WHERE pay66_key IS NOT NULL;

UPDATE public.profiles
SET pay66_key = '66-' || UPPER(SUBSTRING(REPLACE(id::TEXT, '-', ''), 1, 8))
WHERE pay66_key IS NULL;

CREATE OR REPLACE VIEW public.user_wallets AS
SELECT
  id AS user_id,
  full_name,
  pay66_key,
  wallet_balance,
  reserved_balance,
  pending_debt_amount,
  updated_at
FROM public.profiles;

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS auth_code TEXT,
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_key TEXT;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.rides'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.rides DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.rides
  ADD CONSTRAINT rides_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'paid_cash', 'paid_pix', 'paid_wallet', 'disputed', 'admin_settled'));

-- ============================================================================
-- GARANTIA DO SUPER ADMINISTRADOR PRINCIPAL (MESMO E-MAIL E MESMA SENHA DO AUTH)
-- ============================================================================
UPDATE public.profiles
SET is_admin = TRUE, role = 'admin', status = 'active', updated_at = NOW()
WHERE LOWER(email) = 'driver@admin.com';
