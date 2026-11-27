-- ============================================================================
-- 66 Mobilidade — SQL Incremental (SOMENTE O DELTA NOVO / O QUE FALTA)
-- Não recria tabelas antigas e preserva 100% dos seus dados existentes.
-- ============================================================================

-- 1. Novas colunas na tabela platform_settings (OTA Web, Endereço e QR Code Pix Admin)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ota_web_url TEXT,
  ADD COLUMN IF NOT EXISTS company_address TEXT,
  ADD COLUMN IF NOT EXISTS platform_pix_qr_url TEXT;

-- 2. Super Administrador seguro no banco (mantendo driver@admin.com e mesma senha)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.profiles
SET is_admin = TRUE,
    role = 'admin',
    status = 'active',
    updated_at = NOW()
WHERE LOWER(email) = 'driver@admin.com'
   OR (role = 'admin' AND COALESCE(is_anonymized, FALSE) = FALSE);

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

-- 3. Proteção contra edição direta de saldo/admin via cliente
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_trusted TEXT;
  v_has_jwt BOOLEAN;
BEGIN
  v_trusted := current_setting('app.trusted_wallet_tx', true);
  v_has_jwt := auth.uid() IS NOT NULL;

  IF NOT v_has_jwt OR v_trusted = '1' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Permissão negada: privilégio is_admin restrito ao banco.';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Permissão negada: não é permitido alterar o próprio cargo.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Permissão negada: alteração de status restrita ao Admin.';
    END IF;
    IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
      RAISE EXCEPTION 'Permissão negada: saldo só pode ser movimentado via RPC 66 Pay.';
    END IF;
    IF NEW.pending_debt_amount IS DISTINCT FROM OLD.pending_debt_amount THEN
      RAISE EXCEPTION 'Permissão negada: débitos controlados apenas pelo servidor.';
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

-- 4. Novos tipos no extrato 66 Pay + tabela nova de Saques Pix (wallet_withdrawals)
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
    'ride_earning', 'payout', 'dispute_settlement', 'deposit',
    'ride_debit', 'ride_refund', 'admin_adjustment',
    'transfer_in', 'transfer_out', 'withdrawal', 'withdrawal_refund'
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

ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_withdrawals_select" ON public.wallet_withdrawals;
DROP POLICY IF EXISTS "wallet_withdrawals_update_admin" ON public.wallet_withdrawals;

CREATE POLICY "wallet_withdrawals_select"
  ON public.wallet_withdrawals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "wallet_withdrawals_update_admin"
  ON public.wallet_withdrawals FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Imutabilidade do extrato (wallet_transactions)
DROP POLICY IF EXISTS "Inserir transações na carteira" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_insert_admin_only" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_no_update" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_no_delete" ON public.wallet_transactions;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wallet_withdrawals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_withdrawals;
  END IF;
END $$;

-- 5. RPCs novas da Carteira 66 Pay (Transferência P2P, Saque Pix e Crédito Seguro)
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
  SELECT p.id, p.full_name, p.email, p.phone, p.role, p.avatar_url
  FROM public.profiles p
  WHERE p.id <> v_uid
    AND COALESCE(p.is_anonymized, FALSE) = FALSE
    AND p.status = 'active'
    AND (
      LOWER(p.email) = LOWER(v_clean)
      OR (LENGTH(v_digits) >= 8 AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
      OR LOWER(p.full_name) LIKE '%' || LOWER(v_clean) || '%'
    )
  ORDER BY CASE WHEN LOWER(p.email) = LOWER(v_clean) THEN 0 ELSE 1 END, p.full_name ASC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
  v_amount := ROUND(COALESCE(p_valor, 0)::NUMERIC, 2);
  IF v_clean = '' OR v_amount < 1 THEN
    RAISE EXCEPTION 'Informe destinatário válido e valor mínimo de R$ 1,00.';
  END IF;

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
    RAISE EXCEPTION 'Destinatário não encontrado ou inválido.';
  END IF;

  IF v_from < v_to THEN
    PERFORM 1 FROM public.profiles WHERE id IN (v_from, v_to) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles WHERE id IN (v_to, v_from) ORDER BY id FOR UPDATE;
  END IF;

  SELECT full_name, COALESCE(wallet_balance, 0), status
  INTO v_from_name, v_from_bal, v_from_status
  FROM public.profiles WHERE id = v_from;

  IF v_from_status <> 'active' THEN
    RAISE EXCEPTION 'Conta inativa.';
  END IF;

  SELECT full_name INTO v_to_name
  FROM public.profiles
  WHERE id = v_to AND COALESCE(is_anonymized, FALSE) = FALSE AND status = 'active';

  IF v_to_name IS NULL THEN
    RAISE EXCEPTION 'Destinatário indisponível.';
  END IF;

  IF v_from_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira 66 Pay.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2), updated_at = NOW()
  WHERE id = v_from;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2), updated_at = NOW()
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
  IF NOT FOUND OR v_ride.driver_id IS NULL THEN RETURN; END IF;

  IF auth.uid() IS DISTINCT FROM v_ride.driver_id
     AND auth.uid() IS DISTINCT FROM v_ride.passenger_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF v_ride.payment_status NOT IN ('paid_pix', 'paid_wallet', 'admin_settled') THEN RETURN; END IF;

  v_tx_type := CASE WHEN p_type IN ('ride_earning', 'dispute_settlement') THEN p_type ELSE 'ride_earning' END;
  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.driver_id AND type IN ('ride_earning', 'dispute_settlement')
  ) INTO v_already;
  IF v_already THEN RETURN; END IF;

  v_amount := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_amount <= 0 THEN RETURN; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2), updated_at = NOW()
  WHERE id = v_ride.driver_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.driver_id, p_ride_id, v_amount, v_tx_type, COALESCE(NULLIF(TRIM(p_description), ''), 'Ganho de corrida #' || RIGHT(p_ride_id::TEXT, 4)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount NUMERIC, p_pix_key TEXT)
