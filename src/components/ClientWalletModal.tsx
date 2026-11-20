import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Home,
  Info,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  QrCode,
  Receipt,
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
  getDepositWindowStatus,
  lookupWalletRecipient,
  requestWalletWithdrawal,
  transferirSaldo66,
  updateMyPay66Key,
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
import { BorealLogoMark } from './BorealBrandAssets';
import { Receipt66PayModal } from './Receipt66PayModal';

export type WalletModalTab = 'home' | 'deposit' | 'transfer' | 'qrcode' | 'withdraw' | 'ledger';

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

const TX_REASON_LABEL: Record<WalletTransaction['type'], string> = {
  deposit: 'Depósito Pix confirmado',
  ride_debit: 'Corrida paga',
  ride_refund: 'Estorno automático',
  admin_adjustment: 'Ajuste administrativo',
  ride_earning: 'Ganho de corrida',
  payout: 'Repasse Pix',
  dispute_settlement: 'Acerto de disputa',
  transfer_in: 'Transferência BorealPay recebida',
  transfer_out: 'Transferência BorealPay enviada',
  withdrawal: 'Saque Pix solicitado',
  withdrawal_refund: 'Estorno de saque Pix',
};

function formatDateGroupLabel(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Movimentações';

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  const itemKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  if (itemKey === todayKey) return 'Hoje';
  if (itemKey === yesterdayKey) return 'Ontem';

  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTimeHHMM(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const ClientWalletModal: React.FC<ClientWalletModalProps> = ({
  currentUser,
  platformConfig,
  initialTab = 'home',
  suggestedMinAmount,
  onUserUpdated,
  onClose,
}) => {
  const { t } = useTranslation();
  const isDriver = currentUser.role === 'driver';
  const [nowTick, setNowTick] = useState(() => Date.now());
  const depositWindow = useMemo(
    () => getDepositWindowStatus(platformConfig, new Date(nowTick)),
    [platformConfig, nowTick]
  );

  const [depositSecurityAccepted, setDepositSecurityAccepted] = useState(false);
  const [showDepositSecurityGate, setShowDepositSecurityGate] = useState(
    () => initialTab === 'deposit' && getDepositWindowStatus(platformConfig).isOpen
  );
  const [tab, setTab] = useState<WalletModalTab>(() => {
    if (initialTab === 'withdraw' && !isDriver) return 'home';
    if (initialTab === 'deposit') {
      return getDepositWindowStatus(platformConfig).isOpen ? 'home' : 'deposit';
    }
    return initialTab;
  });
  const [hideBalance, setHideBalance] = useState<boolean>(() => {
    try {
      return localStorage.getItem('meia66_hide_balance') === '1';
    } catch {
      return false;
    }
  });

  // Deposit state
  const [amountInput, setAmountInput] = useState<string>(() => {
    if (suggestedMinAmount && suggestedMinAmount > 0) {
      return Math.max(10, Math.ceil(suggestedMinAmount)).toFixed(2);
    }
    return '30.00';
  });
  const [noteInput, setNoteInput] = useState('');

  // Chave BorealPay editor state
  const defaultFallback66Key = `BOREAL-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const [editingPay66Key, setEditingPay66Key] = useState(false);
  const [pay66KeyInput, setPay66KeyInput] = useState(
    () => currentUser.pay66_key || defaultFallback66Key
  );
  const [savingPay66Key, setSavingPay66Key] = useState(false);

  // Transfer P2P state + QR Scanner
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientMatches, setRecipientMatches] = useState<WalletRecipientMatch[]>([]);
  const [searchingRecipient, setSearchingRecipient] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<WalletRecipientMatch | null>(null);
  const [transferAmountInput, setTransferAmountInput] = useState('10.00');
  const [transferNote, setTransferNote] = useState('');
  const [showTransferQrScanner, setShowTransferQrScanner] = useState(false);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const [qrScanReady, setQrScanReady] = useState(false);
  const transferVideoRef = useRef<HTMLVideoElement | null>(null);
  const transferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transferStreamRef = useRef<MediaStream | null>(null);
  const transferRafRef = useRef<number | null>(null);

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
  const [copiedMy66Pay, setCopiedMy66Pay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [selectedReceiptTx, setSelectedReceiptTx] = useState<WalletTransaction | null>(null);
  const [lastTransferReceiptTx, setLastTransferReceiptTx] = useState<WalletTransaction | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (currentUser.pay66_key && !editingPay66Key) {
      setPay66KeyInput(currentUser.pay66_key);
    }
  }, [currentUser.pay66_key, editingPay66Key]);

  const toggleHideBalance = () => {
    setHideBalance((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('meia66_hide_balance', next ? '1' : '0');
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };

  const switchTab = (nextTab: WalletModalTab) => {
    setError(null);
    setSuccessMsg(null);
    setLastTransferReceiptTx(null);
    if (nextTab === 'deposit' && depositWindow.isOpen && !depositSecurityAccepted) {
      setShowDepositSecurityGate(true);
      return;
    }
    setTab(nextTab);
  };

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
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recipientQuery, tab, currentUser.id]);

  const stopTransferQrCamera = useCallback(() => {
    if (transferRafRef.current !== null) {
      window.cancelAnimationFrame(transferRafRef.current);
      transferRafRef.current = null;
    }
    if (transferStreamRef.current) {
      try {
        transferStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // Ignore stop errors
      }
      transferStreamRef.current = null;
    }
    setQrScanReady(false);
  }, []);

  useEffect(() => {
    if (!showTransferQrScanner) {
      stopTransferQrCamera();
      return;
    }

    let cancelled = false;
    let locked = false;
    setQrScanError(null);

    const startScanner = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setQrScanError('Câmera indisponível neste navegador. Digite a Chave BorealPay manualmente.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        transferStreamRef.current = stream;
        if (transferVideoRef.current) {
          transferVideoRef.current.srcObject = stream;
          await transferVideoRef.current.play().catch(() => {});
        }
        setQrScanReady(true);

        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
            };
          }
        ).BarcodeDetector;
        const nativeDetector = BarcodeDetectorCtor
          ? (() => {
              try {
                return new BarcodeDetectorCtor({ formats: ['qr_code'] });
              } catch {
                return null;
              }
            })()
          : null;

        let lastAt = 0;
        const scanLoop = async () => {
          if (cancelled || locked) return;
          const video = transferVideoRef.current;
          const now = Date.now();
          if (video && video.readyState >= 2 && video.videoWidth > 0 && now - lastAt >= 220) {
            lastAt = now;
            try {
              let detected: string | null = null;
              const canvas = transferCanvasRef.current;
              if (canvas) {
                const w = Math.min(480, video.videoWidth);
                const h = Math.max(1, Math.round(video.videoHeight * (w / video.videoWidth)));
                if (canvas.width !== w || canvas.height !== h) {
                  canvas.width = w;
                  canvas.height = h;
                }
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, w, h);
                  const imgData = ctx.getImageData(0, 0, w, h);
                  const code = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
                  if (code?.data) detected = code.data;
                }
              }
              if (!detected && nativeDetector) {
                const found = await nativeDetector.detect(video).catch(() => []);
                if (found.length > 0 && found[0]?.rawValue) detected = found[0].rawValue;
              }

              if (detected && !locked) {
                locked = true;
                stopTransferQrCamera();
                setShowTransferQrScanner(false);
                const matches = await lookupWalletRecipient(detected).catch(() => []);
                const target = matches.find((m) => m.id !== currentUser.id);
                if (target) {
                  setSelectedRecipient(target);
                  setRecipientMatches([]);
                  setRecipientQuery(target.pay66_key || target.full_name);
                  setSuccessMsg(`QR Code BorealPay lido! Destinatário: ${target.full_name}.`);
                } else {
                  setRecipientQuery(detected);
                  setError('QR Code lido, mas nenhum usuário BorealPay ativo foi localizado.');
                }
                return;
              }
            } catch {
              // Ignore single-frame glitch
            }
          }
          if (!cancelled) {
            transferRafRef.current = window.requestAnimationFrame(() => {
              void scanLoop();
            });
          }
        };

        transferRafRef.current = window.requestAnimationFrame(() => {
          void scanLoop();
        });
      } catch {
        if (!cancelled) {
          setQrScanError('Não foi possível acessar a câmera. Informe a Chave BorealPay no campo de busca.');
        }
      }
    };

    void startScanner();
    return () => {
      cancelled = true;
      stopTransferQrCamera();
    };
  }, [showTransferQrScanner, currentUser.id, stopTransferQrCamera]);

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

  // Identificador e Chave exclusiva BorealPay
  const myPay66Key =
    currentUser.pay66_key ||
    `BOREAL-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const my66PayIdentifier = currentUser.email || currentUser.phone || currentUser.id;
  const my66PayQrPayload = useMemo(
    () => `BOREALPAY|${currentUser.id}|${myPay66Key}|${currentUser.email}|${currentUser.full_name}`,
    [currentUser.id, myPay66Key, currentUser.email, currentUser.full_name]
  );

  const pendingDeposits = useMemo(
    () => deposits.filter((d) => d.status === 'pending'),
    [deposits]
  );
  const pendingWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.status === 'pending'),
    [withdrawals]
  );

  const groupedTransactions = useMemo(() => {
    const groups: Array<{ label: string; items: WalletTransaction[] }> = [];
    const indexMap = new Map<string, number>();

    for (const tx of transactions) {
      const label = formatDateGroupLabel(tx.created_at);
      const existingIdx = indexMap.get(label);
      if (existingIdx === undefined) {
        indexMap.set(label, groups.length);
        groups.push({ label, items: [tx] });
      } else {
        groups[existingIdx].items.push(tx);
      }
    }
    return groups;
  }, [transactions]);

  const copyValue = async (val: string, kind: 'code' | 'key' | '66pay') => {
    try {
      await navigator.clipboard.writeText(val);
      if (kind === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else if (kind === 'key') {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedMy66Pay(true);
        setTimeout(() => setCopiedMy66Pay(false), 2000);
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
        `Solicitação de ${formatBRL(numericAmount)} enviada! Assim que o Administrador confirmar no banco, o valor entra automaticamente na sua carteira BorealPay.`
      );
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar solicitação de depósito.');
    } finally {
      setSubmitting(false);
    }
  };

  const canTransferDirect =
    Boolean(selectedRecipient) ||
    recipientQuery.trim().includes('@') ||
    recipientQuery.trim().toUpperCase().startsWith('BOREAL-') ||
    recipientQuery.trim().toUpperCase().startsWith('BOREALPAY|') ||
    recipientQuery.trim().toUpperCase().startsWith('66-') ||
    recipientQuery.trim().toUpperCase().startsWith('66PAY|') ||
    recipientQuery.replace(/\D/g, '').length >= 10;

  const handleSavePay66Key = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSavingPay66Key(true);
    try {
      const updated = await updateMyPay66Key(currentUser.id, pay66KeyInput);
      onUserUpdated(updated);
      setEditingPay66Key(false);
      setSuccessMsg(
        `Chave BorealPay "${updated.pay66_key}" cadastrada! Seu QR Code BorealPay foi atualizado automaticamente.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar sua Chave BorealPay.');
    } finally {
      setSavingPay66Key(false);
    }
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const targetParam = selectedRecipient ? selectedRecipient.id : recipientQuery.trim();
    if (!targetParam || (!selectedRecipient && !canTransferDirect)) {
      setError('Busque e selecione o destinatário (ou informe o e-mail/telefone completo).');
      return;
    }
    if (numericTransferAmount < 1) {
      setError('O valor mínimo para transferência BorealPay é R$ 1,00.');
      return;
    }
    if (numericTransferAmount > currentUser.wallet_balance) {
      setError(`Saldo insuficiente. Disponível: ${formatBRL(currentUser.wallet_balance)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const receiptTx = await transferirSaldo66(targetParam, numericTransferAmount, transferNote);
      const targetName = selectedRecipient?.full_name || recipientQuery.trim();
      setSuccessMsg(
        `Transferência BorealPay de ${formatBRL(numericTransferAmount)} para ${targetName} concluída instantaneamente!`
      );
      setLastTransferReceiptTx(receiptTx);
      setSelectedRecipient(null);
      setRecipientQuery('');
      setTransferNote('');
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir transferência BorealPay.');
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

  const renderTransactionItem = (tx: WalletTransaction) => {
    const isPositive = tx.amount >= 0;
    const timeStr = formatTimeHHMM(tx.created_at);
    const reasonLabel = TX_REASON_LABEL[tx.type] || tx.description;

    return (
      <button
        key={tx.id}
        type="button"
        onClick={() => setSelectedReceiptTx(tx)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#CCFBF1] dark:border-teal-900/60 bg-white dark:bg-[#0F2421] px-3.5 py-3 text-left shadow-2xs hover:border-[#2DD4BF] active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              isPositive
                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-100 dark:bg-neutral-800 text-rose-600 dark:text-rose-400'
            }`}
          >
            {isPositive ? (
              <ArrowDownLeft className="h-5 w-5" />
            ) : (
              <ArrowUpRight className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate">
              {reasonLabel}
            </p>
            <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 truncate">
              {tx.description}
            </p>
            <p className="mt-0.5 font-mono-num text-[10px] font-bold text-neutral-400 dark:text-neutral-500">
              {timeStr} · Toque para comprovante
            </p>
          </div>
        </div>
        <span
          className={`font-mono-num text-sm font-extrabold shrink-0 ${
            isPositive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-neutral-950 dark:text-neutral-100'
          }`}
        >
          {hideBalance
            ? 'R$ ••••'
            : isPositive
            ? `+ ${formatBRL(tx.amount)}`
            : `- ${formatBRL(Math.abs(tx.amount))}`}
        </span>
      </button>
    );
  };

  const bottomNavItems: Array<{
    id: WalletModalTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'transfer', label: 'Transferir', icon: Send },
    { id: 'deposit', label: 'Depositar', icon: Plus },
    ...(isDriver
      ? [{ id: 'withdraw' as const, label: 'Sacar', icon: Banknote }]
      : [{ id: 'qrcode' as const, label: 'QR Code', icon: QrCode }]),
    { id: 'ledger', label: 'Extrato', icon: Receipt },
  ];

  return (
    <div className="fixed inset-0 z-[1220] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs p-0 sm:p-4">
      <div
        className={`relative flex h-[94vh] sm:h-auto sm:max-h-[92vh] w-full max-w-md flex-col rounded-t-[28px] sm:rounded-[28px] bg-[#F7FBFA] dark:bg-[#081513] shadow-2xl overflow-hidden border border-[#2DD4BF]/35 dark:border-teal-900 ${
          selectedReceiptTx ? 'no-print' : ''
        }`}
      >
        {/* Top Brand Bar BorealPay (Light Aurora Boreal) */}
        <div className="aurora-surface-flow flex items-center justify-between px-5 pt-4 pb-3.5 text-[#0F2421] border-b border-[#2DD4BF]/35 shrink-0">
          <div className="flex items-center gap-2.5">
            <BorealLogoMark className="h-10 w-10 shrink-0 shadow-sm rounded-xl" />
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-lg font-extrabold tracking-tight text-[#0F2421]">
                  BorealPay
                </h3>
                <span className="rounded-full bg-[#CCFBF1] border border-[#2DD4BF]/60 px-2 py-0.5 text-[10px] font-extrabold text-[#065F46]">
                  Carteira Oficial
                </span>
              </div>
              <p className="text-[11px] font-medium text-[#334E4A]">
                {isDriver ? 'Ganhos, saques e recebimentos BorealPay' : 'Saldo exclusivo, depósitos e transferências BorealPay'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 border border-[#2DD4BF]/35 text-[#0F2421] hover:bg-[#ECFDF5] active:scale-95 transition"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body (with extra bottom padding for floating pill dock) */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 space-y-4">
          {/* CABEÇALHO AURORA BOREALPAY */}
          <div className="aurora-border-glow rounded-3xl bg-white dark:bg-[#0F2421] p-5 text-[#0F2421] dark:text-white shadow-lg space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#334E4A] dark:text-[#6EE7B7]">Saldo disponível BorealPay</span>
                  <button
                    type="button"
                    onClick={toggleHideBalance}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ECFDF5] dark:bg-teal-950/60 border border-[#6EE7B7]/60 dark:border-teal-800 text-[#047857] dark:text-[#6EE7B7] hover:bg-[#CCFBF1] transition"
                    aria-label={hideBalance ? 'Mostrar saldo' : 'Ocultar saldo'}
                    title={hideBalance ? 'Mostrar saldo' : 'Ocultar saldo'}
                  >
                    {hideBalance ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="mt-1 font-display text-4xl font-extrabold text-[#047857] dark:text-[#6EE7B7] font-mono-num tracking-tight">
                  {hideBalance ? 'R$ •••••' : formatBRL(currentUser.wallet_balance || 0)}
                </p>
                {Number(currentUser.reserved_balance || 0) > 0 && (
                  <p className="mt-1 text-[11px] font-bold text-[#0891B2] dark:text-[#2DD4BF] font-mono-num">
                    Reservado em corrida ativa: {hideBalance ? '••••' : formatBRL(currentUser.reserved_balance || 0)}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={loadWalletData}
                disabled={loading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] dark:bg-teal-950/60 border border-[#6EE7B7]/60 dark:border-teal-800 text-[#047857] dark:text-[#6EE7B7] hover:bg-[#CCFBF1] active:scale-95 transition"
                aria-label="Atualizar saldo"
                title="Atualizar saldo"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Prominent Deposit CTA + Driver Withdraw shortcut */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => switchTab('deposit')}
                className="aurora-accent-flow flex flex-1 min-h-[46px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold text-white shadow-md hover:brightness-105 active:scale-[0.98] transition"
              >
                <Plus className="h-4 w-4 stroke-[2.5]" />
                <span>Depositar</span>
              </button>
              {isDriver ? (
                <button
                  type="button"
                  onClick={() => switchTab('withdraw')}
                  className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#34D399] px-4 text-xs font-extrabold text-[#065F46] dark:text-[#6EE7B7] shadow-2xs hover:bg-[#CCFBF1] active:scale-[0.98] transition"
                >
                  <Banknote className="h-4 w-4" />
                  <span>Sacar Pix</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchTab('transfer')}
                  className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl bg-[#F0FDF9] dark:bg-teal-950/50 border border-[#2DD4BF]/50 px-4 text-xs font-extrabold text-[#0F2421] dark:text-white hover:bg-[#CCFBF1]/60 active:scale-[0.98] transition"
                >
                  <Send className="h-4 w-4 text-[#047857] dark:text-[#2DD4BF]" />
                  <span>Transferir</span>
                </button>
              )}
            </div>

            {/* Exclusivity Notice */}
            <div className="flex items-start gap-2 rounded-2xl bg-[#F7FBFA] dark:bg-teal-950/40 border border-[#CCFBF1] dark:border-teal-900 px-3 py-2.5 text-[11px] leading-snug text-[#334E4A] dark:text-neutral-300">
              <Info className="h-4 w-4 shrink-0 text-[#0891B2] dark:text-[#2DD4BF] mt-0.5" />
              <span>
                Saldo exclusivo do ecossistema <strong className="text-[#0F2421] dark:text-white">Boreal Mobilidade</strong> para pagamento ágil de corridas, entregas e transferências instantâneas entre usuários.
              </span>
            </div>

            {pendingDeposits.length > 0 && (
              <div className="flex items-center gap-2 rounded-2xl bg-[#ECFEFF] dark:bg-cyan-950/40 border border-[#2DD4BF]/50 px-3 py-2 text-xs text-[#0F2421] dark:text-cyan-100">
                <Clock className="h-4 w-4 shrink-0 text-[#0891B2] dark:text-[#2DD4BF] animate-pulse" />
                <span>
                  {pendingDeposits.length} depósito(s) aguardando confirmação:{' '}
                  <strong className="font-mono-num text-[#047857] dark:text-[#6EE7B7]">
                    {formatBRL(pendingDeposits.reduce((acc, d) => acc + d.amount, 0))}
                  </strong>
                </span>
              </div>
            )}

            {pendingWithdrawals.length > 0 && (
              <div className="flex items-center gap-2 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 px-3 py-2 text-xs text-sky-900 dark:text-sky-200">
                <Clock className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300 animate-pulse" />
                <span>
                  {pendingWithdrawals.length} saque(s) em análise:{' '}
                  <strong className="font-mono-num text-sky-950 dark:text-white">
                    {formatBRL(pendingWithdrawals.reduce((acc, w) => acc + w.amount, 0))}
                  </strong>
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#CCFBF1]/45 dark:bg-teal-950/45 border border-[#2DD4BF]/40 px-3 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-[#334E4A] dark:text-teal-200 font-bold truncate">
                <KeyRound className="h-3.5 w-3.5 text-[#047857] dark:text-[#2DD4BF] shrink-0" />
                Chave BorealPay: <strong className="font-mono-num text-[#065F46] dark:text-[#6EE7B7] truncate">{myPay66Key}</strong>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    switchTab('qrcode');
                    setEditingPay66Key(true);
                  }}
                  className="rounded-lg bg-white dark:bg-teal-900/70 border border-[#2DD4BF]/50 px-2 py-1 text-[10px] font-extrabold text-[#065F46] dark:text-[#6EE7B7] hover:bg-[#ECFDF5]"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  onClick={() => copyValue(myPay66Key, '66pay')}
                  className="rounded-lg bg-[#047857] px-2.5 py-1 text-[10px] font-extrabold text-white hover:bg-[#065F46]"
                >
                  {copiedMy66Pay ? 'Copiada!' : 'Copiar'}
                </button>
              </div>
            </div>
          </div>

          {/* ATALHOS RÁPIDOS EM GRID */}
          <div className="grid grid-cols-4 gap-2">
            {[
              {
                id: 'transfer' as const,
                label: 'Transferir\n(BorealPay)',
                icon: Send,
                highlight: tab === 'transfer',
              },
              {
                id: 'deposit' as const,
                label: 'Depositar',
                icon: Wallet,
                highlight: tab === 'deposit',
              },
              {
                id: 'qrcode' as const,
                label: 'QR Code',
                icon: QrCode,
                highlight: tab === 'qrcode',
              },
              {
                id: 'ledger' as const,
                label: 'Extrato\nDetalhado',
                icon: Receipt,
                highlight: tab === 'ledger',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => switchTab(item.id)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl p-2.5 text-center border transition active:scale-95 ${
                    item.highlight
                      ? 'bg-[#047857] border-[#065F46] text-white shadow-sm'
                      : 'bg-white dark:bg-[#0F2421] border-[#CCFBF1] dark:border-teal-900 text-[#0F2421] dark:text-neutral-100 hover:border-[#2DD4BF]'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                      item.highlight
                        ? 'bg-white/15 text-[#6EE7B7]'
                        : 'bg-[#ECFDF5] dark:bg-teal-950/60 text-[#047857] dark:text-[#2DD4BF]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="whitespace-pre-line text-[10px] font-extrabold leading-tight">
                    {item.label}
                  </span>
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
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-3 text-xs font-bold text-emerald-900 dark:text-emerald-200 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                <span>{successMsg}</span>
              </div>
              {lastTransferReceiptTx && (
                <button
                  type="button"
                  onClick={() => setSelectedReceiptTx(lastTransferReceiptTx)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 py-1.5 text-[11px] font-extrabold text-white dark:text-[#0F2421] shadow-2xs active:scale-95 transition"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>Ver / Baixar Comprovante BorealPay</span>
                </button>
              )}
            </div>
          )}

          {/* HOME TAB: OVERVIEW + RECENT SMART STATEMENT */}
          {tab === 'home' && (
            <div className="space-y-4">
              {isDriver && (
                <button
                  type="button"
                  onClick={() => switchTab('withdraw')}
                  className="flex w-full items-center justify-between rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-left transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                      <Banknote className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-extrabold text-emerald-950 dark:text-emerald-200">
                        Sacar Ganhos via Pix
                      </p>
                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                        Solicite envio direto para sua chave Pix
                      </p>
                    </div>
                  </div>
                  <span className="rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-extrabold text-white">
                    Sacar
                  </span>
                </button>
              )}

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Movimentações Recentes
                  </h4>
                  {transactions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => switchTab('ledger')}
                      className="text-xs font-extrabold text-[#047857] dark:text-[#6EE7B7] underline"
                    >
                      Ver extrato completo
                    </button>
                  )}
                </div>

                {groupedTransactions.length === 0 ? (
                  <div className="rounded-3xl border border-[#CCFBF1] dark:border-teal-900 bg-white dark:bg-[#0F2421] p-6 text-center space-y-2">
                    <Receipt className="mx-auto h-8 w-8 text-[#0D9488]" />
                    <p className="text-xs font-bold text-[#0F2421] dark:text-neutral-300">
                      Nenhuma movimentação na sua BorealPay ainda.
                    </p>
                    <p className="text-[11px] text-[#334E4A] dark:text-neutral-400">
                      Faça um depósito via Pix ou receba transferências BorealPay.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedTransactions.slice(0, 2).map((grp) => (
                      <div key={grp.label} className="space-y-2">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 px-1">
                          {grp.label}
                        </p>
                        <div className="space-y-2">
                          {grp.items.slice(0, 4).map(renderTransactionItem)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DEPOSIT PIX (Blocked outside operating hours; existing balance stays 100% usable 24h) */}
          {tab === 'deposit' && !depositWindow.isOpen && (
            <div className="space-y-4 rounded-3xl bg-white dark:bg-[#0F2421] p-5 border border-[#2DD4BF]/50 dark:border-teal-800/70">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ECFEFF] dark:bg-cyan-950/70 text-[#0891B2] dark:text-[#2DD4BF]">
                  <Clock className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#0891B2] dark:text-[#2DD4BF]">
                    Horário de Depósitos Pix
                  </p>
                  <h4 className="font-display text-base font-extrabold text-[#0F2421] dark:text-white">
                    Depósitos disponíveis das {depositWindow.startTime} às {depositWindow.endTime}
                  </h4>
                  <p className="mt-1.5 text-xs text-[#334E4A] dark:text-neutral-300 leading-relaxed">
                    No momento novos depósitos via Pix estão pausados porque a confirmação administrativa funciona das{' '}
                    <strong className="font-mono-num">{depositWindow.startTime}</strong> às{' '}
                    <strong className="font-mono-num">{depositWindow.endTime}</strong>.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed">
                <strong>Seu saldo atual BorealPay ({formatBRL(currentUser.wallet_balance || 0)}) continua ativo 24h:</strong>{' '}
                quem já depositou pode pagar corridas e fazer transferências normalmente. Se estiver sem saldo agora, peça sua corrida escolhendo pagamento em <strong>Dinheiro</strong>.
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => switchTab('transfer')}
                  className="aurora-accent-flow min-h-[46px] rounded-2xl text-xs font-extrabold text-white active:scale-95 transition"
                >
                  Transferir Saldo
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('home')}
                  className="min-h-[46px] rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-xs font-extrabold text-neutral-900 dark:text-white active:scale-95 transition"
                >
                  Voltar ao Início
                </button>
              </div>
            </div>
          )}

          {tab === 'deposit' && depositWindow.isOpen && depositSecurityAccepted && (
            <form onSubmit={handleSubmitDeposit} className="space-y-4 rounded-3xl bg-white dark:bg-[#1A1D24] p-4 border border-neutral-200 dark:border-neutral-800">
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
                            ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421]'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-[#ECFDF5] dark:hover:bg-neutral-700'
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
                  className="min-h-[48px] w-full rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                />
              </div>

              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-4 space-y-3">
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
                    className="rounded-2xl border-2 border-[#047857] bg-white p-3 shadow-xs transition-opacity"
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
                      className="flex min-h-[34px] items-center gap-1 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 text-[11px] font-extrabold text-white dark:text-[#0F2421]"
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
                    className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 p-2 font-mono text-[10px] text-neutral-800 dark:text-neutral-200 outline-none resize-none"
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
                    className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 text-[11px] font-bold text-neutral-900 dark:text-neutral-100"
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
                  className="min-h-[44px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                />
              </div>

              <div className="flex items-start gap-2 rounded-2xl bg-[#ECFDF5] dark:bg-emerald-950/30 border border-[#6EE7B7]/60 dark:border-emerald-800/60 px-3.5 py-2.5 text-[11px] text-[#0F2421] dark:text-emerald-200 leading-relaxed">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#047857] dark:text-[#6EE7B7]" />
                <span>
                  Você tem <strong>até 1 dia útil</strong> para receber o seu valor na conta, mas{' '}
                  <strong>assim que o Administrador confirmar no banco, cai na hora</strong> na sua
                  carteira BorealPay.
                </span>
              </div>

              <button
                type="submit"
                disabled={submitting || numericAmount < 1}
                className="aurora-accent-flow min-h-[52px] w-full rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-50"
              >
                {submitting
                  ? t.saving
                  : `Já fiz o Pix de ${formatBRL(numericAmount)} · Avisar Admin`}
              </button>
            </form>
          )}

          {/* TAB: TRANSFER P2P TO OTHER APP USERS (BOREALPAY) */}
          {tab === 'transfer' && (
            <form onSubmit={handleSubmitTransfer} className="space-y-4 rounded-3xl bg-white dark:bg-[#0F2421] p-4 border border-[#CCFBF1] dark:border-teal-900">
              <div className="rounded-2xl border border-[#2DD4BF]/50 bg-[#ECFDF5] dark:bg-teal-950/40 p-3.5 text-xs text-[#334E4A] dark:text-neutral-200">
                <p className="font-extrabold text-[#0F2421] dark:text-white flex items-center gap-1.5">
                  <Send className="h-4 w-4 text-[#047857] dark:text-[#2DD4BF]" />
                  Transferência Instantânea BorealPay
                </p>
                <p className="mt-1 text-[11px]">
                  Envie saldo sem taxa para qualquer cliente ou motorista cadastrado usando e-mail,
                  telefone ou nome.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-extrabold text-neutral-900 dark:text-neutral-100">
                    1. Destinatário (Chave BorealPay, QR Code, e-mail ou telefone)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTransferQrScanner(true)}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1 text-[11px] font-extrabold text-white dark:text-[#0F2421] active:scale-95 transition"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Ler QR BorealPay
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3.5 focus-within:border-[#047857] dark:focus-within:border-[#2DD4BF]">
                  <Search className="h-4 w-4 text-neutral-400 shrink-0" />
                  <input
                    type="text"
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value);
                      setSelectedRecipient(null);
                    }}
                    placeholder="Chave BorealPay, e-mail, telefone ou nome"
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
                    Buscando contas BorealPay cadastradas...
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
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#ECFDF5] dark:hover:bg-neutral-800 transition"
                      >
                        <AvatarImage
                          src={match.avatar_url}
                          name={match.full_name}
                          className="h-9 w-9 rounded-full object-cover border border-[#2DD4BF] shrink-0"
                          fallbackClassName="flex h-9 w-9 items-center justify-center rounded-full bg-[#047857] text-white text-xs font-extrabold shrink-0"
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
                        <span className="rounded-lg bg-[#047857] px-2 py-1 text-[10px] font-extrabold text-white">
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
                  2. {t.amount_label} (mín. R$ 1,00)
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[5, 10, 20, 50].map((val) => (
                    <button
                      key={val}
                      type="button"
                      disabled={val > currentUser.wallet_balance}
                      onClick={() => setTransferAmountInput(val.toFixed(2))}
                      className={`min-h-[38px] rounded-xl border font-mono-num text-xs font-extrabold transition disabled:opacity-35 ${
                        numericTransferAmount === val
                          ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421]'
                          : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      R$ {val}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={Math.max(1, currentUser.wallet_balance)}
                  required
                  value={transferAmountInput}
                  onChange={(e) => setTransferAmountInput(e.target.value)}
                  className="min-h-[48px] w-full rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  Motivo / Observação opcional
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="Ex: Ajuda na corrida / Pagamento"
                  className="min-h-[44px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                />
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !canTransferDirect ||
                  numericTransferAmount < 1 ||
                  numericTransferAmount > currentUser.wallet_balance
                }
                className="aurora-accent-flow flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-45"
              >
                <Send className="h-4 w-4" />
                {submitting
                  ? t.saving
                  : `Enviar ${formatBRL(numericTransferAmount)} via BorealPay`}
              </button>
            </form>
          )}

          {/* TAB: QR CODE BOREALPAY + REGISTRO DE CHAVE */}
          {tab === 'qrcode' && (
            <div className="space-y-4 rounded-3xl bg-white dark:bg-[#0F2421] p-5 border border-[#CCFBF1] dark:border-teal-900 text-center">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#CCFBF1] dark:bg-teal-950/60 border border-[#2DD4BF]/50 px-3 py-1 text-[11px] font-extrabold text-[#065F46] dark:text-[#6EE7B7]">
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code Automático BorealPay
                </span>
                <h4 className="mt-2 font-display text-lg font-extrabold text-[#0F2421] dark:text-white">
                  Seu Código de Recebimento BorealPay
                </h4>
                <p className="mt-1 text-xs text-[#334E4A] dark:text-neutral-400">
                  Gerado automaticamente com a sua Chave BorealPay para transferências instantâneas dentro do app (sem depender de banco externo).
                </p>
              </div>

              <div className="mx-auto inline-block rounded-3xl border-2 border-[#047857] dark:border-[#2DD4BF] bg-white p-4 shadow-sm">
                <PixQrSvg payload={my66PayQrPayload} size={160} />
              </div>

              <div className="rounded-2xl border border-[#2DD4BF]/50 bg-[#ECFDF5] dark:bg-teal-950/40 p-3.5 text-left space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#334E4A] dark:text-neutral-300">
                    Minha Chave BorealPay Ativa
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPay66KeyInput(myPay66Key);
                      setEditingPay66Key((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#047857] dark:text-[#6EE7B7] underline"
                  >
                    <Pencil className="h-3 w-3" />
                    {editingPay66Key ? 'Cancelar' : 'Cadastrar / Alterar Chave'}
                  </button>
                </div>

                {!editingPay66Key ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono-num text-sm font-black text-[#065F46] dark:text-[#6EE7B7] truncate">
                        {myPay66Key}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyValue(myPay66Key, '66pay')}
                        className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 text-[11px] font-extrabold text-white dark:text-[#0F2421]"
                      >
                        {copiedMy66Pay ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedMy66Pay ? 'Copiado!' : 'Copiar Chave'}
                      </button>
                    </div>
                    <p className="text-[10px] text-[#334E4A] dark:text-neutral-400 truncate">
                      Conta vinculada: {my66PayIdentifier}
                    </p>
                  </>
                ) : (
                  <form onSubmit={handleSavePay66Key} className="space-y-2.5 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {currentUser.phone && (
                        <button
                          type="button"
                          onClick={() => setPay66KeyInput(currentUser.phone.replace(/\s+/g, ''))}
                          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-[10px] font-extrabold text-neutral-800 dark:text-neutral-200"
                        >
                          Usar Telefone
                        </button>
                      )}
                      {currentUser.email && (
                        <button
                          type="button"
                          onClick={() => setPay66KeyInput(currentUser.email.trim().toLowerCase())}
                          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-[10px] font-extrabold text-neutral-800 dark:text-neutral-200"
                        >
                          Usar E-mail
                        </button>
                      )}
                      {currentUser.cpf && (
                        <button
                          type="button"
                          onClick={() => setPay66KeyInput(currentUser.cpf.replace(/\D/g, ''))}
                          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-[10px] font-extrabold text-neutral-800 dark:text-neutral-200"
                        >
                          Usar CPF
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setPay66KeyInput(
                            `BOREAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
                          )
                        }
                        className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-[10px] font-extrabold text-neutral-800 dark:text-neutral-200"
                      >
                        Chave Aleatória
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      minLength={4}
                      maxLength={64}
                      value={pay66KeyInput}
                      onChange={(e) => setPay66KeyInput(e.target.value)}
                      placeholder="Ex: seu@email.com, telefone, CPF ou @apelido"
                      className="min-h-[44px] w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 font-mono-num text-xs font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                    />
                    <button
                      type="submit"
                      disabled={savingPay66Key || pay66KeyInput.trim().length < 4}
                      className="min-h-[42px] w-full rounded-xl bg-[#047857] dark:bg-[#2DD4BF] text-xs font-extrabold text-white dark:text-[#0F2421] disabled:opacity-50"
                    >
                      {savingPay66Key ? 'Salvando Chave...' : 'Salvar Chave & Atualizar QR Code'}
                    </button>
                  </form>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => switchTab('deposit')}
                  className="aurora-accent-flow min-h-[46px] rounded-2xl text-xs font-extrabold text-white active:scale-95 transition"
                >
                  Depositar via Pix
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('transfer')}
                  className="min-h-[46px] rounded-2xl border border-[#2DD4BF]/50 bg-[#ECFDF5] dark:bg-teal-950/50 text-xs font-extrabold text-[#065F46] dark:text-[#6EE7B7] active:scale-95 transition"
                >
                  Enviar BorealPay
                </button>
              </div>
            </div>
          )}

          {/* TAB: DRIVER WITHDRAWAL VIA PIX */}
          {tab === 'withdraw' && isDriver && (
            <form onSubmit={handleSubmitWithdrawal} className="space-y-4 rounded-3xl bg-white dark:bg-[#0F2421] p-4 border border-[#CCFBF1] dark:border-teal-900">
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3.5 text-xs text-neutral-700 dark:text-neutral-300">
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
                            ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421]'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200'
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
                    className="min-h-[48px] flex-1 rounded-2xl border-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-4 font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
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
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3.5 font-mono-num text-xs font-bold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
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

          {/* TAB: SMART STATEMENT & REQUESTS (EXTRATO DETALHADO) */}
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
                        className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#1A1D24] px-3.5 py-3 text-xs"
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
              {deposits.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Solicitações de Depósito ({deposits.length})
                  </h4>
                  <div className="space-y-2">
                    {deposits.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#1A1D24] px-3.5 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {dep.status === 'approved' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : dep.status === 'rejected' ? (
                              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-[#0891B2] dark:text-[#2DD4BF] shrink-0" />
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
                              : 'text-[#0891B2] dark:text-[#2DD4BF]'
                          }`}
                        >
                          {formatBRL(dep.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped Smart Ledger */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Extrato Inteligente ({transactions.length})
                </h4>
                {groupedTransactions.length === 0 ? (
                  <p className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#1A1D24] p-5 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Nenhuma movimentação registrada ainda.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {groupedTransactions.map((grp) => (
                      <div key={grp.label} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                            {grp.label}
                          </span>
                          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                        </div>
                        <div className="space-y-2">
                          {grp.items.map(renderTransactionItem)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NAVEGAÇÃO INFERIOR FLUTUANTE ("PÍLULA ARREDONDADA") */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex justify-center">
          <nav
            aria-label="Navegação BorealPay"
            className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-1 rounded-full bg-white/95 dark:bg-[#0F2421]/95 p-1.5 shadow-xl border border-[#2DD4BF]/40 backdrop-blur-md"
          >
            {bottomNavItems.map((nav) => {
              const Icon = nav.icon;
              const active = tab === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => switchTab(nav.id)}
                  className={`flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-1 text-[10px] font-extrabold transition ${
                    active
                      ? 'bg-[#047857] text-white shadow-sm'
                      : 'text-[#334E4A] dark:text-teal-200 hover:text-[#0F2421] dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate leading-none">{nav.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* POP-UP DE SEGURANÇA BOREALPAY ANTES DE EXIBIR PIX PARA DEPÓSITO */}
      {showDepositSecurityGate && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#0F2421] text-[#0F2421] dark:text-white border border-[#2DD4BF]/50 p-6 shadow-2xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ECFDF5] dark:bg-teal-950/60 border border-[#6EE7B7] text-[#047857] dark:text-[#6EE7B7] shadow-sm">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#047857] dark:text-[#6EE7B7]">
                    Escudo Antifraude BorealPay
                  </p>
                  <h4 className="font-display text-base font-black text-[#0F2421] dark:text-white">
                    Ambiente Seguro de Depósito
                  </h4>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDepositSecurityGate(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F7FBFA] dark:bg-white/10 text-[#334E4A] dark:text-neutral-300 hover:bg-[#CCFBF1]"
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-teal-950/40 p-3.5 text-xs text-[#334E4A] dark:text-neutral-200 leading-relaxed">
              <div className="flex items-start gap-2">
                <Lock className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7] shrink-0 mt-0.5" />
                <p>
                  Conexão criptografada diretamente com o cofre <strong className="text-[#0F2421] dark:text-white">BorealPay</strong>.
                </p>
              </div>
              <p>
                • Confira sempre o favorecido oficial:{' '}
                <strong className="text-[#047857] dark:text-[#6EE7B7]">{platformConfig.platform_pix_receiver}</strong>.
              </p>
              <p>
                • Nunca transfira para chaves enviadas por terceiros fora desta tela. Assim que o Administrador validar o Pix, seu saldo BorealPay é liberado automaticamente.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setDepositSecurityAccepted(true);
                  setShowDepositSecurityGate(false);
                  setTab('deposit');
                }}
                className="aurora-accent-flow flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition"
              >
                <ShieldCheck className="h-4 w-4" />
                Entendi e Continuar com Segurança
              </button>
              <button
                type="button"
                onClick={() => setShowDepositSecurityGate(false)}
                className="min-h-[42px] w-full rounded-2xl border border-neutral-200 dark:border-white/15 bg-neutral-100 dark:bg-white/5 text-xs font-bold text-[#334E4A] dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/10"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferQrScanner && (
        <div className="fixed inset-0 z-[1310] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#0F2421] text-[#0F2421] dark:text-white border border-[#2DD4BF]/50 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-[#047857] dark:text-[#2DD4BF]" />
                <h4 className="font-display text-base font-extrabold">Ler QR Code BorealPay</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowTransferQrScanner(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F7FBFA] dark:bg-white/10 text-[#334E4A] dark:text-neutral-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black border-2 border-[#2DD4BF]/70 flex items-center justify-center">
              <video ref={transferVideoRef} playsInline muted className="h-full w-full object-cover" />
              <canvas ref={transferCanvasRef} className="hidden" />
              {!qrScanError && (
                <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-[#6EE7B7] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              )}
              {!qrScanReady && !qrScanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 text-xs text-neutral-300 p-4 text-center">
                  <Camera className="h-7 w-7 text-[#6EE7B7] animate-pulse" />
                  <span>Abrindo câmera...</span>
                </div>
              )}
              {qrScanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-xs text-neutral-300">
                  <p>{qrScanError}</p>
                </div>
              )}
            </div>

            <p className="text-center text-[11px] text-[#334E4A] dark:text-neutral-400">
              Aponte para o QR Code BorealPay do usuário que vai receber a transferência.
            </p>
          </div>
        </div>
      )}

      {selectedReceiptTx && (
        <Receipt66PayModal
          transaction={selectedReceiptTx}
          currentUser={currentUser}
          platformConfig={platformConfig}
          onClose={() => setSelectedReceiptTx(null)}
        />
      )}
    </div>
  );
};
