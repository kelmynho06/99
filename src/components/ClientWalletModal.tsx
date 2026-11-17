import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import {
  createWalletDepositRequest,
  fetchMyWalletDeposits,
  fetchMyWalletWithdrawals,
  fetchUserProfileById,
  fetchWalletTransactions,
  lookupWalletRecipient,
  requestWalletWithdrawal,
  transferWalletBalance,
} from '../lib/mobilityApi';
import { PixQrSvg, usePixSecurityRotation } from '../lib/pixQr';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
  UserProfile,
  WalletDeposit,
  WalletRecipientMatch,
  WalletTransaction,
  WalletWithdrawal,
} from '../types/mobility';
import { AvatarImage } from './AvatarImage';

export type WalletModalTab = 'deposit' | 'transfer' | 'withdraw' | 'ledger';

interface ClientWalletModalProps {
  currentUser: UserProfile;
  platformConfig: PlatformConfig;
  initialTab?: WalletModalTab;
  suggestedMinAmount?: number;
  onUserUpdated: (user: UserProfile) => void;
  onClose: () => void;
}

const DEPOSIT_PRESETS = [15, 30, 50, 100];
const WITHDRAW_PRESETS = [20, 50, 100, 200];

const TX_TYPE_LABEL: Record<WalletTransaction['type'], string> = {
  deposit: 'Depósito Pix confirmado',
  ride_debit: 'Corrida paga com Saldo',
  ride_refund: 'Estorno automático',
  admin_adjustment: 'Ajuste pelo Admin',
  ride_earning: 'Ganho de corrida',
  payout: 'Repasse Pix',
  dispute_settlement: 'Acerto de disputa',
  transfer_in: 'Transferência recebida',
  transfer_out: 'Transferência enviada',
  withdrawal: 'Saque Pix solicitado',
  withdrawal_refund: 'Estorno de saque',
};