RETURNS UUID AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_amount NUMERIC(10,2) := ROUND(COALESCE(p_amount, 0)::NUMERIC, 2);
  v_bal NUMERIC(10,2);
  v_clean_pix TEXT := TRIM(COALESCE(p_pix_key, ''));
  v_withdrawal_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_amount < 5 OR LENGTH(v_clean_pix) < 4 THEN
    RAISE EXCEPTION 'Valor mínimo R$ 5,00 e chave Pix válida.';
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_bal FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_bal < v_amount THEN RAISE EXCEPTION 'Saldo insuficiente para saque.'; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2), updated_at = NOW()
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
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Restrito ao Admin.'; END IF;
  IF p_action NOT IN ('paid', 'rejected') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;

  SELECT * INTO v_w FROM public.wallet_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR v_w.status <> 'pending' THEN RETURN; END IF;

  UPDATE public.wallet_withdrawals
  SET status = p_action, note = COALESCE(NULLIF(TRIM(p_note), ''), note), reviewed_at = NOW()
  WHERE id = p_withdrawal_id;

  IF p_action = 'rejected' THEN
    PERFORM set_config('app.trusted_wallet_tx', '1', true);
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_w.amount)::NUMERIC, 2), updated_at = NOW()
    WHERE id = v_w.user_id;

    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (v_w.user_id, v_w.amount, 'withdrawal_refund', COALESCE(NULLIF(TRIM(p_note), ''), 'Saque Pix recusado · Saldo estornado'));
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Atualiza RPCs de saldo existentes para respeitar a trava segura (app.trusted_wallet_tx)
CREATE OR REPLACE FUNCTION public.debit_own_wallet_for_ride(
  p_ride_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT 'Pagamento de corrida com Saldo 66 Pay'
)
RETURNS VOID AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_balance NUMERIC(10,2);
  v_debit NUMERIC(10,2) := ROUND(GREATEST(0, COALESCE(p_amount, 0))::NUMERIC, 2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_debit <= 0 THEN RETURN; END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_balance FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_balance < v_debit THEN RAISE EXCEPTION 'Saldo insuficiente na carteira.'; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.profiles SET wallet_balance = ROUND((wallet_balance - v_debit)::NUMERIC, 2), updated_at = NOW() WHERE id = v_uid;
  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_uid, p_ride_id, -v_debit, 'ride_debit', p_description);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.pay_completed_ride_with_wallet(p_ride_id UUID)
RETURNS VOID AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_bal NUMERIC(10,2);
  v_fare NUMERIC(10,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corrida não encontrada.'; END IF;
  IF v_ride.passenger_id <> v_uid AND NOT public.is_admin() THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF v_ride.payment_status IN ('paid_wallet', 'paid_pix', 'paid_cash', 'admin_settled') THEN RAISE EXCEPTION 'Corrida já quitada.'; END IF;

  v_fare := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  SELECT COALESCE(wallet_balance, 0) INTO v_bal FROM public.profiles WHERE id = v_ride.passenger_id FOR UPDATE;
  IF v_bal < v_fare THEN RAISE EXCEPTION 'Saldo insuficiente.'; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.profiles SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_fare)::NUMERIC, 2), updated_at = NOW() WHERE id = v_ride.passenger_id;
  UPDATE public.rides SET payment_method = 'wallet', payment_status = 'paid_wallet', final_fare = v_fare WHERE id = p_ride_id;
  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.passenger_id, p_ride_id, -v_fare, 'ride_debit', 'Pagamento pós-corrida 66 Pay #' || RIGHT(p_ride_id::TEXT, 4));

  IF v_ride.driver_id IS NOT NULL THEN
    PERFORM public.credit_driver_wallet_for_ride(p_ride_id, 'Corrida Saldo 66 Pay #' || RIGHT(p_ride_id::TEXT, 4), 'ride_earning');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_approve_wallet_deposit(p_deposit_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_dep public.wallet_deposits%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Restrito ao Admin.'; END IF;
  SELECT * INTO v_dep FROM public.wallet_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_dep.status = 'approved' THEN RETURN; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.wallet_deposits SET status = 'approved', note = COALESCE(NULLIF(TRIM(p_note), ''), note), reviewed_at = NOW() WHERE id = p_deposit_id;
  UPDATE public.profiles SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_dep.amount)::NUMERIC, 2), updated_at = NOW() WHERE id = v_dep.user_id;
  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_dep.user_id, NULL, v_dep.amount, 'deposit', COALESCE(NULLIF(TRIM(p_note), ''), 'Depósito Pix confirmado pelo Admin'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_adjust_user_wallet(p_user_id UUID, p_new_balance NUMERIC, p_description TEXT DEFAULT 'Ajuste Admin')
RETURNS VOID AS $$
DECLARE
  v_current NUMERIC(10,2);
  v_target NUMERIC(10,2) := ROUND(GREATEST(0, COALESCE(p_new_balance, 0))::NUMERIC, 2);
  v_delta NUMERIC(10,2);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Restrito ao Admin.'; END IF;
  SELECT COALESCE(wallet_balance, 0) INTO v_current FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;

  v_delta := ROUND((v_target - v_current)::NUMERIC, 2);
  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.profiles SET wallet_balance = v_target, updated_at = NOW() WHERE id = p_user_id;
  IF v_delta <> 0 THEN
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (p_user_id, NULL, v_delta, 'admin_adjustment', COALESCE(NULLIF(TRIM(p_description), ''), 'Ajuste de saldo pelo Administrador'));
  END IF;
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
  IF NOT FOUND THEN RETURN; END IF;

  IF auth.uid() IS DISTINCT FROM v_ride.passenger_id
     AND auth.uid() IS DISTINCT FROM v_ride.driver_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para estornar esta corrida.';
  END IF;

  IF v_ride.payment_method <> 'wallet' OR v_ride.payment_status <> 'paid_wallet' THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.passenger_id AND type = 'ride_refund'
  ) INTO v_already_refunded;
  IF v_already_refunded THEN RETURN; END IF;

  v_refund := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_refund <= 0 THEN RETURN; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);
  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_refund)::NUMERIC, 2), updated_at = NOW()
  WHERE id = v_ride.passenger_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.passenger_id, p_ride_id, v_refund, 'ride_refund', 'Estorno automático de corrida cancelada');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.anonymize_own_account()
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.driver_profiles
  SET is_online = FALSE, cnh_url = 'REDACTED', crlv_url = 'REDACTED',
      vehicle_plate = 'REDACTED', pix_key = 'REDACTED',
      current_lat = NULL, current_lng = NULL, updated_at = NOW()
  WHERE user_id = auth.uid();

  UPDATE public.profiles
  SET full_name = 'Usuário Anonimizado', phone = '00000000000',
      email = CONCAT('deleted_', id, '@anon.local'), cpf = '000.000.000-00',
      avatar_url = NULL, home_address = NULL, work_address = NULL,
      favorites = '[]'::jsonb, status = 'suspended', is_admin = FALSE,
      is_anonymized = TRUE, deleted_at = NOW(), updated_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

