import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Ban,
  Bell,
  BellRing,
  Bike,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  DollarSign,
  DownloadCloud,
  Eye,
  FileText,
  Gift,
  Image as ImageIcon,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Music,
  Package,
  Plus,
  Power,
  Printer,
  QrCode,
  Radio,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { useAppConfig } from '../context/AppConfigContext';
import { fetchAuditLogsFromSupabase } from '../lib/audit';
import { resolveBrandLogo, resolveCategoryVehicleImage } from '../lib/brandAssets';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import { formatBRL } from '../lib/geo';
import {
  adminApproveWalletDeposit,
  adminAssignClientDebt,
  adminConfirmPixRide,
  adminCreateCoupon,
  adminCreatePlatformEvent,
  adminDeleteCoupon,
  adminDeletePlatformEvent,
  adminDeleteUserAccount,
  adminFetchCouponsOverview,
  adminFetchSentNotifications,
  adminGrantCouponToUsers,
  adminPayDriverPix,
  adminProcessWalletWithdrawal,
  adminRejectWalletDeposit,
  adminReviewDriver,
  adminSavePlatformConfig,
  adminSavePricing,
  adminSendNotification,
  adminSettleDispute,
  adminToggleCoupon,
  adminTogglePlatformEvent,
  adminUpdateUserStatus,
  adminUpdateUserWalletBalance,
  cancelRide,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRICING_LIST,
  fetchAdminOverview,
  fetchPlatformEvents,
  resolveDocumentDisplayUrl,
  uploadPlatformAssetFile,
} from '../lib/mobilityApi';
import { CURRENT_APP_VERSION } from '../lib/otaUpdate';
import { isDateInPeriod } from '../lib/periodFilter';
import { playSoundCue, speakPtBr, stopSpeech, syncPlatformSounds } from '../lib/sound';
import { supabase } from '../lib/supabase';
import {
  getUserPreferences,
  saveUserPreferences,
  subscribeUserPreferences,
} from '../lib/userPrefs';
import type {
  AppNotification,
  AuditLogEntry,
  Coupon,
  NotificationCategory,
  NotificationTargetScope,
  PeriodFilter,
  PlatformConfig,
  PlatformEvent,
  PricingSetting,
  Ride,
  UserCoupon,
  UserProfile,
  WalletDeposit,
  WalletTransaction,
  WalletWithdrawal,
} from '../types/mobility';
import { AdminAuditTab } from './AdminAuditTab';
import { AdminSettlementReceiptModal } from './AdminSettlementReceiptModal';
import { AvatarImage } from './AvatarImage';
import { DirectChatModal } from './DirectChatModal';
import { LegalDocsModal } from './LegalDocsModal';
import { LiveMap } from './LiveMap';
import migrationSqlRaw from '../../supabase/migration_incremental_latest.sql?raw';

interface AdminDashboardProps {
  currentUser: UserProfile;
  initialPlatformConfig?: PlatformConfig;
  onLogout: () => void;
}

