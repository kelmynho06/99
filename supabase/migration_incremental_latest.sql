-- ============================================================================
-- 66 Mobilidade — SQL Incremental Atualizado v1.2.2 (Apenas Delta Novo)
-- Seguro para executar em bancos que já possuem as tabelas principais.
-- ============================================================================

-- 1. URL da versão web/OTA dentro do APK (atualização automática de interface)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ota_web_url TEXT;

-- 2. Novos tipos no extrato da carteira (Transferência P2P e Saque Pix de Motorista)
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

-- 3. Tabela de solicitações de Saque Pix para Motoristas / Entregadores
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

DROP POLICY IF EXISTS "Usuario ve proprios saques" ON public.wallet_withdrawals;
CREATE POLICY "Usuario ve proprios saques"
  ON public.wallet_withdrawals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Admin atualiza saques" ON public.wallet_withdrawals;
CREATE POLICY "Admin atualiza saques"
  ON public.wallet_withdrawals FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wallet_withdrawals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_withdrawals;
  END IF;
END $$;

-- 4. RPC segura: localizar destinatário por e-mail, telefone ou nome para transferir saldo
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC atômica: transferir Saldo do App entre contas (Cliente <-> Motorista/Cliente)
CREATE OR REPLACE FUNCTION public.transfer_wallet_balance(
  p_to_user_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_from UUID;
  v_amount NUMERIC(10,2);
  v_from_name TEXT;
  v_to_name TEXT;
  v_from_bal NUMERIC(10,2);
BEGIN
  v_from := auth.uid();
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;
  IF p_to_user_id IS NULL OR p_to_user_id = v_from THEN
    RAISE EXCEPTION 'Selecione outro destinatário válido.';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0)::NUMERIC, 2);
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'O valor mínimo para transferência é R$ 1,00.';
  END IF;

  IF v_from < p_to_user_id THEN
    PERFORM 1 FROM public.profiles WHERE id IN (v_from, p_to_user_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles WHERE id IN (p_to_user_id, v_from) ORDER BY id FOR UPDATE;
  END IF;

  SELECT full_name, COALESCE(wallet_balance, 0)
  INTO v_from_name, v_from_bal
  FROM public.profiles
  WHERE id = v_from;

  SELECT full_name INTO v_to_name
  FROM public.profiles
  WHERE id = p_to_user_id AND COALESCE(is_anonymized, FALSE) = FALSE;

  IF v_to_name IS NULL THEN
    RAISE EXCEPTION 'Destinatário não encontrado.';
  END IF;

  IF v_from_bal < v_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente para realizar a transferência.';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = v_from;

  UPDATE public.profiles
  SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_amount)::NUMERIC, 2),
      updated_at = NOW()
  WHERE id = p_to_user_id;

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (
    v_from,
    -v_amount,
    'transfer_out',
    COALESCE(NULLIF(TRIM(p_note), ''), 'Transferência enviada para ' || v_to_name)
  );

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
  VALUES (
    p_to_user_id,
    v_amount,
    'transfer_in',
    COALESCE(NULLIF(TRIM(p_note), ''), 'Transferência recebida de ' || v_from_name)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC atômica: motorista solicita Saque Pix do seu Saldo do App
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC Admin: marcar saque como pago ou recusar (estornando o saldo automaticamente)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