-- 7. Central de Notificações (Admin -> Clientes / Motoristas / Individual) & Cupons de Desconto
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

-- 8. Atualização Incremental 66pay (Chave 66pay, Saldo Reservado, Comprovante Oficial e Transferência Atômica na Corrida)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pay66_key TEXT,
  ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_pay66_key_unique
  ON public.profiles (LOWER(pay66_key))
  WHERE pay66_key IS NOT NULL;

UPDATE public.profiles
SET pay66_key = '66-' || UPPER(SUBSTRING(REPLACE(id::TEXT, '-', ''), 1, 8))
WHERE pay66_key IS NULL;

CREATE OR REPLACE FUNCTION public.assign_default_pay66_key()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pay66_key IS NULL OR BTRIM(NEW.pay66_key) = '' THEN
    NEW.pay66_key := '66-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_assign_default_pay66_key ON public.profiles;
CREATE TRIGGER trg_assign_default_pay66_key
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_default_pay66_key();

-- Atualiza trigger de proteção para também blindar reserved_balance
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_trusted TEXT;
  v_has_jwt BOOLEAN;
BEGIN
  v_trusted := current_setting('app.trusted_wallet_tx', true);
  v_has_jwt := auth.uid() IS NOT NULL;

  IF NOT v_has_jwt OR v_trusted = '1' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Permissão negada: privilégio is_admin restrito ao banco.';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Permissão negada: não é permitido alterar o próprio cargo.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Permissão negada: alteração de status restrita ao Admin.';
    END IF;
    IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
      RAISE EXCEPTION 'Permissão negada: saldo só pode ser movimentado via RPC 66pay.';
    END IF;
    IF NEW.reserved_balance IS DISTINCT FROM OLD.reserved_balance THEN
      RAISE EXCEPTION 'Permissão negada: saldo reservado controlado apenas pelo servidor.';
    END IF;
    IF NEW.pending_debt_amount IS DISTINCT FROM OLD.pending_debt_amount THEN
      RAISE EXCEPTION 'Permissão negada: débitos controlados apenas pelo servidor.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- View user_wallets compatível com o saldo oficial da tabela profiles
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

-- Permitir payment_status = 'paid' na tabela rides (sem apagar dados existentes)
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

