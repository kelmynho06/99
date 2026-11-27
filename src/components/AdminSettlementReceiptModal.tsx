import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Eraser, Printer, Wallet, X } from 'lucide-react';
import { handleBrandImageError, resolveBrandLogo } from '../lib/brandAssets';
import { formatBRL } from '../lib/geo';
import { getPeriodRangeLabel, isDateInPeriod } from '../lib/periodFilter';
import type {
  PeriodFilter,
  PlatformConfig,
  Ride,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';

interface AdminSettlementReceiptModalProps {
  driver: UserProfile;
  period: PeriodFilter;
  rides: Ride[];
  transactions: WalletTransaction[];
  platformConfig: PlatformConfig;
  onConfirmPayout: (amount: number, note: string) => Promise<void>;
  onClose: () => void;
}

export const AdminSettlementReceiptModal: React.FC<AdminSettlementReceiptModalProps> = ({
  driver,
  period,
  rides,
  transactions,
  platformConfig,
  onConfirmPayout,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<string>(
    Number(driver.wallet_balance || 0).toFixed(2)
  );
  const [payoutNote, setPayoutNote] = useState<string>(
    `Acerto ${getPeriodRangeLabel(period)} · Pix ${driver.driver?.pix_key || driver.email}`
  );
  const [submitting, setSubmitting] = useState(false);

  const periodRides = useMemo(
    () =>
      rides.filter(
        (r) =>
          r.driver_id === driver.id &&
          r.status === 'completed' &&
          isDateInPeriod(r.completed_at || r.created_at, period)
      ),
    [rides, driver.id, period]
  );

  const periodPayouts = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.user_id === driver.id &&
          tx.type === 'payout' &&
          isDateInPeriod(tx.created_at, period)
      ),
    [transactions, driver.id, period]
  );

  const totals = useMemo(() => {
    const pixApp = periodRides
      .filter((r) => r.payment_method === 'pix' || r.payment_method === 'wallet')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
    const cash = periodRides
      .filter((r) => r.payment_method === 'cash')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
    const paidOut = periodPayouts.reduce((acc, tx) => acc + Math.abs(tx.amount), 0);
    return {
      pixApp: Number(pixApp.toFixed(2)),
      cash: Number(cash.toFixed(2)),
      gross: Number((pixApp + cash).toFixed(2)),
      paidOut: Number(paidOut.toFixed(2)),
    };
  }, [periodRides, periodPayouts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const receiptCode = `REC-${driver.id.slice(-5).toUpperCase()}-${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '')}`;

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = parseFloat(payoutAmount.replace(',', '.')) || 0;
    if (numeric <= 0) return;
    setSubmitting(true);
    try {
      await onConfirmPayout(numeric, payoutNote);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4">
      <div className="print-only-sheet w-full max-w-3xl rounded-t-3xl sm:rounded-3xl bg-white text-neutral-950 shadow-2xl max-h-[94vh] flex flex-col overflow-hidden border border-neutral-200">
        {/* Top Screen Bar (hidden when printing) */}
        <div className="no-print flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-5 py-3.5">
          <div>
            <h3 className="font-display text-base font-extrabold text-neutral-950">
              Recibo de Pagamento &amp; Acerto — {driver.full_name}
            </h3>
            <p className="text-xs text-neutral-500">
              {getPeriodRangeLabel(period)} · Assinatura digital ou impressão para assinatura manual
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="aurora-accent-flow inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-extrabold text-white shadow-sm transition"
            >
              <Printer className="h-4 w-4" />
              Imprimir / Salvar PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-200 text-neutral-700"
              aria-label="Fechar recibo"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Formal A4-ready Receipt Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Formal Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-neutral-900 pb-4">
            <div className="flex items-center gap-3">
              <img
                src={resolveBrandLogo(platformConfig)}
                alt={platformConfig.site_name}
                referrerPolicy="no-referrer"
                onError={(e) => handleBrandImageError(e)}
                className="h-12 w-12 rounded-xl object-cover border border-neutral-300"
              />
              <div>
                <h2 className="font-display text-xl font-extrabold text-[#0F172A]">
                  {platformConfig.site_name || 'Go Driver Mobilidade'}
                </h2>
                <p className="text-xs font-semibold text-neutral-600">
                  Operação Local · {platformConfig.platform_city}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-extrabold uppercase tracking-wider text-neutral-950">
                Recibo de Pagamento e Acerto
              </p>
              <p className="font-mono-num text-xs font-bold text-neutral-700">
                Documento Nº {receiptCode}
              </p>
              <p className="font-mono-num text-[11px] text-neutral-500">
                Emitido em {new Date().toLocaleString('pt-BR')}
              </p>
            </div>
          </div>

          {/* Receiver Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-neutral-300 bg-neutral-50 p-4 text-xs">
            <div className="space-y-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                Dados do Recebedor (Motorista / Entregador)
              </p>
              <p className="text-sm font-extrabold text-neutral-950">{driver.full_name}</p>
              <p className="font-mono-num text-neutral-700">
                CPF: <strong>{driver.cpf || '—'}</strong> · Tel: {driver.phone}
              </p>
              <p className="text-neutral-700">
                Veículo: {driver.driver?.vehicle_model || '—'} · Placa{' '}
                <strong className="font-mono-num">{driver.driver?.vehicle_plate || '—'}</strong>
              </p>
            </div>
            <div className="space-y-1 sm:text-right">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                Período &amp; Chave Pix de Repasse
              </p>
              <p className="font-bold text-neutral-950">{getPeriodRangeLabel(period)}</p>
              <p className="font-mono-num text-neutral-800">
                Chave Pix: <strong>{driver.driver?.pix_key || driver.email}</strong>
              </p>
              <p className="text-neutral-600">
                Total de corridas/entregas no período: <strong>{periodRides.length}</strong>
              </p>
            </div>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            <div className="rounded-xl border border-neutral-300 p-3">
              <p className="text-[10px] font-bold uppercase text-neutral-500">Pix + App (Período)</p>
              <p className="mt-1 font-mono-num text-base font-extrabold text-neutral-950">
                {formatBRL(totals.pixApp)}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-300 p-3">
              <p className="text-[10px] font-bold uppercase text-neutral-500">Dinheiro (Período)</p>
              <p className="mt-1 font-mono-num text-base font-extrabold text-emerald-700">
                {formatBRL(totals.cash)}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-300 p-3">
              <p className="text-[10px] font-bold uppercase text-neutral-500">Já Repassado</p>
              <p className="mt-1 font-mono-num text-base font-extrabold text-sky-700">
                {formatBRL(totals.paidOut)}
              </p>
            </div>
            <div className="rounded-xl border-2 border-[#2563EB] bg-[#EFF6FF] p-3">
              <p className="text-[10px] font-extrabold uppercase text-[#1D4ED8]">Saldo a Pagar</p>
              <p className="mt-1 font-mono-num text-base font-extrabold text-[#0F172A]">
                {formatBRL(driver.wallet_balance || 0)}
              </p>
            </div>
          </div>

          {/* Itemized Rides List */}
          <div className="space-y-2">
            <p className="text-xs font-extrabold uppercase tracking-wider text-neutral-700">
              Detalhamento das Corridas / Entregas Concluídas ({periodRides.length})
            </p>
            {periodRides.length === 0 ? (
              <div className="rounded-xl border border-neutral-200 p-4 text-center text-xs text-neutral-500">
                Nenhuma corrida ou entrega concluída neste filtro de período.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-300">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-neutral-100 border-b border-neutral-300 text-neutral-700">
                    <tr>
                      <th className="px-3 py-2 font-bold">Data/Hora</th>
                      <th className="px-3 py-2 font-bold">Modalidade</th>
                      <th className="px-3 py-2 font-bold">Trajeto</th>
                      <th className="px-3 py-2 font-bold">Pgto</th>
                      <th className="px-3 py-2 font-bold text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {periodRides.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-1.5 font-mono-num whitespace-nowrap">
                          {new Date(r.completed_at || r.created_at).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-1.5 font-bold uppercase">{r.category}</td>
                        <td className="px-3 py-1.5 max-w-[240px] truncate">
                          {r.origin_address} → {r.destination_address}
                        </td>
                        <td className="px-3 py-1.5 uppercase font-bold">{r.payment_method}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num font-bold">
                          {formatBRL(r.final_fare ?? r.estimated_fare)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Interactive Digital Signature Canvas + Dual Printed Signature Lines */}
          <div className="rounded-2xl border border-neutral-300 p-4 space-y-3">
            <div className="no-print flex items-center justify-between">
              <p className="text-xs font-extrabold text-neutral-900">
                Assinatura Digital na Tela (ou deixe em branco para assinar no papel impresso)
              </p>
              {hasSignature && (
                <button
                  type="button"
                  onClick={clearSignature}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-[11px] font-bold text-neutral-700"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Limpar assinatura
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
              <div className="flex flex-col items-center">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={110}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-24 touch-none rounded-xl border border-dashed border-neutral-400 bg-neutral-50 cursor-crosshair"
                />
                <div className="mt-2 w-full border-t border-neutral-900 pt-1 text-center">
                  <p className="text-xs font-extrabold text-neutral-950">{driver.full_name}</p>
                  <p className="text-[10px] text-neutral-600">
                    Assinatura do Motorista / Entregador (Recebedor)
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center justify-end">
                <div className="h-24 w-full flex items-end justify-center pb-2 text-[10px] text-neutral-400">
                  {platformConfig.platform_pix_receiver}
                </div>
                <div className="mt-2 w-full border-t border-neutral-900 pt-1 text-center">
                  <p className="text-xs font-extrabold text-neutral-950">
                    Administração · {platformConfig.site_name}
                  </p>
                  <p className="text-[10px] text-neutral-600">
                    Responsável pela Conferência e Repasse
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Payout Confirmation Form (Hidden in Print) */}
          {driver.wallet_balance > 0 && (
            <form
              onSubmit={handlePaySubmit}
              className="no-print rounded-2xl border border-emerald-300 bg-emerald-50 p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-900">
                <Wallet className="h-4 w-4" />
                <span>Confirmar Pagamento / Registrar Repasse Pix no Sistema</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={driver.wallet_balance}
                  required
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-emerald-300 bg-white px-3 font-mono-num text-sm font-extrabold"
                />
                <input
                  type="text"
                  value={payoutNote}
                  onChange={(e) => setPayoutNote(e.target.value)}
                  placeholder="Comprovante / observação"
                  className="sm:col-span-2 min-h-[42px] rounded-xl border border-emerald-300 bg-white px-3 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-extrabold text-white shadow-sm disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {submitting
                  ? 'Registrando repasse...'
                  : `Confirmar Pagamento (${formatBRL(parseFloat(payoutAmount) || 0)}) & Abater Saldo`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
