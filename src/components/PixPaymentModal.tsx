import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock, Copy, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import { declarePixPaid } from '../lib/mobilityApi';
import { PixQrSvg, usePixSecurityRotation } from '../lib/pixQr';
import { speakPtBr } from '../lib/sound';
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
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const celebratedRef = useRef(false);
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
      onDeclared(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de conexão ao registrar pagamento Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  const isPaid = ride.payment_status === 'paid_pix' || ride.payment_status === 'admin_settled';
  const isDeclared = !isPaid && Boolean(ride.pix_declared_at);

  useEffect(() => {
    if (!isPaid || celebratedRef.current) return;
    celebratedRef.current = true;
    speakPtBr('Pagamento confirmado com sucesso.', true);
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
              Pix Confirmado pelo Admin
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

        {/* Payment Confirmation Status Badge */}
        <div className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
            <Clock className="h-3.5 w-3.5" />
            {isDeclared
              ? 'Aviso enviado · Aguardando confirmação do Admin'
              : 'Aguardando pagamento Pix'}
          </span>
        </div>

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

        {/* Official Custom QR Image or Deterministic SVG QR Code with 90s Security Rotation */}
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

        {/* EMV Pix Copia e Cola Field + Key */}
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