-- Atualizar credit_driver_wallet_for_ride para aceitar também payment_status = 'paid'
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
  IF NOT FOUND OR v_ride.driver_id IS NULL THEN RETURN; END IF;

  IF auth.uid() IS DISTINCT FROM v_ride.driver_id
     AND auth.uid() IS DISTINCT FROM v_ride.passenger_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF v_ride.payment_status NOT IN ('paid', 'paid_pix', 'paid_wallet', 'admin_settled') THEN RETURN; END IF;

  v_tx_type := CASE WHEN p_type IN ('ride_earning', 'dispute_settlement') THEN p_type ELSE 'ride_earning' END;
  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.driver_id AND type IN ('ride_earning', 'dispute_settlement')
  ) INTO v_already;
  IF v_already THEN RETURN; END IF;

  v_amount := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_amount <= 0 THEN RETURN; END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2), updated_at = NOW()
  WHERE id = v_ride.driver_id;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
  VALUES (v_ride.driver_id, p_ride_id, v_amount, v_tx_type, COALESCE(NULLIF(TRIM(p_description), ''), 'Ganho de corrida #' || RIGHT(p_ride_id::TEXT, 4)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Localizar motorista/entregador por Chave 66pay, QR Code 66PAY|..., ID, e-mail, telefone ou Pix
CREATE OR REPLACE FUNCTION public.lookup_66pay_driver(p_key TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  pay66_key TEXT,
  avatar_url TEXT,
  phone TEXT,
  vehicle_model TEXT,
  vehicle_plate TEXT
) AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_raw TEXT := TRIM(COALESCE(p_key, ''));
  v_token TEXT;
  v_digits TEXT;
  v_parts TEXT[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF v_raw = '' THEN
    RETURN;
  END IF;

  -- Suporta payload QR "BOREALPAY|<uuid>|..." e legado "66PAY|<uuid>|..."
  IF UPPER(v_raw) LIKE '66PAY|%' OR UPPER(v_raw) LIKE 'BOREALPAY|%' THEN
    v_parts := string_to_array(v_raw, '|');
    v_token := COALESCE(NULLIF(TRIM(v_parts[2]), ''), NULLIF(TRIM(v_parts[3]), ''), v_raw);
  ELSE
    v_token := v_raw;
  END IF;

  v_digits := regexp_replace(v_token, '\D', '', 'g');

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    COALESCE(p.pay66_key, '66-' || UPPER(SUBSTRING(REPLACE(p.id::TEXT, '-', ''), 1, 8))) AS pay66_key,
    p.avatar_url,
    p.phone,
    dp.vehicle_model,
    dp.vehicle_plate
  FROM public.profiles p
  LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
  WHERE p.role = 'driver'
    AND COALESCE(p.is_anonymized, FALSE) = FALSE
    AND (
      p.id::TEXT = v_token
      OR LOWER(COALESCE(p.pay66_key, '')) = LOWER(v_token)
      OR LOWER(COALESCE(p.email, '')) = LOWER(v_token)
      OR LOWER(COALESCE(dp.pix_key, '')) = LOWER(v_token)
      OR (LENGTH(v_digits) >= 8 AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') = v_digits)
    )
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Reservar saldo 66pay ao solicitar a corrida (impede saldo negativo até confirmação no destino)
CREATE OR REPLACE FUNCTION public.reserve_66pay_for_ride(
  p_ride_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_amount NUMERIC(10,2) := ROUND(GREATEST(0, COALESCE(p_amount, 0))::NUMERIC, 2);
  v_bal NUMERIC(10,2);
  v_res NUMERIC(10,2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;
  IF v_ride.passenger_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'reserved', 0);
  END IF;

  SELECT COALESCE(wallet_balance, 0), COALESCE(reserved_balance, 0)
  INTO v_bal, v_res
  FROM public.profiles
  WHERE id = v_ride.passenger_id
  FOR UPDATE;

  IF v_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo 66pay insuficiente para solicitar esta corrida.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((v_bal - v_amount)::NUMERIC, 2),
      reserved_balance = ROUND((v_res + v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_ride.passenger_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reserved', v_amount,
    'new_balance', ROUND((v_bal - v_amount)::NUMERIC, 2),
    'new_reserved', ROUND((v_res + v_amount)::NUMERIC, 2)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Transferência atômica 66pay no destino (QR Code / Chave 66pay do Motorista -> Saldo do Motorista + Comprovante)
CREATE OR REPLACE FUNCTION public.process_66pay_ride_transfer(
  p_ride_id UUID,
  p_driver_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_pax public.profiles%ROWTYPE;
  v_drv public.profiles%ROWTYPE;
  v_fare NUMERIC(10,2);
  v_reserved_used NUMERIC(10,2) := 0;
  v_extra_debit NUMERIC(10,2) := 0;
  v_driver_key_clean TEXT := TRIM(COALESCE(p_driver_key, ''));
  v_resolved_driver_id UUID;
  v_drv_pay66_key TEXT;
  v_pax_pay66_key TEXT;
  v_auth_code TEXT;
  v_pax_tx_id UUID;
  v_drv_tx_id UUID;
  v_ts TIMESTAMPTZ := NOW();
  v_already_debited BOOLEAN := FALSE;
  v_already_credited BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;

  IF v_ride.passenger_id <> v_uid AND v_ride.driver_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissão para processar pagamento desta corrida.';
  END IF;

  IF v_ride.driver_id IS NULL THEN
    RAISE EXCEPTION 'Motorista ainda não vinculado a esta corrida.';
  END IF;

  IF v_driver_key_clean <> '' THEN
    SELECT l.id INTO v_resolved_driver_id FROM public.lookup_66pay_driver(v_driver_key_clean) l LIMIT 1;
    IF v_resolved_driver_id IS NULL OR v_resolved_driver_id <> v_ride.driver_id THEN
      RAISE EXCEPTION 'QR Code / Chave 66pay não corresponde ao motorista desta corrida.';
    END IF;
  END IF;

  -- Trava determinística em profiles (ordem por UUID para evitar deadlock)
  IF v_ride.passenger_id < v_ride.driver_id THEN
    PERFORM 1 FROM public.profiles WHERE id IN (v_ride.passenger_id, v_ride.driver_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles WHERE id IN (v_ride.driver_id, v_ride.passenger_id) ORDER BY id FOR UPDATE;
  END IF;

  SELECT * INTO v_pax FROM public.profiles WHERE id = v_ride.passenger_id;
  SELECT * INTO v_drv FROM public.profiles WHERE id = v_ride.driver_id;

  v_pax_pay66_key := COALESCE(v_pax.pay66_key, '66-' || UPPER(SUBSTRING(REPLACE(v_pax.id::TEXT, '-', ''), 1, 8)));
  v_drv_pay66_key := COALESCE(v_drv.pay66_key, '66-' || UPPER(SUBSTRING(REPLACE(v_drv.id::TEXT, '-', ''), 1, 8)));
  v_fare := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);

  IF v_fare <= 0 THEN
    RAISE EXCEPTION 'Valor da corrida inválido.';
  END IF;

  -- Idempotência caso a corrida já tenha sido quitada anteriormente
  IF v_ride.payment_status IN ('paid', 'paid_wallet', 'paid_pix', 'admin_settled') THEN
    SELECT id, auth_code, created_at INTO v_pax_tx_id, v_auth_code, v_ts
    FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.passenger_id
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_paid', TRUE,
      'ride_id', p_ride_id,
      'amount', v_fare,
      'auth_code', COALESCE(v_auth_code, UPPER(REPLACE(gen_random_uuid()::TEXT, '-', ''))),
      'tx_id', COALESCE(v_pax_tx_id, p_ride_id),
      'created_at', COALESCE(v_ts, NOW()),
      'sender_name', v_pax.full_name,
      'sender_key', v_pax_pay66_key,
      'recipient_name', v_drv.full_name,
      'recipient_key', v_drv_pay66_key,
      'new_passenger_balance', COALESCE(v_pax.wallet_balance, 0)
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.passenger_id AND type = 'ride_debit'
  ) INTO v_already_debited;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_ride.driver_id AND type IN ('ride_earning', 'dispute_settlement')
  ) INTO v_already_credited;

  IF NOT v_already_debited THEN
    v_reserved_used := LEAST(COALESCE(v_pax.reserved_balance, 0), v_fare);
    v_extra_debit := ROUND((v_fare - v_reserved_used)::NUMERIC, 2);

    IF COALESCE(v_pax.wallet_balance, 0) < v_extra_debit THEN
      RAISE EXCEPTION 'Saldo insuficiente na carteira 66pay para concluir o pagamento.';
    END IF;
  END IF;

  v_auth_code := '66PAY-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 16));

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  IF NOT v_already_debited THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_extra_debit)::NUMERIC, 2),
        reserved_balance = ROUND(GREATEST(0, COALESCE(reserved_balance, 0) - v_reserved_used)::NUMERIC, 2),
        pending_debt_amount = CASE
          WHEN COALESCE(v_ride.pending_debt_included, 0) > 0
            THEN ROUND(GREATEST(0, COALESCE(pending_debt_amount, 0) - v_ride.pending_debt_included)::NUMERIC, 2)
          ELSE pending_debt_amount
        END,
        pending_debt_note = CASE
          WHEN COALESCE(v_ride.pending_debt_included, 0) > 0 AND ROUND(GREATEST(0, COALESCE(pending_debt_amount, 0) - v_ride.pending_debt_included)::NUMERIC, 2) = 0
            THEN NULL
          ELSE pending_debt_note
        END,
        updated_at = NOW()
    WHERE id = v_ride.passenger_id;

    INSERT INTO public.wallet_transactions (
      user_id, ride_id, amount, type, description, auth_code, sender_name, recipient_name, recipient_key
    )
    VALUES (
      v_ride.passenger_id,
      p_ride_id,
      -v_fare,
      'ride_debit',
      'Pagamento 66pay para ' || v_drv.full_name || ' · Corrida #' || RIGHT(p_ride_id::TEXT, 4),
      v_auth_code,
      v_pax.full_name,
      v_drv.full_name,
      v_drv_pay66_key
    )
    RETURNING id, created_at INTO v_pax_tx_id, v_ts;
  END IF;

  IF NOT v_already_credited THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_fare)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_ride.driver_id;

    INSERT INTO public.wallet_transactions (
      user_id, ride_id, amount, type, description, auth_code, sender_name, recipient_name, recipient_key
    )
    VALUES (
      v_ride.driver_id,
      p_ride_id,
      v_fare,
      'ride_earning',
      'Recebido via 66pay de ' || v_pax.full_name || ' · Corrida #' || RIGHT(p_ride_id::TEXT, 4),
      v_auth_code,
      v_pax.full_name,
      v_drv.full_name,
      v_drv_pay66_key
    )
    RETURNING id INTO v_drv_tx_id;
  END IF;

  UPDATE public.rides
  SET payment_method = 'wallet',
      payment_status = 'paid',
      final_fare = v_fare
  WHERE id = p_ride_id;

  IF to_regclass('public.app_notifications') IS NOT NULL THEN
    INSERT INTO public.app_notifications (
      title, message, category, target_scope, target_user_id, action_tab, metadata, created_by
    )
    VALUES (
      'Pagamento 66pay recebido',
      v_pax.full_name || ' transferiu R$ ' || REPLACE(TO_CHAR(v_fare, 'FM999999990.00'), '.', ',') || ' pela corrida #' || RIGHT(p_ride_id::TEXT, 4) || '.',
      'payment',
      'user',
      v_ride.driver_id,
      'wallet',
      jsonb_build_object(
        'source', 'ride_66pay',
        'ride_id', p_ride_id,
        'amount', v_fare,
        'auth_code', v_auth_code,
        'sender_name', v_pax.full_name,
        'recipient_name', v_drv.full_name,
        'recipient_key', v_drv_pay66_key
      ),
      v_pax.id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'already_paid', FALSE,
    'ride_id', p_ride_id,
    'amount', v_fare,
    'auth_code', v_auth_code,
    'tx_id', COALESCE(v_pax_tx_id, v_drv_tx_id, p_ride_id),
    'created_at', v_ts,
    'sender_name', v_pax.full_name,
    'sender_key', v_pax_pay66_key,
    'recipient_name', v_drv.full_name,
    'recipient_key', v_drv_pay66_key,
    'new_passenger_balance', ROUND((COALESCE(v_pax.wallet_balance, 0) - v_extra_debit)::NUMERIC, 2)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Atualiza cancel_ride_with_fee para liberar saldo reservado 66pay menos eventual taxa
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
  v_pax_res NUMERIC(10,2) := 0;
  v_release_res NUMERIC(10,2) := 0;
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

  SELECT COALESCE(wallet_balance, 0), COALESCE(reserved_balance, 0)
  INTO v_pax_bal, v_pax_res
  FROM public.profiles
  WHERE id = v_ride.passenger_id
  FOR UPDATE;

  IF v_ride.payment_method = 'wallet' AND v_ride.payment_status IN ('paid_wallet', 'paid') THEN
    v_refund := GREATEST(0, ROUND((v_fare - v_fee)::NUMERIC, 2));
    IF v_refund > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((v_pax_bal + v_refund)::NUMERIC, 2), updated_at = NOW()
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
  ELSIF v_ride.payment_method = 'wallet' AND v_pax_res > 0 THEN
    v_release_res := LEAST(v_pax_res, v_fare);
    v_refund := GREATEST(0, ROUND((v_release_res - v_fee)::NUMERIC, 2));

    UPDATE public.profiles
    SET reserved_balance = ROUND(GREATEST(0, v_pax_res - v_release_res)::NUMERIC, 2),
        wallet_balance = ROUND((v_pax_bal + v_refund)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_ride.passenger_id;

    IF v_fee > 0 THEN
      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (v_ride.passenger_id, p_ride_id, -LEAST(v_release_res, v_fee), 'ride_debit', 'Taxa de cancelamento #' || RIGHT(p_ride_id::TEXT, 4));
    END IF;
  ELSIF v_fee > 0 THEN
    v_debit_now := LEAST(v_pax_bal, v_fee);
    v_debt_add := ROUND((v_fee - v_debit_now)::NUMERIC, 2);

    IF v_debit_now > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((v_pax_bal - v_debit_now)::NUMERIC, 2), updated_at = NOW()
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

-- 9. Horário Automático de Depósitos Pix, Registro de Chave 66pay pelo Usuário & Transferência/Busca por Chave/QR 66pay
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS deposit_window_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deposit_start_time TEXT NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS deposit_end_time TEXT NOT NULL DEFAULT '23:30';

UPDATE public.platform_settings
SET
  deposit_window_enabled = COALESCE(deposit_window_enabled, TRUE),
  deposit_start_time = COALESCE(NULLIF(BTRIM(deposit_start_time), ''), '07:00'),
  deposit_end_time = COALESCE(NULLIF(BTRIM(deposit_end_time), ''), '23:30')
WHERE id = 1;

-- Permite que qualquer usuário autenticado (passageiro ou motorista) cadastre/altere sua Chave 66pay exclusiva (sem colisão)
CREATE OR REPLACE FUNCTION public.update_my_pay66_key(p_new_key TEXT)
RETURNS TEXT AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clean TEXT := BTRIM(COALESCE(p_new_key, ''));
  v_conflict UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_clean := regexp_replace(v_clean, '\s+', '', 'g');
  IF LENGTH(v_clean) < 4 OR LENGTH(v_clean) > 64 THEN
    RAISE EXCEPTION 'Informe uma Chave 66pay válida entre 4 e 64 caracteres (e-mail, telefone, CPF ou código 66-...).';
  END IF;

  SELECT id INTO v_conflict
  FROM public.profiles
  WHERE LOWER(COALESCE(pay66_key, '')) = LOWER(v_clean)
    AND id <> v_uid
    AND COALESCE(is_anonymized, FALSE) = FALSE
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Esta Chave 66pay já está cadastrada por outro usuário. Escolha outra.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET pay66_key = v_clean,
      updated_at = NOW()
  WHERE id = v_uid
    AND COALESCE(is_anonymized, FALSE) = FALSE;

  RETURN v_clean;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Atualiza lookup_wallet_recipient para buscar também por Chave 66pay e QR Code 66PAY|...
DROP FUNCTION IF EXISTS public.lookup_wallet_recipient(TEXT);
CREATE OR REPLACE FUNCTION public.lookup_wallet_recipient(p_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  avatar_url TEXT,
  pay66_key TEXT
) AS $$
DECLARE
  v_uid UUID;
  v_raw TEXT;
  v_clean TEXT;
  v_digits TEXT;
  v_parts TEXT[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_raw := TRIM(COALESCE(p_query, ''));
  IF LENGTH(v_raw) < 3 THEN
    RETURN;
  END IF;

  IF UPPER(v_raw) LIKE '66PAY|%' OR UPPER(v_raw) LIKE 'BOREALPAY|%' THEN
    v_parts := string_to_array(v_raw, '|');
    v_clean := COALESCE(NULLIF(TRIM(v_parts[2]), ''), NULLIF(TRIM(v_parts[3]), ''), v_raw);
  ELSE
    v_clean := v_raw;
  END IF;

  v_digits := regexp_replace(v_clean, '\D', '', 'g');

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.role,
    p.avatar_url,
    COALESCE(p.pay66_key, '66-' || UPPER(SUBSTRING(REPLACE(p.id::TEXT, '-', ''), 1, 8))) AS pay66_key
  FROM public.profiles p
  WHERE p.id <> v_uid
    AND COALESCE(p.is_anonymized, FALSE) = FALSE
    AND p.status = 'active'
    AND (
      p.id::TEXT = v_clean
      OR LOWER(COALESCE(p.pay66_key, '')) = LOWER(v_clean)
      OR LOWER(COALESCE(p.pay66_key, '')) LIKE '%' || LOWER(v_clean) || '%'
      OR LOWER(p.email) = LOWER(v_clean)
      OR LOWER(p.email) LIKE '%' || LOWER(v_clean) || '%'
      OR (LENGTH(v_digits) >= 8 AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
      OR LOWER(p.full_name) LIKE '%' || LOWER(v_clean) || '%'
    )
  ORDER BY
    CASE
      WHEN p.id::TEXT = v_clean THEN 0
      WHEN LOWER(COALESCE(p.pay66_key, '')) = LOWER(v_clean) THEN 1
      WHEN LOWER(p.email) = LOWER(v_clean) THEN 2
      ELSE 3
    END,
    p.full_name ASC
  LIMIT 6;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Atualiza transferir_saldo_66 para reconhecer também QR Code 66PAY|... e Chave 66pay cadastrada
CREATE OR REPLACE FUNCTION public.transferir_saldo_66(
  p_destinatario TEXT,
  p_valor NUMERIC,
  p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_from UUID;
  v_to UUID;
  v_raw TEXT;
  v_clean TEXT;
  v_digits TEXT;
  v_parts TEXT[];
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

  v_raw := TRIM(COALESCE(p_destinatario, ''));
  v_amount := ROUND(COALESCE(p_valor, 0)::NUMERIC, 2);
  IF v_raw = '' OR v_amount < 1 THEN
    RAISE EXCEPTION 'Informe destinatário válido e valor mínimo de R$ 1,00.';
  END IF;

  IF UPPER(v_raw) LIKE '66PAY|%' OR UPPER(v_raw) LIKE 'BOREALPAY|%' THEN
    v_parts := string_to_array(v_raw, '|');
    v_clean := COALESCE(NULLIF(TRIM(v_parts[2]), ''), NULLIF(TRIM(v_parts[3]), ''), v_raw);
  ELSE
    v_clean := v_raw;
  END IF;

  BEGIN
    v_to := v_clean::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_digits := regexp_replace(v_clean, '\D', '', 'g');
    SELECT id INTO v_to
    FROM public.profiles
    WHERE COALESCE(is_anonymized, FALSE) = FALSE
      AND status = 'active'
      AND (
        LOWER(COALESCE(pay66_key, '')) = LOWER(v_clean)
        OR LOWER(email) = LOWER(v_clean)
        OR (LENGTH(v_digits) >= 10 AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_digits)
      )
    LIMIT 1;
  END;

  IF v_to IS NULL OR v_to = v_from THEN
    RAISE EXCEPTION 'Destinatário não encontrado ou inválido.';
  END IF;

  IF v_from < v_to THEN
    PERFORM 1 FROM public.profiles WHERE id IN (v_from, v_to) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles WHERE id IN (v_to, v_from) ORDER BY id FOR UPDATE;
  END IF;

  SELECT full_name, COALESCE(wallet_balance, 0), status
  INTO v_from_name, v_from_bal, v_from_status
  FROM public.profiles WHERE id = v_from;

  IF v_from_status <> 'active' THEN
    RAISE EXCEPTION 'Conta inativa.';
  END IF;

  SELECT full_name INTO v_to_name
  FROM public.profiles
  WHERE id = v_to AND COALESCE(is_anonymized, FALSE) = FALSE AND status = 'active';

  IF v_to_name IS NULL THEN
    RAISE EXCEPTION 'Destinatário indisponível.';
  END IF;

  IF v_from_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira 66 Pay.';
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2), updated_at = NOW()
  WHERE id = v_from;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2), updated_at = NOW()
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

-- 10. Foto/nome imediato do passageiro na chamada do motorista + Nova política de cancelamento (20s grátis, R$ 3,00 após 20s, 100% quando já chegou)
DROP POLICY IF EXISTS "Usuário vê próprio perfil ou participante em corrida ativa" ON public.profiles;
CREATE POLICY "Usuário vê próprio perfil ou participante em corrida ativa"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR (
      public.is_online_approved_driver()
      AND EXISTS (
        SELECT 1 FROM public.rides r
        WHERE r.passenger_id = profiles.id
          AND r.status = 'searching'
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status IN ('accepted', 'arrived', 'in_progress')
        AND (
          (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
          OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.get_ride_passenger_preview(p_ride_id UUID)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  avatar_url TEXT,
  rating_avg NUMERIC,
  rating_count INTEGER,
  status TEXT
) AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.rating_avg,
    p.rating_count,
    p.status
  FROM public.rides r
  JOIN public.profiles p ON p.id = r.passenger_id
  WHERE r.id = p_ride_id
    AND (
      r.passenger_id = auth.uid()
      OR r.driver_id = auth.uid()
      OR public.is_admin()
      OR (r.status = 'searching' AND public.is_online_approved_driver())
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

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
  v_fee NUMERIC(10,2) := 0;
  v_refund NUMERIC(10,2) := 0;
  v_pax_bal NUMERIC(10,2) := 0;
  v_pax_res NUMERIC(10,2) := 0;
  v_release_res NUMERIC(10,2) := 0;
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

  IF v_uid = v_ride.passenger_id AND v_ride.driver_id IS NOT NULL THEN
    IF v_ride.status = 'arrived' THEN
      v_fee := v_fare;
    ELSIF v_ride.accepted_at IS NOT NULL THEN
      v_elapsed_sec := EXTRACT(EPOCH FROM (NOW() - v_ride.accepted_at));
      IF v_elapsed_sec > 20 THEN
        v_fee := LEAST(v_fare, 3.00);
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_wallet_tx', '1', true);

  UPDATE public.rides
  SET status = 'cancelled'
  WHERE id = p_ride_id;

  SELECT COALESCE(wallet_balance, 0), COALESCE(reserved_balance, 0)
  INTO v_pax_bal, v_pax_res
  FROM public.profiles
  WHERE id = v_ride.passenger_id
  FOR UPDATE;

  IF v_ride.payment_method = 'wallet' AND v_ride.payment_status IN ('paid_wallet', 'paid') THEN
    v_refund := GREATEST(0, ROUND((v_fare - v_fee)::NUMERIC, 2));
    IF v_refund > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((v_pax_bal + v_refund)::NUMERIC, 2), updated_at = NOW()
      WHERE id = v_ride.passenger_id;

      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (
        v_ride.passenger_id,
        p_ride_id,
        v_refund,
        'ride_refund',
        CASE WHEN v_fee > 0
          THEN 'Estorno após taxa de cancelamento #' || RIGHT(p_ride_id::TEXT, 4)
          ELSE 'Estorno automático de corrida cancelada #' || RIGHT(p_ride_id::TEXT, 4)
        END
      );
    END IF;
  ELSIF v_ride.payment_method = 'wallet' AND v_pax_res > 0 THEN
    v_release_res := LEAST(v_pax_res, v_fare);
    v_refund := GREATEST(0, ROUND((v_release_res - v_fee)::NUMERIC, 2));

    UPDATE public.profiles
    SET reserved_balance = ROUND(GREATEST(0, v_pax_res - v_release_res)::NUMERIC, 2),
        wallet_balance = ROUND((v_pax_bal + v_refund)::NUMERIC, 2),
        updated_at = NOW()
    WHERE id = v_ride.passenger_id;

    IF v_fee > 0 THEN
      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (v_ride.passenger_id, p_ride_id, -LEAST(v_release_res, v_fee), 'ride_debit', 'Taxa de cancelamento #' || RIGHT(p_ride_id::TEXT, 4));
    END IF;
  ELSIF v_fee > 0 THEN
    v_debit_now := LEAST(v_pax_bal, v_fee);
    v_debt_add := ROUND((v_fee - v_debit_now)::NUMERIC, 2);

    IF v_debit_now > 0 THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((v_pax_bal - v_debit_now)::NUMERIC, 2), updated_at = NOW()
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

-- ============================================================================
-- 10. Multi-Veículos por Motorista & Compatibilidade BorealPay (BOREAL- / BOREALPAY|)
-- ============================================================================
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS vehicles JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_vehicle_id TEXT;

UPDATE public.driver_profiles
SET vehicles = jsonb_build_array(
  jsonb_build_object(
    'id', 'veh-' || SUBSTRING(REPLACE(user_id::TEXT, '-', ''), 1, 8),
    'vehicle_type', COALESCE(vehicle_type, 'car'),
    'vehicle_model', COALESCE(NULLIF(TRIM(vehicle_model), ''), CASE WHEN vehicle_type = 'moto' THEN 'Moto Parceira' WHEN vehicle_type = 'delivery' THEN 'Entrega Parceira' ELSE 'Carro Parceiro' END),
    'vehicle_plate', COALESCE(vehicle_plate, ''),
    'vehicle_color', COALESCE(vehicle_color, 'Prata'),
    'created_at', COALESCE(updated_at, NOW())
  )
),
active_vehicle_id = COALESCE(active_vehicle_id, 'veh-' || SUBSTRING(REPLACE(user_id::TEXT, '-', ''), 1, 8))
WHERE jsonb_array_length(COALESCE(vehicles, '[]'::jsonb)) = 0;

UPDATE public.profiles
SET pay66_key = 'BOREAL-' || UPPER(SUBSTRING(REPLACE(id::TEXT, '-', ''), 1, 8))
WHERE pay66_key IS NULL OR TRIM(pay66_key) = '';

-- ============================================================================
-- 11. Upload Direto de APK & Identidade Separada (PWA vs APK)
-- ============================================================================
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pwa_app_name TEXT,
  ADD COLUMN IF NOT EXISTS pwa_icon_url TEXT,
  ADD COLUMN IF NOT EXISTS apk_app_name TEXT,
  ADD COLUMN IF NOT EXISTS apk_icon_url TEXT;

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES ('public-assets', 'public-assets', TRUE, NULL)
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      allowed_mime_types = NULL;

DROP POLICY IF EXISTS "Public read public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Auth update public-assets" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete public-assets" ON storage.objects;

CREATE POLICY "Public read public-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'public-assets');

CREATE POLICY "Auth upload public-assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'public-assets');

CREATE POLICY "Auth update public-assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'public-assets');

CREATE POLICY "Admin delete public-assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'public-assets' AND public.is_admin());

-- ============================================================================
-- 12. Go Driver v1.2.5 — Melissa Plantão Noturno, Tema Global, Pix e Fila Facial
-- ============================================================================
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS theme_preset TEXT DEFAULT 'electric_blue',
  ADD COLUMN IF NOT EXISTS assistant_voice_default TEXT DEFAULT 'melissa-maps',
  ADD COLUMN IF NOT EXISTS night_duty_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS night_duty_start TEXT NOT NULL DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS night_duty_end TEXT NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS night_duty_auto_approve BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.platform_settings
SET
  theme_preset = COALESCE(NULLIF(TRIM(theme_preset), ''), 'electric_blue'),
  assistant_voice_default = COALESCE(NULLIF(TRIM(assistant_voice_default), ''), 'melissa-maps'),
  night_duty_start = COALESCE(NULLIF(TRIM(night_duty_start), ''), '00:00'),
  night_duty_end = COALESCE(NULLIF(TRIM(night_duty_end), ''), '07:00')
WHERE id = 1;

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS pix_key_type TEXT DEFAULT 'cpf_cnpj';

ALTER TABLE public.wallet_withdrawals
  ADD COLUMN IF NOT EXISTS pix_key_type TEXT DEFAULT 'cpf_cnpj';

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT,
  ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS public.driver_facial_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  selfie_data_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driver_facial_status_created
  ON public.driver_facial_verifications (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_driver_facial_driver_created
  ON public.driver_facial_verifications (driver_id, created_at DESC);

ALTER TABLE public.driver_facial_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Motorista e Admin leem fila facial" ON public.driver_facial_verifications;
DROP POLICY IF EXISTS "Motorista aprovado envia facial ao vivo" ON public.driver_facial_verifications;
DROP POLICY IF EXISTS "Somente Admin revisa fila facial" ON public.driver_facial_verifications;

CREATE POLICY "Motorista e Admin leem fila facial"
  ON public.driver_facial_verifications FOR SELECT
  USING (driver_id = auth.uid() OR public.is_admin());

CREATE POLICY "Motorista aprovado envia facial ao vivo"
  ON public.driver_facial_verifications FOR INSERT
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'driver' AND p.status = 'active' AND p.is_anonymized = FALSE
    )
  );

CREATE POLICY "Somente Admin revisa fila facial"
  ON public.driver_facial_verifications FOR UPDATE
  USING (public.is_admin());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'driver_facial_verifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_facial_verifications;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_driver_facial_verification(p_selfie_data_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_status TEXT;
  v_id UUID;
  v_pos INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT role, status INTO v_role, v_status
  FROM public.profiles
  WHERE id = v_uid AND is_anonymized = FALSE;

  IF v_role <> 'driver' OR v_status <> 'active' THEN
    RAISE EXCEPTION 'Conta de motorista não está ativa para verificação ao vivo';
  END IF;

  IF p_selfie_data_url IS NULL OR LENGTH(TRIM(p_selfie_data_url)) < 20 THEN
    RAISE EXCEPTION 'Foto facial inválida';
  END IF;

  UPDATE public.driver_facial_verifications
  SET status = 'rejected',
      rejection_reason = 'Substituída por nova verificação ao vivo',
      reviewed_at = NOW()
  WHERE driver_id = v_uid AND status = 'pending';

  INSERT INTO public.driver_facial_verifications (driver_id, selfie_data_url, status)
  VALUES (v_uid, p_selfie_data_url, 'pending')
  RETURNING id INTO v_id;

  SELECT COUNT(*)::INTEGER INTO v_pos
  FROM public.driver_facial_verifications
  WHERE status = 'pending' AND created_at <= (
    SELECT created_at FROM public.driver_facial_verifications WHERE id = v_id
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'id', v_id,
    'status', 'pending',
    'queue_position', COALESCE(v_pos, 1)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_driver_facial(
  p_verification_id UUID,
  p_approve BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_driver_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente administrador';
  END IF;

  UPDATE public.driver_facial_verifications
  SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = auth.uid(),
    rejection_reason = CASE WHEN p_approve THEN NULL ELSE NULLIF(TRIM(COALESCE(p_reason, '')), '') END,
    reviewed_at = NOW()
  WHERE id = p_verification_id
  RETURNING driver_id INTO v_driver_id;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Verificação facial não encontrada';
  END IF;

  IF p_approve THEN
    UPDATE public.driver_profiles
    SET is_online = TRUE,
        updated_at = NOW()
    WHERE user_id = v_driver_id;
  ELSE
    UPDATE public.driver_profiles
    SET is_online = FALSE,
        updated_at = NOW()
    WHERE user_id = v_driver_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'driver_id', v_driver_id,
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  );
END;
$$;

-- ============================================================================
-- 13. Persistência Real de Notificações Lidas (lida, read_at, RLS e RPC)
-- ============================================================================
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS lida BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID NOT NULL REFERENCES public.app_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id, read_at DESC);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

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

