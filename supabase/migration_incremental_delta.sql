-- ============================================================================
-- Go Driver Mobilidade — SQL INCREMENTAL MÍNIMO (Somente Notificações Lidas)
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
