import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock, Copy, QrCode, ShieldCheck, X } from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import { declarePixPaid } from '../lib/mobilityApi';
import { PixQrSvg } from '../lib/pixQr';
import { playRideAcceptedChime } from '../lib/sound';
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
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const celebratedRef = useRef(false);

  const amount = ride.final_fare ?? ride.estimated_fare;
  const pixPayload = useMemo(
    () =>
      buildPixEmvPayload(
        platformConfig.platform_pix_key,
        platformConfig.platform_pix_receiver,
        platformConfig.platform_city,
        amount,
        ride.id
      ),
    [platformConfig, amount, ride.id]
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
    void playRideAcceptedChime();
    const timer = window.setTimeout(() => {
      onClose();
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [isPaid, onClose]);

  if (isPaid) {
    return (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/65 p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 text-center shadow-2xl border border-emerald-200 dark:border-emerald-800 space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Pix Confirmado pelo Admin
            </p>
            <h3 className="mt-1 font-display text-xl font-extrabold text-neutral-950 dark:text-white">
              Pagamento confirmado com sucesso!
            </h3>
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              O pagamento de{' '}
              <strong className="font-mono-num text-neutral-950 dark:text-white">{formatBRL(amount)}</strong> foi
              confirmado. Obrigado por viajar com a gente!
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-2xl bg-emerald-600 text-sm font-extrabold text-white shadow-sm active:scale-[0.98]"
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl max-h-[92vh] overflow-y-auto border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                {ride.status === 'completed' ? 'Aguardando Pagamento (Pix)' : 'Pix Copia e Cola'}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{platformConfig.platform_pix_receiver}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
            aria-label="Fechar pagamento Pix"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Payment Confirmation Status Badge */}
        <div className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            <Clock className="h-3.5 w-3.5" />
            {isDeclared
              ? 'Aviso enviado · Aguardando confirmação do Admin'
              : 'Aguardando pagamento Pix'}
          </span>
        </div>

        <div className="mt-3 text-center">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Valor total a transferir</p>
          <p className="mt-0.5 font-mono-num text-3xl font-extrabold text-neutral-950 dark:text-white">
            {formatBRL(amount)}
          </p>
          {Boolean(ride.pending_debt_included && ride.pending_debt_included > 0) && (
            <p className="mt-1 text-[11px] font-bold text-amber-800 dark:text-amber-300">
              Inclui débito pendente anterior: {formatBRL(ride.pending_debt_included || 0)}
            </p>
          )}
        </div>

        {/* Deterministic SVG QR Code */}
        <div className="mt-4 flex justify-center">
          <div className="rounded-2xl border-2 border-neutral-950 bg-white p-3.5 shadow-sm">
            <PixQrSvg payload={pixPayload} size={160} />
          </div>
        </div>

        {/* EMV Pix Copia e Cola Field + Key */}
        <div className="mt-4 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[11px] font-bold text-neutral-600 dark:text-neutral-300">
                Código EMV Pix Copia e Cola
              </p>
              <button
                type="button"
                onClick={() => copyText(pixPayload, 'code')}
                className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-neutral-950 dark:bg-[#FFD100] px-3 text-xs font-bold text-[#FFD100] dark:text-neutral-950"
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
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 font-mono text-[11px] text-neutral-800 dark:text-neutral-200 outline-none resize-none"
            />
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-700 pt-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400">Chave Pix da Plataforma</p>
              <p className="font-mono-num text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                {platformConfig.platform_pix_key}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(platformConfig.platform_pix_key, 'key')}
              className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-xs font-bold text-neutral-900 dark:text-neutral-100"
            >
              {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey ? 'Copiada' : 'Copiar chave'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <span>
            Pagamento centralizado para {platformConfig.platform_pix_receiver}. Após pagar no app do
            seu banco, toque abaixo para avisar o Administrador e liberar o motorista.
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3.5 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={confirmPixPaid}
            className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
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
            className="min-h-[44px] w-full text-xs font-bold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            Minimizar
          </button>
        </div>
      </div>
    </div>
  );
};

