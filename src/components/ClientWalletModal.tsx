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
  Moon,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { buildPixEmvPayload, formatBRL } from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import {
  createManualPagamentoPix,
  createMercadoPagoPix,
  createWalletDepositRequest,
  fetchMyPagamentosPix,
  fetchMyWalletDeposits,
  fetchMyWalletWithdrawals,
  fetchUserProfileById,
  fetchWalletTransactions,
  getDepositWindowStatus,
  getNightDutyWindowStatus,
  lookupWalletRecipient,
  requestWalletWithdrawal,
  transferirSaldo66,
  updateMyPay66Key,
} from '../lib/mobilityApi';
import { PixQrSvg, usePixSecurityRotation } from '../lib/pixQr';
import { supabase } from '../lib/supabase';
import type {
  PagamentoPix,
  PixKeyType,
  PlatformConfig,
  UserProfile,
  WalletDeposit,
  WalletRecipientMatch,
  WalletTransaction,
  WalletWithdrawal,
} from '../types/mobility';
import { AvatarImage } from './AvatarImage';
import { resolveBrandLogo } from '../lib/brandAssets';
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
  transfer_in: 'Transferência GoPay recebida',
  transfer_out: 'Transferência GoPay enviada',
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
  const nightDutyStatus = useMemo(
    () => getNightDutyWindowStatus(platformConfig, new Date(nowTick)),
    [platformConfig, nowTick]
  );
  const autoPixEnabled = platformConfig.mp_auto_pix_enabled !== false;
  const manualPixEnabled = platformConfig.manual_pix_enabled !== false;
  const depositsBlockedNow = !depositWindow.isOpen || nightDutyStatus.isActive;
  const canDepositAnyMethod = autoPixEnabled || !depositsBlockedNow;

  const [depositSecurityAccepted, setDepositSecurityAccepted] = useState(false);
  const [showDepositSecurityGate, setShowDepositSecurityGate] = useState(
    () =>
      initialTab === 'deposit' &&
      (platformConfig.mp_auto_pix_enabled !== false ||
        (getDepositWindowStatus(platformConfig).isOpen &&
          !getNightDutyWindowStatus(platformConfig).isActive))
  );
  const [tab, setTab] = useState<WalletModalTab>(() => {
    if (initialTab === 'withdraw' && !isDriver) return 'home';
    if (initialTab === 'deposit') {
      const canDeposit =
        platformConfig.mp_auto_pix_enabled !== false ||
        (getDepositWindowStatus(platformConfig).isOpen &&
          !getNightDutyWindowStatus(platformConfig).isActive);
      return canDeposit ? 'home' : 'deposit';
    }
    return initialTab;
  });
  const [depositMethod, setDepositMethod] = useState<'auto' | 'manual'>(() =>
    autoPixEnabled ? 'auto' : 'manual'
  );
  const [autoPixCharge, setAutoPixCharge] = useState<{
    id: string;
    mp_payment_id: string;
    qr_code: string;
    qr_code_base64: string;
    valor: number;
  } | null>(null);
  const [generatingAutoPix, setGeneratingAutoPix] = useState(false);
  const [myPagamentosPix, setMyPagamentosPix] = useState<PagamentoPix[]>([]);
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

  // Chave GoPay editor state
  const defaultFallback66Key = `GO-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
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
  const [withdrawPixKeyType, setWithdrawPixKeyType] = useState<PixKeyType>(
    () => currentUser.driver?.pix_key_type || 'cpf_cnpj'
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
    if (nextTab === 'deposit' && canDepositAnyMethod && !depositSecurityAccepted) {
      setShowDepositSecurityGate(true);
      return;
    }
    setTab(nextTab);
  };

  const loadWalletData = useCallback(async () => {
    setLoading(true);
    try {
      const [deps, wds, txs, pixRows, freshUser] = await Promise.all([
        fetchMyWalletDeposits(currentUser.id),
        isDriver ? fetchMyWalletWithdrawals(currentUser.id) : Promise.resolve([]),
        fetchWalletTransactions(currentUser.id),
        fetchMyPagamentosPix(currentUser.id).catch(() => []),
        fetchUserProfileById(currentUser.id),
      ]);
      setDeposits(deps);
      setWithdrawals(wds);
      setTransactions(txs);
      setMyPagamentosPix(pixRows);
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pagamentos_pix', filter: `usuario_id=eq.${currentUser.id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (row && row.status === 'aprovado') {
            setAutoPixCharge(null);
            setSuccessMsg('Depósito Pix Automático confirmado! Seu saldo GoPay foi creditado na hora.');
          }
          loadWalletData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUser.id, loadWalletData]);

  // Light 5s fallback poll while awaiting Mercado Pago Pix confirmation
  useEffect(() => {
    if (!autoPixCharge) return;
    const pollId = window.setInterval(async () => {
      try {
        const { data } = await supabase
          .from('pagamentos_pix')
          .select('status')
          .eq('id', autoPixCharge.id)
          .maybeSingle();
        if (data?.status === 'aprovado') {
          setAutoPixCharge(null);
          setSuccessMsg('Depósito Pix Automático confirmado! Seu saldo GoPay foi creditado na hora.');
          await loadWalletData();
        }
      } catch {
        // Ignore transient poll error
      }
    }, 5000);
    return () => window.clearInterval(pollId);
  }, [autoPixCharge, loadWalletData]);

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
          setQrScanError('Câmera indisponível neste navegador. Digite a Chave GoPay manualmente.');
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
                  setSuccessMsg(`QR Code GoPay lido! Destinatário: ${target.full_name}.`);
                } else {
                  setRecipientQuery(detected);
                  setError('QR Code lido, mas nenhum usuário GoPay ativo foi localizado.');
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
          setQrScanError('Não foi possível acessar a câmera. Informe a Chave GoPay no campo de busca.');
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

  // Identificador e Chave exclusiva GoPay
  const myPay66Key =
    currentUser.pay66_key ||
    `GO-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const my66PayIdentifier = currentUser.email || currentUser.phone || currentUser.id;
  const my66PayQrPayload = useMemo(
    () => `GOPAY|${currentUser.id}|${myPay66Key}|${currentUser.email}|${currentUser.full_name}`,
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

  const handleGenerateAutoPixDeposit = async () => {
    setError(null);
    setSuccessMsg(null);
    if (numericAmount < 1) {
      setError('Informe um valor mínimo de R$ 1,00 para depósito.');
      return;
    }
    setGeneratingAutoPix(true);
    try {
      const res = await createMercadoPagoPix({
        tipo: 'recarga',
        valor: numericAmount,
        email: currentUser.email,
        nome: currentUser.full_name,
      });
      setAutoPixCharge({
        id: res.id,
        mp_payment_id: res.mp_payment_id,
        qr_code: res.qr_code,
        qr_code_base64: res.qr_code_base64,
        valor: res.valor,
      });
      await loadWalletData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Pix Automático indisponível no momento. Use o Pix Manual do Administrador.'
      );
    } finally {
      setGeneratingAutoPix(false);
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
      await createManualPagamentoPix({
        usuario_id: currentUser.id,
        tipo: 'recarga',
        valor: numericAmount,
        qr_code: pixPayload,
      });
      setNoteInput('');
      setSuccessMsg(
        `Solicitação de ${formatBRL(numericAmount)} enviada! Assim que o Administrador confirmar no banco, o valor entra automaticamente na sua carteira GoPay.`
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
    recipientQuery.trim().toUpperCase().startsWith('GO-') ||
    recipientQuery.trim().toUpperCase().startsWith('GOPAY|') ||
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
        `Chave GoPay "${updated.pay66_key}" cadastrada! Seu QR Code GoPay foi atualizado automaticamente.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar sua Chave GoPay.');
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
      setError('O valor mínimo para transferência GoPay é R$ 1,00.');
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
        `Transferência GoPay de ${formatBRL(numericTransferAmount)} para ${targetName} concluída instantaneamente!`
      );
      setLastTransferReceiptTx(receiptTx);
      setSelectedRecipient(null);
      setRecipientQuery('');
      setTransferNote('');
      await loadWalletData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir transferência GoPay.');
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
      await requestWalletWithdrawal(numericWithdrawAmount, withdrawPixKey.trim(), withdrawPixKeyType);
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
        className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-white px-3.5 py-3 text-left shadow-2xs hover:border-[#2563EB] active:scale-[0.99] transition"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              isPositive
                ? 'bg-[#ECFDF5] text-[#10B981]'
                : 'bg-rose-50 text-rose-600'
            }`}
          >
            {isPositive ? (
              <ArrowDownLeft className="h-5 w-5" />
            ) : (
              <ArrowUpRight className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-[#0F172A] truncate">
              {reasonLabel}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-[#475569] line-clamp-2 leading-snug">
              {tx.description}
            </p>
            <p className="mt-1 font-mono-num text-[10px] font-bold text-[#64748B]">
              {timeStr} · Ver comprovante
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right pt-0.5">
          <span
            className={`font-mono-num text-sm font-extrabold whitespace-nowrap block ${
              isPositive ? 'text-[#10B981]' : 'text-[#0F172A]'
            }`}
          >
            {hideBalance
              ? 'R$ ••••'
              : isPositive
              ? `+ ${formatBRL(tx.amount)}`
              : `- ${formatBRL(Math.abs(tx.amount))}`}
          </span>
        </div>
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
    <div className="fixed inset-0 z-[1220] flex flex-col bg-[#F4F6F9] h-[100dvh] w-screen overflow-hidden">
      <div
        className={`relative flex h-full w-full flex-col bg-[#F4F6F9] overflow-hidden ${
          selectedReceiptTx ? 'no-print' : ''
        }`}
      >
        {/* Top Brand Bar GoPay */}
        <div className="aurora-surface-flow flex items-center justify-between px-5 pt-4 pb-3.5 text-[#0F172A] border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-center gap-2.5">
            <img
              src={resolveBrandLogo(platformConfig)}
              alt="GoPay"
              className="h-10 w-10 shrink-0 rounded-xl object-cover border border-[#BFDBFE] shadow-sm bg-white"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-lg font-extrabold tracking-tight text-[#0F172A]">
                  GoPay
                </h3>
                <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-extrabold text-[#2563EB]">
                  Carteira Oficial
                </span>
              </div>
              <p className="text-[11px] font-medium text-[#475569]">
                {isDriver ? 'Ganhos, saques e recebimentos GoPay' : 'Saldo exclusivo, depósitos e transferências GoPay'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#E2E8F0] text-[#475569] hover:text-[#0F172A] hover:bg-[#F4F6F9] active:scale-95 transition"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body (with extra bottom padding for floating pill dock) */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 space-y-4 max-w-xl w-full mx-auto">
          {/* CABEÇALHO GOPAY */}
          <div className="rounded-3xl bg-white border border-[#E2E8F0] p-5 text-[#0F172A] shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#475569]">{t.wallet_available_gopay}</span>
                  <button
                    type="button"
                    onClick={toggleHideBalance}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F4F6F9] border border-[#E2E8F0] text-[#2563EB] hover:bg-[#EFF6FF] transition"
                    aria-label={hideBalance ? 'Show' : 'Hide'}
                  >
                    {hideBalance ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="mt-1 font-display text-4xl font-extrabold text-[#10B981] font-mono-num tracking-tight">
                  {hideBalance ? 'R$ •••••' : formatBRL(currentUser.wallet_balance || 0)}
                </p>
                {Number(currentUser.reserved_balance || 0) > 0 && (
                  <p className="mt-1 text-[11px] font-bold text-[#2563EB] font-mono-num">
                    {formatBRL(currentUser.reserved_balance || 0)}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={loadWalletData}
                disabled={loading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4F6F9] border border-[#E2E8F0] text-[#2563EB] hover:bg-[#EFF6FF] active:scale-95 transition"
                aria-label={t.wallet_refresh}
                title={t.wallet_refresh}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Prominent Deposit CTA + Driver Withdraw shortcut */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => switchTab('deposit')}
                className="aurora-accent-flow flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl px-3 text-sm font-extrabold text-white shadow-md hover:brightness-105 active:scale-[0.98] transition whitespace-nowrap"
              >
                <Plus className="h-4 w-4 stroke-[2.5] shrink-0" />
                <span>{t.deposit}</span>
              </button>
              {isDriver ? (
                <button
                  type="button"
                  onClick={() => switchTab('withdraw')}
                  className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] px-3 text-xs font-extrabold text-[#059669] shadow-2xs hover:bg-[#D1FAE5]/70 active:scale-[0.98] transition whitespace-nowrap"
                >
                  <Banknote className="h-4 w-4 shrink-0" />
                  <span>{t.withdraw}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchTab('transfer')}
                  className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl bg-[#F1F5F9] border border-[#E2E8F0] px-3 text-xs font-extrabold text-[#0F172A] hover:bg-[#E2E8F0] active:scale-[0.98] transition whitespace-nowrap"
                >
                  <Send className="h-4 w-4 text-[#2563EB] shrink-0" />
                  <span>{t.transfer}</span>
                </button>
              )}
            </div>

            {/* Exclusivity Notice */}
            <div className="flex items-start gap-2 rounded-2xl bg-[#F4F6F9] border border-[#E2E8F0] px-3 py-2.5 text-[11px] leading-snug text-[#475569]">
              <Info className="h-4 w-4 shrink-0 text-[#2563EB] mt-0.5" />
              <span>
                <strong className="text-[#0F172A]">Go Driver Mobilidade · GoPay:</strong> {t.wallet_ecosystem_notice}
              </span>
            </div>

            {pendingDeposits.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-2 text-xs text-[#0F172A]">
                <span className="flex items-center gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 text-[#2563EB] animate-pulse" />
                  <span className="truncate">{pendingDeposits.length} depósito(s) pendente(s)</span>
                </span>
                <strong className="font-mono-num text-[#2563EB] shrink-0 whitespace-nowrap">
                  {formatBRL(pendingDeposits.reduce((acc, d) => acc + d.amount, 0))}
                </strong>
              </div>
            )}

            {pendingWithdrawals.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-2 text-xs text-[#0F172A]">
                <span className="flex items-center gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 text-[#2563EB] animate-pulse" />
                  <span className="truncate">{pendingWithdrawals.length} saque(s) em análise</span>
                </span>
                <strong className="font-mono-num text-[#2563EB] shrink-0 whitespace-nowrap">
                  {formatBRL(pendingWithdrawals.reduce((acc, w) => acc + w.amount, 0))}
                </strong>
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[#2563EB]">
                  <KeyRound className="h-3 w-3 shrink-0" />
                  {t.wallet_key_label}
                </span>
                <p className="mt-0.5 font-mono-num text-xs font-extrabold text-[#0F172A] truncate">
                  {myPay66Key}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    switchTab('qrcode');
                    setEditingPay66Key(true);
                  }}
                  className="min-h-[34px] rounded-lg bg-white border border-[#BFDBFE] px-2.5 py-1 text-[11px] font-extrabold text-[#2563EB] hover:bg-[#F4F6F9]"
                >
                  {t.wallet_change_key}
                </button>
                <button
                  type="button"
                  onClick={() => copyValue(myPay66Key, '66pay')}
                  className="min-h-[34px] rounded-lg bg-[#2563EB] px-3 py-1 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
                >
                  {copiedMy66Pay ? t.wallet_copied_key : t.wallet_copy_key}
                </button>
              </div>
            </div>
          </div>

          {/* ATALHOS RÁPIDOS EM GRID */}
          <div className="grid grid-cols-4 gap-2">
            {[
              {
                id: 'transfer' as const,
                label: `${t.transfer}\n(GoPay)`,
                icon: Send,
                highlight: tab === 'transfer',
              },
              {
                id: 'deposit' as const,
                label: t.deposit,
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
                label: t.statement,
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
                      ? 'bg-[#2563EB] border-[#1D4ED8] text-white shadow-sm'
                      : 'bg-white border-[#E2E8F0] text-[#0F172A] hover:border-[#2563EB]'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                      item.highlight
                        ? 'bg-white/20 text-white'
                        : 'bg-[#EFF6FF] text-[#2563EB]'
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
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-3 text-xs font-bold text-[#059669] space-y-2.5">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[#10B981] mt-0.5" />
                <span>{successMsg}</span>
              </div>
              {lastTransferReceiptTx && (
                <button
                  type="button"
                  onClick={() => setSelectedReceiptTx(lastTransferReceiptTx)}
                  className="aurora-accent-flow inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-extrabold text-white shadow-2xs active:scale-95 transition"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>{t.view_gopay_receipt}</span>
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
                  className="flex w-full items-center justify-between rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-left transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#10B981] text-white">
                      <Banknote className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-extrabold text-[#0F172A]">
                        Sacar Ganhos via Pix
                      </p>
                      <p className="text-[11px] text-[#059669]">
                        Solicite envio direto para sua chave Pix
                      </p>
                    </div>
                  </div>
                  <span className="rounded-xl bg-[#10B981] px-3 py-1.5 text-[11px] font-extrabold text-white">
                    Sacar
                  </span>
                </button>
              )}

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#475569]">
                    Movimentações Recentes
                  </h4>
                  {transactions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => switchTab('ledger')}
                      className="text-xs font-extrabold text-[#2563EB] underline"
                    >
                      Ver extrato completo
                    </button>
                  )}
                </div>

                {groupedTransactions.length === 0 ? (
                  <div className="rounded-3xl border border-[#E2E8F0] bg-white p-6 text-center space-y-2">
                    <Receipt className="mx-auto h-8 w-8 text-[#2563EB]" />
                    <p className="text-xs font-bold text-[#0F172A]">
                      Nenhuma movimentação na sua GoPay ainda.
                    </p>
                    <p className="text-[11px] text-[#475569]">
                      Faça um depósito via Pix ou receba transferências GoPay.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedTransactions.slice(0, 2).map((grp) => (
                      <div key={grp.label} className="space-y-2">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#475569] px-1">
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

          {/* TAB: DEPOSIT PIX (Auto Mercado Pago 24h + Manual Admin com Plantão Noturno preservado) */}
          {tab === 'deposit' && !canDepositAnyMethod && (
            <div className="space-y-4 rounded-3xl bg-white p-5 border border-[#E2E8F0]">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB]">
                  {nightDutyStatus.isActive ? <Moon className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                </span>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#2563EB]">
                    {nightDutyStatus.isActive
                      ? `Plantão Noturno da Melissa (${nightDutyStatus.startTime} às ${nightDutyStatus.endTime})`
                      : 'Horário de Depósitos Pix'}
                  </p>
                  <h4 className="font-display text-base font-extrabold text-[#0F172A]">
                    {nightDutyStatus.isActive
                      ? 'Depósitos manuais via Pix pausados na madrugada'
                      : `Depósitos disponíveis das ${depositWindow.startTime} às ${depositWindow.endTime}`}
                  </h4>
                  <p className="mt-1.5 text-xs text-[#475569] leading-relaxed">
                    {nightDutyStatus.isActive ? (
                      <>
                        Durante o Plantão Autônomo da Melissa (
                        <strong className="font-mono-num">{nightDutyStatus.startTime}</strong> às{' '}
                        <strong className="font-mono-num">{nightDutyStatus.endTime}</strong>), não há
                        aprovação manual de depósitos Pix pelo Administrador.
                      </>
                    ) : (
                      <>
                        No momento novos depósitos via Pix estão pausados porque a confirmação administrativa funciona das{' '}
                        <strong className="font-mono-num">{depositWindow.startTime}</strong> às{' '}
                        <strong className="font-mono-num">{depositWindow.endTime}</strong>.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 text-xs text-[#0F172A] leading-relaxed">
                <strong>Seu saldo atual GoPay ({formatBRL(currentUser.wallet_balance || 0)}) continua ativo 24h:</strong>{' '}
                você pode pagar corridas com <strong>Saldo da Carteira GoPay</strong> ou <strong>Dinheiro</strong> a qualquer hora da madrugada e transferir saldo normalmente.
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
                  className="min-h-[46px] rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] text-xs font-extrabold text-[#0F172A] active:scale-95 transition"
                >
                  Voltar ao Início
                </button>
              </div>
            </div>
          )}

          {tab === 'deposit' && canDepositAnyMethod && depositSecurityAccepted && (
            <div className="space-y-4 rounded-3xl bg-white p-4 border border-[#E2E8F0]">
              {(autoPixEnabled || manualPixEnabled) && (
                <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F1F5F9] p-1 border border-[#E2E8F0]">
                  {autoPixEnabled && (
                    <button
                      type="button"
                      onClick={() => setDepositMethod('auto')}
                      className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-extrabold transition ${
                        depositMethod === 'auto'
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
                      onClick={() => setDepositMethod('manual')}
                      className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-extrabold transition ${
                        depositMethod === 'manual'
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

              <div>
                <label className="block text-xs font-extrabold text-[#0F172A] mb-2">
                  1. Quanto deseja depositar? ({t.amount_label})
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2.5">
                  {DEPOSIT_PRESETS.map((val) => {
                    const active = numericAmount === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setAmountInput(val.toFixed(2));
                          setAutoPixCharge(null);
                        }}
                        className={`min-h-[40px] rounded-xl border font-mono-num text-xs font-extrabold transition ${
                          active
                            ? 'border-[#2563EB] bg-[#2563EB] text-white'
                            : 'border-[#E2E8F0] bg-[#F4F6F9] text-[#0F172A] hover:bg-[#EFF6FF]'
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
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    setAutoPixCharge(null);
                  }}
                  placeholder="Ex: 25.00"
                  className="min-h-[48px] w-full rounded-2xl border-2 border-[#E2E8F0] bg-[#F4F6F9] px-4 font-mono-num text-lg font-extrabold text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>

              {depositMethod === 'auto' && autoPixEnabled && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] px-3.5 py-2.5 text-[11px] text-[#0F172A]">
                    <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-[#10B981]" />
                    <span>
                      <strong>Mercado Pago 24h:</strong> o QR Code cai na hora na sua carteira GoPay assim que você paga no banco, mesmo na madrugada.
                    </span>
                  </div>

                  {!autoPixCharge ? (
                    <button
                      type="button"
                      disabled={generatingAutoPix || numericAmount < 1}
                      onClick={handleGenerateAutoPixDeposit}
                      className="aurora-accent-flow flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-50"
                    >
                      <QrCode className="h-4 w-4" />
                      {generatingAutoPix
                        ? 'Gerando Pix Automático...'
                        : `Gerar Pix Automático de ${formatBRL(numericAmount)}`}
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#0F172A]">
                          Escaneie ou copie o código Pix
                        </span>
                        <span className="font-mono-num text-xs font-extrabold text-[#10B981]">
                          {formatBRL(autoPixCharge.valor)}
                        </span>
                      </div>

                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-2xl border-2 border-[#2563EB] bg-white p-3 shadow-xs">
                          {autoPixCharge.qr_code_base64 ? (
                            <img
                              src={`data:image/png;base64,${autoPixCharge.qr_code_base64}`}
                              alt="QR Code Pix Automático"
                              className="h-40 w-40 object-contain rounded-lg"
                            />
                          ) : (
                            <PixQrSvg payload={autoPixCharge.qr_code} size={148} />
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2563EB]">
                          <Clock className="h-3.5 w-3.5" />
                          Aguardando confirmação automática do banco...
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-[11px] font-bold text-[#475569]">Pix Copia e Cola</span>
                          <button
                            type="button"
                            onClick={() => copyValue(autoPixCharge.qr_code, 'code')}
                            className="flex min-h-[34px] items-center gap-1 rounded-xl bg-[#2563EB] px-3 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
                          >
                            {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedCode ? 'Copiado!' : 'Copiar Código'}
                          </button>
                        </div>
                        <textarea
                          readOnly
                          rows={2}
                          value={autoPixCharge.qr_code}
                          onClick={(e) => e.currentTarget.select()}
                          className="w-full rounded-xl border border-[#E2E8F0] bg-white p-2 font-mono text-[10px] text-[#0F172A] outline-none resize-none"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setAutoPixCharge(null)}
                        className="w-full text-[11px] font-bold text-[#475569] underline"
                      >
                        Gerar outro valor
                      </button>
                    </div>
                  )}

                  {myPagamentosPix.filter((p) => p.tipo === 'recarga').length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">
                        Recargas Pix Recentes
                      </p>
                      {myPagamentosPix
                        .filter((p) => p.tipo === 'recarga')
                        .slice(0, 3)
                        .map((px) => (
                          <div
                            key={px.id}
                            className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F4F6F9] px-3 py-2 text-[11px]"
                          >
                            <span className="font-bold text-[#0F172A]">
                              {px.metodo_confirmacao === 'mercadopago_auto' ? 'Mercado Pago 24h' : 'Manual Admin'} ·{' '}
                              <span className="font-mono-num">{formatBRL(px.valor)}</span>
                            </span>
                            <span
                              className={`font-extrabold ${
                                px.status === 'aprovado'
                                  ? 'text-[#10B981]'
                                  : px.status === 'pendente'
                                  ? 'text-[#2563EB]'
                                  : 'text-red-600'
                              }`}
                            >
                              {px.status === 'aprovado'
                                ? 'Confirmado'
                                : px.status === 'pendente'
                                ? 'Pendente'
                                : px.status}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {depositMethod === 'manual' && depositsBlockedNow && (
                <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 space-y-2 text-xs">
                  <p className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                    {nightDutyStatus.isActive ? <Moon className="h-4 w-4 text-[#2563EB]" /> : <Clock className="h-4 w-4 text-[#2563EB]" />}
                    {nightDutyStatus.isActive
                      ? `Pix Manual pausado no Plantão Noturno (${nightDutyStatus.startTime} às ${nightDutyStatus.endTime})`
                      : `Pix Manual disponível das ${depositWindow.startTime} às ${depositWindow.endTime}`}
                  </p>
                  <p className="text-[#475569] leading-relaxed">
                    Use a aba <strong>Pix Automático 24h</strong> acima para creditar na hora via Mercado Pago durante a madrugada!
                  </p>
                </div>
              )}

              {depositMethod === 'manual' && !depositsBlockedNow && (
                <form onSubmit={handleSubmitDeposit} className="space-y-4">
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        2. Pague com o Pix da Plataforma
                      </span>
                      <span className="font-mono-num text-xs font-extrabold text-[#10B981]">
                        {formatBRL(numericAmount || 10)}
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <div
                        key={cycle}
                        className="rounded-2xl border-2 border-[#2563EB] bg-white p-3 shadow-xs transition-opacity"
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
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[10px] font-bold text-[#2563EB]">
                        <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '6s' }} />
                        <span>
                          Atualização em <strong className="font-mono-num">{formattedTimer}</strong> · Mesma chave
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-bold text-[#475569]">
                          Pix Copia e Cola
                        </span>
                        <button
                          type="button"
                          onClick={() => copyValue(pixPayload, 'code')}
                          className="flex min-h-[34px] items-center gap-1 rounded-xl bg-[#2563EB] px-3 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
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
                        className="w-full rounded-xl border border-[#E2E8F0] bg-white p-2 font-mono text-[10px] text-[#0F172A] outline-none resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-[#E2E8F0] pt-2.5">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-[#475569]">
                          Favorecido: {platformConfig.platform_pix_receiver}
                        </p>
                        <p className="font-mono-num text-xs font-extrabold text-[#0F172A] truncate">
                          {platformConfig.platform_pix_key}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyValue(platformConfig.platform_pix_key, 'key')}
                        className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 text-[11px] font-bold text-[#0F172A]"
                      >
                        {copiedKey ? <Check className="h-3.5 w-3.5 text-[#10B981]" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedKey ? 'Copiada' : 'Copiar chave'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">
                      Observação opcional (ex: nome do titular da conta)
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Ex: Transferido por Maria Silva"
                      className="min-h-[44px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div className="flex items-start gap-2 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] px-3.5 py-2.5 text-[11px] text-[#0F172A] leading-relaxed">
                    <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#2563EB]" />
                    <span>
                      Você tem <strong>até 1 dia útil</strong> para receber o seu valor na conta, mas{' '}
                      <strong>assim que o Administrador confirmar no banco, cai na hora</strong> na sua
                      carteira GoPay.
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
            </div>
          )}

          {/* TAB: TRANSFER P2P TO OTHER APP USERS (GOPAY) */}
          {tab === 'transfer' && (
            <form onSubmit={handleSubmitTransfer} className="space-y-4 rounded-3xl bg-white p-4 border border-[#E2E8F0]">
              <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3.5 text-xs text-[#475569]">
                <p className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                  <Send className="h-4 w-4 text-[#2563EB]" />
                  Transferência Instantânea GoPay
                </p>
                <p className="mt-1 text-[11px]">
                  Envie saldo sem taxa para qualquer cliente ou motorista cadastrado usando e-mail,
                  telefone ou nome.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-extrabold text-[#0F172A]">
                    1. Destinatário (Chave GoPay, QR Code, e-mail ou telefone)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTransferQrScanner(true)}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#2563EB] px-2.5 py-1 text-[11px] font-extrabold text-white active:scale-95 transition"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Ler QR GoPay
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 focus-within:border-[#2563EB]">
                  <Search className="h-4 w-4 text-[#475569] shrink-0" />
                  <input
                    type="text"
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value);
                      setSelectedRecipient(null);
                    }}
                    placeholder="Chave GoPay, e-mail, telefone ou nome"
                    className="min-h-[46px] flex-1 bg-transparent text-xs font-semibold text-[#0F172A] outline-none"
                  />
                  {recipientQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecipientQuery('');
                        setSelectedRecipient(null);
                        setRecipientMatches([]);
                      }}
                      className="text-[#475569] hover:text-[#0F172A]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {searchingRecipient && (
                  <p className="mt-1.5 text-[11px] font-semibold text-[#475569]">
                    Buscando contas GoPay cadastradas...
                  </p>
                )}

                {!selectedRecipient && recipientMatches.length > 0 && (
                  <div className="mt-2 divide-y divide-[#E2E8F0] rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden shadow-sm">
                    {recipientMatches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => {
                          setSelectedRecipient(match);
                          setRecipientMatches([]);
                        }}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#EFF6FF] transition"
                      >
                        <AvatarImage
                          src={match.avatar_url}
                          name={match.full_name}
                          className="h-9 w-9 rounded-full object-cover border border-[#2563EB] shrink-0"
                          fallbackClassName="flex h-9 w-9 items-center justify-center rounded-full bg-[#2563EB] text-white text-xs font-extrabold shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-[#0F172A] truncate">
                            {match.full_name}
                          </p>
                          <p className="text-[11px] text-[#475569] truncate">
                            {match.role === 'driver' ? t.driver_role_badge : t.passenger_role_badge} ·{' '}
                            {match.email || match.phone}
                          </p>
                        </div>
                        <span className="rounded-lg bg-[#2563EB] px-2 py-1 text-[10px] font-extrabold text-white">
                          Selecionar
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {selectedRecipient && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarImage
                        src={selectedRecipient.avatar_url}
                        name={selectedRecipient.full_name}
                        className="h-10 w-10 rounded-full object-cover border-2 border-[#10B981] shrink-0"
                        fallbackClassName="flex h-10 w-10 items-center justify-center rounded-full bg-[#10B981] text-white text-xs font-extrabold shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-[#0F172A] truncate flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5 shrink-0 text-[#10B981]" />
                          {selectedRecipient.full_name}
                        </p>
                        <p className="text-[11px] text-[#059669] truncate">
                          {selectedRecipient.email || selectedRecipient.phone}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRecipient(null)}
                      className="text-xs font-bold text-[#059669] underline shrink-0"
                    >
                      Trocar
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#0F172A] mb-1.5">
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
                          ? 'border-[#2563EB] bg-[#2563EB] text-white'
                          : 'border-[#E2E8F0] bg-[#F4F6F9] text-[#0F172A]'
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
                  className="min-h-[48px] w-full rounded-2xl border-2 border-[#E2E8F0] bg-[#F4F6F9] px-4 font-mono-num text-lg font-extrabold text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Motivo / Observação opcional
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="Ex: Ajuda na corrida / Pagamento"
                  className="min-h-[44px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
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
                  : `Enviar ${formatBRL(numericTransferAmount)} via GoPay`}
              </button>
            </form>
          )}

          {/* TAB: QR CODE GOPAY + REGISTRO DE CHAVE */}
          {tab === 'qrcode' && (
            <div className="space-y-4 rounded-3xl bg-white p-5 border border-[#E2E8F0] text-center">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-1 text-[11px] font-extrabold text-[#2563EB]">
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code Automático GoPay
                </span>
                <h4 className="mt-2 font-display text-lg font-extrabold text-[#0F172A]">
                  Seu Código de Recebimento GoPay
                </h4>
                <p className="mt-1 text-xs text-[#475569]">
                  Gerado automaticamente com a sua Chave GoPay para transferências instantâneas dentro do app (sem depender de banco externo).
                </p>
              </div>

              <div className="mx-auto inline-block rounded-3xl border-2 border-[#2563EB] bg-white p-4 shadow-sm">
                <PixQrSvg payload={my66PayQrPayload} size={160} />
              </div>

              <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3.5 text-left space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                    Minha Chave GoPay Ativa
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPay66KeyInput(myPay66Key);
                      setEditingPay66Key((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#2563EB] underline"
                  >
                    <Pencil className="h-3 w-3" />
                    {editingPay66Key ? 'Cancelar' : 'Cadastrar / Alterar Chave'}
                  </button>
                </div>

                {!editingPay66Key ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono-num text-sm font-black text-[#1D4ED8] truncate">
                        {myPay66Key}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyValue(myPay66Key, '66pay')}
                        className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl bg-[#2563EB] px-3 text-[11px] font-extrabold text-white"
                      >
                        {copiedMy66Pay ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedMy66Pay ? 'Copiado!' : 'Copiar Chave'}
                      </button>
                    </div>
                    <p className="text-[10px] text-[#475569] truncate">
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
                          className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#0F172A]"
                        >
                          Usar Telefone
                        </button>
                      )}
                      {currentUser.email && (
                        <button
                          type="button"
                          onClick={() => setPay66KeyInput(currentUser.email.trim().toLowerCase())}
                          className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#0F172A]"
                        >
                          Usar E-mail
                        </button>
                      )}
                      {currentUser.cpf && (
                        <button
                          type="button"
                          onClick={() => setPay66KeyInput(currentUser.cpf.replace(/\D/g, ''))}
                          className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#0F172A]"
                        >
                          Usar CPF
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setPay66KeyInput(
                            `GO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
                          )
                        }
                        className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#0F172A]"
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
                      className="min-h-[44px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 font-mono-num text-xs font-extrabold text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                    <button
                      type="submit"
                      disabled={savingPay66Key || pay66KeyInput.trim().length < 4}
                      className="min-h-[42px] w-full rounded-xl bg-[#2563EB] text-xs font-extrabold text-white disabled:opacity-50"
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
                  className="min-h-[46px] rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] text-xs font-extrabold text-[#0F172A] active:scale-95 transition"
                >
                  Enviar GoPay
                </button>
              </div>
            </div>
          )}

          {/* TAB: DRIVER WITHDRAWAL VIA PIX */}
          {tab === 'withdraw' && isDriver && (
            <form onSubmit={handleSubmitWithdrawal} className="space-y-4 rounded-3xl bg-white p-4 border border-[#E2E8F0]">
              <div className="rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 text-xs text-[#475569]">
                <p className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                  <Banknote className="h-4 w-4 text-[#10B981]" />
                  {t.withdraw_pix_title}
                </p>
                <p className="mt-1 text-[11px]">
                  O valor solicitado fica reservado automaticamente do seu saldo até o Administrador
                  realizar o envio do Pix para sua chave.
                </p>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#0F172A] mb-2">
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
                            ? 'border-[#10B981] bg-[#10B981] text-white'
                            : 'border-[#E2E8F0] bg-[#F4F6F9] text-[#0F172A]'
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
                    className="min-h-[48px] flex-1 rounded-2xl border-2 border-[#E2E8F0] bg-[#F4F6F9] px-4 font-mono-num text-lg font-extrabold text-[#0F172A] outline-none focus:border-[#10B981]"
                  />
                  {currentUser.wallet_balance >= 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawAmountInput(Number(currentUser.wallet_balance).toFixed(2))
                      }
                      className="rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] px-3 text-xs font-extrabold text-[#0F172A]"
                    >
                      Tudo
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#0F172A] mb-1.5">
                  2. Tipo de Chave Pix
                </label>
                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {(
                    [
                      { id: 'cpf_cnpj', label: 'CPF/CNPJ' },
                      { id: 'phone', label: 'Celular' },
                      { id: 'email', label: 'E-mail' },
                      { id: 'random', label: 'Aleatória' },
                    ] as Array<{ id: PixKeyType; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setWithdrawPixKeyType(opt.id)}
                      className={`min-h-[38px] rounded-xl border text-[11px] font-extrabold transition ${
                        withdrawPixKeyType === opt.id
                          ? 'border-[#10B981] bg-[#10B981] text-white'
                          : 'border-[#E2E8F0] bg-[#F4F6F9] text-[#475569]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="block text-xs font-extrabold text-[#0F172A] mb-1.5">
                  3. {t.pix_key_label}
                </label>
                <input
                  type="text"
                  required
                  value={withdrawPixKey}
                  onChange={(e) => setWithdrawPixKey(e.target.value)}
                  placeholder="CPF, Celular, E-mail ou Chave Aleatória"
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 font-mono-num text-xs font-bold text-[#0F172A] outline-none focus:border-[#10B981]"
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
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#10B981] hover:bg-[#059669] text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-45"
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
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#475569]">
                    Solicitações de Saque ({withdrawals.length})
                  </h4>
                  <div className="space-y-2">
                    {withdrawals.map((wd) => (
                      <div
                        key={wd.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-white px-3.5 py-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {wd.status === 'paid' ? (
                              <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
                            ) : wd.status === 'rejected' ? (
                              <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-[#2563EB] shrink-0" />
                            )}
                            <span className="font-extrabold text-[#0F172A] truncate">
                              {wd.status === 'paid'
                                ? 'Saque Pix Pago'
                                : wd.status === 'rejected'
                                ? 'Saque Recusado (Estornado)'
                                : 'Aguardando pagamento do Admin'}
                            </span>
                          </div>
                          <p className="mt-0.5 font-mono-num text-[11px] text-[#475569] truncate">
                            {wd.pix_key_type ? `[${wd.pix_key_type.toUpperCase()}] ` : ''}Chave: {wd.pix_key}
                          </p>
                          <p className="text-[10px] text-[#64748B] font-mono-num">
                            {new Date(wd.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num text-sm font-extrabold shrink-0 whitespace-nowrap ${
                            wd.status === 'paid'
                              ? 'text-[#10B981]'
                              : wd.status === 'rejected'
                              ? 'text-red-600 line-through'
                              : 'text-[#2563EB]'
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
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#475569]">
                    Solicitações de Depósito ({deposits.length})
                  </h4>
                  <div className="space-y-2">
                    {deposits.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-white px-3.5 py-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {dep.status === 'approved' ? (
                              <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
                            ) : dep.status === 'rejected' ? (
                              <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-[#2563EB] shrink-0" />
                            )}
                            <span className="font-extrabold text-[#0F172A] truncate">
                              {dep.status === 'approved'
                                ? 'Depósito Confirmado'
                                : dep.status === 'rejected'
                                ? 'Depósito Recusado'
                                : 'Aguardando confirmação do Admin'}
                            </span>
                          </div>
                          {dep.note && (
                            <p className="mt-0.5 text-[11px] text-[#475569] truncate">
                              {dep.note}
                            </p>
                          )}
                          <p className="text-[10px] text-[#64748B] font-mono-num">
                            {new Date(dep.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num text-sm font-extrabold shrink-0 whitespace-nowrap ${
                            dep.status === 'approved'
                              ? 'text-[#10B981]'
                              : dep.status === 'rejected'
                              ? 'text-red-600 line-through'
                              : 'text-[#2563EB]'
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
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#475569]">
                  Extrato Inteligente ({transactions.length})
                </h4>
                {groupedTransactions.length === 0 ? (
                  <p className="rounded-2xl border border-[#E2E8F0] bg-white p-5 text-center text-xs text-[#475569]">
                    Nenhuma movimentação registrada ainda.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {groupedTransactions.map((grp) => (
                      <div key={grp.label} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#475569]">
                            {grp.label}
                          </span>
                          <span className="h-px flex-1 bg-[#E2E8F0]" />
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
            aria-label="Navegação GoPay"
            className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-1 rounded-full bg-white/95 p-1.5 shadow-xl border border-[#E2E8F0] backdrop-blur-md"
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
                      ? 'bg-[#2563EB] text-white shadow-sm'
                      : 'text-[#475569] hover:text-[#0F172A]'
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

      {/* POP-UP DE SEGURANÇA GOPAY ANTES DE EXIBIR PIX PARA DEPÓSITO */}
      {showDepositSecurityGate && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-[#0F172A]/65 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-white text-[#0F172A] border border-[#E2E8F0] p-6 shadow-2xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] shadow-sm">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#2563EB]">
                    Escudo Antifraude GoPay
                  </p>
                  <h4 className="font-display text-base font-black text-[#0F172A]">
                    Ambiente Seguro de Depósito
                  </h4>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDepositSecurityGate(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F4F6F9] text-[#475569] hover:bg-[#E2E8F0]"
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 text-xs text-[#475569] leading-relaxed">
              <div className="flex items-start gap-2">
                <Lock className="h-4 w-4 text-[#2563EB] shrink-0 mt-0.5" />
                <p>
                  Conexão criptografada diretamente com o cofre <strong className="text-[#0F172A]">GoPay</strong>.
                </p>
              </div>
              <p>
                • Confira sempre o favorecido oficial:{' '}
                <strong className="text-[#2563EB]">{platformConfig.platform_pix_receiver}</strong>.
              </p>
              <p>
                • Nunca transfira para chaves enviadas por terceiros fora desta tela. Assim que o Administrador validar o Pix, seu saldo GoPay é liberado automaticamente.
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
                className="min-h-[42px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferQrScanner && (
        <div className="fixed inset-0 z-[1310] flex items-end sm:items-center justify-center bg-[#0F172A]/75 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-white text-[#0F172A] border border-[#E2E8F0] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-[#2563EB]" />
                <h4 className="font-display text-base font-extrabold">Ler QR Code GoPay</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowTransferQrScanner(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F4F6F9] text-[#475569]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black border-2 border-[#2563EB] flex items-center justify-center">
              <video ref={transferVideoRef} playsInline muted className="h-full w-full object-cover" />
              <canvas ref={transferCanvasRef} className="hidden" />
              {!qrScanError && (
                <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-[#38BDF8] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              )}
              {!qrScanReady && !qrScanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 text-xs text-neutral-300 p-4 text-center">
                  <Camera className="h-7 w-7 text-[#38BDF8] animate-pulse" />
                  <span>Abrindo câmera...</span>
                </div>
              )}
              {qrScanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-xs text-neutral-300">
                  <p>{qrScanError}</p>
                </div>
              )}
            </div>

            <p className="text-center text-[11px] text-[#475569]">
              Aponte para o QR Code GoPay do usuário que vai receber a transferência.
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