export const ClientWalletModal: React.FC<ClientWalletModalProps> = ({
  currentUser,
  platformConfig,
  initialTab = 'deposit',
  suggestedMinAmount,
  onUserUpdated,
  onClose,
}) => {
  const { t } = useTranslation();
  const isDriver = currentUser.role === 'driver';
  const [tab, setTab] = useState<WalletModalTab>(
    initialTab === 'withdraw' && !isDriver ? 'deposit' : initialTab
  );

  // Deposit state
  const [amountInput, setAmountInput] = useState<string>(() => {
    if (suggestedMinAmount && suggestedMinAmount > 0) {
      return Math.max(10, Math.ceil(suggestedMinAmount)).toFixed(2);
    }
    return '30.00';
  });
  const [noteInput, setNoteInput] = useState('');

  // Transfer P2P state
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientMatches, setRecipientMatches] = useState<WalletRecipientMatch[]>([]);
  const [searchingRecipient, setSearchingRecipient] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<WalletRecipientMatch | null>(null);
  const [transferAmountInput, setTransferAmountInput] = useState('10.00');
  const [transferNote, setTransferNote] = useState('');

  // Driver withdrawal state
  const [withdrawAmountInput, setWithdrawAmountInput] = useState(() =>
    currentUser.wallet_balance >= 5
      ? Number(currentUser.wallet_balance).toFixed(2)
      : '20.00'
  );
  const [withdrawPixKey, setWithdrawPixKey] = useState(
    () => currentUser.driver?.pix_key || currentUser.phone || currentUser.email || ''
  );

  // Shared records state
  const [deposits, setDeposits] = useState<WalletDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawal[]>([]);
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
      const [deps, wds, txs, freshUser] = await Promise.all([
        fetchMyWalletDeposits(currentUser.id),
        isDriver ? fetchMyWalletWithdrawals(currentUser.id) : Promise.resolve([]),
        fetchWalletTransactions(currentUser.id),
        fetchUserProfileById(currentUser.id),
      ]);
      setDeposits(deps);
      setWithdrawals(wds);
      setTransactions(txs);
      if (freshUser) onUserUpdated(freshUser);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, isDriver, onUserUpdated]);

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
        { event: '*', schema: 'public', table: 'wallet_withdrawals', filter: `user_id=eq.${currentUser.id}` },
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

  // Debounced P2P recipient lookup
  useEffect(() => {
    if (tab !== 'transfer') return;
    const clean = recipientQuery.trim();
    if (clean.length < 3) {
      setRecipientMatches([]);
      setSearchingRecipient(false);
      return;
    }

    let cancelled = false;
    setSearchingRecipient(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await lookupWalletRecipient(clean);
        if (!cancelled) {
          setRecipientMatches(res.filter((r) => r.id !== currentUser.id));
        }
      } catch {
        if (!cancelled) setRecipientMatches([]);
      } finally {
        if (!cancelled) setSearchingRecipient(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recipientQuery, tab, currentUser.id]);

  const { formattedTimer, cycle } = usePixSecurityRotation(90);

  const numericAmount = useMemo(() => {
    const parsed = parseFloat(amountInput.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
  }, [amountInput]);

  const numericTransferAmount = useMemo(() => {
    const parsed = parseFloat(transferAmountInput.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
  }, [transferAmountInput]);

  const numericWithdrawAmount = useMemo(() => {
    const parsed = parseFloat(withdrawAmountInput.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
  }, [withdrawAmountInput]);

  const pixPayload = useMemo(
    () =>
      buildPixEmvPayload(
        platformConfig.platform_pix_key,
        platformConfig.platform_pix_receiver,
        platformConfig.platform_city,
        numericAmount > 0 ? numericAmount : 10,
        `SALDO${currentUser.id.slice(-4)}C${cycle}`
      ),
    [platformConfig, numericAmount, currentUser.id, cycle]
  );

  const pendingDeposits = useMemo(
    () => deposits.filter((d) => d.status === 'pending'),
    [deposits]
  );
  const pendingWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.status === 'pending'),
    [withdrawals]
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

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!selectedRecipient) {
      setError('Busque e selecione o destinatário antes de transferir.');
      return;
    }
    if (numericTransferAmount <= 0) {
      setError('Informe um valor válido maior que zero.');
      return;
    }
    if (numericTransferAmount > currentUser.wallet_balance) {
      setError(`Saldo insuficiente. Disponível: ${formatBRL(currentUser.wallet_balance)}.`);
      return;
    }

    setSubmitting(true);
    try {
      await transferWalletBalance(selectedRecipient.id, numericTransferAmount, transferNote);
      setSuccessMsg(
        `Transferência de ${formatBRL(numericTransferAmount)} para ${selectedRecipient.full_name} concluída com sucesso!`
      );
      setSelectedRecipient(null);
      setRecipientQuery('');
      setTransferNote('');
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (numericWithdrawAmount < 5) {
      setError('O valor mínimo para solicitar saque Pix é R$ 5,00.');
      return;
    }
    if (numericWithdrawAmount > currentUser.wallet_balance) {
      setError(`Saldo insuficiente para saque. Disponível: ${formatBRL(currentUser.wallet_balance)}.`);
      return;
    }
    if (!withdrawPixKey.trim()) {
      setError('Informe a chave Pix onde deseja receber o pagamento.');
      return;
    }

    setSubmitting(true);
    try {
      await requestWalletWithdrawal(numericWithdrawAmount, withdrawPixKey.trim());
      setSuccessMsg(
        `Saque de ${formatBRL(numericWithdrawAmount)} enviado ao Administrador! Você será notificado assim que o Pix for pago.`
      );
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar saque.');
    } finally {
      setSubmitting(false);
    }
  };

  const tabsList: Array<{
    id: WalletModalTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'deposit', label: t.deposit, icon: QrCode },
    { id: 'transfer', label: t.transfer, icon: Send },
    ...(isDriver ? [{ id: 'withdraw' as const, label: t.withdraw, icon: Banknote }] : []),
    { id: 'ledger', label: t.statement, icon: Clock },
  ];

  return (
    <div className="fixed inset-0 z-[1220] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-4">
      <div className="flex h-[92vh] sm:h-auto sm:max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950 shadow-xs">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                {t.wallet_title}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {isDriver
                  ? 'Deposite, transfira ou solicite saque via Pix'
                  : 'Deposite, transfira saldo e pague corridas'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Available Balance Hero Card */}
          <div className="rounded-3xl bg-neutral-950 p-5 text-white shadow-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-400">{t.wallet_balance}</span>
              <button
                type="button"
                onClick={loadWalletData}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-[#FFD100]"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>
            <p className="mt-1 font-display text-4xl font-extrabold text-[#FFD100] font-mono-num">
              {formatBRL(currentUser.wallet_balance || 0)}
            </p>
            {pendingDeposits.length > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-500/15 border border-amber-400/30 px-3 py-2 text-xs text-amber-200">
                <Clock className="h-4 w-4 shrink-0 text-[#FFD100] animate-pulse" />
                <span>
                  {pendingDeposits.length} depósito(s) pendente(s):{' '}
                  <strong className="font-mono-num text-white">
                    {formatBRL(pendingDeposits.reduce((acc, d) => acc + d.amount, 0))}
                  </strong>
                </span>
              </div>
            )}
            {pendingWithdrawals.length > 0 && (
              <div className="mt-2 flex items-center gap-2 rounded-2xl bg-sky-500/15 border border-sky-400/30 px-3 py-2 text-xs text-sky-200">
                <Clock className="h-4 w-4 shrink-0 text-sky-300 animate-pulse" />
                <span>
                  {pendingWithdrawals.length} saque(s) em análise:{' '}
                  <strong className="font-mono-num text-white">
                    {formatBRL(pendingWithdrawals.reduce((acc, w) => acc + w.amount, 0))}
                  </strong>
                </span>
              </div>
            )}
          </div>

          {/* Sub-Tabs */}
          <div
            className={`grid gap-1 rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1 ${
              isDriver ? 'grid-cols-4' : 'grid-cols-3'
            }`}
          >
            {tabsList.map((tb) => {
              const Icon = tb.icon;
              const active = tab === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => {
                    setTab(tb.id);
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className={`min-h-[42px] flex flex-col sm:flex-row items-center justify-center gap-1 rounded-xl px-1.5 py-1 text-[11px] font-extrabold transition ${
                    active
                      ? 'bg-white dark:bg-neutral-950 text-neutral-950 dark:text-[#FFD100] shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tb.label}</span>
                </button>
              );
            })}
          </div>

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

          {/* TAB 1: DEPOSIT PIX */}
          {tab === 'deposit' && (
            <form onSubmit={handleSubmitDeposit} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-2">
                  1. Quanto deseja depositar? ({t.amount_label})
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
                  placeholder="Ex: 25.00"
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

                <div className="flex flex-col items-center gap-2">
                  <div
                    key={cycle}
                    className="rounded-2xl border-2 border-neutral-950 bg-white p-3 shadow-xs transition-opacity"
                  >
                    {platformConfig.platform_pix_qr_url ? (
                      <img
                        src={platformConfig.platform_pix_qr_url}
                        alt="QR Code Pix Oficial"
                        className="h-40 w-40 object-contain rounded-lg"
                      />
                    ) : (
                      <PixQrSvg payload={pixPayload} size={148} />
                    )}
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                    <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '6s' }} />
                    <span>
                      Atualização em <strong className="font-mono-num">{formattedTimer}</strong> · Mesma chave
                    </span>
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
                  ? t.saving
                  : `Já fiz o Pix de ${formatBRL(numericAmount)} · Avisar Admin`}
              </button>
            </form>
          )}

          {/* TAB 2: TRANSFER P2P TO OTHER APP USERS */}
          {tab === 'transfer' && (
            <form onSubmit={handleSubmitTransfer} className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 text-xs text-neutral-700 dark:text-neutral-300">
                <p className="font-extrabold text-neutral-950 dark:text-white flex items-center gap-1.5">
                  <Send className="h-4 w-4 text-amber-600" />
                  {t.transfer_to_user}
                </p>
                <p className="mt-1 text-[11px]">
                  Envie saldo instantaneamente para outro cliente ou motorista cadastrado usando
                  e-mail, telefone ou nome.
                </p>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-1.5">
                  1. Buscar destinatário
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 focus-within:border-neutral-950 dark:focus-within:border-[#FFD100]">
                  <Search className="h-4 w-4 text-neutral-400 shrink-0" />
                  <input
                    type="text"
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value);
                      setSelectedRecipient(null);
                    }}
                    placeholder={t.transfer_search_placeholder}
                    className="min-h-[46px] flex-1 bg-transparent text-xs font-semibold text-neutral-950 dark:text-white outline-none"
                  />
                  {recipientQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecipientQuery('');
                        setSelectedRecipient(null);
                        setRecipientMatches([]);
                      }}
                      className="text-neutral-400 hover:text-neutral-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {searchingRecipient && (
                  <p className="mt-1.5 text-[11px] font-semibold text-neutral-500">
                    Buscando contas cadastradas...
                  </p>
                )}

                {!selectedRecipient && recipientMatches.length > 0 && (
                  <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
                    {recipientMatches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => {
                          setSelectedRecipient(match);
                          setRecipientMatches([]);
                        }}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
                      >
                        <AvatarImage
                          src={match.avatar_url}
                          name={match.full_name}
                          className="h-9 w-9 rounded-full object-cover border border-[#FFD100] shrink-0"
                          fallbackClassName="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] text-xs font-extrabold shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                            {match.full_name}
                          </p>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                            {match.role === 'driver' ? t.driver_role_badge : t.passenger_role_badge} ·{' '}
                            {match.email || match.phone}
                          </p>
                        </div>
                        <span className="rounded-lg bg-[#FFD100] px-2 py-1 text-[10px] font-extrabold text-neutral-950">
                          Selecionar
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {selectedRecipient && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarImage
                        src={selectedRecipient.avatar_url}
                        name={selectedRecipient.full_name}
                        className="h-10 w-10 rounded-full object-cover border-2 border-emerald-500 shrink-0"
                        fallbackClassName="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-extrabold shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-emerald-950 dark:text-emerald-200 truncate flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5 shrink-0" />
                          {selectedRecipient.full_name}
                        </p>
                        <p className="text-[11px] text-emerald-800 dark:text-emerald-300 truncate">
                          {selectedRecipient.email || selectedRecipient.phone}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRecipient(null)}
                      className="text-xs font-bold text-emerald-800 dark:text-emerald-300 underline shrink-0"
                    >
                      Trocar
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-1.5">
                  2. {t.amount_label}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max={Math.max(0.5, currentUser.wallet_balance)}
                  required
                  value={transferAmountInput}
                  onChange={(e) => setTransferAmountInput(e.target.value)}
                  className="min-h-[48px] w-full rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  Mensagem opcional
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="Ex: Ajuda na corrida / Pagamento"
                  className="min-h-[44px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                />
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !selectedRecipient ||
                  numericTransferAmount <= 0 ||
                  numericTransferAmount > currentUser.wallet_balance
                }
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-45"
              >
                <Send className="h-4 w-4" />
                {submitting
                  ? t.saving
                  : `Transferir ${formatBRL(numericTransferAmount)} Agora`}
              </button>
            </form>
          )}

          {/* TAB 3: DRIVER WITHDRAWAL VIA PIX */}
          {tab === 'withdraw' && isDriver && (
            <form onSubmit={handleSubmitWithdrawal} className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 text-xs text-neutral-700 dark:text-neutral-300">
                <p className="font-extrabold text-neutral-950 dark:text-white flex items-center gap-1.5">
                  <Banknote className="h-4 w-4 text-emerald-600" />
                  {t.withdraw_pix_title}
                </p>
                <p className="mt-1 text-[11px]">
                  O valor solicitado fica reservado automaticamente do seu saldo até o Administrador
                  realizar o envio do Pix para sua chave.
                </p>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-2">
                  1. Quanto deseja sacar? (mín. R$ 5,00)
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2.5">
                  {WITHDRAW_PRESETS.map((val) => {
                    const disabledPreset = val > currentUser.wallet_balance;
                    const active = numericWithdrawAmount === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        disabled={disabledPreset}
                        onClick={() => setWithdrawAmountInput(val.toFixed(2))}
                        className={`min-h-[40px] rounded-xl border font-mono-num text-xs font-extrabold transition disabled:opacity-35 ${
                          active
                            ? 'border-neutral-950 dark:border-[#FFD100] bg-neutral-950 dark:bg-[#FFD100] text-[#FFD100] dark:text-neutral-950'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                        }`}
                      >
                        R$ {val}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="5"
                    max={Math.max(5, currentUser.wallet_balance)}
                    required
                    value={withdrawAmountInput}
                    onChange={(e) => setWithdrawAmountInput(e.target.value)}
                    className="min-h-[48px] flex-1 rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                  />
                  {currentUser.wallet_balance >= 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawAmountInput(Number(currentUser.wallet_balance).toFixed(2))
                      }
                      className="rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-3 text-xs font-extrabold text-neutral-900 dark:text-white"
                    >
                      Tudo
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100 mb-1.5">
                  2. {t.pix_key_label}
                </label>
                <input
                  type="text"
                  required
                  value={withdrawPixKey}
                  onChange={(e) => setWithdrawPixKey(e.target.value)}
                  placeholder="CPF, Celular, E-mail ou Chave Aleatória"
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 font-mono-num text-xs font-bold text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                />
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  numericWithdrawAmount < 5 ||
                  numericWithdrawAmount > currentUser.wallet_balance ||
                  !withdrawPixKey.trim()
                }
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-45"
              >
                <Banknote className="h-4 w-4" />
                {submitting
                  ? t.saving
                  : `${t.request_withdraw_btn} (${formatBRL(numericWithdrawAmount)})`}
              </button>
            </form>
          )}

          {/* TAB 4: STATEMENT & REQUESTS */}
          {tab === 'ledger' && (
            <div className="space-y-4">
              {isDriver && withdrawals.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Solicitações de Saque ({withdrawals.length})
                  </h4>
                  <div className="space-y-2">
                    {withdrawals.map((wd) => (
                      <div
                        key={wd.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-800/60 px-3.5 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {wd.status === 'paid' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : wd.status === 'rejected' ? (
                              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                            )}
                            <span className="font-extrabold text-neutral-950 dark:text-white">
                              {wd.status === 'paid'
                                ? 'Saque Pix Pago'
                                : wd.status === 'rejected'
                                ? 'Saque Recusado (Estornado)'
                                : 'Aguardando pagamento do Admin'}
                            </span>
                          </div>
                          <p className="mt-0.5 font-mono-num text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                            Chave: {wd.pix_key}
                          </p>
                          <p className="text-[10px] text-neutral-400 font-mono-num">
                            {new Date(wd.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num text-sm font-extrabold shrink-0 ${
                            wd.status === 'paid'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : wd.status === 'rejected'
                              ? 'text-red-600 dark:text-red-400 line-through'
                              : 'text-sky-700 dark:text-sky-400'
                          }`}
                        >
                          {formatBRL(wd.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                              {dep.note}
                            </p>
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
                              isPositive
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-neutral-950 dark:text-white'
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
