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

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (v_from, -v_amount, 'transfer_out', COALESCE(NULLIF(TRIM(p_observacao), ''), 'Transferência 66 Pay para ' || v_to_name));

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (v_to, v_amount, 'transfer_in', COALESCE(NULLIF(TRIM(p_observacao), ''), 'Transferência 66 Pay de ' || v_from_name));

  RETURN jsonb_build_object('ok', TRUE, 'amount', v_amount, 'recipient_id', v_to, 'recipient_name', v_to_name, 'new_balance', ROUND((v_from_bal - v_amount)::NUMERIC, 2));
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

