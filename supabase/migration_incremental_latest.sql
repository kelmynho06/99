-- ============================================================================
-- 66 Mobilidade — SQL Incremental Atualizado (Apenas Delta Recente)
-- Seguro para rodar em bancos que já possuem as tabelas principais.
-- ============================================================================

-- 1. Liberar 'wallet' nas preferências de pagamento do perfil e nas corridas
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%preferred_payment%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;

  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.rides'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%payment_method%' OR pg_get_constraintdef(oid) ILIKE '%payment_status%')
  LOOP
    EXECUTE format('ALTER TABLE public.rides DROP CONSTRAINT %I', c.conname);
  END LOOP;

  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wallet_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_payment_check
  CHECK (preferred_payment IN ('cash', 'pix', 'wallet'));

ALTER TABLE public.rides
  ADD CONSTRAINT rides_payment_method_check
  CHECK (payment_method IN ('cash', 'pix', 'wallet'));

ALTER TABLE public.rides
  ADD CONSTRAINT rides_payment_status_check
  CHECK (payment_status IN ('pending', 'paid_pix', 'paid_cash', 'paid_wallet', 'disputed', 'admin_settled'));

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'ride_earning',
    'payout',
    'dispute_settlement',
    'deposit',
    'ride_debit',
    'ride_refund',
    'admin_adjustment'
  ));

DROP POLICY IF EXISTS "Usuario insere proprio debito da carteira" ON public.wallet_transactions;
CREATE POLICY "Usuario insere proprio debito da carteira"
  ON public.wallet_transactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- 2. RPC idempotente: Pagar corrida já concluída usando Saldo do App
CREATE OR REPLACE FUNCTION public.pay_completed_ride_with_wallet(
  p_ride_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_uid UUID;
  v_ride public.rides%ROWTYPE;
  v_fare NUMERIC(10,2);
  v_balance NUMERIC(10,2);
  v_already_debited BOOLEAN;
  v_already_credited BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada.';
  END IF;
  IF v_ride.passenger_id <> v_uid THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta corrida.';
  END IF;
  IF v_ride.payment_status = 'paid_wallet' THEN
    RETURN;
  END IF;
  IF v_ride.payment_status IN ('paid_pix', 'paid_cash', 'admin_settled') THEN
    RAISE EXCEPTION 'Esta corrida já foi quitada.';
  END IF;

  v_fare := ROUND(COALESCE(v_ride.final_fare, v_ride.estimated_fare, 0)::NUMERIC, 2);
  IF v_fare <= 0 THEN
    RAISE EXCEPTION 'Valor inválido para pagamento.';
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_balance
  FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_balance < v_fare THEN
    RAISE EXCEPTION 'Saldo insuficiente na carteira. Deposite via Pix ou escolha Pix/Dinheiro.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE ride_id = p_ride_id AND user_id = v_uid AND type = 'ride_debit'
  ) INTO v_already_debited;

  IF NOT v_already_debited THEN
    UPDATE public.profiles
    SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) - v_fare)::NUMERIC, 2),
        pending_debt_amount = GREATEST(0, COALESCE(pending_debt_amount, 0) - COALESCE(v_ride.pending_debt_included, 0)),
        updated_at = NOW()
    WHERE id = v_uid;

    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (v_uid, p_ride_id, -v_fare, 'ride_debit', 'Pagamento pós-corrida com Saldo do App');
  END IF;

  UPDATE public.rides
  SET payment_method = 'wallet',
      payment_status = 'paid_wallet',
      final_fare = v_fare
  WHERE id = p_ride_id;

  IF v_ride.driver_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE ride_id = p_ride_id AND user_id = v_ride.driver_id AND type IN ('ride_earning', 'dispute_settlement')
    ) INTO v_already_credited;

    IF NOT v_already_credited THEN
      UPDATE public.profiles
      SET wallet_balance = ROUND((COALESCE(wallet_balance, 0) + v_fare)::NUMERIC, 2),
          updated_at = NOW()
      WHERE id = v_ride.driver_id;

      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
      VALUES (v_ride.driver_id, p_ride_id, v_fare, 'ride_earning', 'Corrida paga pelo cliente com Saldo do App');
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC: Cliente alterna método de pagamento (Pix ou Dinheiro) após finalizar corrida
CREATE OR REPLACE FUNCTION public.client_select_ride_payment_method(
  p_ride_id UUID,
  p_method TEXT
)
RETURNS VOID AS $$
BEGIN
  IF p_method NOT IN ('pix', 'cash') THEN
    RAISE EXCEPTION 'Método inválido.';
  END IF;

  UPDATE public.rides
  SET payment_method = p_method,
      pix_declared_at = CASE WHEN p_method = 'cash' THEN NULL ELSE pix_declared_at END
  WHERE id = p_ride_id
    AND passenger_id = auth.uid()
    AND payment_status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
