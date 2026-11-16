import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import {
  createWalletDepositRequest,
  fetchMyWalletDeposits,
  fetchUserProfileById,
  fetchWalletTransactions,
} from '../lib/mobilityApi';
import { PixQrSvg } from '../lib/pixQr';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
  UserProfile,
  WalletDeposit,
  WalletTransaction,
} from '../types/mobility';

interface ClientWalletModalProps {
  currentUser: UserProfile;
  platformConfig: PlatformConfig;
  initialTab?: 'deposit' | 'ledger';
  suggestedMinAmount?: number;
  onUserUpdated: (user: UserProfile) => void;
  onClose: () => void;
}

const DEPOSIT_PRESETS = [15, 30, 50, 100];

const TX_TYPE_LABEL: Record<WalletTransaction['type'], string> = {
  deposit: 'Depósito Pix confirmado',
  ride_debit: 'Corrida paga com Saldo',
  ride_refund: 'Estorno automático',
  admin_adjustment: 'Ajuste pelo Admin',
  ride_earning: 'Ganho de corrida',
  payout: 'Repasse',
  dispute_settlement: 'Acerto de disputa',
};

export const ClientWalletModal: React.FC<ClientWalletModalProps> = ({
  currentUser,
  platformConfig,
  initialTab = 'deposit',
  suggestedMinAmount,
  onUserUpdated,
  onClose,
}) => {
  const [tab, setTab] = useState<'deposit' | 'ledger'>(initialTab);
  const [amountInput, setAmountInput] = useState<string>(() => {
    if (suggestedMinAmount && suggestedMinAmount > 0) {
      return Math.max(10, Math.ceil(suggestedMinAmount)).toFixed(2);
    }
    return '30.00';
  });
  const [noteInput, setNoteInput] = useState('');
  const [deposits, setDeposits] = useState<WalletDeposit[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadWalletData = useCallback(async () => {
    setLoading(true);
    try {
      const [deps, txs, freshUser] = await Promise.all([
        fetchMyWalletDeposits(currentUser.id),
        fetchWalletTransactions(currentUser.id),
        fetchUserProfileById(currentUser.id),
      ]);
      setDeposits(deps);
      setTransactions(txs);
      if (freshUser) onUserUpdated(freshUser);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, onUserUpdated]);

  useEffect(() => {
    loadWalletData();

    const ch = supabase
      .channel(`client-wallet-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_deposits', filter: `user_id=eq.${currentUser.id}` },
        () => {
          loadWalletData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_transactions', filter: `user_id=eq.${currentUser.id}` },
        () => {
          loadWalletData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUser.id, loadWalletData]);

  const numericAmount = useMemo(() => {
    const parsed = parseFloat(amountInput.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
  }, [amountInput]);

  const pixPayload = useMemo(
    () =>
      buildPixEmvPayload(
        platformConfig.platform_pix_key,
        platformConfig.platform_pix_receiver,
        platformConfig.platform_city,
        numericAmount > 0 ? numericAmount : 10,
        `SALDO${currentUser.id.slice(-6)}`
      ),
    [platformConfig, numericAmount, currentUser.id]
  );

  const pendingDeposits = useMemo(
    () => deposits.filter((d) => d.status === 'pending'),
    [deposits]
  );

  const copyValue = async (val: string, kind: 'code' | 'key') => {
    try {
      await navigator.clipboard.writeText(val);
      if (kind === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      }
    } catch {
      // Clipboard blocked
    }
  };

  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (numericAmount < 1) {
      setError('Informe um valor mínimo de R$ 1,00 para depósito.');
      return;
    }

    setSubmitting(true);
    try {
      await createWalletDepositRequest(currentUser.id, numericAmount, pixPayload, noteInput);
      setNoteInput('');
      setSuccessMsg(
        `Solicitação de ${formatBRL(numericAmount)} enviada! Assim que o Administrador confirmar no banco, o valor entra automaticamente no seu saldo.`
      );
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar solicitação de depósito.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1220] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="flex h-[90vh] sm:h-auto sm:max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                Meu Saldo & Depósitos
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Use seu saldo para pedir corridas com 1 toque
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
            aria-label="Fechar carteira"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Available Balance Hero Card */}
          <div className="rounded-3xl bg-neutral-950 dark:bg-neutral-950 p-5 text-white shadow-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-400">Saldo disponível</span>
              <button
                type="button"
                onClick={loadWalletData}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-[#FFD100]"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
            <p className="mt-1 font-display text-4xl font-extrabold text-[#FFD100] font-mono-num">
              {formatBRL(currentUser.wallet_balance || 0)}
            </p>
            {pendingDeposits.length > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-500/15 border border-amber-400/30 px-3 py-2 text-xs text-amber-200">
                <Clock className="h-4 w-4 shrink-0 text-[#FFD100] animate-pulse" />
                <span>
                  {pendingDeposits.length}{' '}
                  {pendingDeposits.length === 1
                    ? 'depósito aguardando confirmação do Admin'
                    : 'depósitos aguardando confirmação do Admin'}{' '}
                  (
                  <strong className="font-mono-num text-white">
                    {formatBRL(pendingDeposits.reduce((acc, d) => acc + d.amount, 0))}
                  </strong>
                  )
                </span>
              </div>
            )}
          </div>

          {/* Sub-Tabs */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1">
            <button
              type="button"
              onClick={() => setTab('deposit')}
              className={`min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition ${
                tab === 'deposit'
                  ? 'bg-white dark:bg-neutral-950 text-neutral-950 dark:text-[#FFD100] shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-300'
              }`}
            >
              <QrCode className="h-4 w-4" />
              Depositar via Pix
            </button>
            <button
              type="button"
              onClick={() => setTab('ledger')}
              className={`min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition ${
                tab === 'ledger'
                  ? 'bg-white dark:bg-neutral-950 text-neutral-950 dark:text-[#FFD100] shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-300'
              }`}
            >
              <Clock className="h-4 w-4" />
              Depósitos & Extrato ({deposits.length + transactions.length})
            </button>
          </div>

          {tab === 'deposit' ? (
            <form onSubmit={handleSubmitDeposit} className="space-y-4">
              {error && (
                <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-bold text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-3 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-2">
                  1. Quanto deseja depositar? (R$)
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2.5">
                  {DEPOSIT_PRESETS.map((val) => {
                    const active = numericAmount === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAmountInput(val.toFixed(2))}
                        className={`min-h-[40px] rounded-xl border font-mono-num text-xs font-extrabold transition ${
                          active
                            ? 'border-neutral-950 dark:border-[#FFD100] bg-neutral-950 dark:bg-[#FFD100] text-[#FFD100] dark:text-neutral-950'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                        }`}
                      >
                        R$ {val}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="Digite outro valor (ex: 25.00)"
                  className="min-h-[48px] w-full rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                />
              </div>

              <div className="rounded-3xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-neutral-950 dark:text-white">
                    2. Pague com o Pix da Plataforma
                  </span>
                  <span className="font-mono-num text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                    {formatBRL(numericAmount || 10)}
                  </span>
                </div>

                <div className="flex justify-center">
                  <div className="rounded-2xl border-2 border-neutral-950 bg-white p-3 shadow-xs">
                    <PixQrSvg payload={pixPayload} size={148} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-neutral-600 dark:text-neutral-300">
                      Pix Copia e Cola
                    </span>
                    <button
                      type="button"
                      onClick={() => copyValue(pixPayload, 'code')}
                      className="flex min-h-[34px] items-center gap-1 rounded-xl bg-neutral-950 dark:bg-[#FFD100] px-3 text-[11px] font-extrabold text-[#FFD100] dark:text-neutral-950"
                    >
                      {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCode ? 'Copiado!' : 'Copiar Código'}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={2}
                    value={pixPayload}
                    onClick={(e) => e.currentTarget.select()}
                    className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 font-mono text-[10px] text-neutral-800 dark:text-neutral-200 outline-none resize-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-neutral-200 dark:border-neutral-700 pt-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400">
                      Favorecido: {platformConfig.platform_pix_receiver}
                    </p>
                    <p className="font-mono-num text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                      {platformConfig.platform_pix_key}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyValue(platformConfig.platform_pix_key, 'key')}
                    className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-[11px] font-bold text-neutral-900 dark:text-neutral-100"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedKey ? 'Copiada' : 'Copiar chave'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  Observação opcional (ex: nome do titular da conta)
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Ex: Transferido por Maria Silva"
                  className="min-h-[44px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                />
              </div>

              <div className="flex items-start gap-2 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 text-[11px] text-amber-950 dark:text-amber-200">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                <span>
                  Após fazer o Pix no app do seu banco, clique abaixo. O Administrador confere o
                  recebimento e libera o saldo na sua conta.
                </span>
              </div>

              <button
                type="submit"
                disabled={submitting || numericAmount < 1}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
              >
                {submitting
                  ? 'Enviando solicitação...'
                  : `Já fiz o Pix de ${formatBRL(numericAmount)} · Avisar Admin`}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Deposits List */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Solicitações de Depósito ({deposits.length})
                </h4>
                {deposits.length === 0 ? (
                  <p className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Você ainda não solicitou depósitos via Pix.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {deposits.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-800/60 px-3.5 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {dep.status === 'approved' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : dep.status === 'rejected' ? (
                              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                            )}
                            <span className="font-extrabold text-neutral-950 dark:text-white">
                              {dep.status === 'approved'
                                ? 'Depósito Confirmado'
                                : dep.status === 'rejected'
                                ? 'Depósito Recusado'
                                : 'Aguardando confirmação do Admin'}
                            </span>
                          </div>
                          {dep.note && (
                            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">{dep.note}</p>
                          )}
                          <p className="text-[10px] text-neutral-400 font-mono-num">
                            {new Date(dep.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num text-sm font-extrabold shrink-0 ${
                            dep.status === 'approved'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : dep.status === 'rejected'
                              ? 'text-red-600 dark:text-red-400 line-through'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {formatBRL(dep.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Wallet Transactions Ledger */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Extrato da Carteira ({transactions.length})
                </h4>
                {transactions.length === 0 ? (
                  <p className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Nenhuma movimentação registrada ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {transactions.map((tx) => {
                      const isPositive = tx.amount >= 0;
                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 px-3.5 py-2.5 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                                isPositive
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                              }`}
                            >
                              {isPositive ? (
                                <ArrowDownLeft className="h-4 w-4" />
                              ) : (
                                <ArrowUpRight className="h-4 w-4" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="font-bold text-neutral-950 dark:text-white truncate">
                                {TX_TYPE_LABEL[tx.type] || tx.description}
                              </p>
                              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                                {tx.description} · {new Date(tx.created_at).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`font-mono-num text-xs font-extrabold shrink-0 ${
                              isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-950 dark:text-white'
                            }`}
                          >
                            {isPositive ? `+ ${formatBRL(tx.amount)}` : `- ${formatBRL(Math.abs(tx.amount))}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
