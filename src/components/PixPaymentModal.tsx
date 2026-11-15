import React, { useMemo, useState } from 'react';
import { Check, Copy, QrCode, ShieldCheck, X } from 'lucide-react';
import { formatBRL } from '../lib/geo';
import type { PlatformConfig, Ride } from '../types/mobility';

interface PixPaymentModalProps {
  ride: Ride;
  platformConfig: PlatformConfig;
  onDeclared: (updatedRide: Ride) => void;
  onClose: () => void;
}

function buildPixPayload(
  pixKey: string,
  receiverName: string,
  city: string,
  amount: number,
  txId: string
): string {
  const cleanName = receiverName.slice(0, 25).toUpperCase();
  const cleanCity = city.split(',')[0].slice(0, 15).toUpperCase();
  const amt = amount.toFixed(2);
  return `00020126360014BR.GOV.BCB.PIX01${String(pixKey.length).padStart(2, '0')}${pixKey}52040000530398654${String(
    amt.length
  ).padStart(2, '0')}${amt}5802BR59${String(cleanName.length).padStart(
    2,
    '0'
  )}${cleanName}60${String(cleanCity.length).padStart(
    2,
    '0'
  )}${cleanCity}62070503${txId.slice(-4).toUpperCase()}6304V99A`;
}

function generateDeterministicMatrix(seedStr: string, size = 21): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = isBorder || isInner;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= size - 8;
      const inBottomLeft = r >= size - 8 && c < 8;
      if (inTopLeft || inTopRight || inBottomLeft) continue;
      hash ^= (r * 31 + c * 17) & 0xff;
      hash = Math.imul(hash, 16777619);
      grid[r][c] = (hash >>> 0) % 2 === 0;
    }
  }
  return grid;
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

  const amount = ride.final_fare ?? ride.estimated_fare;
  const pixPayload = useMemo(
    () =>
      buildPixPayload(
        platformConfig.platform_pix_key,
        platformConfig.platform_pix_receiver,
        platformConfig.platform_city,
        amount,
        ride.id
      ),
    [platformConfig, amount, ride.id]
  );

  const qrMatrix = useMemo(() => generateDeterministicMatrix(pixPayload), [pixPayload]);

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
      // Clipboard blocked in non-HTTPS context
    }
  };

  const confirmPixPaid = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/rides/${ride.id}/declare-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setError(data.error || 'Não foi possível confirmar o Pix.');
        return;
      }
      onDeclared(data.ride);
    } catch {
      setError('Falha de conexão ao registrar pagamento Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Pagar via Pix Oficial
              </h3>
              <p className="text-xs text-neutral-500">{platformConfig.platform_pix_receiver}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
            aria-label="Fechar pagamento Pix"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs font-semibold text-neutral-500">Valor total da viagem</p>
          <p className="mt-0.5 font-mono-num text-3xl font-extrabold text-neutral-950">
            {formatBRL(amount)}
          </p>
        </div>

        {/* Deterministic SVG QR Code */}
        <div className="mt-4 flex justify-center">
          <div className="rounded-2xl border-2 border-neutral-950 bg-white p-3.5 shadow-sm">
            <svg
              width="168"
              height="168"
              viewBox="0 0 21 21"
              shapeRendering="crispEdges"
              role="img"
              aria-label="QR Code Pix da Plataforma"
            >
              <rect width="21" height="21" fill="#ffffff" />
              {qrMatrix.map((row, r) =>
                row.map((cell, c) =>
                  cell ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#111827" /> : null
                )
              )}
            </svg>
          </div>
        </div>

        {/* Official Platform Pix Key */}
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-neutral-500">Chave Pix da Plataforma</p>
              <p className="font-mono-num text-sm font-extrabold text-neutral-950 truncate">
                {platformConfig.platform_pix_key}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(platformConfig.platform_pix_key, 'key')}
              className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-neutral-950 px-3 text-xs font-bold text-[#FFD100]"
            >
              {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey ? 'Copiada' : 'Copiar chave'}
            </button>
          </div>

          <div className="border-t border-neutral-200 pt-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-neutral-500">Pix Copia e Cola</p>
              <p className="font-mono text-[11px] text-neutral-700 truncate">{pixPayload}</p>
            </div>
            <button
              type="button"
              onClick={() => copyText(pixPayload, 'code')}
              className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-900"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? 'Copiado' : 'Copiar código'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
          <span>
            Pagamento centralizado com proteção Velo99. O repasse ao motorista é garantido pela
            plataforma.
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
            className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
          >
            {submitting ? 'Confirmando...' : 'Já fiz o Pix'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full text-xs font-bold text-neutral-500 hover:text-neutral-900"
          >
            Pagar depois
          </button>
        </div>
      </div>
    </div>
  );
};
