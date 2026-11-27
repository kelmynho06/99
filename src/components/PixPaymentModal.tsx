import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import {
  createManualPagamentoPix,
  createMercadoPagoPix,
  declarePixPaid,
  fetchRideByIdEnriched,
} from '../lib/mobilityApi';
import { PixQrSvg, usePixSecurityRotation } from '../lib/pixQr';
import { speakPtBr } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type { PlatformConfig, Ride } from '../types/mobility';

interface PixPaymentModalProps {
  ride: Ride;
  platformConfig: PlatformConfig;
  onDeclared: (updatedRide: Ride) => void;
  onClose: () => void;
}

export const PixPaymentModal: React.FC<PixPaymentModalProps> = ({
  ride,
  platformConfig,
  onDeclared,
  onClose,
}) => {
  const { t } = useTranslation();
  const autoPixEnabled = platformConfig.mp_auto_pix_enabled !== false;
  const manualPixEnabled = platformConfig.manual_pix_enabled !== false;

  const [pixMode, setPixMode] = useState<'auto' | 'manual'>(() =>
    autoPixEnabled ? 'auto' : 'manual'
  );
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingAuto, setGeneratingAuto] = useState(false);
  const [autoPixData, setAutoPixData] = useState<{
    id: string;
    mp_payment_id: string;
    qr_code: string;
    qr_code_base64: string;
    valor: number;
  } | null>(null);
  const [autoApproved, setAutoApproved] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const celebratedRef = useRef(false);
  const autoAttemptedRef = useRef(false);
  const { formattedTimer, cycle } = usePixSecurityRotation(90);

  const amount = ride.final_fare ?? ride.estimated_fare;
  const pixPayload = useMemo(
    () =>
      buildPixEmvPayload(
        platformConfig.platform_pix_key,
        platformConfig.platform_pix_receiver,
        platformConfig.platform_city,
        amount,
        `${ride.id}S${cycle}`
      ),
    [platformConfig, amount, ride.id, cycle]
  );

  const isPaid =
    autoApproved ||
    ride.payment_status === 'paid_pix' ||
    ride.payment_status === 'admin_settled';
  const isDeclared = !isPaid && Boolean(ride.pix_declared_at);

  const generateMercadoPagoCharge = useCallback(async () => {
    setAutoError(null);
    setGeneratingAuto(true);
    try {
      const res = await createMercadoPagoPix({
        tipo: 'corrida',
        valor: amount,
        corrida_id: ride.id,
        email: ride.passenger?.email,
        nome: ride.passenger?.full_name,
      });
      setAutoPixData({
        id: res.id,
        mp_payment_id: res.mp_payment_id,
        qr_code: res.qr_code,
        qr_code_base64: res.qr_code_base64,
        valor: res.valor,
      });
    } catch (err) {
      setAutoError(
        err instanceof Error
          ? err.message
          : 'Pix Automático indisponível no momento. Use o Pix Manual do Administrador.'
      );
    } finally {
      setGeneratingAuto(false);
    }
  }, [amount, ride.id, ride.passenger?.email, ride.passenger?.full_name]);

  useEffect(() => {
    if (!autoPixEnabled || isPaid || pixMode !== 'auto' || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    void generateMercadoPagoCharge();
  }, [autoPixEnabled, isPaid, pixMode, generateMercadoPagoCharge]);

  // Listen in real time + light 5s poll for Mercado Pago webhook confirmation
  useEffect(() => {
    if (isPaid) return;
    const paymentId = autoPixData?.id;

    const handleConfirmed = async () => {
      setAutoApproved(true);
      const freshRide = await fetchRideByIdEnriched(ride.id).catch(() => null);
      if (freshRide) {
        onDeclared(freshRide);
      } else {
        onDeclared({ ...ride, payment_status: 'paid_pix' });
      }
    };

    const ch = supabase
      .channel(`pix-modal-${ride.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${ride.id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (
            row &&
            (row.payment_status === 'paid_pix' || row.payment_status === 'admin_settled')
          ) {
            void handleConfirmed();
          }
        }
      );

    if (paymentId) {
      ch.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pagamentos_pix', filter: `id=eq.${paymentId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (row && row.status === 'aprovado') {
            void handleConfirmed();
          }
        }
      );
    }

    ch.subscribe();

    const pollId = window.setInterval(async () => {
      try {
        if (paymentId) {
          const { data } = await supabase
            .from('pagamentos_pix')
            .select('status')
            .eq('id', paymentId)
            .maybeSingle();
          if (data?.status === 'aprovado') {
            await handleConfirmed();
            return;
          }
        }
        const freshRide = await fetchRideByIdEnriched(ride.id).catch(() => null);
        if (
          freshRide &&
          (freshRide.payment_status === 'paid_pix' ||
            freshRide.payment_status === 'admin_settled')
        ) {
          await handleConfirmed();
        }
      } catch {
        // Ignore transient poll error
      }
    }, 5000);

    return () => {
      window.clearInterval(pollId);
      supabase.removeChannel(ch);
    };
  }, [autoPixData?.id, isPaid, onDeclared, ride]);

  const copyText = async (value: string, target: 'key' | 'code') => {
    try {
      await navigator.clipboard.writeText(value);
      if (target === 'key') {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const confirmPixPaid = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const updated = await declarePixPaid(ride);
      await createManualPagamentoPix({
        usuario_id: ride.passenger_id,
        tipo: 'corrida',
        valor: amount,
        corrida_id: ride.id,
        qr_code: pixPayload,
      });
      onDeclared(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de conexão ao registrar pagamento Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isPaid || celebratedRef.current) return;
    celebratedRef.current = true;
    speakPtBr('Pagamento Pix confirmado com sucesso!', true);
    const timer = window.setTimeout(() => {
      onClose();
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [isPaid, onClose]);

  if (isPaid) {
    return (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#0F172A]/60 p-4 backdrop-blur-xs">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl border border-[#A7F3D0] space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ECFDF5] text-[#10B981]">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-[#059669]">
              {autoApproved ? 'Pix Automático Confirmado' : 'Pix Confirmado'}
            </p>
            <h3 className="mt-1 font-display text-xl font-extrabold text-[#0F172A]">
              Pagamento confirmado com sucesso!
            </h3>
            <p className="mt-1.5 text-xs text-[#475569]">
              O pagamento de{' '}
              <strong className="font-mono-num text-[#0F172A]">{formatBRL(amount)}</strong> foi
              confirmado. Obrigado por viajar com a gente!
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-2xl bg-[#10B981] text-sm font-extrabold text-white shadow-sm hover:bg-[#059669] active:scale-[0.98]"
          >
            {t.continue_btn}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-[#0F172A]/60 p-0 sm:p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl max-h-[92vh] overflow-y-auto border border-[#E2E8F0]">
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563EB] to-[#0EA5E9] text-white">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
                {ride.status === 'completed' ? t.pay_with_pix : 'Pix Copia e Cola'}
              </h3>
              <p className="text-xs text-[#475569]">{platformConfig.platform_pix_receiver}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A]"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher: Pix Automático (Mercado Pago) vs Pix Manual (Admin) */}
        {(autoPixEnabled || manualPixEnabled) && (
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F1F5F9] p-1 border border-[#E2E8F0]">
            {autoPixEnabled && (
              <button
                type="button"
                onClick={() => {
                  setPixMode('auto');
                  if (!autoPixData && !generatingAuto) {
                    void generateMercadoPagoCharge();
                  }
                }}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-extrabold transition ${
                  pixMode === 'auto'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                Pix Automático 24h
              </button>
            )}
            {(manualPixEnabled || !autoPixEnabled) && (
              <button
                type="button"
                onClick={() => setPixMode('manual')}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-extrabold transition ${
                  pixMode === 'manual'
                    ? 'bg-white text-[#0F172A] shadow-xs border border-[#E2E8F0]'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />
                Pix Manual (Admin)
              </button>
            )}
          </div>
        )}

        <div className="mt-3 text-center">
          <p className="text-xs font-semibold text-[#475569]">Valor total a transferir</p>
          <p className="mt-0.5 font-mono-num text-3xl font-extrabold text-[#0F172A]">
            {formatBRL(amount)}
          </p>
          {Boolean(ride.pending_debt_included && ride.pending_debt_included > 0) && (
            <p className="mt-1 text-[11px] font-bold text-[#2563EB]">
              Inclui débito pendente anterior: {formatBRL(ride.pending_debt_included || 0)}
            </p>
          )}
        </div>

        {/* MODO 1: PIX AUTOMÁTICO MERCADO PAGO */}
        {pixMode === 'auto' && autoPixEnabled && (
          <div className="mt-4 space-y-3">
            {generatingAuto ? (
              <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-6 text-center space-y-2">
                <RefreshCw className="mx-auto h-7 w-7 animate-spin text-[#2563EB]" />
                <p className="text-xs font-extrabold text-[#0F172A]">
                  Gerando QR Code Pix Automático via Mercado Pago...
                </p>
                <p className="text-[11px] text-[#475569]">
                  Confirmação instantânea em segundos após o pagamento.
                </p>
              </div>
            ) : autoError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-xs font-bold text-amber-900 leading-relaxed">{autoError}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void generateMercadoPagoCharge()}
                    className="flex-1 min-h-[40px] rounded-xl border border-amber-300 bg-white text-xs font-extrabold text-[#0F172A]"
                  >
                    Tentar Novamente
                  </button>
                  {manualPixEnabled && (
                    <button
                      type="button"
                      onClick={() => setPixMode('manual')}
                      className="flex-1 min-h-[40px] rounded-xl bg-[#2563EB] text-xs font-extrabold text-white"
                    >
                      Usar Pix Manual
                    </button>
                  )}
                </div>
              </div>
            ) : autoPixData ? (
              <>
                <div className="flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Aguardando pagamento · Baixa Automática
                  </span>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-2xl border-2 border-[#2563EB] bg-white p-3 shadow-sm">
                    {autoPixData.qr_code_base64 ? (
                      <img
                        src={`data:image/png;base64,${autoPixData.qr_code_base64}`}
                        alt="QR Code Pix Automático"
                        className="h-44 w-44 object-contain rounded-lg"
                      />
                    ) : (
                      <PixQrSvg payload={autoPixData.qr_code} size={160} />
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-[#2563EB]">
                    Assim que você pagar no banco, esta tela fecha automaticamente.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-[#475569]">Pix Copia e Cola</p>
                    <button
                      type="button"
                      onClick={() => copyText(autoPixData.qr_code, 'code')}
                      className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 text-xs font-bold text-white"
                    >
                      {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCode ? 'Código copiado!' : 'Copiar Código'}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={2}
                    value={autoPixData.qr_code}
                    onClick={(e) => e.currentTarget.select()}
                    className="w-full rounded-xl border border-[#E2E8F0] bg-white p-2 font-mono text-[11px] text-[#0F172A] outline-none resize-none"
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* MODO 2: PIX MANUAL ADMIN (100% PRESERVADO) */}
        {pixMode === 'manual' && (
          <>
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
                <Clock className="h-3.5 w-3.5" />
                {isDeclared
                  ? 'Aviso enviado · Aguardando confirmação do Admin'
                  : 'Aguardando pagamento Pix'}
              </span>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2">
              <div
                key={cycle}
                className="rounded-2xl border-2 border-[#0F172A] bg-white p-3 shadow-sm transition-opacity"
              >
                {platformConfig.platform_pix_qr_url ? (
                  <img
                    src={platformConfig.platform_pix_qr_url}
                    alt="QR Code Pix Oficial"
                    className="h-44 w-44 object-contain rounded-lg"
                  />
                ) : (
                  <PixQrSvg payload={pixPayload} size={160} />
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-1 text-[11px] font-bold text-[#1D4ED8]">
                <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '6s' }} />
                <span>
                  Atualização de segurança em <strong className="font-mono-num">{formattedTimer}</strong> · Mesma conta oficial
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-bold text-[#475569]">
                    Código EMV Pix Copia e Cola
                  </p>
                  <button
                    type="button"
                    onClick={() => copyText(pixPayload, 'code')}
                    className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 text-xs font-bold text-white"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedCode ? 'Código copiado!' : 'Copiar Código'}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={2}
                  value={pixPayload}
                  onClick={(e) => e.currentTarget.select()}
                  className="w-full rounded-xl border border-[#E2E8F0] bg-white p-2 font-mono text-[11px] text-[#0F172A] outline-none resize-none"
                />
              </div>

              <div className="border-t border-[#E2E8F0] pt-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-[#475569]">Chave Pix da Plataforma</p>
                  <p className="font-mono-num text-xs font-extrabold text-[#0F172A] truncate">
                    {platformConfig.platform_pix_key}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(platformConfig.platform_pix_key, 'key')}
                  className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-bold text-[#0F172A]"
                >
                  {copiedKey ? <Check className="h-3.5 w-3.5 text-[#10B981]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey ? 'Copiada' : 'Copiar chave'}
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] px-3.5 py-2.5 text-xs text-[#1E3A8A]">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#2563EB]" />
              <span>
                Pagamento centralizado para {platformConfig.platform_pix_receiver}. Após pagar no app do
                seu banco, toque abaixo para avisar o Administrador e liberar o motorista.
              </span>
            </div>

            {error && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={confirmPixPaid}
                className="aurora-accent-flow min-h-[52px] w-full rounded-2xl text-base font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-50"
              >
                {submitting
                  ? 'Enviando aviso...'
                  : isDeclared
                  ? 'Reenviar aviso ao Admin · Já fiz o Pix'
                  : 'Já fiz o Pix · Avisar Admin'}
              </button>
            </div>
          </>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full text-xs font-bold text-[#475569] hover:text-[#0F172A]"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};