type AdminTab =
  | 'livemap'
  | 'drivers'
  | 'deliverers'
  | 'clients'
  | 'rides'
  | 'payments'
  | 'events'
  | 'notifications'
  | 'coupons'
  | 'pricing'
  | 'audit'
  | 'infra';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  initialPlatformConfig,
  onLogout,
}) => {
  const { refreshConfig, applyLocalConfig } = useAppConfig();
  const [tab, setTab] = useState<AdminTab>('livemap');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>(DEFAULT_PRICING_LIST);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [deposits, setDeposits] = useState<WalletDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawal[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(
    initialPlatformConfig ?? DEFAULT_PLATFORM_CONFIG
  );
  const [platformEvents, setPlatformEvents] = useState<PlatformEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [migrationSql] = useState<string>(migrationSqlRaw);
  const [copiedSql, setCopiedSql] = useState(false);

  const [driverFilter, setDriverFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('all');
  const [delivererFilter, setDelivererFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('all');
  const [rideFilter, setRideFilter] = useState<'all' | 'active' | 'completed' | 'disputed' | 'cancelled'>('all');
  const [settlementPeriod, setSettlementPeriod] = useState<PeriodFilter>('all');

  const [inspectDriver, setInspectDriver] = useState<UserProfile | null>(null);
  const [resolvedCnhUrl, setResolvedCnhUrl] = useState<string>('');
  const [resolvedCrlvUrl, setResolvedCrlvUrl] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState('');

  const [payoutModalDriver, setPayoutModalDriver] = useState<UserProfile | null>(null);
  const [receiptModalDriver, setReceiptModalDriver] = useState<UserProfile | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutNote, setPayoutNote] = useState<string>('');

  const [confirmingPixRideId, setConfirmingPixRideId] = useState<string | null>(null);
  const [processingDepositId, setProcessingDepositId] = useState<string | null>(null);
  const [processingWithdrawalId, setProcessingWithdrawalId] = useState<string | null>(null);
  const [copiedWithdrawPixId, setCopiedWithdrawPixId] = useState<string | null>(null);
  const [debtModalClient, setDebtModalClient] = useState<UserProfile | null>(null);
  const [debtAmountInput, setDebtAmountInput] = useState<string>('');
  const [debtNoteInput, setDebtNoteInput] = useState<string>('Corrida não paga');
  const [savingDebt, setSavingDebt] = useState(false);

  const [balanceModalUser, setBalanceModalUser] = useState<UserProfile | null>(null);
  const [balanceMode, setBalanceMode] = useState<'set' | 'add' | 'subtract'>('set');
  const [balanceAmountInput, setBalanceAmountInput] = useState<string>('');
  const [balanceNoteInput, setBalanceNoteInput] = useState<string>('');
  const [savingBalance, setSavingBalance] = useState(false);

  const [showLegalDocs, setShowLegalDocs] = useState(false);
  const [uploadingAssetKind, setUploadingAssetKind] = useState<string | null>(null);

  const [chatTargetUser, setChatTargetUser] = useState<UserProfile | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-23.55052, -46.633308]);

  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventBonus, setEventBonus] = useState('15.00');
  const [eventTargetRole, setEventTargetRole] = useState<PlatformEvent['target_role']>('all');
  const [notifyDriversOnEventCreate, setNotifyDriversOnEventCreate] = useState(true);
  const [notifyingEventId, setNotifyingEventId] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);

  const [sentNotifications, setSentNotifications] = useState<AppNotification[]>([]);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifCategory, setNotifCategory] = useState<NotificationCategory>('general');
  const [notifTargetScope, setNotifTargetScope] = useState<NotificationTargetScope>('all');
  const [notifTargetUserId, setNotifTargetUserId] = useState('');
  const [sendingNotif, setSendingNotif] = useState(false);

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponGrants, setCouponGrants] = useState<UserCoupon[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponTitle, setCouponTitle] = useState('');
  const [couponDesc, setCouponDesc] = useState('');
  const [couponType, setCouponType] = useState<'percent' | 'fixed'>('percent');
  const [couponValue, setCouponValue] = useState('15');
  const [couponMaxDiscount, setCouponMaxDiscount] = useState('15.00');
  const [couponMinFare, setCouponMinFare] = useState('0');
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponGrantUserId, setCouponGrantUserId] = useState('');
  const [couponGrantWithNotif, setCouponGrantWithNotif] = useState(true);
  const [grantingCouponId, setGrantingCouponId] = useState<string | null>(null);

  const [savingPricing, setSavingPricing] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [adminPrefs, setAdminPrefs] = useState(() => getUserPreferences());
  const [supportAlerts, setSupportAlerts] = useState<
    Array<{
      userId: string;
      senderName: string;
      senderRole: string;
      content: string;
      createdAt: string;
    }>
  >([]);
  const announcedAlertIdsRef = useRef<Set<string>>(new Set());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadOverview = useCallback(async () => {
    setLoadingData(true);
    try {
      const [data, events, logs, notifs, couponsRes] = await Promise.all([
        fetchAdminOverview(),
        fetchPlatformEvents(),
        fetchAuditLogsFromSupabase(300).catch(() => []),
        adminFetchSentNotifications().catch(() => []),
        adminFetchCouponsOverview().catch(() => ({ coupons: [], grants: [] })),
      ]);
      setPlatformConfig(data.platformConfig);
      syncPlatformSounds(data.platformConfig);
      setUsers(data.users);
      setRides(data.rides);
      setPricing(data.pricing);
      setTransactions(data.transactions);
      setDeposits(data.deposits);
      setWithdrawals(data.withdrawals || []);
      setPlatformEvents(events);
      setAuditLogs(logs);
      setSentNotifications(notifs);
      setCoupons(couponsRes.coupons);
      setCouponGrants(couponsRes.grants);

      const firstOnlineWithGps = data.users.find(
        (u) => u.role === 'driver' && u.driver?.is_online && u.driver.current_lat && u.driver.current_lng
      );
      if (firstOnlineWithGps?.driver?.current_lat && firstOnlineWithGps?.driver?.current_lng) {
        setMapCenter([firstOnlineWithGps.driver.current_lat, firstOnlineWithGps.driver.current_lng]);
      } else {
        getCurrentGpsPosition()
          .then((pos) => {
            if (pos) setMapCenter([pos.lat, pos.lng]);
          })
          .catch(() => {});
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar dados do Supabase.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    return subscribeUserPreferences((prefs) => setAdminPrefs(prefs));
  }, []);

  useEffect(() => {
    loadOverview();

    // Load recent incoming support messages (last 12 hours) so Admin sees active support alerts
    const sinceIso = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    supabase
      .from('direct_messages')
      .select('user_id, sender_id, sender_name, sender_role, content, created_at')
      .neq('sender_role', 'admin')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const map = new Map<
          string,
          {
            userId: string;
            senderName: string;
            senderRole: string;
            content: string;
            createdAt: string;
          }
        >();
        for (const row of data) {
          const uid = String(row.user_id || '');
          if (!uid || map.has(uid)) continue;
          map.set(uid, {
            userId: uid,
            senderName: String(row.sender_name || 'Usuário'),
            senderRole: String(row.sender_role || 'passenger'),
            content: String(row.content || ''),
            createdAt: String(row.created_at || ''),
          });
        }
        setSupportAlerts(Array.from(map.values()));
      })
      .then(undefined, () => undefined);

    const channel = supabase
      .channel('admin-live-overview')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_profiles' },
        () => {
          loadOverview();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        () => {
          loadOverview();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_deposits' },
        () => {
          loadOverview();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_withdrawals' },
        () => {
          loadOverview();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          loadOverview();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          const m = payload.new as Record<string, unknown> | undefined;
          if (!m || String(m.sender_role || '') === 'admin') return;
          const uid = String(m.user_id || '');
          if (!uid) return;
          const alertItem = {
            userId: uid,
            senderName: String(m.sender_name || 'Usuário'),
            senderRole: String(m.sender_role || 'passenger'),
            content: String(m.content || ''),
            createdAt: String(m.created_at || new Date().toISOString()),
          };
          setSupportAlerts((prev) => [
            alertItem,
            ...prev.filter((p) => p.userId !== uid),
          ]);
          void playSoundCue('chat');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (!inspectDriver?.driver) {
      setResolvedCnhUrl('');
      setResolvedCrlvUrl('');
      return;
    }
    resolveDocumentDisplayUrl(inspectDriver.driver.cnh_url).then(setResolvedCnhUrl);
    resolveDocumentDisplayUrl(inspectDriver.driver.crlv_url).then(setResolvedCrlvUrl);
  }, [inspectDriver]);

  const passengerDrivers = useMemo(
    () => users.filter((u) => u.role === 'driver' && u.driver?.vehicle_type !== 'delivery'),
    [users]
  );

  const deliverers = useMemo(
    () => users.filter((u) => u.role === 'driver' && u.driver?.vehicle_type === 'delivery'),
    [users]
  );

  const allDriversAndDeliverers = useMemo(
    () => users.filter((u) => u.role === 'driver'),
    [users]
  );

  const onlineDrivers = useMemo(
    () => allDriversAndDeliverers.filter((d) => Boolean(d.driver?.is_online)),
    [allDriversAndDeliverers]
  );

  const onlineDriversWithGps = useMemo(
    () => onlineDrivers.filter((d) => Boolean(d.driver?.current_lat && d.driver?.current_lng)),
    [onlineDrivers]
  );

  const clients = useMemo(
    () => users.filter((u) => u.role === 'passenger'),
    [users]
  );

  const metrics = useMemo(() => {
    const completed = rides.filter((r) => r.status === 'completed');
    const totalRevenue = completed.reduce(
      (acc, r) => acc + (r.final_fare ?? r.estimated_fare),
      0
    );
    const totalPixPlatform = completed
      .filter((r) => r.payment_method === 'pix' || r.payment_method === 'wallet')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
    const totalPendingToDrivers = allDriversAndDeliverers.reduce(
      (acc, d) => acc + (d.wallet_balance || 0),
      0
    );

    return {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalPixPlatform: Number(totalPixPlatform.toFixed(2)),
      totalPendingToDrivers: Number(totalPendingToDrivers.toFixed(2)),
      completedCount: completed.length,
      activeRidesCount: rides.filter((r) =>
        ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status)
      ).length,
      pendingApprovalsCount: allDriversAndDeliverers.filter((d) => d.status === 'pending').length,
      disputedCount: rides.filter((r) => r.payment_status === 'disputed').length,
      onlineCount: onlineDrivers.length,
    };
  }, [rides, allDriversAndDeliverers, onlineDrivers.length]);

  const filteredDrivers = useMemo(
    () =>
      passengerDrivers.filter((d) =>
        driverFilter === 'all' ? true : d.status === driverFilter
      ),
    [passengerDrivers, driverFilter]
  );

  const filteredDeliverers = useMemo(
    () =>
      deliverers.filter((d) =>
        delivererFilter === 'all' ? true : d.status === delivererFilter
      ),
    [deliverers, delivererFilter]
  );

  const awaitingPixRides = useMemo(
    () =>
      rides.filter(
        (r) =>
          r.status === 'completed' &&
          r.payment_status === 'pending' &&
          (r.payment_method === 'pix' || Boolean(r.pix_declared_at))
      ),
    [rides]
  );

  const pendingDeposits = useMemo(
    () => deposits.filter((d) => d.status === 'pending'),
    [deposits]
  );

  const reviewedDeposits = useMemo(
    () => deposits.filter((d) => d.status !== 'pending').slice(0, 15),
    [deposits]
  );

  const pendingWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.status === 'pending'),
    [withdrawals]
  );

  const reviewedWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.status !== 'pending').slice(0, 15),
    [withdrawals]
  );

  // Automatic Admin Voice Assistant for newly arrived pending Pix rides, deposits, withdrawals & support calls
  useEffect(() => {
    const queueMessages: string[] = [];

    for (const r of awaitingPixRides) {
      const k = `pix_ride:${r.id}`;
      if (!announcedAlertIdsRef.current.has(k)) {
        announcedAlertIdsRef.current.add(k);
        const drvName = r.driver?.full_name || 'o motorista';
        const val = Number(r.final_fare ?? r.estimated_fare ?? 0).toFixed(2).replace('.', ',');
        queueMessages.push(
          `Administrador, estamos aguardando a confirmação da corrida Pix de ${drvName} no valor de ${val} reais.`
        );
      }
    }

    for (const dep of pendingDeposits) {
      const k = `deposit:${dep.id}`;
      if (!announcedAlertIdsRef.current.has(k)) {
        announcedAlertIdsRef.current.add(k);
        const cliName = dep.user?.full_name || 'um cliente';
        const val = Number(dep.amount || 0).toFixed(2).replace('.', ',');
        queueMessages.push(
          `Administrador, estamos aguardando a confirmação do depósito Pix de ${cliName} no valor de ${val} reais.`
        );
      }
    }

    for (const w of pendingWithdrawals) {
      const k = `withdraw:${w.id}`;
      if (!announcedAlertIdsRef.current.has(k)) {
        announcedAlertIdsRef.current.add(k);
        const uName = w.user?.full_name || 'um parceiro';
        const val = Number(w.amount || 0).toFixed(2).replace('.', ',');
        queueMessages.push(
          `Administrador, estamos aguardando a confirmação do saque Pix de ${uName} no valor de ${val} reais.`
        );
      }
    }

    for (const s of supportAlerts) {
      const k = `support:${s.userId}:${s.createdAt}`;
      if (!announcedAlertIdsRef.current.has(k)) {
        announcedAlertIdsRef.current.add(k);
        queueMessages.push(
          `Administrador, ${s.senderName} enviou uma mensagem no suporte aguardando retorno.`
        );
      }
    }

    if (queueMessages.length > 0 && adminPrefs.voice_enabled) {
      void playSoundCue('offer');
      speakPtBr(queueMessages.slice(0, 3).join(' '), true);
    }
  }, [awaitingPixRides, pendingDeposits, pendingWithdrawals, supportAlerts, adminPrefs.voice_enabled]);

  // Voice escalation & periodic wait-time monitor: warns specifically when an item reaches >= 5 minutes
  useEffect(() => {
    const totalPending =
      awaitingPixRides.length +
      pendingDeposits.length +
      pendingWithdrawals.length +
      supportAlerts.length;
    if (totalPending === 0 || !adminPrefs.voice_enabled) return;

    const lastUrgentSpeakAtByKey = new Map<string, number>();

    const checkAndSpeak = () => {
      const now = Date.now();
      const urgentMsgs: string[] = [];

      for (const dep of pendingDeposits) {
        const createdMs = new Date(dep.created_at).getTime();
        const elapsedMin = Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((now - createdMs) / 60000))
          : 0;
        const k = `deposit:${dep.id}`;
        const lastAt = lastUrgentSpeakAtByKey.get(k) || 0;
        if (elapsedMin >= 5 && now - lastAt >= 55_000) {
          lastUrgentSpeakAtByKey.set(k, now);
          const cliName = dep.user?.full_name || 'um cliente';
          const val = Number(dep.amount || 0).toFixed(2).replace('.', ',');
          urgentMsgs.push(
            `Administrador, já faz ${elapsedMin} minutos que estamos aguardando a confirmação do depósito de ${cliName} no valor de ${val} reais.`
          );
        }
      }

      for (const r of awaitingPixRides) {
        const refIso = r.pix_declared_at || r.completed_at || r.created_at;
        const createdMs = new Date(refIso).getTime();
        const elapsedMin = Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((now - createdMs) / 60000))
          : 0;
        const k = `pix_ride:${r.id}`;
        const lastAt = lastUrgentSpeakAtByKey.get(k) || 0;
        if (elapsedMin >= 5 && now - lastAt >= 55_000) {
          lastUrgentSpeakAtByKey.set(k, now);
          const drvName = r.driver?.full_name || 'o motorista';
          const val = Number(r.final_fare ?? r.estimated_fare ?? 0).toFixed(2).replace('.', ',');
          urgentMsgs.push(
            `Administrador, já faz ${elapsedMin} minutos que estamos aguardando a confirmação da corrida Pix de ${drvName} no valor de ${val} reais.`
          );
        }
      }

      for (const w of pendingWithdrawals) {
        const createdMs = new Date(w.created_at).getTime();
        const elapsedMin = Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((now - createdMs) / 60000))
          : 0;
        const k = `withdraw:${w.id}`;
        const lastAt = lastUrgentSpeakAtByKey.get(k) || 0;
        if (elapsedMin >= 5 && now - lastAt >= 55_000) {
          lastUrgentSpeakAtByKey.set(k, now);
          const uName = w.user?.full_name || 'um parceiro';
          const val = Number(w.amount || 0).toFixed(2).replace('.', ',');
          urgentMsgs.push(
            `Administrador, já faz ${elapsedMin} minutos que estamos aguardando a confirmação do saque de ${uName} no valor de ${val} reais.`
          );
        }
      }

      for (const s of supportAlerts) {
        const createdMs = new Date(s.createdAt).getTime();
        const elapsedMin = Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((now - createdMs) / 60000))
          : 0;
        const k = `support:${s.userId}:${s.createdAt}`;
        const lastAt = lastUrgentSpeakAtByKey.get(k) || 0;
        if (elapsedMin >= 5 && now - lastAt >= 55_000) {
          lastUrgentSpeakAtByKey.set(k, now);
          urgentMsgs.push(
            `Administrador, já faz ${elapsedMin} minutos que ${s.senderName} aguarda resposta no suporte.`
          );
        }
      }

      if (urgentMsgs.length > 0) {
        void playSoundCue('offer');
        speakPtBr(urgentMsgs.slice(0, 2).join(' '), true);
        return;
      }

      const parts: string[] = [];
      if (awaitingPixRides.length > 0) parts.push(`${awaitingPixRides.length} corrida Pix`);
      if (pendingDeposits.length > 0) parts.push(`${pendingDeposits.length} depósito`);
      if (pendingWithdrawals.length > 0) parts.push(`${pendingWithdrawals.length} saque`);
      if (supportAlerts.length > 0) parts.push(`${supportAlerts.length} chamado de suporte`);
      if (parts.length > 0) {
        speakPtBr(
          `Administrador, estamos aguardando a confirmação de ${parts.join(', ')}.`,
          false
        );
      }
    };

    const timer = window.setInterval(checkAndSpeak, 30_000);

    return () => window.clearInterval(timer);
  }, [
    awaitingPixRides,
    pendingDeposits,
    pendingWithdrawals,
    supportAlerts,
    adminPrefs.voice_enabled,
  ]);

  const filteredRides = useMemo(() => {
    if (rideFilter === 'active') {
      return rides.filter((r) =>
        ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status)
      );
    }
    if (rideFilter === 'completed') return rides.filter((r) => r.status === 'completed');
    if (rideFilter === 'cancelled') return rides.filter((r) => r.status === 'cancelled');
    if (rideFilter === 'disputed') return rides.filter((r) => r.payment_status === 'disputed');
    return rides;
  }, [rides, rideFilter]);

  const handleReviewDriver = async (
    userId: string,
    status: 'active' | 'rejected' | 'suspended',
    reason?: string
  ) => {
    try {
      await adminReviewDriver(userId, status, reason);
      await loadOverview();
      setInspectDriver(null);
      setRejectionReason('');
      showToast(
        status === 'active'
          ? 'Cadastro aprovado e liberado!'
          : status === 'rejected'
          ? 'Cadastro reprovado.'
          : 'Conta suspensa.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar status.');
    }
  };

  const handleToggleClientStatus = async (client: UserProfile) => {
    const nextStatus = client.status === 'suspended' ? 'active' : 'suspended';
    try {
      await adminUpdateUserStatus(client.id, nextStatus);
      await loadOverview();
      showToast(
        nextStatus === 'active' ? 'Cliente reativado.' : 'Cliente suspenso.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar cliente.');
    }
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPricing(true);
    try {
      await adminSavePricing(pricing);
      showToast('Tarifas das 5 categorias atualizadas no Supabase!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar tarifas.');
    } finally {
      setSavingPricing(false);
    }
  };

  const handleSavePlatformConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlatform(true);
    try {
      await adminSavePlatformConfig(platformConfig);
      syncPlatformSounds(platformConfig);
      applyLocalConfig({
        app_name: platformConfig.site_name,
        logo_url: platformConfig.app_logo_url ?? null,
        primary_color: platformConfig.primary_color || '#047857',
        secondary_color: platformConfig.secondary_color || '#071513',
      });
      void refreshConfig();
      showToast('Configurações, Marca, Cores, Pix Oficial e Sons salvos!');
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar configurações. Verifique se o SQL incremental foi aplicado.'
      );
    } finally {
      setSavingPlatform(false);
    }
  };

  const handleConfirmPixRide = async (ride: Ride) => {
    setConfirmingPixRideId(ride.id);
    try {
      await adminConfirmPixRide(ride);
      await loadOverview();
      showToast(
        `Pix da corrida #${ride.id.slice(-4)} confirmado! Motorista liberado e saldo creditado.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao confirmar Pix recebido.');
    } finally {
      setConfirmingPixRideId(null);
    }
  };

  const handleSettleDispute = async (ride: Ride, chargeClientAsUnpaid = false) => {
    try {
      await adminSettleDispute(ride, chargeClientAsUnpaid);
      await loadOverview();
      showToast(
        chargeClientAsUnpaid
          ? 'Motorista quitado e cobrança "Corrida não paga" atribuída ao cliente!'
          : 'Disputa assumida e valor creditado ao motorista!'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao quitar disputa.');
    }
  };

  const handleSaveClientDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtModalClient) return;
    setSavingDebt(true);
    try {
      const numeric = parseFloat(debtAmountInput.replace(',', '.')) || 0;
      await adminAssignClientDebt(debtModalClient.id, numeric, debtNoteInput);
      setDebtModalClient(null);
      await loadOverview();
      showToast(
        numeric > 0
          ? `Cobrança de ${formatBRL(numeric)} atribuída a ${debtModalClient.full_name}!`
          : `Dívida de ${debtModalClient.full_name} zerada.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar cobrança do cliente.');
    } finally {
      setSavingDebt(false);
    }
  };

  const handleApproveDeposit = async (dep: WalletDeposit) => {
    setProcessingDepositId(dep.id);
    try {
      await adminApproveWalletDeposit(dep);
      await loadOverview();
      showToast(
        `Depósito de ${formatBRL(dep.amount)} creditado no saldo de ${dep.user?.full_name || 'Cliente'}!`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao aprovar depósito Pix.');
    } finally {
      setProcessingDepositId(null);
    }
  };

  const handleRejectDeposit = async (dep: WalletDeposit) => {
    setProcessingDepositId(dep.id);
    try {
      await adminRejectWalletDeposit(dep.id);
      await loadOverview();
      showToast('Solicitação de depósito recusada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao recusar depósito.');
    } finally {
      setProcessingDepositId(null);
    }
  };

  const handleApproveWithdrawal = async (w: WalletWithdrawal) => {
    setProcessingWithdrawalId(w.id);
    try {
      await adminProcessWalletWithdrawal(w.id, 'paid');
      await loadOverview();
      showToast(
        `Saque de ${formatBRL(w.amount)} marcado como pago para ${w.user?.full_name || 'Motorista'}!`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao confirmar pagamento de saque.');
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  const handleRejectWithdrawal = async (w: WalletWithdrawal) => {
    setProcessingWithdrawalId(w.id);
    try {
      await adminProcessWalletWithdrawal(w.id, 'rejected');
      await loadOverview();
      showToast(
        `Saque de ${formatBRL(w.amount)} recusado e saldo estornado para ${w.user?.full_name || 'Motorista'}.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao estornar solicitação de saque.');
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  const openBalanceModal = (usr: UserProfile) => {
    setBalanceModalUser(usr);
    setBalanceMode('set');
    setBalanceAmountInput(Number(usr.wallet_balance || 0).toFixed(2));
    setBalanceNoteInput('');
  };

  const computedPreviewBalance = useMemo(() => {
    if (!balanceModalUser) return 0;
    const current = Number(balanceModalUser.wallet_balance || 0);
    const val = Math.max(0, parseFloat(balanceAmountInput.replace(',', '.')) || 0);
    if (balanceMode === 'add') return Number((current + val).toFixed(2));
    if (balanceMode === 'subtract') return Number(Math.max(0, current - val).toFixed(2));
    return Number(val.toFixed(2));
  }, [balanceModalUser, balanceMode, balanceAmountInput]);

  const handleSaveUserBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceModalUser) return;
    setSavingBalance(true);
    try {
      await adminUpdateUserWalletBalance(
        balanceModalUser,
        computedPreviewBalance,
        balanceNoteInput || undefined
      );
      setBalanceModalUser(null);
      await loadOverview();
      showToast(
        `Saldo de ${balanceModalUser.full_name} atualizado para ${formatBRL(computedPreviewBalance)}!`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar saldo do usuário.');
    } finally {
      setSavingBalance(false);
    }
  };

  const handleUploadPlatformAsset = async (
    file: File | undefined,
    kind:
      | 'logo'
      | 'pix_qr'
      | 'moto'
      | 'pop'
      | 'delivery_moto'
      | 'delivery_car'
      | 'sound_offer'
      | 'sound_delivery'
      | 'sound_accepted'
      | 'sound_arrived'
      | 'sound_completed'
      | 'sound_chat'
      | 'sound_cancel'
  ) => {
    if (!file) return;
    setUploadingAssetKind(kind);
    try {
      const uploadedUrl = await uploadPlatformAssetFile(file, kind);
      const fieldMap: Record<typeof kind, keyof PlatformConfig> = {
        logo: 'app_logo_url',
        pix_qr: 'platform_pix_qr_url',
        moto: 'vehicle_img_moto',
        pop: 'vehicle_img_pop',
        delivery_moto: 'vehicle_img_delivery_moto',
        delivery_car: 'vehicle_img_delivery_car',
        sound_offer: 'sound_offer_url',
        sound_delivery: 'sound_delivery_url',
        sound_accepted: 'sound_accepted_url',
        sound_arrived: 'sound_arrived_url',
        sound_completed: 'sound_completed_url',
        sound_chat: 'sound_chat_url',
        sound_cancel: 'sound_cancel_url',
      };
      const updatedCfg: PlatformConfig = {
        ...platformConfig,
        [fieldMap[kind]]: uploadedUrl,
      };
      setPlatformConfig(updatedCfg);
      syncPlatformSounds(updatedCfg);
      await adminSavePlatformConfig(updatedCfg);
      if (kind === 'logo') {
        applyLocalConfig({ logo_url: uploadedUrl });
      }
      void refreshConfig();
      showToast('Mídia atualizada e salva com sucesso!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao enviar arquivo.');
    } finally {
      setUploadingAssetKind(null);
    }
  };

  const handleResetPlatformAsset = async (
    field:
      | 'app_logo_url'
      | 'platform_pix_qr_url'
      | 'vehicle_img_moto'
      | 'vehicle_img_pop'
      | 'vehicle_img_delivery_moto'
      | 'vehicle_img_delivery_car'
      | 'sound_offer_url'
      | 'sound_delivery_url'
      | 'sound_accepted_url'
      | 'sound_arrived_url'
      | 'sound_completed_url'
      | 'sound_chat_url'
      | 'sound_cancel_url'
  ) => {
    const updatedCfg: PlatformConfig = { ...platformConfig, [field]: null };
    setPlatformConfig(updatedCfg);
    syncPlatformSounds(updatedCfg);
    try {
      await adminSavePlatformConfig(updatedCfg);
      if (field === 'app_logo_url') {
        applyLocalConfig({ logo_url: null });
      }
      void refreshConfig();
      showToast('Restaurado para o padrão original!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao restaurar padrão.');
    }
  };

  const handleSubmitPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModalDriver) return;
    const numeric = parseFloat(payoutAmount.replace(',', '.')) || 0;
    if (numeric <= 0) return;

    try {
      await adminPayDriverPix(payoutModalDriver, numeric, payoutNote);
      setPayoutModalDriver(null);
      setPayoutAmount('');
      setPayoutNote('');
      await loadOverview();
      showToast('Repasse Pix registrado com sucesso!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao registrar repasse Pix.');
    }
  };

  const handleCancelRide = async (rideId: string) => {
    try {
      await cancelRide(rideId);
      await loadOverview();
      showToast('Corrida cancelada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao cancelar.');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await adminDeleteUserAccount(userId);
      setConfirmDeleteUserId(null);
      await loadOverview();
      showToast('Usuário excluído da plataforma.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao excluir usuário.');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim() || !eventDesc.trim()) return;
    setSavingEvent(true);
    try {
      const titleSnap = eventTitle.trim();
      const descSnap = eventDesc.trim();
      const bonusNum = parseFloat(eventBonus.replace(',', '.')) || 0;
      await adminCreatePlatformEvent({
        title: titleSnap,
        description: descSnap,
        bonus_amount: bonusNum,
        target_role: eventTargetRole,
      });
      if (notifyDriversOnEventCreate) {
        await adminSendNotification({
          title: `Novo Evento: ${titleSnap}`,
          message:
            bonusNum > 0
              ? `${descSnap} (Bônus: +${formatBRL(bonusNum)})`
              : descSnap,
          category: 'event',
          target_scope: 'drivers',
          action_tab: 'events',
          created_by: currentUser.id,
        }).catch(() => undefined);
      }
      setEventTitle('');
      setEventDesc('');
      setEventBonus('15.00');
      await loadOverview();
      showToast(
        notifyDriversOnEventCreate
          ? 'Evento publicado e motoristas/entregadores notificados!'
          : 'Evento / Campanha publicado para os parceiros!'
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Erro ao criar evento. Aplique o SQL incremental primeiro.'
      );
    } finally {
      setSavingEvent(false);
    }
  };

  const handleNotifyDriversForEvent = async (ev: PlatformEvent) => {
    setNotifyingEventId(ev.id);
    try {
      await adminSendNotification({
        title: `Evento Ativo: ${ev.title}`,
        message:
          ev.bonus_amount > 0
            ? `${ev.description} (Bônus: +${formatBRL(ev.bonus_amount)})`
            : ev.description,
        category: 'event',
        target_scope: 'drivers',
        action_tab: 'events',
        created_by: currentUser.id,
      });
      await loadOverview();
      showToast('Notificação enviada apenas aos motoristas e entregadores!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao notificar motoristas.');
    } finally {
      setNotifyingEventId(null);
    }
  };

  const handleToggleEvent = async (ev: PlatformEvent) => {
    try {
      await adminTogglePlatformEvent(ev.id, !ev.active);
      await loadOverview();
      showToast(ev.active ? 'Evento pausado.' : 'Evento reativado!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar evento.');
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      await adminDeletePlatformEvent(eventId);
      await loadOverview();
      showToast('Evento removido.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao remover evento.');
    }
  };

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) return;
    if (notifTargetScope === 'user' && !notifTargetUserId) {
      showToast('Selecione o usuário de destino.');
      return;
    }
    setSendingNotif(true);
    try {
      await adminSendNotification({
        title: notifTitle,
        message: notifMessage,
        category: notifCategory,
        target_scope: notifTargetScope,
        target_user_id: notifTargetScope === 'user' ? notifTargetUserId : null,
        created_by: currentUser.id,
      });
      setNotifTitle('');
      setNotifMessage('');
      await loadOverview();
      showToast('Notificação enviada em tempo real!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao enviar notificação.');
    } finally {
      setSendingNotif(false);
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim() || !couponTitle.trim()) return;
    setSavingCoupon(true);
    try {
      await adminCreateCoupon({
        code: couponCode,
        title: couponTitle,
        description: couponDesc || `Desconto promocional ${couponCode.toUpperCase()}`,
        discount_type: couponType,
        discount_value: parseFloat(couponValue.replace(',', '.')) || 0,
        max_discount: parseFloat(couponMaxDiscount.replace(',', '.')) || null,
        min_ride_fare: parseFloat(couponMinFare.replace(',', '.')) || 0,
      });
      setCouponCode('');
      setCouponTitle('');
      setCouponDesc('');
      await loadOverview();
      showToast('Cupom criado! Agora você pode liberá-lo aos passageiros.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao criar cupom.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleToggleCoupon = async (coupon: Coupon) => {
    try {
      await adminToggleCoupon(coupon.id, !coupon.active);
      await loadOverview();
      showToast(coupon.active ? 'Cupom pausado.' : 'Cupom reativado!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar cupom.');
    }
  };

  const handleDeleteCoupon = async (couponId: string) => {
    try {
      await adminDeleteCoupon(couponId);
      await loadOverview();
      showToast('Cupom excluído.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao excluir cupom.');
    }
  };

  const handleGrantCoupon = async (couponId: string, targetUserId: string | null) => {
    if (targetUserId === '') {
      showToast('Selecione um passageiro para liberar este cupom.');
      return;
    }
    setGrantingCouponId(couponId);
    try {
      const count = await adminGrantCouponToUsers(couponId, targetUserId, couponGrantWithNotif);
      await loadOverview();
      showToast(
        targetUserId
          ? `Cupom liberado para o passageiro selecionado!`
          : `Cupom liberado para ${count} passageiro(s)!`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao liberar cupom.');
    } finally {
      setGrantingCouponId(null);
    }
  };

  const copySql = async () => {
    if (!migrationSql) return;
    await navigator.clipboard.writeText(migrationSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const renderDriverGrid = (
    list: UserProfile[],
    emptyLabel: string,
    filter: 'all' | 'pending' | 'active' | 'rejected' | 'suspended',
    setFilter: (v: 'all' | 'pending' | 'active' | 'rejected' | 'suspended') => void,
    title: string
  ) => (
    <section className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold text-neutral-950">{title}</h2>
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-200/70 p-1">
          {(['all', 'pending', 'active', 'rejected', 'suspended'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition ${
                filter === f ? 'bg-white text-neutral-950 shadow-xs' : 'text-neutral-600'
              }`}
            >
              {f === 'all'
                ? 'Todos'
                : f === 'pending'
                ? 'Pendentes'
                : f === 'active'
                ? 'Aprovados'
                : f === 'rejected'
                ? 'Reprovados'
                : 'Suspensos'}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((d) => {
            const drvRides = rides.filter((r) => r.driver_id === d.id && r.status === 'completed');
            const isDeleting = confirmDeleteUserId === d.id;
            return (
              <div
                key={d.id}
                className="rounded-2xl border border-neutral-200 bg-white p-5 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarImage
                        src={d.avatar_url}
                        name={d.full_name}
                        initialsCount={2}
                        className="h-10 w-10 rounded-full object-cover border border-neutral-200 shrink-0"
                        fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#047857] text-xs font-extrabold text-[#6EE7B7]"
                      />
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-extrabold text-neutral-950 truncate">
                          {d.full_name}
                        </h3>
                        <p className="text-xs text-neutral-500 truncate">
                          {d.phone} · {d.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`text-xs font-extrabold ${
                          d.status === 'active'
                            ? 'text-emerald-700'
                            : d.status === 'pending'
                            ? 'text-teal-700'
                            : 'text-red-600'
                        }`}
                      >
                        {d.status === 'active'
                          ? 'Aprovado'
                          : d.status === 'pending'
                          ? 'Pendente'
                          : d.status === 'rejected'
                          ? 'Reprovado'
                          : 'Suspenso'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                          d.driver?.is_online ? 'text-emerald-600' : 'text-neutral-400'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            d.driver?.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-300'
                          }`}
                        />
                        {d.driver?.is_online ? 'Online agora' : 'Offline'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-neutral-700 space-y-1 border-t border-neutral-100 pt-3">
                    <p className="flex items-center gap-1.5">
                      {d.driver?.vehicle_type === 'delivery' ? (
                        <Package className="h-3.5 w-3.5 text-[#047857]" />
                      ) : d.driver?.vehicle_type === 'moto' ? (
                        <Bike className="h-3.5 w-3.5 text-neutral-700" />
                      ) : (
                        <Car className="h-3.5 w-3.5 text-neutral-700" />
                      )}
                      <strong>Veículo:</strong> {d.driver?.vehicle_model} ({d.driver?.vehicle_color})
                    </p>
                    <p className="font-mono-num">
                      <strong>Placa:</strong> {d.driver?.vehicle_plate} · <strong>CPF:</strong>{' '}
                      {d.cpf}
                    </p>
                    <p className="font-mono-num truncate">
                      <strong>Pix:</strong> {d.driver?.pix_key}
                    </p>
                    <p className="font-mono-num text-neutral-950 font-bold pt-1">
                      Concluídas: {drvRides.length} · A pagar (Pix):{' '}
                      {formatBRL(d.wallet_balance)}
                    </p>
                  </div>
                </div>

                {isDeleting ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-red-700">
                      Excluir conta?
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteUserId(null)}
                        className="rounded-lg bg-white border border-neutral-200 px-2.5 py-1 text-[11px] font-bold text-neutral-700"
                      >
                        Não
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(d.id)}
                        className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white"
                      >
                        Sim, Excluir
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setInspectDriver(d)}
                      className="min-h-[40px] flex-1 flex items-center justify-center gap-1 rounded-xl border border-neutral-300 bg-neutral-50 px-2.5 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Docs
                    </button>
                    <button
                      type="button"
                      onClick={() => openBalanceModal(d)}
                      className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                      title="Editar saldo deste parceiro"
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      Saldo
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatTargetUser(d)}
                      className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl border border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                      title="Conversar com este usuário"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Chat
                    </button>
                    {d.status !== 'active' ? (
                      <button
                        type="button"
                        onClick={() => handleReviewDriver(d.id, 'active')}
                        className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl aurora-accent-flow px-3 text-xs font-extrabold text-white"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Aprovar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReviewDriver(d.id, 'suspended', 'Bloqueado pelo Admin')}
                        className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-800"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Bloquear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteUserId(d.id)}
                      className="flex h-[40px] w-[40px] items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      title="Excluir usuário"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'livemap',
      label: `Mapa ao Vivo (${metrics.onlineCount} online)`,
      icon: Radio,
    },
    {
      id: 'drivers',
      label: `Motoristas (${passengerDrivers.length})`,
      icon: Car,
    },
    {
      id: 'deliverers',
      label: `Entregadores (${deliverers.length})`,
      icon: Package,
    },
    {
      id: 'clients',
      label: `Clientes (${clients.length})`,
      icon: Users,
    },
    {
      id: 'rides',
      label: `Corridas & Disputas (${rides.length})`,
      icon: ShieldCheck,
    },
    {
      id: 'payments',
      label: `Pagamentos & Saldos (${awaitingPixRides.length + pendingDeposits.length + pendingWithdrawals.length})`,
      icon: Wallet,
      badge: awaitingPixRides.length + pendingDeposits.length + pendingWithdrawals.length,
    },
    {
      id: 'events',
      label: `Eventos Motoboys (${platformEvents.filter((e) => e.active).length})`,
      icon: Sparkles,
    },
    {
      id: 'notifications',
      label: `Notificações (${sentNotifications.length})`,
      icon: Bell,
    },
    {
      id: 'coupons',
      label: `Cupons (${coupons.filter((c) => c.active).length})`,
      icon: Gift,
    },
    {
      id: 'pricing',
      label: 'Tarifas, Marca & Sons',
      icon: Settings,
    },
    {
      id: 'audit',
      label: `Auditoria & Dispositivos (${auditLogs.length})`,
      icon: Activity,
    },
    {
      id: 'infra',
      label: 'SQL & APK',
      icon: Database,
    },
  ];
  const activeNavItem = navItems.find((item) => item.id === tab) || navItems[0];

  return (
    <div
      className={`min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col ${
        receiptModalDriver ? 'no-print' : ''
      }`}
    >
      {/* Top Bar */}
      <header className="no-print sticky top-0 z-30 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 sm:px-8 py-3.5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-950 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-700 active:scale-95 transition"
              aria-label="Abrir menu lateral"
              title="Abrir menu de seções"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src={resolveBrandLogo(platformConfig)}
              alt={platformConfig.site_name || 'Boreal Mobilidade'}
              className="h-10 w-10 shrink-0 rounded-xl object-cover border border-[#D4EDE7] dark:border-neutral-700 shadow-xs"
            />
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-extrabold text-[#0F2421] dark:text-white leading-tight truncate">
                {platformConfig.site_name || 'Boreal Mobilidade'} · Super Admin
              </h1>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {platformConfig.platform_city} · {activeNavItem.label}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const nextAllOn = !(adminPrefs.voice_enabled || adminPrefs.sounds_enabled);
                const next = saveUserPreferences({
                  voice_enabled: nextAllOn,
                  sounds_enabled: nextAllOn,
                  notifications_enabled: nextAllOn,
                });
                setAdminPrefs(next);
                if (!nextAllOn) stopSpeech();
                else speakPtBr('Voz e sons do administrador ativados.', true);
              }}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 text-xs font-extrabold transition ${
                adminPrefs.voice_enabled || adminPrefs.sounds_enabled
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                  : 'border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
              }`}
              title="Acessibilidade: Silenciar ou Ativar Voz e Sons do Admin"
            >
              {adminPrefs.voice_enabled || adminPrefs.sounds_enabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
              <span className="hidden md:inline">
                {adminPrefs.voice_enabled || adminPrefs.sounds_enabled ? 'Voz & Som' : 'Silenciado'}
              </span>
            </button>
            <button
              type="button"
              disabled={loadingData}
              onClick={loadOverview}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3.5 text-xs font-bold text-white dark:text-[#071513]"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Left Hamburger Drawer Menu (Top-to-bottom section navigation) */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col bg-white dark:bg-[#0B1D1A] border-r border-[#D4EDE7] dark:border-neutral-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#D4EDE7] dark:border-neutral-800 p-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={resolveBrandLogo(platformConfig)}
                  alt={platformConfig.site_name || 'Boreal Mobilidade'}
                  className="h-10 w-10 rounded-xl object-cover border border-[#D4EDE7] dark:border-neutral-700 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-display text-sm font-extrabold text-[#0F2421] dark:text-white truncate">
                    {platformConfig.site_name || 'Boreal Mobilidade'}
                  </p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                    {currentUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setDrawerOpen(false);
                    }}
                    className={`flex min-h-[46px] w-full items-center justify-between gap-2.5 rounded-2xl px-3.5 text-left text-xs font-bold transition ${
                      active
                        ? 'aurora-accent-flow text-white shadow-sm'
                        : 'text-[#0F2421] dark:text-neutral-200 hover:bg-[#F7FBFA] dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white font-mono-num shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2.5">
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-3 space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Acessibilidade (Voz &amp; Alertas)
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = saveUserPreferences({
                        voice_enabled: !adminPrefs.voice_enabled,
                      });
                      setAdminPrefs(next);
                      if (!next.voice_enabled) stopSpeech();
                    }}
                    className={`min-h-[36px] rounded-xl text-[11px] font-extrabold ${
                      adminPrefs.voice_enabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
                    }`}
                  >
                    {adminPrefs.voice_enabled ? 'Voz: Ligada' : 'Voz: Mudo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = saveUserPreferences({
                        sounds_enabled: !adminPrefs.sounds_enabled,
                      });
                      setAdminPrefs(next);
                    }}
                    className={`min-h-[36px] rounded-xl text-[11px] font-extrabold ${
                      adminPrefs.sounds_enabled
                        ? 'bg-[#047857] text-[#6EE7B7]'
                        : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
                    }`}
                  >
                    {adminPrefs.sounds_enabled ? 'Sons: Ligados' : 'Sons: Mudos'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-red-50 dark:bg-red-950/40 text-xs font-extrabold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900"
              >
                <LogOut className="h-4 w-4" />
                Sair do Painel Admin
              </button>
            </div>
          </aside>
        </div>
      )}

      {toast && (
        <div className="no-print fixed bottom-5 right-5 z-50 rounded-2xl bg-[#071513] border border-[#2DD4BF]/40 px-4 py-3 text-xs font-bold text-[#6EE7B7] shadow-xl">
          {toast}
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-8 py-6">
        {/* KPIs */}
        <div className="no-print mb-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Volume Total</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-[#0F2421] dark:text-white">
              {formatBRL(metrics.totalRevenue)}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Entradas Pix / App</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-emerald-700 dark:text-emerald-400">
              {formatBRL(metrics.totalPixPlatform)}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">A Repassar (Pix)</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-[#047857] dark:text-[#6EE7B7]">
              {formatBRL(metrics.totalPendingToDrivers)}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Concluídas / Ativas</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-[#0F2421] dark:text-white">
              {metrics.completedCount} / {metrics.activeRidesCount}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Aprovações Pend.</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-[#047857] dark:text-[#6EE7B7]">
              {metrics.pendingApprovalsCount}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Disputas Abertas</p>
            <p
              className={`mt-1 font-mono-num text-xl font-extrabold ${
                metrics.disputedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-[#0F2421] dark:text-white'
              }`}
            >
              {metrics.disputedCount}
            </p>
          </div>
        </div>

        {(awaitingPixRides.length > 0 ||
          pendingDeposits.length > 0 ||
          pendingWithdrawals.length > 0 ||
          supportAlerts.length > 0) && (
          <div className="no-print mb-5 rounded-3xl border-2 border-[#2DD4BF] dark:border-[#2DD4BF]/60 bg-[#ECFDF5] dark:bg-[#047857]/25 p-4 shadow-lg ring-2 ring-[#2DD4BF]/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl aurora-accent-flow text-white animate-pulse shadow">
                  <BellRing className="h-5 w-5" />
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-600" />
                  </span>
                </div>
                <div>
                  <p className="text-xs font-extrabold text-[#065F46] dark:text-[#6EE7B7] flex items-center gap-2">
                    <span>ATENÇÃO ADMIN · PENDÊNCIAS EM TEMPO REAL</span>
                  </p>
                  <p className="text-[11px] font-semibold text-[#047857] dark:text-emerald-200">
                    {awaitingPixRides.length > 0 && `${awaitingPixRides.length} corrida(s) Pix`}
                    {awaitingPixRides.length > 0 &&
                      (pendingDeposits.length > 0 ||
                        pendingWithdrawals.length > 0 ||
                        supportAlerts.length > 0) &&
                      ' · '}
                    {pendingDeposits.length > 0 && `${pendingDeposits.length} depósito(s) BorealPay`}
                    {pendingDeposits.length > 0 &&
                      (pendingWithdrawals.length > 0 || supportAlerts.length > 0) &&
                      ' · '}
                    {pendingWithdrawals.length > 0 &&
                      `${pendingWithdrawals.length} saque(s) Pix`}
                    {pendingWithdrawals.length > 0 && supportAlerts.length > 0 && ' · '}
                    {supportAlerts.length > 0 && `${supportAlerts.length} chamado(s) no suporte`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTab('payments')}
                className="min-h-[42px] shrink-0 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-4 text-xs font-extrabold text-white dark:text-[#071513] shadow-sm"
              >
                Conferir &amp; Confirmar
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {awaitingPixRides.slice(0, 4).map((r) => (
                <button
                  key={`alert-pix-${r.id}`}
                  type="button"
                  onClick={() => setTab('payments')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-500/20 border border-teal-500/40 px-3 py-1.5 text-[11px] font-extrabold text-[#065F46] dark:text-[#6EE7B7] animate-pulse"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Pix Corrida · {r.driver?.full_name?.split(' ')[0] || 'Motorista'} ·{' '}
                  {formatBRL(r.final_fare ?? r.estimated_fare)}
                </button>
              ))}
              {pendingDeposits.slice(0, 4).map((dep) => (
                <button
                  key={`alert-dep-${dep.id}`}
                  type="button"
                  onClick={() => setTab('payments')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-[11px] font-extrabold text-emerald-950 dark:text-emerald-100 animate-pulse"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  Depósito · {dep.user?.full_name?.split(' ')[0] || 'Cliente'} ·{' '}
                  {formatBRL(dep.amount)}
                </button>
              ))}
              {pendingWithdrawals.slice(0, 4).map((w) => (
                <button
                  key={`alert-wd-${w.id}`}
                  type="button"
                  onClick={() => setTab('payments')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500/20 border border-blue-500/40 px-3 py-1.5 text-[11px] font-extrabold text-blue-950 dark:text-blue-100 animate-pulse"
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  Saque · {w.user?.full_name?.split(' ')[0] || 'Parceiro'} · {formatBRL(w.amount)}
                </button>
              ))}
              {supportAlerts.slice(0, 4).map((s) => (
                <button
                  key={`alert-sup-${s.userId}`}
                  type="button"
                  onClick={() => {
                    const matched = users.find((u) => u.id === s.userId);
                    setChatTargetUser(
                      matched || {
                        id: s.userId,
                        full_name: s.senderName,
                        role: s.senderRole === 'driver' ? 'driver' : 'passenger',
                        status: 'active',
                        phone: '',
                        email: '',
                        cpf: '',
                        rating_avg: 5,
                        rating_count: 0,
                        wallet_balance: 0,
                        created_at: s.createdAt,
                      }
                    );
                    setSupportAlerts((prev) => prev.filter((item) => item.userId !== s.userId));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-600/20 border border-red-500/50 px-3 py-1.5 text-[11px] font-extrabold text-red-950 dark:text-red-100 animate-pulse"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Suporte · {s.senderName.split(' ')[0]}: &ldquo;{s.content.slice(0, 26)}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active Section Pill + Quick Drawer Trigger */}
        <div className="no-print flex items-center justify-between gap-3 rounded-2xl border border-[#D4EDE7] dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <activeNavItem.icon className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7] shrink-0" />
            <span className="font-display text-sm font-extrabold text-[#0F2421] dark:text-white truncate">
              {activeNavItem.label}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 px-3 text-xs font-extrabold text-neutral-900 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
          >
            <Menu className="h-3.5 w-3.5" />
            <span>Menu</span>
          </button>
        </div>

        {/* TAB 0: MAPA AO VIVO & ONLINE */}
        {tab === 'livemap' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 px-5 py-3.5">
                <div>
                  <h2 className="font-display text-base font-extrabold text-neutral-950 dark:text-white flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    Monitoramento GPS ao Vivo ({onlineDrivers.length} online)
                  </h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Total de cadastros: {users.length} usuários · Mapa Urbano GPS ao vivo
                  </p>
                </div>
              </div>
              <div className="h-[420px] lg:h-[520px] w-full">
                <LiveMap
                  center={mapCenter}
                  nearbyDrivers={onlineDriversWithGps}
                  controlsTopClassName="top-4"
                />
              </div>
            </div>

            <div className="lg:col-span-4 space-y-4">
              <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-extrabold text-neutral-950 dark:text-white">
                    Quem está Online Agora
                  </h3>
                  <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400">
                    {onlineDrivers.length} ativos
                  </span>
                </div>

                {onlineDrivers.length === 0 ? (
                  <p className="py-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Nenhum motorista ou entregador online neste momento.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {onlineDrivers.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 p-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            {d.full_name}
                          </p>
                          <p className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
                            {d.driver?.vehicle_type === 'delivery'
                              ? 'Motoboy / Entrega'
                              : d.driver?.vehicle_type === 'moto'
                              ? 'Moto'
                              : 'Carro'}{' '}
                            · {d.driver?.vehicle_plate}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {d.driver?.current_lat && d.driver?.current_lng && (
                            <button
                              type="button"
                              onClick={() =>
                                setMapCenter([
                                  d.driver!.current_lat!,
                                  d.driver!.current_lng!,
                                ])
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50"
                              title="Focar no mapa"
                            >
                              <MapPin className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setChatTargetUser(d)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#071513]"
                            title="Conversar"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-2">
                <h3 className="font-display text-sm font-extrabold text-neutral-950 dark:text-white">
                  Resumo da Base Cadastrada
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white">
                      {clients.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400">Clientes</p>
                  </div>
                  <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white">
                      {passengerDrivers.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400">Motoristas</p>
                  </div>
                  <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white">
                      {deliverers.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400">Entregadores</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 1: MOTORISTAS (CARRO / MOTO) */}
        {tab === 'drivers' &&
          renderDriverGrid(
            filteredDrivers,
            'Nenhum motorista (Carro ou Moto) nesta categoria.',
            driverFilter,
            setDriverFilter,
            'Gestão de Motoristas (Carros e Motos)'
          )}

        {/* TAB 2: ENTREGADORES */}
        {tab === 'deliverers' &&
          renderDriverGrid(
            filteredDeliverers,
            'Nenhum entregador cadastrado nesta categoria.',
            delivererFilter,
            setDelivererFilter,
            'Gestão de Entregadores (Pacotes e Coletas)'
          )}

        {/* TAB 3: CLIENTES (PASSAGEIROS) */}
        {tab === 'clients' && (
          <section className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Gestão de Clientes / Passageiros ({clients.length})
              </h2>
            </div>

            {clients.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                Nenhum cliente cadastrado ainda.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">Cliente</th>
                      <th className="px-4 py-3 font-bold">Telefone / CPF</th>
                      <th className="px-4 py-3 font-bold">E-mail</th>
                      <th className="px-4 py-3 font-bold">Nota</th>
                      <th className="px-4 py-3 font-bold">Corridas</th>
                      <th className="px-4 py-3 font-bold">Saldo App</th>
                      <th className="px-4 py-3 font-bold">Pendência</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {clients.map((c) => {
                      const clientRides = rides.filter((r) => r.passenger_id === c.id);
                      const isDeleting = confirmDeleteUserId === c.id;
                      const debtVal = Number(c.pending_debt_amount || 0);
                      return (
                        <tr key={c.id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <AvatarImage
                                src={c.avatar_url}
                                name={c.full_name}
                                initialsCount={2}
                                className="h-8 w-8 rounded-full object-cover border border-neutral-200 shrink-0"
                                fallbackClassName="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-extrabold text-neutral-800"
                              />
                              <span className="font-bold text-neutral-950">{c.full_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-num">
                            {c.phone} · {c.cpf}
                          </td>
                          <td className="px-4 py-3">{c.email}</td>
                          <td className="px-4 py-3 font-mono-num">{c.rating_avg.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono-num font-bold">
                            {clientRides.length}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-lg px-2 py-1 font-mono-num text-[11px] font-extrabold ${
                                (c.wallet_balance || 0) > 0
                                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                  : 'bg-neutral-100 text-neutral-600'
                              }`}
                            >
                              {formatBRL(c.wallet_balance || 0)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {debtVal > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 border border-red-200 px-2 py-1 font-mono-num text-[11px] font-extrabold text-red-700">
                                {formatBRL(debtVal)}
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-neutral-400">
                                Em dia
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-bold">
                            <span
                              className={
                                c.status === 'active' ? 'text-emerald-700' : 'text-red-600'
                              }
                            >
                              {c.status === 'active' ? 'Ativo' : 'Bloqueado'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isDeleting ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUserId(null)}
                                  className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-700"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(c.id)}
                                  className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white"
                                >
                                  Confirmar
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openBalanceModal(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                                  title="Editar Saldo do App do cliente"
                                >
                                  <Wallet className="h-3.5 w-3.5" />
                                  Editar Saldo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDebtModalClient(c);
                                    setDebtAmountInput(
                                      debtVal > 0 ? debtVal.toFixed(2) : ''
                                    );
                                    setDebtNoteInput(
                                      c.pending_debt_note || 'Corrida não paga'
                                    );
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
                                  title="Atribuir ou quitar dívida do cliente"
                                >
                                  <DollarSign className="h-3.5 w-3.5" />
                                  Cobrança
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setChatTargetUser(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-900 hover:bg-neutral-100"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  Chat
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleClientStatus(c)}
                                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${
                                    c.status === 'active'
                                      ? 'border border-rose-200 bg-rose-50 text-rose-800'
                                      : 'aurora-accent-flow text-white'
                                  }`}
                                >
                                  {c.status === 'active' ? 'Bloquear' : 'Desbloquear'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUserId(c.id)}
                                  className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                  title="Excluir cliente"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 4: CORRIDAS & DISPUTAS */}
        {tab === 'rides' && (
          <section className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Monitoramento de Corridas, Entregas & Disputas
              </h2>
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-200/70 p-1">
                {(
                  [
                    { id: 'all', label: `Todas (${rides.length})` },
                    { id: 'active', label: `Ativas (${metrics.activeRidesCount})` },
                    { id: 'completed', label: `Concluídas (${metrics.completedCount})` },
                    { id: 'disputed', label: `Em disputa (${metrics.disputedCount})` },
                    { id: 'cancelled', label: 'Canceladas' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setRideFilter(f.id)}
                    className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                      rideFilter === f.id
                        ? f.id === 'disputed'
                          ? 'bg-red-600 text-white shadow-xs'
                          : 'bg-white text-neutral-950 shadow-xs'
                        : 'text-neutral-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredRides.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                Nenhuma corrida encontrada neste filtro.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">ID / Modalidade</th>
                      <th className="px-4 py-3 font-bold">Cliente</th>
                      <th className="px-4 py-3 font-bold">Motorista / Entregador</th>
                      <th className="px-4 py-3 font-bold">Trajeto</th>
                      <th className="px-4 py-3 font-bold">Pagamento</th>
                      <th className="px-4 py-3 font-bold text-right">Valor</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredRides.map((r) => (
                      <tr key={r.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono-num font-bold">
                          {r.id.slice(-5)} · {r.category}
                        </td>
                        <td className="px-4 py-3">{r.passenger?.full_name || '—'}</td>
                        <td className="px-4 py-3">{r.driver?.full_name || 'Buscando'}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate">
                          {r.origin_address} → {r.destination_address}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-bold ${
                              r.payment_status === 'disputed'
                                ? 'text-red-600'
                                : r.payment_status === 'paid_pix' ||
                                  r.payment_status === 'paid_wallet' ||
                                  r.payment_status === 'paid_cash' ||
                                  r.payment_status === 'admin_settled'
                                ? 'text-emerald-700'
                                  : 'text-teal-700'
                              }`}
                            >
                              {r.payment_method === 'wallet'
                                ? 'SALDO APP'
                                : r.payment_method.toUpperCase()}{' '}
                              · {r.payment_status}
                            </span>
                            {r.dispute_reason && (
                              <p className="text-[11px] text-red-600 truncate max-w-[180px]">
                                {r.dispute_reason}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num font-bold">
                            {formatBRL(r.final_fare ?? r.estimated_fare)}
                          </td>
                          <td className="px-4 py-3 font-bold">{r.status}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              {r.status === 'completed' &&
                                r.payment_status === 'pending' &&
                                (r.payment_method === 'pix' || Boolean(r.pix_declared_at)) && (
                                  <button
                                    type="button"
                                    disabled={confirmingPixRideId === r.id}
                                    onClick={() => handleConfirmPixRide(r)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-extrabold text-white"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    {confirmingPixRideId === r.id ? 'Confirmando...' : 'Confirmar Pix'}
                                  </button>
                                )}
                              {r.payment_status === 'disputed' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleSettleDispute(r, false)}
                                    className="inline-flex items-center gap-1 rounded-lg aurora-accent-flow px-2.5 py-1.5 text-[11px] font-extrabold text-white"
                                  >
                                  <ShieldAlert className="h-3.5 w-3.5" />
                                  Quitar Motorista
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSettleDispute(r, true)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-extrabold text-red-700 hover:bg-red-100"
                                >
                                  <DollarSign className="h-3.5 w-3.5" />
                                  Quitar & Cobrar Cliente
                                </button>
                              </>
                            )}
                            {['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status) && (
                              <button
                                type="button"
                                onClick={() => handleCancelRide(r.id)}
                                className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 5: PAGAMENTOS, CONTA PIX DO DONO & REPASSES POR MOTORISTA/ENTREGADOR */}
        {tab === 'payments' && (
          <section className="mt-5 space-y-6">
            {/* Fila de Confirmação Pix Recebido (Libera o Motorista em Tempo Real) */}
            <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-extrabold text-[#0F2421] flex items-center gap-2">
                    <Clock className="h-5 w-5 text-[#047857]" />
                    Confirmações de Pix Pendentes ({awaitingPixRides.length})
                  </h2>
                  <p className="text-xs text-neutral-600">
                    Assim que o Pix cair na sua conta oficial, clique em{' '}
                    <strong>Confirmar Pix Recebido</strong>. O painel do motorista destrava
                    instantaneamente e o valor entra no saldo dele para repasse.
                  </p>
                </div>
              </div>

              {awaitingPixRides.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-center text-xs font-semibold text-neutral-500">
                  Nenhum pagamento Pix aguardando sua confirmação neste momento.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {awaitingPixRides.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-[#2DD4BF]/40 bg-[#ECFDF5]/70 p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-num text-xs font-extrabold text-neutral-950">
                            #{r.id.slice(-5)} · {r.category}
                          </span>
                          <span className="font-mono-num text-base font-extrabold text-emerald-700">
                            {formatBRL(r.final_fare ?? r.estimated_fare)}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-800">
                          <strong>Cliente:</strong> {r.passenger?.full_name || 'Passageiro'} ·{' '}
                          <strong>Motorista:</strong> {r.driver?.full_name || '—'}
                        </p>
                        <p className="text-[11px] text-neutral-600 truncate">
                          {r.destination_address}
                        </p>
                        <p className="text-[11px] font-bold text-[#047857]">
                          {r.pix_declared_at
                            ? `Cliente/Motorista informou envio em ${new Date(
                                r.pix_declared_at
                              ).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : 'Aguardando conferência do Pix pelo Admin'}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={confirmingPixRideId === r.id}
                        onClick={() => handleConfirmPixRide(r)}
                        className="min-h-[44px] w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-extrabold text-white shadow-sm disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {confirmingPixRideId === r.id
                          ? 'Confirmando no Supabase...'
                          : 'Confirmar Pix Recebido & Liberar Motorista'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Solicitações de Depósito de Saldo (Clientes via Pix) */}
            <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-extrabold text-neutral-950 flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-600" />
                    Depósitos de Saldo Pendentes — Clientes ({pendingDeposits.length})
                  </h2>
                  <p className="text-xs text-neutral-600">
                    Quando o cliente informar que enviou um Pix para recarregar o Saldo do App,
                    confira no seu banco e clique em <strong>Confirmar &amp; Creditar Saldo</strong>.
                  </p>
                </div>
              </div>

              {pendingDeposits.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-center text-xs font-semibold text-neutral-500">
                  Nenhuma solicitação de depósito de saldo aguardando confirmação.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pendingDeposits.map((dep) => {
                    const isBusy = processingDepositId === dep.id;
                    return (
                      <div
                        key={dep.id}
                        className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-neutral-950">
                              {dep.user?.full_name || 'Cliente'}
                            </span>
                            <span className="font-mono-num text-lg font-extrabold text-emerald-700">
                              + {formatBRL(dep.amount)}
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-700 font-mono-num">
                            {dep.user?.phone || '—'} · Saldo atual:{' '}
                            <strong>{formatBRL(dep.user?.wallet_balance || 0)}</strong>
                          </p>
                          <p className="text-[11px] text-neutral-500 font-mono-num">
                            Solicitado em {new Date(dep.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRejectDeposit(dep)}
                            className="min-h-[42px] rounded-xl border border-red-200 bg-white px-3.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            Recusar
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleApproveDeposit(dep)}
                            className="min-h-[42px] flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white shadow-sm disabled:opacity-60"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {isBusy ? 'Creditando...' : 'Confirmar & Creditar Saldo'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {reviewedDeposits.length > 0 && (
                <div className="border-t border-neutral-100 pt-3">
                  <p className="text-[11px] font-bold text-neutral-500 mb-2">
                    Últimos depósitos revisados
                  </p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {reviewedDeposits.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2 text-[11px]"
                      >
                        <span className="font-semibold text-neutral-800 truncate pr-2">
                          {dep.user?.full_name || 'Cliente'} ·{' '}
                          <span className="font-mono-num">{formatBRL(dep.amount)}</span>
                        </span>
                        <span
                          className={`font-extrabold shrink-0 ${
                            dep.status === 'approved' ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {dep.status === 'approved' ? 'Aprovado' : 'Recusado'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Solicitações de Saque via Pix (Motoristas & Entregadores) */}
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-extrabold text-[#0F2421] dark:text-white flex items-center gap-2">
                    <QrCode className="h-5 w-5 text-[#047857] dark:text-[#6EE7B7]" />
                    Saques Solicitados (Motoristas &amp; Entregadores) ({pendingWithdrawals.length})
                  </h2>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Transfira o valor solicitado para a chave Pix exibida e clique em{' '}
                    <strong>Confirmar Pago</strong>. Caso recuse, o valor é estornado ao saldo do motorista.
                  </p>
                </div>
              </div>

              {pendingWithdrawals.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 p-6 text-center text-xs font-semibold text-neutral-500">
                  Nenhuma solicitação de saque pendente neste momento.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pendingWithdrawals.map((w) => {
                    const isBusy = processingWithdrawalId === w.id;
                    return (
                      <div
                        key={w.id}
                        className="rounded-2xl border border-[#2DD4BF]/50 dark:border-[#2DD4BF]/30 bg-[#ECFDF5]/70 dark:bg-[#047857]/20 p-4 flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-[#0F2421] dark:text-white">
                              {w.user?.full_name || 'Motorista'}
                            </span>
                            <span className="font-mono-num text-lg font-extrabold text-[#047857] dark:text-[#6EE7B7]">
                              {formatBRL(w.amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-neutral-800 border border-[#D4EDE7] dark:border-neutral-700 px-3 py-2 text-xs">
                            <span className="font-mono-num font-bold text-[#0F2421] dark:text-white truncate">
                              Pix: {w.pix_key}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(w.pix_key);
                                setCopiedWithdrawPixId(w.id);
                                setTimeout(() => setCopiedWithdrawPixId(null), 2000);
                              }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1 text-[10px] font-extrabold text-white dark:text-[#071513]"
                            >
                              {copiedWithdrawPixId === w.id ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {copiedWithdrawPixId === w.id ? 'Copiada' : 'Copiar Pix'}
                            </button>
                          </div>
                          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 font-mono-num">
                            {w.user?.phone || '—'} · Saldo restante:{' '}
                            <strong>{formatBRL(w.user?.wallet_balance || 0)}</strong> ·{' '}
                            {new Date(w.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRejectWithdrawal(w)}
                            className="min-h-[42px] rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-neutral-900 px-3.5 text-xs font-bold text-red-700 dark:text-red-300 hover:bg-red-50 disabled:opacity-60"
                          >
                            Recusar &amp; Estornar
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleApproveWithdrawal(w)}
                            className="min-h-[42px] flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white shadow-sm disabled:opacity-60"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {isBusy ? 'Confirmando...' : 'Confirmar Pago'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {reviewedWithdrawals.length > 0 && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 pt-3">
                  <p className="text-[11px] font-bold text-neutral-500 mb-2">
                    Últimos saques processados
                  </p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {reviewedWithdrawals.map((w) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between rounded-xl bg-neutral-50 dark:bg-neutral-800/50 px-3 py-2 text-[11px]"
                      >
                        <span className="font-semibold text-neutral-800 dark:text-neutral-200 truncate pr-2">
                          {w.user?.full_name || 'Motorista'} ({w.pix_key}) ·{' '}
                          <span className="font-mono-num">{formatBRL(w.amount)}</span>
                        </span>
                        <span
                          className={`font-extrabold shrink-0 ${
                            w.status === 'paid' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {w.status === 'paid' ? 'Pago' : 'Recusado / Estornado'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Official Owner Pix Configuration & Central Address */}
              <form
                onSubmit={handleSavePlatformConfig}
                className="lg:col-span-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4 h-fit"
              >
                <div className="flex items-center gap-2.5 text-[#0F2421] dark:text-white font-extrabold text-sm">
                  <QrCode className="h-5 w-5 text-[#047857] dark:text-[#6EE7B7]" />
                  <span>Minha Conta Pix Oficial (Dono)</span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  Todo passageiro que pagar por Pix ou depositar Saldo no App enviará diretamente
                  para esta conta, com atualização automática de segurança a cada 90 segundos.
                </p>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    <MapPin className="h-3.5 w-3.5 text-[#047857] dark:text-[#6EE7B7]" />
                    Endereço Central da Empresa
                  </label>
                  <input
                    type="text"
                    value={platformConfig.company_address || ''}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({
                        ...prev,
                        company_address: e.target.value,
                      }))
                    }
                    placeholder="Ex: Av. Rui Barbosa, 450 - Heliópolis, Garanhuns - PE"
                    className="min-h-[46px] w-full rounded-xl border border-[#D4EDE7] dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold text-[#0F2421] dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    Chave Pix Recebedora
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.platform_pix_key}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, platform_pix_key: e.target.value }))
                    }
                    className="min-h-[46px] w-full rounded-xl border border-[#D4EDE7] dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 font-mono-num text-sm font-bold text-[#0F2421] dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    Nome do Titular / Favorecido
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.platform_pix_receiver}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({
                        ...prev,
                        platform_pix_receiver: e.target.value,
                      }))
                    }
                    className="min-h-[46px] w-full rounded-xl border border-[#D4EDE7] dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm font-semibold text-[#0F2421] dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                  />
                </div>

                {/* Custom Official Pix QR Code Image Upload */}
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-extrabold text-neutral-900 dark:text-white">
                      <ImageIcon className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                      Imagem do QR Code Pix (Opcional)
                    </span>
                    {platformConfig.platform_pix_qr_url && (
                      <button
                        type="button"
                        onClick={() => handleResetPlatformAsset('platform_pix_qr_url')}
                        className="text-[11px] font-bold text-red-600 dark:text-red-400"
                      >
                        Remover
                      </button>
                    )}
                  </div>

                  {platformConfig.platform_pix_qr_url ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={platformConfig.platform_pix_qr_url}
                        alt="QR Code Pix Oficial"
                        className="h-16 w-16 rounded-xl border border-neutral-300 bg-white object-contain p-1 shrink-0"
                      />
                      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                        Imagem ativa! Será exibida nos pagamentos e recargas Pix com rotação visual de 90s.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Envie a imagem do QR Code do seu banco (ou deixe vazio para gerar automaticamente pela Chave Pix).
                    </p>
                  )}

                  <label className="flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-xs font-extrabold text-neutral-950 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <ImageIcon className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                    <span>
                      {uploadingAssetKind === 'pix_qr'
                        ? 'Enviando QR Code...'
                        : platformConfig.platform_pix_qr_url
                        ? 'Trocar Imagem do QR Code'
                        : 'Fazer Upload do QR Code Pix'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadPlatformAsset(e.target.files?.[0], 'pix_qr')}
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingPlatform}
                  className="min-h-[48px] w-full rounded-2xl aurora-accent-flow text-sm font-extrabold text-white"
                >
                  {savingPlatform ? 'Salvando...' : 'Salvar Conta & Endereço'}
                </button>
              </form>

              {/* Driver & Deliverer Payout Ledger Table with Period Breakdown & Printable Receipt */}
              <div className="lg:col-span-8 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-extrabold text-neutral-950 dark:text-white">
                      Repasses &amp; Saldos — Motoristas e Entregadores
                    </h2>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
                      Filtre por Dia, Semana, Mês ou Tudo e gere Recibos assinados para repasse.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-neutral-200/70 dark:bg-neutral-800 p-1">
                    {(
                      [
                        { id: 'day', label: 'Hoje (Dia)' },
                        { id: 'week', label: 'Semana' },
                        { id: 'month', label: 'Mês' },
                        { id: 'all', label: 'Tudo' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSettlementPeriod(p.id)}
                        className={`min-h-[34px] rounded-lg px-2.5 text-[11px] font-bold transition ${
                          settlementPeriod === p.id
                            ? 'bg-white dark:bg-neutral-950 text-[#047857] dark:text-[#6EE7B7] shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                      <tr>
                        <th className="px-4 py-3 font-bold">Motorista / Entregador</th>
                        <th className="px-4 py-3 font-bold">Chave Pix Dele</th>
                        <th className="px-4 py-3 font-bold text-right">Pix / App</th>
                        <th className="px-4 py-3 font-bold text-right">Dinheiro</th>
                        <th className="px-4 py-3 font-bold text-right">Já Pago</th>
                        <th className="px-4 py-3 font-bold text-right">Saldo Atual</th>
                        <th className="px-4 py-3 font-bold text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {allDriversAndDeliverers.map((d) => {
                        const drvRides = rides.filter(
                          (r) =>
                            r.driver_id === d.id &&
                            r.status === 'completed' &&
                            isDateInPeriod(r.completed_at || r.created_at, settlementPeriod)
                        );
                        const pixAndAppTotal = drvRides
                          .filter(
                            (r) => r.payment_method === 'pix' || r.payment_method === 'wallet'
                          )
                          .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
                        const cashTotal = drvRides
                          .filter((r) => r.payment_method === 'cash')
                          .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
                        const paidOut = transactions
                          .filter(
                            (t) =>
                              t.user_id === d.id &&
                              t.type === 'payout' &&
                              isDateInPeriod(t.created_at, settlementPeriod)
                          )
                          .reduce((acc, t) => acc + Math.abs(t.amount), 0);

                        return (
                          <tr key={d.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                            <td className="px-4 py-3">
                              <p className="font-bold text-neutral-950 dark:text-white">{d.full_name}</p>
                              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                {d.driver?.vehicle_type === 'delivery'
                                  ? 'Entregador'
                                  : d.driver?.vehicle_type === 'moto'
                                  ? 'Moto'
                                  : 'Carro'}{' '}
                                · {d.driver?.vehicle_plate} · {drvRides.length} corridas
                              </p>
                            </td>
                            <td className="px-4 py-3 font-mono-num text-neutral-700 dark:text-neutral-300">
                              {d.driver?.pix_key || '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num font-bold text-neutral-900 dark:text-neutral-100">
                              {formatBRL(pixAndAppTotal)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num text-emerald-700 dark:text-emerald-400">
                              {formatBRL(cashTotal)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num text-sky-700 dark:text-sky-400">
                              {formatBRL(paidOut)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num font-extrabold text-[#047857] dark:text-[#6EE7B7]">
                              {formatBRL(d.wallet_balance)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setReceiptModalDriver(d)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-900 dark:text-white hover:bg-neutral-100"
                                  title="Gerar Recibo Imprimível com Assinatura"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                  Recibo / Acertar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openBalanceModal(d)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100"
                                >
                                  Editar Saldo
                                </button>
                                {d.wallet_balance > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPayoutModalDriver(d);
                                      setPayoutAmount(d.wallet_balance.toFixed(2));
                                      setPayoutNote(
                                        `Repasse Pix para ${d.driver?.pix_key || d.email}`
                                      );
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg aurora-accent-flow px-3 py-1.5 text-[11px] font-extrabold text-white"
                                  >
                                    <Wallet className="h-3.5 w-3.5" />
                                    Pagar Pix
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Em dia
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Recent Financial Ledger */}
                <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    Extrato Geral de Pagamentos & Repasses ({transactions.length})
                  </h3>
                  {transactions.length === 0 ? (
                    <p className="text-xs text-neutral-500">Nenhuma transação registrada ainda.</p>
                  ) : (
                    <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
                      {transactions.slice(0, 30).map((tx) => {
                        const usr = users.find((u) => u.id === tx.user_id);
                        return (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between py-2.5 text-xs"
                          >
                            <div className="min-w-0 pr-3">
                              <p className="font-bold text-neutral-950 truncate">
                                {usr?.full_name || tx.user_id} · {tx.description}
                              </p>
                              <p className="text-[11px] text-neutral-500 font-mono-num">
                                {new Date(tx.created_at).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            <span
                              className={`font-mono-num font-extrabold shrink-0 ${
                                tx.amount < 0 ? 'text-sky-700' : 'text-emerald-700'
                              }`}
                            >
                              {tx.amount < 0
                                ? `- ${formatBRL(Math.abs(tx.amount))}`
                                : `+ ${formatBRL(tx.amount)}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 5B: EVENTOS E CAMPANHAS PARA MOTOBOYS / MOTORISTAS */}
        {tab === 'events' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateEvent}
              className="lg:col-span-5 rounded-3xl border border-neutral-200 bg-white p-5 space-y-4 h-fit"
            >
              <div className="flex items-center gap-2 text-neutral-950 font-extrabold text-sm">
                <Sparkles className="h-5 w-5 text-[#047857]" />
                <span>Criar Evento / Bônus para Parceiros</span>
              </div>
              <p className="text-xs text-neutral-600">
                Publique desafios, metas ou bônus em tempo real. Todos os motoboys e motoristas
                receberão notificação instantânea com som e vibração.
              </p>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Título do Evento
                </label>
                <input
                  type="text"
                  required
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Ex: Bônus Chuva / Meta 10 Entregas Hoje"
                  className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Regras / Descrição
                </label>
                <textarea
                  rows={3}
                  required
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  placeholder="Ex: Complete 8 entregas até às 22h e ganhe bônus extra no repasse."
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Valor do Bônus (R$)
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={eventBonus}
                    onChange={(e) => setEventBonus(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Público-Alvo
                  </label>
                  <select
                    value={eventTargetRole}
                    onChange={(e) =>
                      setEventTargetRole(e.target.value as PlatformEvent['target_role'])
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold outline-none focus:border-neutral-950"
                  >
                    <option value="all">Todos (Motoristas e Motoboys)</option>
                    <option value="delivery">Apenas Motoboys / Entregas</option>
                    <option value="driver">Apenas Motoristas (Carro/Moto)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-[#D4EDE7] bg-[#ECFDF5]/70 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyDriversOnEventCreate}
                  onChange={(e) => setNotifyDriversOnEventCreate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#047857]"
                />
                <div className="text-xs">
                  <span className="font-extrabold text-neutral-950 block">
                    Notificar motoristas e entregadores
                  </span>
                  <span className="text-[11px] text-neutral-600">
                    Envia push/alerta na central apenas para motoristas e motoboys (passageiros nunca
                    recebem alertas de eventos).
                  </span>
                </div>
              </label>

              <button
                type="submit"
                disabled={savingEvent}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {savingEvent ? 'Publicando...' : 'Publicar Evento Agora'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Eventos e Campanhas Publicadas ({platformEvents.length})
              </h2>
              {platformEvents.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                  Nenhum evento criado ainda. Crie sua primeira campanha ao lado!
                </div>
              ) : (
                <div className="space-y-3">
                  {platformEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={`rounded-2xl border p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        ev.active ? 'border-[#2DD4BF]' : 'border-neutral-200 opacity-75'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-extrabold text-neutral-950">{ev.title}</h3>
                          {ev.bonus_amount > 0 && (
                            <span className="rounded-lg aurora-accent-flow px-2 py-0.5 font-mono-num text-[11px] font-extrabold text-white">
                              +{formatBRL(ev.bonus_amount)}
                            </span>
                          )}
                          <span className="rounded-lg bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
                            {ev.target_role === 'delivery'
                              ? 'Motoboys'
                              : ev.target_role === 'driver'
                              ? 'Motoristas'
                              : 'Todos'}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600">{ev.description}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={notifyingEventId === ev.id}
                          onClick={() => handleNotifyDriversForEvent(ev)}
                          className="inline-flex items-center gap-1 rounded-xl border border-[#D4EDE7] bg-[#ECFDF5] px-3 py-2 text-xs font-bold text-[#065F46] hover:bg-teal-100"
                          title="Enviar notificação apenas para motoristas/entregadores"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          {notifyingEventId === ev.id ? '...' : 'Notificar Motoristas'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEvent(ev)}
                          className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold ${
                            ev.active
                              ? 'border border-neutral-200 bg-neutral-100 text-neutral-800'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {ev.active ? 'Pausar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700"
                          title="Excluir evento"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 5C: CENTRAL DE NOTIFICAÇÕES */}
        {tab === 'notifications' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleSendNotification}
              className="lg:col-span-5 rounded-3xl border border-neutral-200 bg-white p-5 space-y-4 h-fit"
            >
              <div className="flex items-center gap-2 text-neutral-950 font-extrabold text-sm">
                <Bell className="h-5 w-5 text-[#047857]" />
                <span>Disparar Notificação no Celular</span>
              </div>
              <p className="text-xs text-neutral-600">
                Envie alertas com título e descrição direto para a barra de notificações do celular e
                para o sino do aplicativo (APK Android, PWA e Site) em tempo real.
              </p>

              {/* Modelos rápidos */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  Modelos Rápidos
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNotifCategory('payment');
                      setNotifTitle('Pendência identificada na conta');
                      setNotifMessage(
                        'Verificamos uma pendência financeira em sua conta. Acesse sua carteira BorealPay ou entre em contato com o suporte para regularizar.'
                      );
                    }}
                    className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
                  >
                    Cobrança / Pendência
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifCategory('general');
                      setNotifTitle('Comunicado da Equipe Boreal Mobilidade');
                      setNotifMessage(
                        'Informamos uma atualização importante no atendimento da sua região. Conte com a nossa equipe!'
                      );
                    }}
                    className="rounded-xl border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-200"
                  >
                    Aviso da Equipe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifCategory('wallet');
                      setNotifTitle('Novidade na Carteira BorealPay');
                      setNotifMessage(
                        'Seu saldo BorealPay permite pagar corridas com QR Code e fazer transferências instantâneas sem sair do app!'
                      );
                    }}
                    className="rounded-xl border border-[#D4EDE7] bg-[#ECFDF5] px-2.5 py-1.5 text-[11px] font-bold text-[#065F46] hover:bg-teal-100"
                  >
                    Comunicado BorealPay
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Enviar para quem?
                  </label>
                  <select
                    value={notifTargetScope}
                    onChange={(e) =>
                      setNotifTargetScope(e.target.value as NotificationTargetScope)
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold outline-none focus:border-neutral-950"
                  >
                    <option value="all">Ambos (Motoristas e Passageiros)</option>
                    <option value="passengers">Somente Passageiros</option>
                    <option value="drivers">Somente Motoristas / Entregadores</option>
                    <option value="user">Usuário específico (1 pessoa)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={notifCategory}
                    onChange={(e) =>
                      setNotifCategory(e.target.value as NotificationCategory)
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold outline-none focus:border-neutral-950"
                  >
                    <option value="general">Aviso Geral</option>
                    <option value="payment">Pagamento / Cobrança</option>
                    <option value="wallet">BorealPay / Carteira</option>
                    <option value="coupon">Cupom</option>
                    <option value="event">Evento / Bônus</option>
                  </select>
                </div>
              </div>

              {notifTargetScope === 'user' && (
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Selecionar Passageiro ou Motorista
                  </label>
                  <select
                    required
                    value={notifTargetUserId}
                    onChange={(e) => setNotifTargetUserId(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold outline-none focus:border-neutral-950"
                  >
                    <option value="">Escolha um usuário...</option>
                    {users
                      .filter((u) => u.role !== 'admin')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} ({u.role === 'driver' ? 'Motorista' : 'Passageiro'}) ·{' '}
                          {u.email}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Título da Notificação
                </label>
                <input
                  type="text"
                  required
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  placeholder="Ex: Verificamos uma pendência em sua conta"
                  className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Descrição / Mensagem
                </label>
                <textarea
                  rows={3}
                  required
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  placeholder="Escreva a explicação detalhada que chegará no celular do usuário..."
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>

              <button
                type="submit"
                disabled={sendingNotif}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm"
              >
                <Bell className="h-4 w-4" />
                {sendingNotif ? 'Enviando...' : 'Enviar Notificação'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Histórico de Notificações Enviadas ({sentNotifications.length})
              </h2>
              {sentNotifications.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                  Nenhuma notificação enviada ainda.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                  {sentNotifications.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-lg bg-[#047857] px-2 py-0.5 text-[10px] font-extrabold text-[#6EE7B7] uppercase">
                            {n.category}
                          </span>
                          <span className="rounded-lg bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-700">
                            {n.target_scope === 'all'
                              ? 'Todos'
                              : n.target_scope === 'passengers'
                              ? 'Passageiros'
                              : n.target_scope === 'drivers'
                              ? 'Motoristas/Entregadores'
                              : 'Usuário específico'}
                          </span>
                        </div>
                        <span className="font-mono-num text-[11px] text-neutral-400">
                          {new Date(n.created_at).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <h3 className="text-sm font-extrabold text-neutral-950">{n.title}</h3>
                      <p className="text-xs text-neutral-600">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 5D: CUPONS DE DESCONTO */}
        {tab === 'coupons' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateCoupon}
              className="lg:col-span-5 rounded-3xl border border-neutral-200 bg-white p-5 space-y-4 h-fit"
            >
              <div className="flex items-center gap-2 text-neutral-950 font-extrabold text-sm">
                <Gift className="h-5 w-5 text-emerald-600" />
                <span>Criar Cupom de Desconto</span>
              </div>
              <p className="text-xs text-neutral-600">
                Passageiros só veem a opção de cupom no pedido quando possuem um cupom liberado para
                eles pelo Admin.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Código (ex: BOREAL20)
                  </label>
                  <input
                    type="text"
                    required
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="BOREAL15"
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-extrabold uppercase outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Tipo de Desconto
                  </label>
                  <select
                    value={couponType}
                    onChange={(e) => setCouponType(e.target.value as 'percent' | 'fixed')}
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold outline-none focus:border-neutral-950"
                  >
                    <option value="percent">Percentual (%)</option>
                    <option value="fixed">Valor Fixo (R$)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Título do Cupom
                </label>
                <input
                  type="text"
                  required
                  value={couponTitle}
                  onChange={(e) => setCouponTitle(e.target.value)}
                  placeholder="Ex: 15% OFF na sua corrida"
                  className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">Descrição</label>
                <input
                  type="text"
                  value={couponDesc}
                  onChange={(e) => setCouponDesc(e.target.value)}
                  placeholder="Ex: Válido para corridas urbanas em toda a cidade"
                  className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-950"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                    {couponType === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    required
                    value={couponValue}
                    onChange={(e) => setCouponValue(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                    Teto Máx (R$)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={couponMaxDiscount}
                    onChange={(e) => setCouponMaxDiscount(e.target.value)}
                    placeholder="Opcional"
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                    Pedido Mín (R$)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={couponMinFare}
                    onChange={(e) => setCouponMinFare(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCoupon}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {savingCoupon ? 'Criando...' : 'Criar Cupom'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-extrabold text-neutral-950">
                  Cupons Cadastrados ({coupons.length})
                </h2>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={couponGrantWithNotif}
                    onChange={(e) => setCouponGrantWithNotif(e.target.checked)}
                    className="h-4 w-4 accent-neutral-950"
                  />
                  Enviar notificação ao liberar cupom
                </label>
              </div>

              {coupons.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                  Nenhum cupom criado ainda. Crie o primeiro cupom ao lado e libere aos passageiros.
                </div>
              ) : (
                <div className="space-y-3">
                  {coupons.map((c) => {
                    const grantsForCoupon = couponGrants.filter((g) => g.coupon_id === c.id);
                    const usedCount = grantsForCoupon.filter((g) => g.status === 'used').length;
                    return (
                      <div
                        key={c.id}
                        className={`rounded-2xl border p-4 bg-white space-y-3 ${
                          c.active ? 'border-emerald-300' : 'border-neutral-200 opacity-75'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-lg bg-[#071513] px-2.5 py-1 font-mono-num text-xs font-extrabold text-[#6EE7B7]">
                                {c.code}
                              </span>
                              <span className="rounded-lg bg-emerald-100 px-2 py-0.5 font-mono-num text-xs font-extrabold text-emerald-800">
                                {c.discount_type === 'percent'
                                  ? `${c.discount_value}% OFF`
                                  : `-${formatBRL(c.discount_value)}`}
                              </span>
                              {c.max_discount && (
                                <span className="text-[11px] font-semibold text-neutral-500">
                                  Teto: {formatBRL(c.max_discount)}
                                </span>
                              )}
                            </div>
                            <h3 className="text-sm font-extrabold text-neutral-950">{c.title}</h3>
                            <p className="text-xs text-neutral-600">{c.description}</p>
                            <p className="text-[11px] font-semibold text-neutral-500 font-mono-num">
                              Liberados: {grantsForCoupon.length} · Usados: {usedCount}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleCoupon(c)}
                              className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold ${
                                c.active
                                  ? 'border border-neutral-200 bg-neutral-100 text-neutral-800'
                                  : 'bg-emerald-600 text-white'
                              }`}
                            >
                              <Power className="h-3.5 w-3.5" />
                              {c.active ? 'Pausar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCoupon(c.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700"
                              title="Excluir cupom"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                          <button
                            type="button"
                            disabled={!c.active || grantingCouponId === c.id}
                            onClick={() => handleGrantCoupon(c.id, null)}
                            className="min-h-[38px] rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white disabled:opacity-40"
                          >
                            {grantingCouponId === c.id
                              ? 'Liberando...'
                              : 'Liberar p/ Todos Passageiros'}
                          </button>

                          <div className="flex flex-1 min-w-[220px] items-center gap-1.5">
                            <select
                              value={couponGrantUserId}
                              onChange={(e) => setCouponGrantUserId(e.target.value)}
                              className="min-h-[38px] flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-semibold outline-none"
                            >
                              <option value="">Selecionar passageiro...</option>
                              {clients.map((cli) => (
                                <option key={cli.id} value={cli.id}>
                                  {cli.full_name} ({cli.phone})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!c.active || !couponGrantUserId || grantingCouponId === c.id}
                              onClick={() => handleGrantCoupon(c.id, couponGrantUserId)}
                              className="min-h-[38px] shrink-0 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 text-xs font-extrabold text-white dark:text-[#071513] disabled:opacity-40"
                            >
                              Liberar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {couponGrants.length > 0 && (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-2">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                    Últimas Liberações ({couponGrants.length})
                  </h3>
                  <div className="max-h-48 overflow-y-auto divide-y divide-neutral-100 text-xs">
                    {couponGrants.slice(0, 12).map((g) => {
                      const targetUsr = users.find((u) => u.id === g.user_id);
                      return (
                        <div
                          key={g.id}
                          className="flex items-center justify-between gap-2 py-2"
                        >
                          <span className="font-semibold text-neutral-900 truncate">
                            {targetUsr?.full_name || g.user_id.slice(0, 8)} ·{' '}
                            <strong className="font-mono-num">{g.coupon?.code || 'Cupom'}</strong>
                          </span>
                          <span
                            className={`rounded-lg px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                              g.status === 'used'
                                ? 'bg-emerald-100 text-emerald-800'
                                : g.status === 'available'
                                ? 'bg-teal-100 text-[#065F46]'
                                : 'bg-neutral-100 text-neutral-600'
                            }`}
                          >
                            {g.status === 'used'
                              ? 'Usado'
                              : g.status === 'available'
                              ? 'Disponível'
                              : 'Revogado'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 6: TARIFAS & CONFIGURAÇÕES DO SITE */}
        {tab === 'pricing' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div>
                <h2 className="font-display text-xl font-extrabold text-neutral-950">
                  Tarifas por Modalidade (5 categorias)
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  Moto, Pop, Negocia, Entrega Moto e Entrega Carro.
                </p>
              </div>

              <form onSubmit={handleSavePricing} className="space-y-4">
                {pricing.map((cat, idx) => (
                  <div
                    key={cat.category}
                    className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-display text-base font-extrabold text-neutral-950">
                          {cat.label}
                        </h3>
                        <p className="text-xs text-neutral-500">{cat.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cat.active}
                          onChange={(e) =>
                            setPricing((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, active: e.target.checked } : p
                              )
                            )
                          }
                          className="h-4 w-4 accent-neutral-950"
                        />
                        Ativa
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                          Tarifa Base (R$)
                        </label>
                        <input
                          type="number"
                          step="0.10"
                          min="0"
                          value={cat.base_fare}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPricing((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, base_fare: val } : p))
                            );
                          }}
                          className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                          Por KM (R$)
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={cat.per_km_rate}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPricing((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, per_km_rate: val } : p))
                            );
                          }}
                          className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                          Tarifa Mínima (R$)
                        </label>
                        <input
                          type="number"
                          step="0.50"
                          min="0"
                          value={cat.min_fare}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPricing((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, min_fare: val } : p))
                            );
                          }}
                          className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="submit"
                  disabled={savingPricing}
                  className="min-h-[48px] rounded-2xl aurora-accent-flow px-6 text-sm font-extrabold text-white shadow-sm"
                >
                  {savingPricing ? 'Salvando...' : 'Salvar Tarifas'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <form
                onSubmit={handleSavePlatformConfig}
                className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950">
                  <Settings className="h-5 w-5 text-[#047857]" />
                  <span>Configurações Gerais do Site</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Nome do Aplicativo / Site
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.site_name}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, site_name: e.target.value }))
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Cidade da Operação Local
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.platform_city}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, platform_city: e.target.value }))
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    WhatsApp de Suporte
                  </label>
                  <input
                    type="text"
                    value={platformConfig.support_whatsapp}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, support_whatsapp: e.target.value }))
                    }
                    placeholder="(87) 99999-9999"
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Comissão da Plataforma (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    step="0.5"
                    value={platformConfig.commission_percent}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({
                        ...prev,
                        commission_percent: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">
                      Cor Primária (Destaque)
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
                      <input
                        type="color"
                        value={platformConfig.primary_color || '#047857'}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            primary_color: e.target.value,
                          }))
                        }
                        className="h-8 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        value={platformConfig.primary_color || '#047857'}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            primary_color: e.target.value,
                          }))
                        }
                        className="w-full bg-transparent font-mono-num text-xs font-bold text-neutral-900 outline-none uppercase"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">
                      Cor Secundária (Base)
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
                      <input
                        type="color"
                        value={platformConfig.secondary_color || '#071513'}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            secondary_color: e.target.value,
                          }))
                        }
                        className="h-8 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        value={platformConfig.secondary_color || '#071513'}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            secondary_color: e.target.value,
                          }))
                        }
                        className="w-full bg-transparent font-mono-num text-xs font-bold text-neutral-900 outline-none uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#D4EDE7] bg-[#ECFDF5]/70 p-3.5 space-y-3">
                  <label className="flex items-center justify-between cursor-pointer gap-2">
                    <div>
                      <p className="text-xs font-extrabold text-neutral-950">
                        Horário Automático de Depósitos Pix (BorealPay)
                      </p>
                      <p className="text-[11px] text-neutral-600">
                        Pausa novos depósitos fora do horário comercial (quem já tem saldo usa 24h normalmente).
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={platformConfig.deposit_window_enabled !== false}
                      onChange={(e) =>
                        setPlatformConfig((prev) => ({
                          ...prev,
                          deposit_window_enabled: e.target.checked,
                        }))
                      }
                      className="h-5 w-5 accent-neutral-950 shrink-0"
                    />
                  </label>

                  {platformConfig.deposit_window_enabled !== false && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                          Abertura (Início)
                        </label>
                        <input
                          type="time"
                          value={platformConfig.deposit_start_time || '07:00'}
                          onChange={(e) =>
                            setPlatformConfig((prev) => ({
                              ...prev,
                              deposit_start_time: e.target.value,
                            }))
                          }
                          className="min-h-[42px] w-full rounded-xl border border-neutral-200 bg-white px-3 font-mono-num text-xs font-extrabold text-neutral-950 outline-none focus:border-neutral-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                          Encerramento (Fim)
                        </label>
                        <input
                          type="time"
                          value={platformConfig.deposit_end_time || '23:30'}
                          onChange={(e) =>
                            setPlatformConfig((prev) => ({
                              ...prev,
                              deposit_end_time: e.target.value,
                            }))
                          }
                          className="min-h-[42px] w-full rounded-xl border border-neutral-200 bg-white px-3 font-mono-num text-xs font-extrabold text-neutral-950 outline-none focus:border-neutral-950"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 cursor-pointer">
                  <div>
                    <p className="text-xs font-extrabold text-neutral-950">Modo Manutenção</p>
                    <p className="text-[11px] text-neutral-500">
                      Pausa novas solicitações temporariamente
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformConfig.maintenance_mode}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({
                        ...prev,
                        maintenance_mode: e.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-neutral-950"
                  />
                </label>

                <button
                  type="submit"
                  disabled={savingPlatform}
                  className="min-h-[46px] w-full rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm"
                >
                  {savingPlatform ? 'Salvando...' : 'Salvar Configurações do Site'}
                </button>
              </form>

              {/* Identidade Visual, Logo & Imagens dos Veículos */}
              <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950">
                  <ImageIcon className="h-5 w-5 text-[#047857]" />
                  <span>Logo & Imagens dos Veículos (White-Label)</span>
                </div>
                <p className="text-xs text-neutral-600">
                  Personalize o logotipo da plataforma e os ícones de Moto, Pop e Entregas exibidos
                  para passageiros e motoristas.
                </p>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-[11px] font-semibold text-emerald-900 leading-relaxed">
                  <strong>Sincronização ao vivo (Web, PWA &amp; APK):</strong> Alterações de nome,
                  logos, cores, fotos dos veículos e áudios são aplicadas dinamicamente via Supabase
                  em todos os aparelhos conectados sem precisar recompilar ou baixar um novo APK.
                </div>

                <div className="space-y-3">
                  {/* Logo */}
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={resolveBrandLogo(platformConfig)}
                        alt="Logo do Site"
                        className="h-12 w-12 rounded-xl object-cover border border-neutral-200 bg-white shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-neutral-950 dark:text-white">Logo Principal</p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {platformConfig.app_logo_url ? 'Personalizada' : 'Padrão Boreal Mobilidade'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="cursor-pointer rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 py-2 text-[11px] font-bold text-white dark:text-[#071513]">
                        {uploadingAssetKind === 'logo' ? 'Enviando...' : 'Trocar'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) =>
                            handleUploadPlatformAsset(e.target.files?.[0], 'logo')
                          }
                        />
                      </label>
                      {platformConfig.app_logo_url && (
                        <button
                          type="button"
                          onClick={() => handleResetPlatformAsset('app_logo_url')}
                          className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[11px] font-bold text-neutral-700"
                        >
                          Padrão
                        </button>
                      )}
                    </div>
                  </div>

                  {(
                    [
                      {
                        kind: 'moto' as const,
                        field: 'vehicle_img_moto' as const,
                        category: 'moto' as const,
                        label: 'Moto Urbana',
                      },
                      {
                        kind: 'pop' as const,
                        field: 'vehicle_img_pop' as const,
                        category: 'pop' as const,
                        label: 'Carro Pop / Negocia',
                      },
                      {
                        kind: 'delivery_moto' as const,
                        field: 'vehicle_img_delivery_moto' as const,
                        category: 'delivery_moto' as const,
                        label: 'Entrega Moto',
                      },
                      {
                        kind: 'delivery_car' as const,
                        field: 'vehicle_img_delivery_car' as const,
                        category: 'delivery_car' as const,
                        label: 'Entrega Carro',
                      },
                    ] as const
                  ).map((item) => (
                    <div
                      key={item.kind}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={resolveCategoryVehicleImage(item.category, platformConfig)}
                          alt={item.label}
                          className="h-11 w-14 rounded-xl object-cover border border-neutral-200 bg-white shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-neutral-950">{item.label}</p>
                          <p className="text-[11px] text-neutral-500">
                            {platformConfig[item.field] ? 'Imagem customizada' : 'Imagem padrão'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <label className="cursor-pointer rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 py-2 text-[11px] font-bold text-white dark:text-[#071513]">
                          {uploadingAssetKind === item.kind ? 'Enviando...' : 'Trocar'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) =>
                              handleUploadPlatformAsset(e.target.files?.[0], item.kind)
                            }
                          />
                        </label>
                        {platformConfig[item.field] && (
                          <button
                            type="button"
                            onClick={() => handleResetPlatformAsset(item.field)}
                            className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[11px] font-bold text-neutral-700"
                          >
                            Padrão
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gerenciador Completo de Sons do Sistema (7 Cues MP3/WAV/OGG) */}
              <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950 dark:text-white">
                  <Music className="h-5 w-5 text-[#047857] dark:text-[#6EE7B7]" />
                  <span>Gerenciador Completo de Sons do Sistema (7 Cues)</span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  Personalize todos os toques de chamada, entrega, aceite, chegada, conclusão, chat e
                  cancelamento em MP3/WAV/OGG.
                </p>

                <div className="space-y-2.5">
                  {(
                    [
                      {
                        kind: 'sound_offer' as const,
                        field: 'sound_offer_url' as const,
                        cue: 'offer' as const,
                        label: '1. Nova Corrida (Alarme Motorista)',
                      },
                      {
                        kind: 'sound_delivery' as const,
                        field: 'sound_delivery_url' as const,
                        cue: 'delivery' as const,
                        label: '2. Nova Entrega (Alarme Motoboy)',
                      },
                      {
                        kind: 'sound_accepted' as const,
                        field: 'sound_accepted_url' as const,
                        cue: 'accepted' as const,
                        label: '3. Corrida Aceita',
                      },
                      {
                        kind: 'sound_arrived' as const,
                        field: 'sound_arrived_url' as const,
                        cue: 'arrived' as const,
                        label: '4. Chegada no Local (Embarque)',
                      },
                      {
                        kind: 'sound_completed' as const,
                        field: 'sound_completed_url' as const,
                        cue: 'completed' as const,
                        label: '5. Corrida / Entrega Concluída',
                      },
                      {
                        kind: 'sound_chat' as const,
                        field: 'sound_chat_url' as const,
                        cue: 'chat' as const,
                        label: '6. Nova Mensagem no Chat',
                      },
                      {
                        kind: 'sound_cancel' as const,
                        field: 'sound_cancel_url' as const,
                        cue: 'cancel' as const,
                        label: '7. Cancelamento de Corrida',
                      },
                    ] as const
                  ).map((snd) => (
                    <div
                      key={snd.kind}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-neutral-950 dark:text-white">{snd.label}</p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {platformConfig[snd.field] ? 'Áudio personalizado ativo' : 'Sintetizador padrão'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            syncPlatformSounds(platformConfig);
                            void playSoundCue(snd.cue);
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-2 text-[11px] font-bold text-neutral-800 dark:text-neutral-200"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          Testar
                        </button>
                        <label className="cursor-pointer rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-3 py-2 text-[11px] font-bold text-white dark:text-[#071513]">
                          {uploadingAssetKind === snd.kind ? 'Enviando...' : 'Enviar Áudio'}
                          <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={(e) =>
                              handleUploadPlatformAsset(e.target.files?.[0], snd.kind)
                            }
                          />
                        </label>
                        {platformConfig[snd.field] && (
                          <button
                            type="button"
                            onClick={() => handleResetPlatformAsset(snd.field)}
                            className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-2 text-[11px] font-bold text-neutral-700 dark:text-neutral-200"
                          >
                            Padrão
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Atualização Automática OTA do APK */}
                <form
                  onSubmit={handleSavePlatformConfig}
                  className="mt-4 rounded-2xl border border-[#D4EDE7] dark:border-[#065F46] bg-[#ECFDF5]/60 dark:bg-[#102924]/50 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-extrabold text-neutral-950 dark:text-white">
                      <DownloadCloud className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                      Publicar Atualização OTA do APK
                    </span>
                    <span className="font-mono-num text-[11px] font-bold text-neutral-500">
                      Atual: v{CURRENT_APP_VERSION}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                        Nova Versão (Semver)
                      </label>
                      <input
                        type="text"
                        value={platformConfig.ota_latest_version || CURRENT_APP_VERSION}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            ota_latest_version: e.target.value,
                          }))
                        }
                        placeholder="1.2.2"
                        className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 font-mono-num text-xs font-bold"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                        URL Direta do APK (.apk / GitHub Release)
                      </label>
                      <input
                        type="url"
                        value={platformConfig.ota_apk_url || ''}
                        onChange={(e) =>
                          setPlatformConfig((prev) => ({
                            ...prev,
                            ota_apk_url: e.target.value,
                          }))
                        }
                        placeholder="https://github.com/.../borealmobilidade-v1.2.2.apk"
                        className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      URL Web OTA ao Vivo (Atualização Instantânea no APK sem reinstalar)
                    </label>
                    <input
                      type="url"
                      value={platformConfig.ota_web_url || ''}
                      onChange={(e) =>
                        setPlatformConfig((prev) => ({
                          ...prev,
                          ota_web_url: e.target.value,
                        }))
                      }
                      placeholder="https://seu-app-hospedado.vercel.app"
                      className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      Notas da Versão (exibidas no alerta do usuário)
                    </label>
                    <input
                      type="text"
                      value={platformConfig.ota_release_notes || ''}
                      onChange={(e) =>
                        setPlatformConfig((prev) => ({
                          ...prev,
                          ota_release_notes: e.target.value,
                        }))
                      }
                      placeholder="Avaliações com foto e nome, transferências/saques Pix e PIN moderno."
                      className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingPlatform}
                    className="min-h-[42px] w-full rounded-xl aurora-accent-flow text-xs font-extrabold text-white shadow-sm"
                  >
                    {savingPlatform ? 'Publicando...' : 'Salvar Versão OTA'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setShowLegalDocs(true)}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-extrabold text-neutral-900 dark:text-white hover:bg-neutral-100"
                >
                  <FileText className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                  Visualizar Termos, Privacidade, Segurança &amp; Cookies
                </button>
              </div>
            </div>
          </section>
        )}

        {/* TAB 6B: AUDITORIA & TELEMETRIA DE DISPOSITIVOS */}
        {tab === 'audit' && (
          <AdminAuditTab
            logs={auditLogs}
            loading={loadingData}
            platformConfig={platformConfig}
            suppressPrintSheet={Boolean(receiptModalDriver)}
            onRefresh={loadOverview}
          />
        )}

        {/* TAB 7: SQL INCREMENTAL & APK */}
        {tab === 'infra' && (
          <section className="mt-5 space-y-6">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
              <div className="flex items-center gap-2.5">
                <Smartphone className="h-5 w-5 text-[#047857] dark:text-[#6EE7B7]" />
                <h3 className="font-display text-base font-extrabold text-neutral-950 dark:text-white">
                  Conexão Direta Supabase (Web, PWA &amp; Capacitor APK)
                </h3>
              </div>
              <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                O aplicativo agora conecta diretamente no seu projeto Supabase em todas as telas
                (inclusive dentro do APK Android sem depender de servidor local), usando{' '}
                <span className="font-mono-num">capacitor.config.ts</span> e{' '}
                <span className="font-mono-num">.github/workflows/build-apk.yml</span>.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950 dark:text-white">
                    SQL Incremental — Apenas Alterações e Tabelas Novas
                  </h3>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Contém somente o que foi adicionado/alterado (Seções 1–10: <span className="font-mono-num">pay66_key</span>, <span className="font-mono-num">update_my_pay66_key</span>, <span className="font-mono-num">deposit_window_enabled/start_time/end_time</span>, <span className="font-mono-num">reserved_balance</span>, <span className="font-mono-num">process_66pay_ride_transfer</span>, <span className="font-mono-num">user_wallets</span>, <span className="font-mono-num">app_notifications</span>, <span className="font-mono-num">coupons</span>, <span className="font-mono-num">user_coupons</span>, multi-veículos <span className="font-mono-num">vehicles/active_vehicle_id</span>, status <span className="font-mono-num">'paid'</span>, trava de segurança BorealPay e privilégio <span className="font-mono-num">is_admin</span> para <span className="font-mono-num">driver@admin.com</span>), sem apagar saldos ou recriar tabelas antigas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copySql}
                  className="flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-4 text-xs font-bold text-white dark:text-[#071513]"
                >
                  <Copy className="h-4 w-4" />
                  {copiedSql ? 'Copiado!' : 'Copiar SQL'}
                </button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-xl bg-neutral-950 p-4 text-[11px] font-mono text-neutral-200 leading-relaxed">
                {migrationSql || 'Veja o arquivo supabase/migration_incremental_latest.sql no repositório.'}
              </pre>
            </div>
          </section>
        )}
      </div>

      {/* Document Inspection Modal */}
      {inspectDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                  Documentos de {inspectDriver.full_name}
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  {inspectDriver.driver?.vehicle_model} · Placa{' '}
                  <span className="font-mono-num font-bold">
                    {inspectDriver.driver?.vehicle_plate}
                  </span>{' '}
                  · Pix: <span className="font-mono-num">{inspectDriver.driver?.pix_key}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectDriver(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">CNH (Habilitação)</p>
                <img
                  src={resolvedCnhUrl || inspectDriver.driver?.cnh_url}
                  alt="CNH do Motorista"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 object-cover bg-neutral-100 dark:bg-neutral-800"
                />
              </div>
              <div>
                <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">CRLV (Documento Veículo)</p>
                <img
                  src={resolvedCrlvUrl || inspectDriver.driver?.crlv_url}
                  alt="CRLV do Veículo"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 object-cover bg-neutral-100 dark:bg-neutral-800"
                />
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t border-neutral-100 dark:border-neutral-800 pt-4">
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Motivo caso reprove ou suspenda (opcional)"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3.5 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    handleReviewDriver(
                      inspectDriver.id,
                      'rejected',
                      rejectionReason || 'Documentação ilegível ou divergente.'
                    )
                  }
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 text-xs font-bold text-red-700 dark:text-red-300"
                >
                  <Ban className="h-4 w-4" />
                  Reprovar
                </button>
                <button
                  type="button"
                  onClick={() => handleReviewDriver(inspectDriver.id, 'active')}
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl aurora-accent-flow px-5 text-xs font-extrabold text-white shadow-sm"
                >
                  <Check className="h-4 w-4" />
                  Aprovar Cadastro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Driver Payout Modal */}
      {payoutModalDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={handleSubmitPayout}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                  Registrar Repasse Pix
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {payoutModalDriver.full_name} · Saldo:{' '}
                  <strong className="font-mono-num">
                    {formatBRL(payoutModalDriver.wallet_balance)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayoutModalDriver(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3.5 text-xs">
              <p className="text-neutral-500 dark:text-neutral-400 font-bold">Chave Pix do Motorista / Entregador</p>
              <p className="mt-1 font-mono-num text-sm font-extrabold text-neutral-950 dark:text-white">
                {payoutModalDriver.driver?.pix_key || payoutModalDriver.email}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                Valor a repassar (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={payoutModalDriver.wallet_balance}
                required
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="min-h-[46px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 font-mono-num text-base font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                Observação / Comprovante
              </label>
              <input
                type="text"
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
                placeholder="Ex: Pix enviado às 18:30"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <button
              type="submit"
              className="min-h-[48px] w-full rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm"
            >
              Confirmar Repasse e Abater Saldo
            </button>
          </form>
        </div>
      )}

      {chatTargetUser && (
        <DirectChatModal
          threadUser={{
            id: chatTargetUser.id,
            full_name: chatTargetUser.full_name,
            role: chatTargetUser.role,
            avatar_url: chatTargetUser.avatar_url,
            phone: chatTargetUser.phone,
          }}
          currentUser={currentUser}
          onClose={() => setChatTargetUser(null)}
        />
      )}

      {/* Client Debt / Non-payment Assignment Modal */}
      {debtModalClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={handleSaveClientDebt}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                  Cobrança / Corrida não paga
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{debtModalClient.full_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDebtModalClient(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="rounded-2xl bg-[#ECFDF5] dark:bg-[#102924] border border-[#D4EDE7] dark:border-[#065F46] p-3 text-xs text-[#065F46] dark:text-[#6EE7B7]">
              O valor definido aqui será exibido como pendência para o cliente e somado
              automaticamente na próxima corrida que ele solicitar (ou digite <strong>0</strong>{' '}
              para limpar a dívida).
            </p>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                Valor da Pendência (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={debtAmountInput}
                onChange={(e) => setDebtAmountInput(e.target.value)}
                placeholder="0.00"
                className="min-h-[46px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 font-mono-num text-base font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                Motivo / Descrição exibida ao cliente
              </label>
              <input
                type="text"
                value={debtNoteInput}
                onChange={(e) => setDebtNoteInput(e.target.value)}
                placeholder="Ex: Corrida não paga"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={savingDebt}
                onClick={async () => {
                  setDebtAmountInput('0');
                  setSavingDebt(true);
                  try {
                    await adminAssignClientDebt(debtModalClient.id, 0);
                    setDebtModalClient(null);
                    await loadOverview();
                    showToast(`Dívida de ${debtModalClient.full_name} zerada.`);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Erro ao zerar dívida.');
                  } finally {
                    setSavingDebt(false);
                  }
                }}
                className="min-h-[48px] flex-1 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-extrabold text-neutral-800 dark:text-neutral-200"
              >
                Zerar Dívida
              </button>
              <button
                type="submit"
                disabled={savingDebt}
                className="min-h-[48px] flex-1 rounded-2xl bg-red-600 text-xs font-extrabold text-white"
              >
                {savingDebt ? 'Salvando...' : 'Salvar Cobrança'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Universal User Wallet Balance Editor Modal (Clients, Drivers & Deliverers) */}
      {balanceModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={handleSaveUserBalance}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                  Editar Saldo do Usuário
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {balanceModalUser.full_name} ·{' '}
                  {balanceModalUser.role === 'passenger'
                    ? 'Cliente'
                    : balanceModalUser.driver?.vehicle_type === 'delivery'
                    ? 'Entregador'
                    : 'Motorista'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBalanceModalUser(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3.5">
              <div>
                <p className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400">Saldo Atual</p>
                <p className="font-mono-num text-lg font-extrabold text-neutral-950 dark:text-white">
                  {formatBRL(balanceModalUser.wallet_balance || 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">Novo Saldo Final</p>
                <p className="font-mono-num text-lg font-extrabold text-emerald-700 dark:text-emerald-400">
                  {formatBRL(computedPreviewBalance)}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                Tipo de Alteração
              </label>
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1">
                {(
                  [
                    { id: 'set', label: 'Valor Exato' },
                    { id: 'add', label: 'Adicionar (+)' },
                    { id: 'subtract', label: 'Descontar (-)' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setBalanceMode(m.id);
                      if (m.id === 'set') {
                        setBalanceAmountInput(
                          Number(balanceModalUser.wallet_balance || 0).toFixed(2)
                        );
                      } else {
                        setBalanceAmountInput('');
                      }
                    }}
                    className={`min-h-[38px] rounded-xl text-[11px] font-extrabold transition ${
                      balanceMode === m.id
                        ? 'bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#071513] shadow-xs'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                {balanceMode === 'set'
                  ? 'Definir novo saldo total (R$)'
                  : balanceMode === 'add'
                  ? 'Valor a adicionar (R$)'
                  : 'Valor a descontar (R$)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={balanceAmountInput}
                onChange={(e) => setBalanceAmountInput(e.target.value)}
                placeholder="0.00"
                className="min-h-[46px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 font-mono-num text-base font-extrabold text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                Motivo / Descrição no Extrato (opcional)
              </label>
              <input
                type="text"
                value={balanceNoteInput}
                onChange={(e) => setBalanceNoteInput(e.target.value)}
                placeholder="Ex: Crédito confirmado / Ajuste manual / Bônus"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
            </div>

            <button
              type="submit"
              disabled={savingBalance}
              className="min-h-[48px] w-full rounded-2xl aurora-accent-flow text-sm font-extrabold text-white shadow-sm disabled:opacity-60"
            >
              {savingBalance
                ? 'Salvando no Supabase...'
                : `Confirmar Saldo (${formatBRL(computedPreviewBalance)})`}
            </button>
          </form>
        </div>
      )}

      {showLegalDocs && (
        <LegalDocsModal
          siteName={platformConfig.site_name}
          onClose={() => setShowLegalDocs(false)}
        />
      )}

      {receiptModalDriver && (
        <AdminSettlementReceiptModal
          driver={receiptModalDriver}
          period={settlementPeriod}
          rides={rides}
          transactions={transactions}
          platformConfig={platformConfig}
          onConfirmPayout={async (amount, note) => {
            await adminPayDriverPix(receiptModalDriver, amount, note);
            setReceiptModalDriver(null);
            await loadOverview();
            showToast('Recibo quitado e repasse Pix registrado!');
          }}
          onClose={() => setReceiptModalDriver(null)}
        />
      )}
    </div>
  );
};
