import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Banknote,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Headphones,
  History,
  KeyRound,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Navigation,
  Phone,
  Power,
  QrCode,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Thermometer,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { getCurrentGpsPosition, watchGpsPosition } from '../lib/capacitorDevice';
import {
  buildGoogleMapsDirectionsUrl,
  buildPixEmvPayload,
  fetchLocalWeather,
  fetchRouteGeometry,
  formatBRL,
  haversineKm,
  preloadLocalGeoIndex,
  reverseGeocode,
  searchAddresses,
  searchLocalGeoIndex,
  type AddressSuggestion,
  type RouteStep,
} from '../lib/geo';
import {
  acceptRide,
  buildDriver66PayQrPayload,
  completeRide,
  confirmCashReceived,
  declarePixPaid,
  fetchMyNotifications,
  fetchRideByIdEnriched,
  fetchUserProfileById,
  fetchWalletTransactions,
  markAllNotificationsRead,
  markNotificationRead,
  markRideArrived,
  reportRideUnpaid,
  startRideWithPin,
  toggleDriverOnlineStatus,
} from '../lib/mobilityApi';
import { logAuditEvent } from '../lib/audit';
import { useTranslation } from '../lib/i18n';
import {
  clearOfflineActiveRideCache,
  loadOfflineActiveRideCache,
  saveOfflineActiveRideCache,
} from '../lib/offlineNavigation';
import { isDateInPeriod } from '../lib/periodFilter';
import { PixQrSvg, usePixSecurityRotation } from '../lib/pixQr';
import {
  playRideAcceptedChime,
  speakPtBr,
  startContinuousRideAlarm,
  stopSpeech,
  unlockAudioContext,
} from '../lib/sound';
import { supabase } from '../lib/supabase';
import {
  getUserPreferences,
  saveUserPreferences,
  subscribeUserPreferences,
} from '../lib/userPrefs';
import type {
  AppNotification,
  GeoPoint,
  PeriodFilter,
  PlatformConfig,
  PlatformEvent,
  Ride,
  RideCategory,
  RideMessage,
  UserProfile,
  WalletTransaction,
  WeatherInfo,
} from '../types/mobility';
import { AccountSettingsModal } from './AccountSettingsModal';
import { AvatarImage } from './AvatarImage';
import { ClientWalletModal, type WalletModalTab } from './ClientWalletModal';
import { DirectChatModal } from './DirectChatModal';
import { LiveMap } from './LiveMap';
import { NotificationsModal } from './NotificationsModal';
import { PWAInstallButton } from './PWAInstallButton';
import { RatingModal } from './RatingModal';
import { Receipt66PayModal } from './Receipt66PayModal';
import { RideChatModal } from './RideChatModal';
import { SlideToConfirm } from './SlideToConfirm';

interface DriverViewProps {
  currentUser: UserProfile;
  platformConfig: PlatformConfig;
  platformEvents: PlatformEvent[];
  rides: Ride[];
  messagesByRide: Record<string, RideMessage[]>;
  onUserUpdated: (user: UserProfile) => void;
  onLoadMessages: (rideId: string) => void;
  onAppendMessage: (msg: RideMessage) => void;
  onRideUpsert: (ride: Ride) => void;
  onEmitLocation: (userId: string, lat: number, lng: number, heading?: number) => void;
  onLogout: () => void;
}

const CATEGORY_LABELS: Record<RideCategory, string> = {
  moto: 'Moto',
  pop: 'Pop (Carro)',
  negocia: 'Negocia',
  delivery_moto: 'Entrega Moto',
  delivery_car: 'Entrega Carro',
};

const isDeliveryCategory = (cat: RideCategory) =>
  cat === 'delivery_moto' || cat === 'delivery_car';

const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  paid_wallet: { label: 'Pago pelo App (Saldo) · A receber', color: 'text-emerald-400' },
  paid_pix: { label: 'Pix pago à Plataforma · A receber', color: 'text-amber-400' },
  admin_settled: { label: 'Quitado pelo Admin', color: 'text-emerald-400' },
  paid_cash: { label: 'Recebido em Dinheiro', color: 'text-emerald-400' },
  disputed: { label: 'Em Disputa (Admin)', color: 'text-red-400' },
  pending: { label: 'Aguardando pagamento', color: 'text-neutral-400' },
};

export const DriverView: React.FC<DriverViewProps> = ({
  currentUser,
  platformConfig,
  platformEvents,
  rides,
  messagesByRide,
  onUserUpdated,
  onLoadMessages,
  onAppendMessage,
  onRideUpsert,
  onEmitLocation,
  onLogout,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeTab, setFinanceTab] = useState<'rides' | 'ledger'>('rides');
  const [financePeriod, setFinancePeriod] = useState<PeriodFilter>('day');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletInitialTab, setWalletInitialTab] = useState<WalletModalTab>('withdraw');

  const openDriverWallet = (tab: WalletModalTab = 'withdraw') => {
    setWalletInitialTab(tab);
    setWalletOpen(true);
  };

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  const [driverCoords, setDriverCoords] = useState<[number, number]>([
    currentUser.driver?.current_lat ?? -23.55052,
    currentUser.driver?.current_lng ?? -46.633308,
  ]);
  const [driverGpsFixed, setDriverGpsFixed] = useState<boolean>(
    Boolean(currentUser.driver?.current_lat && currentUser.driver?.current_lng)
  );
  const [driverHeading, setDriverHeading] = useState<number>(currentUser.driver?.heading ?? 0);
  const [driverSpeedKmh, setDriverSpeedKmh] = useState<number>(0);
  const [sheetMinimized, setSheetMinimized] = useState<boolean>(false);
  const [idleCleanMap, setIdleCleanMap] = useState<boolean>(false);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => getUserPreferences().voice_enabled);
  const dragStartYRef = useRef<number | null>(null);
  const speedDecayRef = useRef<number | null>(null);
  const fetchedRouteStageRef = useRef<string | null>(null);
  const lastSpokenStepRef = useRef<string>('');
  const prioritySpeechUntilRef = useRef<number>(0);
  const spokenMilestonesRef = useRef<Set<string>>(new Set());
  const autoArrivedRideIdsRef = useRef<Set<string>>(new Set());
  const pinHiddenInputRef = useRef<HTMLInputElement | null>(null);

  const announcePrioritySpeech = useCallback((text: string) => {
    prioritySpeechUntilRef.current = Date.now() + 8500;
    speakPtBr(text, true);
  }, []);

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number>(0);
  const [routeDurationMin, setRouteDurationMin] = useState<number>(0);
  const [declinedRideIds, setDeclinedRideIds] = useState<string[]>([]);

  const [pinModalMode, setPinModalMode] = useState<'pickup' | 'delivery' | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [checkoutRide, setCheckoutRide] = useState<Ride | null>(null);
  const [walletPaidSuccessRide, setWalletPaidSuccessRide] = useState<Ride | null>(null);
  const [pixConfirmedSuccess, setPixConfirmedSuccess] = useState(false);
  const [walletCheckoutSuccess, setWalletCheckoutSuccess] = useState(false);
  const [copiedCheckoutPix, setCopiedCheckoutPix] = useState(false);
  const [copied66PayKey, setCopied66PayKey] = useState(false);
  const [waitNowMs, setWaitNowMs] = useState<number>(() => Date.now());

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [receiptTx, setReceiptTx] = useState<WalletTransaction | null>(null);
  const [receipt66Ride, setReceipt66Ride] = useState<Ride | null>(null);

  const [freeNavOpen, setFreeNavOpen] = useState(false);
  const [freeNavQuery, setFreeNavQuery] = useState('');
  const [freeNavSuggestions, setFreeNavSuggestions] = useState<AddressSuggestion[]>([]);
  const [freeNavSearching, setFreeNavSearching] = useState(false);
  const [freeNavPickMode, setFreeNavPickMode] = useState(false);
  const [freeNavDest, setFreeNavDest] = useState<GeoPoint | null>(null);
  const [freeNavRouteCoords, setFreeNavRouteCoords] = useState<[number, number][]>([]);
  const [freeNavRouteInfo, setFreeNavRouteInfo] = useState<{
    distanceKm: number;
    durationMin: number;
  } | null>(null);

  const [disputeRide, setDisputeRide] = useState<Ride | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const [chatOpen, setChatOpen] = useState(false);

  const ratingStorageKey = `velo99_driver_dismissed_ratings_${currentUser.id}`;
  const [dismissedRatingIds, setDismissedRatingIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(ratingStorageKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const sessionStartedAtRef = useRef<number>(Date.now());
  const justCompletedRideIdRef = useRef<string | null>(null);
  const pixSuccessTimerRef = useRef<number | null>(null);
  const walletSuccessTimerRef = useRef<number | null>(null);

  const markRatingHandled = useCallback(
    (rideId: string) => {
      setDismissedRatingIds((prev) => {
        if (prev.includes(rideId)) return prev;
        const next = [...prev, rideId].slice(-120);
        try {
          localStorage.setItem(ratingStorageKey, JSON.stringify(next));
        } catch {
          // Ignore storage quota issues
        }
        return next;
      });
    },
    [ratingStorageKey]
  );

  const isOnline = Boolean(currentUser.driver?.is_online);

  const relevantEvents = useMemo(
    () =>
      platformEvents.filter((ev) => {
        if (!ev.active) return false;
        if (ev.target_role === 'all') return true;
        if (ev.target_role === 'delivery') return currentUser.driver?.vehicle_type === 'delivery';
        return currentUser.driver?.vehicle_type !== 'delivery';
      }),
    [platformEvents, currentUser.driver?.vehicle_type]
  );

  const myDriverRides = useMemo(
    () => rides.filter((r) => r.driver_id === currentUser.id),
    [rides, currentUser.id]
  );

  const completedRides = useMemo(
    () => myDriverRides.filter((r) => r.status === 'completed'),
    [myDriverRides]
  );

  const periodDriverRides = useMemo(
    () =>
      myDriverRides.filter((r) =>
        isDateInPeriod(r.completed_at || r.created_at, financePeriod)
      ),
    [myDriverRides, financePeriod]
  );

  const periodCompletedRides = useMemo(
    () => periodDriverRides.filter((r) => r.status === 'completed'),
    [periodDriverRides]
  );

  const periodTransactions = useMemo(
    () => transactions.filter((tx) => isDateInPeriod(tx.created_at, financePeriod)),
    [transactions, financePeriod]
  );

  const financeSummary = useMemo(() => {
    const totalPixEarned = periodCompletedRides
      .filter((r) => r.payment_method === 'pix')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const totalWalletEarned = periodCompletedRides
      .filter((r) => r.payment_method === 'wallet')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const totalCashCollected = periodCompletedRides
      .filter((r) => r.payment_method === 'cash' && r.payment_status !== 'disputed')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const totalPayoutsReceived = periodTransactions
      .filter((tx) => tx.type === 'payout')
      .reduce((acc, tx) => acc + Math.abs(tx.amount), 0);

    const disputedTotal = periodDriverRides
      .filter((r) => r.payment_status === 'disputed')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const grossTotal = totalPixEarned + totalWalletEarned + totalCashCollected;
    const deliveriesCount = periodCompletedRides.filter((r) =>
      isDeliveryCategory(r.category)
    ).length;

    return {
      totalPixEarned: Number(totalPixEarned.toFixed(2)),
      totalWalletEarned: Number(totalWalletEarned.toFixed(2)),
      totalCashCollected: Number(totalCashCollected.toFixed(2)),
      totalPayoutsReceived: Number(totalPayoutsReceived.toFixed(2)),
      disputedTotal: Number(disputedTotal.toFixed(2)),
      grossTotal: Number(grossTotal.toFixed(2)),
      ridesCount: periodCompletedRides.length - deliveriesCount,
      deliveriesCount,
      pendingToReceive: Number((currentUser.wallet_balance || 0).toFixed(2)),
    };
  }, [periodCompletedRides, periodDriverRides, periodTransactions, currentUser.wallet_balance]);

  const activeRide = useMemo(
    () =>
      myDriverRides.find((r) =>
        ['accepted', 'arrived', 'in_progress'].includes(r.status)
      ) || null,
    [myDriverRides]
  );

  const incomingRide = useMemo(() => {
    if (!isOnline || activeRide || currentUser.status !== 'active') return null;
    return (
      rides.find(
        (r) => r.status === 'searching' && !declinedRideIds.includes(r.id)
      ) || null
    );
  }, [isOnline, activeRide, currentUser.status, rides, declinedRideIds]);

  // Continuous alarm sound + vibration while incoming ride alert is on screen
  useEffect(() => {
    if (!incomingRide) return;
    const isDel = isDeliveryCategory(incomingRide.category);
    const stopAlarm = startContinuousRideAlarm(
      isDel
        ? `Nova Entrega (${formatBRL(incomingRide.estimated_fare)})`
        : `Nova Corrida (${formatBRL(incomingRide.estimated_fare)})`,
      `${incomingRide.origin_address} → ${incomingRide.destination_address}`,
      isDel
    );
    return stopAlarm;
  }, [incomingRide]);

  // Keep checkoutRide synced and show green confirmation feedback when Admin confirms Pix or client scans 66pay QR
  useEffect(() => {
    if (!checkoutRide) return;
    const latest = myDriverRides.find((r) => r.id === checkoutRide.id);
    if (!latest) return;

    if (
      latest.payment_status === 'paid' ||
      latest.payment_status === 'paid_pix' ||
      latest.payment_status === 'admin_settled' ||
      latest.payment_status === 'paid_wallet'
    ) {
      if (!pixConfirmedSuccess) {
        const isWalletPay =
          latest.payment_status === 'paid' || latest.payment_status === 'paid_wallet';
        setWalletCheckoutSuccess(isWalletPay);
        setPixConfirmedSuccess(true);
        setCheckoutRide(latest);
        justCompletedRideIdRef.current = latest.id;
        void playRideAcceptedChime();
        fetchWalletTransactions(currentUser.id).then(setTransactions).catch(() => {});
        fetchUserProfileById(currentUser.id)
          .then((fresh) => fresh && onUserUpdated(fresh))
          .catch(() => {});
        if (pixSuccessTimerRef.current) window.clearTimeout(pixSuccessTimerRef.current);
        if (!isWalletPay) {
          pixSuccessTimerRef.current = window.setTimeout(() => {
            setCheckoutRide(null);
            setPixConfirmedSuccess(false);
            setWalletCheckoutSuccess(false);
          }, 3200);
        }
      }
      return;
    }

    if (latest.payment_status === 'paid_cash') {
      justCompletedRideIdRef.current = latest.id;
      setCheckoutRide(null);
      setPixConfirmedSuccess(false);
      setWalletCheckoutSuccess(false);
      fetchWalletTransactions(currentUser.id).then(setTransactions).catch(() => {});
      fetchUserProfileById(currentUser.id)
        .then((fresh) => fresh && onUserUpdated(fresh))
        .catch(() => {});
    } else if (
      latest.payment_method !== checkoutRide.payment_method ||
      latest.payment_status !== checkoutRide.payment_status ||
      latest.pix_declared_at !== checkoutRide.pix_declared_at
    ) {
      setCheckoutRide(latest);
    }
  }, [myDriverRides, checkoutRide, pixConfirmedSuccess, currentUser.id, onUserUpdated]);

  // Guaranteed fast poll (2.5s) while checkout popup is open so Admin Pix approval unlocks immediately
  useEffect(() => {
    if (!checkoutRide?.id || pixConfirmedSuccess) return;
    let active = true;
    const pollCheckout = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      fetchRideByIdEnriched(checkoutRide.id)
        .then((fresh) => {
          if (active && fresh) onRideUpsert(fresh);
        })
        .catch(() => {});
    };
    const timer = window.setInterval(pollCheckout, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [checkoutRide?.id, pixConfirmedSuccess, onRideUpsert]);

  useEffect(() => {
    const onBubbleTap = () => {
      setSheetMinimized(false);
      setIdleCleanMap(false);
    };
    window.addEventListener('mobilidade66:bubble-tap', onBubbleTap);
    return () => window.removeEventListener('mobilidade66:bubble-tap', onBubbleTap);
  }, []);

  useEffect(() => {
    return () => {
      if (pixSuccessTimerRef.current) window.clearTimeout(pixSuccessTimerRef.current);
      if (walletSuccessTimerRef.current) window.clearTimeout(walletSuccessTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return subscribeUserPreferences((prefs) => {
      setVoiceEnabled(prefs.voice_enabled);
    });
  }, []);

  // 1-second waiting timer when arrived at pickup
  useEffect(() => {
    if (!activeRide || activeRide.status !== 'arrived' || !activeRide.arrived_at) return;
    setWaitNowMs(Date.now());
    const id = window.setInterval(() => setWaitNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeRide]);

  const waitingStats = useMemo(() => {
    if (!activeRide?.arrived_at) {
      return { elapsedSec: 0, remainingFreeSec: 120, extraSec: 0, waitingFee: 0, isCharging: false };
    }
    const arrivedMs = new Date(activeRide.arrived_at).getTime();
    const endMs = activeRide.started_at
      ? new Date(activeRide.started_at).getTime()
      : activeRide.status === 'arrived'
      ? waitNowMs
      : arrivedMs;
    const elapsedSec = Math.max(0, Math.floor((endMs - arrivedMs) / 1000));
    const remainingFreeSec = Math.max(0, 120 - elapsedSec);
    const extraSec = Math.max(0, elapsedSec - 120);
    const waitingFee = extraSec > 0 ? Number((Math.ceil(extraSec / 60) * 0.5).toFixed(2)) : 0;
    return {
      elapsedSec,
      remainingFreeSec,
      extraSec,
      waitingFee,
      isCharging: extraSec > 0,
    };
  }, [activeRide, waitNowMs]);

  const pendingRatingRide = useMemo(
    () =>
      !checkoutRide && !walletPaidSuccessRide
        ? myDriverRides.find((r) => {
            if (r.status !== 'completed' || r.driver_rating_submitted) return false;
            if (dismissedRatingIds.includes(r.id)) return false;
            const completedMs = new Date(r.completed_at || r.created_at).getTime();
            return (
              r.id === justCompletedRideIdRef.current ||
              completedMs >= sessionStartedAtRef.current - 60_000
            );
          }) || null
        : null,
    [myDriverRides, dismissedRatingIds, checkoutRide, walletPaidSuccessRide]
  );

  useEffect(() => {
    getCurrentGpsPosition().then((pos) => {
      if (pos) {
        setDriverCoords([pos.lat, pos.lng]);
        setDriverGpsFixed(true);
        setDriverHeading(pos.heading ?? 0);
        setDriverSpeedKmh(pos.speedKmh ?? 0);
        fetchLocalWeather(pos.lat, pos.lng).then((w) => w && setWeather(w));
      } else {
        fetchLocalWeather(driverCoords[0], driverCoords[1]).then((w) => w && setWeather(w));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const stopWatch = watchGpsPosition((pos) => {
      setDriverCoords([pos.lat, pos.lng]);
      setDriverGpsFixed(true);
      if (pos.heading !== undefined) setDriverHeading(pos.heading);
      setDriverSpeedKmh(pos.speedKmh ?? 0);
      onEmitLocation(currentUser.id, pos.lat, pos.lng, pos.heading);
    });
    return stopWatch;
  }, [isOnline, currentUser.id, onEmitLocation]);

  useEffect(() => {
    if (activeRide) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  useEffect(() => {
    setSheetMinimized(false);
  }, [activeRide?.id]);

  useEffect(() => {
    return () => {
      if (speedDecayRef.current) window.clearTimeout(speedDecayRef.current);
    };
  }, []);

  // Fetch persistent OSRM route once per ride stage + cache locally for 4G-drop offline resilience
  useEffect(() => {
    if (!activeRide) {
      fetchedRouteStageRef.current = null;
      setRouteCoords([]);
      setRouteSteps([]);
      setRouteDistanceKm(0);
      setRouteDurationMin(0);
      clearOfflineActiveRideCache();
      return;
    }

    const stage = activeRide.status === 'in_progress' ? 'B' : 'A';
    const stageKey = `${activeRide.id}:${stage}`;
    if (fetchedRouteStageRef.current === stageKey) return;
    fetchedRouteStageRef.current = stageKey;

    const cached = loadOfflineActiveRideCache(activeRide.id, stage);
    if (cached) {
      setRouteCoords(cached.routeCoords);
      setRouteSteps(cached.routeSteps);
      setRouteDistanceKm(cached.distanceKm);
      setRouteDurationMin(cached.durationMin);
    }

    const startLat = stage === 'B' ? activeRide.origin_lat : driverCoords[0];
    const startLng = stage === 'B' ? activeRide.origin_lng : driverCoords[1];
    const targetLat = stage === 'B' ? activeRide.destination_lat : activeRide.origin_lat;
    const targetLng = stage === 'B' ? activeRide.destination_lng : activeRide.origin_lng;

    let cancelled = false;
    fetchRouteGeometry(startLat, startLng, targetLat, targetLng).then((res) => {
      if (cancelled) return;
      // Preserve rich cached OSRM geometry if device went offline and fell back to 2-point straight line
      if (cached && cached.routeCoords.length > 2 && res.coords.length <= 2) {
        return;
      }
      setRouteCoords(res.coords);
      setRouteSteps(res.steps);
      setRouteDistanceKm(res.distanceKm);
      setRouteDurationMin(res.durationMin);
      saveOfflineActiveRideCache({
        rideId: activeRide.id,
        stage,
        routeCoords: res.coords,
        routeSteps: res.steps,
        distanceKm: res.distanceKm,
        durationMin: res.durationMin,
        updatedAt: Date.now(),
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide?.id, activeRide?.status]);

  const refreshProfile = useCallback(async () => {
    const fresh = await fetchUserProfileById(currentUser.id);
    if (fresh) onUserUpdated(fresh);
  }, [currentUser.id, onUserUpdated]);

  const loadFinancePanel = useCallback(async () => {
    const [txs] = await Promise.all([
      fetchWalletTransactions(currentUser.id),
      refreshProfile(),
    ]);
    setTransactions(txs);
  }, [currentUser.id, refreshProfile]);

  const loadNotifications = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const list = await fetchMyNotifications(currentUser);
      setNotifications(list);
    } finally {
      setLoadingNotifications(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadNotifications();
    const channel = supabase
      .channel(`driver-notifications-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_notifications' },
        () => {
          void loadNotifications();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.id, loadNotifications]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  // Free-Map Navigation ONLY when !activeRide — auto-clears completely as soon as a ride starts
  useEffect(() => {
    if (activeRide) {
      setFreeNavOpen(false);
      setFreeNavPickMode(false);
      setFreeNavQuery('');
      setFreeNavSuggestions([]);
      setFreeNavDest(null);
      setFreeNavRouteCoords([]);
      setFreeNavRouteInfo(null);
    }
  }, [activeRide]);

  useEffect(() => {
    if (!driverGpsFixed) return;
    void preloadLocalGeoIndex(driverCoords[0], driverCoords[1]);
  }, [driverGpsFixed, driverCoords]);

  useEffect(() => {
    if (activeRide || !freeNavOpen) return;
    const trimmed = freeNavQuery.trim();
    if (trimmed.length < 2) {
      setFreeNavSuggestions([]);
      setFreeNavSearching(false);
      return;
    }

    const localHits = searchLocalGeoIndex(trimmed, driverCoords[0], driverCoords[1]);
    if (localHits.length > 0) {
      setFreeNavSuggestions(localHits);
    }

    const controller = new AbortController();
    setFreeNavSearching(true);
    const timer = window.setTimeout(() => {
      searchAddresses(trimmed, driverCoords[0], driverCoords[1], controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) {
            setFreeNavSuggestions(results.length > 0 ? results : localHits);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setFreeNavSearching(false);
        });
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeRide, freeNavOpen, freeNavQuery, driverCoords]);

  const selectFreeNavDestination = useCallback(
    async (point: GeoPoint) => {
      if (activeRide) return;
      setFreeNavDest(point);
      setFreeNavQuery(point.address);
      setFreeNavSuggestions([]);
      setFreeNavPickMode(false);
      const route = await fetchRouteGeometry(
        driverCoords[0],
        driverCoords[1],
        point.lat,
        point.lng
      );
      setFreeNavRouteCoords(route.coords);
      setFreeNavRouteInfo({
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
      });
    },
    [activeRide, driverCoords]
  );

  const handleFreeNavMapPick = useCallback(
    async (lat: number, lng: number) => {
      if (activeRide || !freeNavPickMode) return;
      const address = await reverseGeocode(lat, lng).catch(
        () => `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      );
      await selectFreeNavDestination({ lat, lng, address });
    },
    [activeRide, freeNavPickMode, selectFreeNavDestination]
  );

  const clearFreeNav = useCallback(() => {
    setFreeNavQuery('');
    setFreeNavSuggestions([]);
    setFreeNavPickMode(false);
    setFreeNavDest(null);
    setFreeNavRouteCoords([]);
    setFreeNavRouteInfo(null);
  }, []);

  useEffect(() => {
    fetchWalletTransactions(currentUser.id).then(setTransactions).catch(() => {});
  }, [currentUser.id]);

  const toggleOnline = async () => {
    unlockAudioContext();
    setStatusError(null);
    setTogglingOnline(true);
    try {
      const updated = await toggleDriverOnlineStatus(
        currentUser.id,
        !isOnline,
        driverCoords[0],
        driverCoords[1]
      );
      onUserUpdated(updated);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Não foi possível alterar status online.'
      );
    } finally {
      setTogglingOnline(false);
    }
  };

  const nudgeDriverTowardTarget = (targetLat: number, targetLng: number) => {
    let nextLat = driverCoords[0] + (targetLat - driverCoords[0]) * 0.35;
    let nextLng = driverCoords[1] + (targetLng - driverCoords[1]) * 0.35;

    if (routeCoords.length >= 2) {
      let closestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const d = haversineKm(driverCoords[0], driverCoords[1], routeCoords[i][0], routeCoords[i][1]);
        if (d < bestDist) {
          bestDist = d;
          closestIdx = i;
        }
      }
      const stepForward = Math.max(1, Math.ceil((routeCoords.length - 1 - closestIdx) * 0.25));
      const nextIdx = Math.min(routeCoords.length - 1, closestIdx + stepForward);
      nextLat = routeCoords[nextIdx][0];
      nextLng = routeCoords[nextIdx][1];
    }

    const heading =
      ((Math.atan2(nextLng - driverCoords[1], nextLat - driverCoords[0]) * 180) / Math.PI + 360) %
      360;
    setDriverCoords([nextLat, nextLng]);
    setDriverHeading(heading);
    setDriverSpeedKmh(42);
    if (speedDecayRef.current) window.clearTimeout(speedDecayRef.current);
    speedDecayRef.current = window.setTimeout(() => setDriverSpeedKmh(0), 3500);
    onEmitLocation(currentUser.id, nextLat, nextLng, heading);
  };

  const handleAcceptRide = async (rideId: string) => {
    setStatusError(null);
    setActionLoading(true);
    try {
      const updated = await acceptRide(rideId, currentUser.id);
      onRideUpsert(updated);
      void logAuditEvent({
        user: currentUser,
        event_type: 'ride_accept',
        description: `Aceitou ${updated.category} #${updated.id.slice(-5)} (${formatBRL(updated.estimated_fare)})`,
        metadata: { ride_id: updated.id, category: updated.category },
      });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Solicitação indisponível.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclineRide = (rideId: string) => {
    setDeclinedRideIds((prev) => [...prev, rideId]);
  };

  const handleMarkArrived = async () => {
    if (!activeRide) return;
    setActionLoading(true);
    try {
      const updated = await markRideArrived(activeRide.id);
      onRideUpsert(updated);
      void logAuditEvent({
        user: currentUser,
        event_type: 'ride_arrived',
        description: `Chegou ao local de embarque #${updated.id.slice(-5)}`,
        metadata: { ride_id: updated.id },
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePickupWithoutPin = async () => {
    if (!activeRide) return;
    setStatusError(null);
    setActionLoading(true);
    try {
      const updated = await startRideWithPin(activeRide);
      onRideUpsert(updated);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Não foi possível iniciar entrega.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompletedRideOutcome = async (updated: Ride) => {
    justCompletedRideIdRef.current = updated.id;
    onRideUpsert(updated);
    void logAuditEvent({
      user: currentUser,
      event_type: 'ride_completed',
      description: `Concluiu ${updated.category} #${updated.id.slice(-5)} (${formatBRL(updated.final_fare ?? updated.estimated_fare)})`,
      metadata: {
        ride_id: updated.id,
        payment_method: updated.payment_method,
        fare: updated.final_fare ?? updated.estimated_fare,
      },
    });
    if (updated.payment_status === 'paid' || updated.payment_status === 'paid_wallet') {
      setCheckoutRide(null);
      setPixConfirmedSuccess(false);
      setWalletPaidSuccessRide(updated);
      void playRideAcceptedChime();
    } else {
      setPixConfirmedSuccess(false);
      setWalletCheckoutSuccess(false);
      setCheckoutRide(updated);
    }
    await loadFinancePanel();
  };

  const submitPinAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRide || !pinModalMode) return;
    setPinError(null);
    setActionLoading(true);
    try {
      if (pinModalMode === 'pickup') {
        const updated = await startRideWithPin(activeRide, pinInput);
        setPinModalMode(null);
        setPinInput('');
        onRideUpsert(updated);
      } else {
        const totalWithWait = Number(
          (activeRide.estimated_fare + waitingStats.waitingFee).toFixed(2)
        );
        const updated = await completeRide(activeRide, currentUser.id, pinInput, totalWithWait);
        setPinModalMode(null);
        setPinInput('');
        await handleCompletedRideOutcome(updated);
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Código PIN incorreto.');
    } finally {
      setActionLoading(false);
    }
  };

  const completeRideDirect = async () => {
    if (!activeRide) return;
    if (isDeliveryCategory(activeRide.category) && activeRide.require_pin !== false) {
      setPinError(null);
      setPinInput('');
      setPinModalMode('delivery');
      return;
    }
    setActionLoading(true);
    try {
      const totalWithWait = Number(
        (activeRide.estimated_fare + waitingStats.waitingFee).toFixed(2)
      );
      const updated = await completeRide(activeRide, currentUser.id, undefined, totalWithWait);
      await handleCompletedRideOutcome(updated);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Não foi possível concluir a corrida.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmCashPayment = async (targetRide: Ride | null = activeRide) => {
    if (!targetRide) return;
    setActionLoading(true);
    try {
      const updated = await confirmCashReceived(targetRide);
      onRideUpsert(updated);
      if (checkoutRide?.id === updated.id) {
        setCheckoutRide(null);
      }
      await loadFinancePanel();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao confirmar pagamento em dinheiro.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclareCheckoutPix = async (targetRide: Ride | null) => {
    if (!targetRide) return;
    setActionLoading(true);
    try {
      const updated = await declarePixPaid(targetRide);
      onRideUpsert(updated);
      setCheckoutRide(updated);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao enviar aviso Pix ao Admin.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeRide) return;
    setActionLoading(true);
    try {
      const updated = await reportRideUnpaid(disputeRide.id, disputeReason);
      onRideUpsert(updated);
      if (checkoutRide?.id === updated.id) {
        setCheckoutRide(null);
      }
      setDisputeRide(null);
      setDisputeReason('');
    } finally {
      setActionLoading(false);
    }
  };

  const googleMapsUrl = activeRide
    ? buildGoogleMapsDirectionsUrl(
        activeRide.status === 'in_progress'
          ? activeRide.destination_lat
          : activeRide.origin_lat,
        activeRide.status === 'in_progress'
          ? activeRide.destination_lng
          : activeRide.origin_lng
      )
    : '#';

  const currentChatMessages = activeRide ? messagesByRide[activeRide.id] || [] : [];
  const activeIsDelivery = activeRide ? isDeliveryCategory(activeRide.category) : false;

  const currentNavStep = useMemo(() => {
    if (routeSteps.length === 0) return null;
    if (routeSteps.length > 1 && routeSteps[0].distanceMeters < 35) {
      return routeSteps[1];
    }
    return routeSteps[0];
  }, [routeSteps]);

  // Contextual lifecycle voice assistant: trip start, pickup arrival/PIN, 350m reminder & destination arrival
  useEffect(() => {
    if (!activeRide) return;
    const isDel = isDeliveryCategory(activeRide.category);

    if (activeRide.status === 'in_progress') {
      const startKey = `${activeRide.id}:in_progress_announced`;
      if (!spokenMilestonesRef.current.has(startKey)) {
        spokenMilestonesRef.current.add(startKey);
        const approxMin = Math.max(
          2,
          routeDurationMin || Math.round((activeRide.distance_km || 1) * 2.5)
        );
        const kmStr = (routeDistanceKm || activeRide.distance_km || 1)
          .toFixed(1)
          .replace('.', ',');
        announcePrioritySpeech(
          isDel
            ? `Iniciando entrega. Seu trajeto é de mais ou menos ${approxMin} minutos e ${kmStr} quilômetros.`
            : `Iniciando corrida. Seu trajeto é de mais ou menos ${approxMin} minutos e ${kmStr} quilômetros.`
        );
      }
    }
  }, [activeRide, routeDurationMin, routeDistanceKm, announcePrioritySpeech]);

  useEffect(() => {
    if (!activeRide) return;
    const isDel = isDeliveryCategory(activeRide.category);

    if (activeRide.status === 'accepted') {
      const distPickupKm = haversineKm(
        driverCoords[0],
        driverCoords[1],
        activeRide.origin_lat,
        activeRide.origin_lng
      );
      if (distPickupKm <= 0.06 && !autoArrivedRideIdsRef.current.has(activeRide.id)) {
        autoArrivedRideIdsRef.current.add(activeRide.id);
        markRideArrived(activeRide.id)
          .then((updated) => onRideUpsert(updated))
          .catch(() => {});

        if (isDel && activeRide.require_pin !== false) {
          announcePrioritySpeech(
            'Você chegou ao destino de retirada do pedido. Peça ao remetente o código para confirmar a entrega.'
          );
        } else if (!isDel) {
          announcePrioritySpeech(
            'Você chegou ao local de embarque. Peça ao passageiro o código PIN para iniciar a corrida.'
          );
        } else {
          announcePrioritySpeech('Você chegou ao local de retirada do pedido.');
        }
      }
      return;
    }

    if (activeRide.status === 'in_progress') {
      const distDestKm = haversineKm(
        driverCoords[0],
        driverCoords[1],
        activeRide.destination_lat,
        activeRide.destination_lng
      );

      if (
        distDestKm <= 0.35 &&
        !spokenMilestonesRef.current.has(`${activeRide.id}:near_dest`)
      ) {
        spokenMilestonesRef.current.add(`${activeRide.id}:near_dest`);
        if (isDel) {
          announcePrioritySpeech(
            'Você está quase chegando ao destino da entrega. Prepare o pacote para o destinatário.'
          );
        } else if (activeRide.category === 'moto') {
          announcePrioritySpeech(
            'Você está quase chegando ao seu destino. Lembre o passageiro de pegar seus objetos pessoais antes de sair da moto.'
          );
        } else {
          announcePrioritySpeech(
            'Você está quase chegando ao seu destino. Lembre o passageiro de pegar seus objetos pessoais antes de desembarcar do carro.'
          );
        }
      }

      if (
        distDestKm <= 0.06 &&
        !spokenMilestonesRef.current.has(`${activeRide.id}:arrived_dest`)
      ) {
        spokenMilestonesRef.current.add(`${activeRide.id}:arrived_dest`);
        if (isDel && activeRide.require_pin !== false) {
          announcePrioritySpeech(
            'Você chegou ao seu destino. Peça ao solicitante ou destinatário o código de finalização da entrega.'
          );
        } else {
          announcePrioritySpeech('Você chegou ao seu destino.');
        }
      }
    }
  }, [activeRide, driverCoords, onRideUpsert, announcePrioritySpeech]);

  // Spoken Portuguese turn-by-turn guidance when navigation step changes (respecting priority milestone window)
  useEffect(() => {
    if (!activeRide || !currentNavStep) {
      if (!activeRide) lastSpokenStepRef.current = '';
      return;
    }
    const key = `${activeRide.id}:${activeRide.status}:${currentNavStep.instruction}`;
    if (lastSpokenStepRef.current === key) return;
    lastSpokenStepRef.current = key;
    const distLabel =
      currentNavStep.distanceMeters >= 1000
        ? `${(currentNavStep.distanceMeters / 1000).toFixed(1).replace('.', ',')} quilômetros`
        : `${Math.max(20, Math.round(currentNavStep.distanceMeters / 10) * 10)} metros`;
    const shouldInterrupt = Date.now() > prioritySpeechUntilRef.current;
    speakPtBr(`${currentNavStep.instruction} em ${distLabel}.`, shouldInterrupt);
  }, [activeRide, currentNavStep]);

  const formatTimerClock = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatStepMeters = (meters: number) =>
    meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(10, meters)} m`;

  const renderManeuverIcon = (step: RouteStep | null) => {
    if (!step) return <Navigation className="h-7 w-7 text-[#FFD100]" />;
    if (step.maneuverType === 'arrive') return <Flag className="h-7 w-7 text-emerald-400" />;
    if (step.modifier === 'uturn') return <RotateCcw className="h-7 w-7 text-[#FFD100]" />;
    if (step.modifier.includes('left')) return <CornerUpLeft className="h-7 w-7 text-[#FFD100]" />;
    if (step.modifier.includes('right')) return <CornerUpRight className="h-7 w-7 text-[#FFD100]" />;
    return <ArrowUp className="h-7 w-7 text-[#FFD100]" />;
  };

  const { formattedTimer: checkoutPixTimer, cycle: checkoutPixCycle } = usePixSecurityRotation(90);

  // Always compute EMV Pix QR payload for destination checkout (even if ride started as cash)
  const checkoutEmvPayload = useMemo(() => {
    if (!checkoutRide) return '';
    const amount = checkoutRide.final_fare ?? checkoutRide.estimated_fare;
    return buildPixEmvPayload(
      platformConfig.platform_pix_key,
      platformConfig.platform_pix_receiver,
      platformConfig.platform_city,
      amount,
      `${checkoutRide.id}D${checkoutPixCycle}`
    );
  }, [checkoutRide, platformConfig, checkoutPixCycle]);

  const myPay66Key = useMemo(
    () =>
      currentUser.pay66_key ||
      `66-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    [currentUser.pay66_key, currentUser.id]
  );

  const driver66PayQrPayload = useMemo(
    () => buildDriver66PayQrPayload(currentUser),
    [currentUser]
  );

  const openRide66PayReceipt = (ride: Ride) => {
    const fare = Number(ride.final_fare ?? ride.estimated_fare ?? 0);
    setReceiptTx({
      id: ride.id,
      user_id: currentUser.id,
      ride_id: ride.id,
      amount: fare,
      type: 'ride_earning',
      description: `Corrida #${ride.id.slice(-4)} recebida via 66pay`,
      auth_code: `66PAY-${ride.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      sender_name: ride.passenger?.full_name || 'Passageiro 66 Mobilidade',
      recipient_name: currentUser.full_name,
      recipient_key: myPay66Key,
      created_at: ride.completed_at || new Date().toISOString(),
    });
    setReceipt66Ride(ride);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-900">
      <LiveMap
        center={driverCoords}
        isDelivery={
          activeRide?.category === 'delivery_moto' || activeRide?.category === 'delivery_car'
        }
        origin={
          activeRide
            ? {
                lat: activeRide.origin_lat,
                lng: activeRide.origin_lng,
                address: activeRide.origin_address,
              }
            : null
        }
        destination={
          activeRide
            ? {
                lat: activeRide.destination_lat,
                lng: activeRide.destination_lng,
                address: activeRide.destination_address,
              }
            : freeNavDest
        }
        routeCoords={activeRide ? routeCoords : freeNavRouteCoords}
        pickOnMapMode={!activeRide && freeNavPickMode ? 'destination' : null}
        onMapPick={!activeRide ? handleFreeNavMapPick : undefined}
        controlsTopClassName={
          activeRide
            ? 'top-28'
            : idleCleanMap
            ? 'top-1/2 -translate-y-1/2 sm:top-20 sm:translate-y-0'
            : 'top-1/2 -translate-y-1/2 sm:top-20 sm:translate-y-0'
        }
        followVehicle={Boolean(activeRide)}
        enable3dHud={Boolean(activeRide)}
        showSpeedometer={Boolean(activeRide)}
        speedKmh={driverSpeedKmh}
        driverPosition={{
          lat: driverCoords[0],
          lng: driverCoords[1],
          heading: driverHeading,
          vehicleType: currentUser.driver?.vehicle_type || 'car',
          label: 'Você (GPS ativo)',
        }}
        onRecenter={() => {
          getCurrentGpsPosition()
            .then((pos) => {
              if (!pos) return;
              setDriverCoords([pos.lat, pos.lng]);
              setDriverGpsFixed(true);
              setDriverHeading(pos.heading ?? 0);
              setDriverSpeedKmh(pos.speedKmh ?? 0);
              onEmitLocation(currentUser.id, pos.lat, pos.lng, pos.heading ?? 0);
              fetchLocalWeather(pos.lat, pos.lng).then((w) => w && setWeather(w));
            })
            .catch(() => {});
        }}
      />

      {/* NORMAL IDLE TOP BAR — HIDDEN IN IMMERSIVE NAVIGATION OR CLEAN MAP MODE */}
      {!activeRide && !idleCleanMap && (
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] flex items-center justify-between gap-2 px-4 pt-safe py-3">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#181B22] text-white shadow-lg border border-white/10 active:scale-95 transition"
              aria-label="Abrir menu do motorista"
            >
              <Menu className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => {
                void loadNotifications();
                setNotificationsOpen(true);
              }}
              className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[#181B22] text-white shadow-lg border border-white/10 active:scale-95 transition"
              aria-label="Notificações"
            >
              <Bell className="h-5 w-5 text-[#FFD100]" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white shadow">
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              loadFinancePanel();
              setFinanceOpen(true);
            }}
            className="pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full bg-[#181B22] px-4 sm:px-5 text-white shadow-xl border border-white/10 active:scale-95 transition"
          >
            <Wallet className="h-4 w-4 text-[#FFD100]" />
            <span className="font-mono-num text-sm sm:text-base font-extrabold text-white">
              {formatBRL(currentUser.wallet_balance)}
            </span>
          </button>

          <button
            type="button"
            disabled={togglingOnline || currentUser.status !== 'active'}
            onClick={toggleOnline}
            className={`pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full px-4 text-xs font-extrabold shadow-lg transition active:scale-95 disabled:opacity-50 ${
              isOnline ? 'bg-emerald-600 text-white' : 'bg-[#FFD100] text-neutral-950'
            }`}
          >
            <Power className="h-4 w-4" />
            <span className="whitespace-nowrap">{isOnline ? t.online : t.connect}</span>
          </button>
        </div>
      )}

      {/* DISCREET RESTORE BUTTON WHEN CLEAN MAP MODE IS ACTIVE */}
      {!activeRide && idleCleanMap && (
        <div className="pointer-events-none fixed top-0 right-0 z-[600] p-4 pt-safe">
          <button
            type="button"
            onClick={() => setIdleCleanMap(false)}
            className="pointer-events-auto flex min-h-[42px] items-center gap-2 rounded-full bg-[#181B22] px-4 text-xs font-extrabold text-white shadow-xl border border-white/15 active:scale-95"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-[#FFD100]'
              }`}
            />
            <Eye className="h-4 w-4 text-[#FFD100]" />
            <span>{t.show_panel}</span>
          </button>
        </div>
      )}

      {/* COMPACT IMMERSIVE TURN-BY-TURN NAVIGATION BANNER */}
      {activeRide && (
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-[700] px-3 pt-safe py-2">
          <div className="pointer-events-auto mx-auto max-w-xl rounded-2xl bg-[#14171D] px-3.5 py-2.5 text-white shadow-2xl border border-white/15">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1F242E] border border-[#FFD100]/40">
                  {renderManeuverIcon(currentNavStep)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-extrabold text-white truncate">
                    {currentNavStep
                      ? `${currentNavStep.instruction} em ${formatStepMeters(currentNavStep.distanceMeters)}`
                      : `Siga para ${
                          activeRide.status === 'in_progress'
                            ? activeRide.destination_address
                            : activeRide.origin_address
                        }`}
                  </p>
                  <p className="text-[11px] font-bold text-[#FFD100] font-mono-num truncate">
                    {routeDistanceKm} km · {routeDurationMin || 3} min ·{' '}
                    {activeRide.status === 'in_progress'
                      ? 'Destino'
                      : activeIsDelivery
                      ? 'Coleta'
                      : 'Embarque'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = saveUserPreferences({ voice_enabled: !voiceEnabled });
                    setVoiceEnabled(next.voice_enabled);
                    if (!next.voice_enabled) stopSpeech();
                    else speakPtBr('Guia por voz reativado.');
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
                    voiceEnabled
                      ? 'bg-[#FFD100]/20 border-[#FFD100]/40 text-[#FFD100]'
                      : 'bg-white/10 border-white/10 text-neutral-400'
                  }`}
                  title={voiceEnabled ? 'Silenciar voz' : 'Ativar guia por voz'}
                  aria-label="Alternar guia por voz"
                >
                  {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-[11px] font-bold text-[#FFD100]"
                  title="Abrir no Google Maps"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Maps</span>
                </a>
                <button
                  type="button"
                  onClick={() =>
                    nudgeDriverTowardTarget(
                      activeRide.status === 'in_progress'
                        ? activeRide.destination_lat
                        : activeRide.origin_lat,
                      activeRide.status === 'in_progress'
                        ? activeRide.destination_lng
                        : activeRide.origin_lng
                    )
                  }
                  className="flex h-9 items-center rounded-xl bg-[#FFD100] px-2.5 text-[11px] font-extrabold text-neutral-950 active:scale-95"
                  title="Simular avanço GPS na rota"
                >
                  +GPS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM FLOATING DRIVER PANEL (RETRACTABLE DURING ACTIVE RIDE, HIDABLE ON IDLE) */}
      {(!idleCleanMap || activeRide) && (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-2.5 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        {activeRide && sheetMinimized ? (
          <div
            onPointerDown={(e) => {
              dragStartYRef.current = e.clientY;
            }}
            onPointerUp={(e) => {
              if (dragStartYRef.current !== null && dragStartYRef.current - e.clientY > 25) {
                setSheetMinimized(false);
              }
              dragStartYRef.current = null;
            }}
            className="pointer-events-auto flex items-center justify-between gap-2 rounded-2xl bg-[#14171D] px-3.5 py-3 text-white shadow-2xl border border-white/15"
          >
            <button
              type="button"
              onClick={() => setSheetMinimized(false)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFD100]" />
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-white truncate">
                  {activeRide.passenger?.full_name || 'Cliente'} ·{' '}
                  <span className="text-[#FFD100] font-mono-num">
                    {formatBRL(activeRide.estimated_fare + waitingStats.waitingFee)}
                  </span>
                </p>
                <p className="text-[11px] text-neutral-400 truncate">
                  {activeRide.status === 'arrived'
                    ? waitingStats.isCharging
                      ? `Espera +${formatTimerClock(waitingStats.extraSec)}`
                      : `Aguardando (${formatTimerClock(waitingStats.remainingFreeSec)})`
                    : activeRide.status === 'in_progress'
                    ? 'Em rota para o destino'
                    : 'Indo para embarque'}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeRide.passenger?.phone && (
                <a
                  href={`tel:${activeRide.passenger.phone.replace(/\D/g, '')}`}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white active:scale-95"
                  aria-label="Ligar para cliente"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#FFD100] active:scale-95"
                aria-label="Abrir chat"
              >
                <MessageSquare className="h-4 w-4" />
                {currentChatMessages.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FFD100] px-1 text-[9px] font-extrabold text-neutral-950 font-mono-num">
                    {currentChatMessages.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSheetMinimized(false)}
                className="flex h-10 items-center gap-1 rounded-xl bg-[#FFD100] px-3 text-xs font-extrabold text-neutral-950 active:scale-95"
                aria-label="Expandir painel"
              >
                <ChevronUp className="h-4 w-4" />
                <span>Abrir</span>
              </button>
            </div>
          </div>
        ) : (
        <div className="pointer-events-auto rounded-3xl bg-[#14171D] p-5 text-white shadow-2xl border border-white/10 max-h-[76vh] overflow-y-auto">
          {activeRide && (
            <div
              onPointerDown={(e) => {
                dragStartYRef.current = e.clientY;
              }}
              onPointerUp={(e) => {
                if (dragStartYRef.current !== null && e.clientY - dragStartYRef.current > 28) {
                  setSheetMinimized(true);
                }
                dragStartYRef.current = null;
              }}
              className="mb-3 -mt-2 flex items-center justify-between border-b border-white/10 pb-2 touch-none"
            >
              <div className="h-1 w-10 rounded-full bg-white/25" />
              <button
                type="button"
                onClick={() => setSheetMinimized(true)}
                className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-neutral-200 hover:bg-white/15"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Minimizar mapa</span>
              </button>
            </div>
          )}
          {statusError && (
            <div className="mb-3 rounded-2xl bg-red-950/70 border border-red-500/40 px-3.5 py-2.5 text-xs font-semibold text-red-200">
              {statusError}
            </div>
          )}

          {currentUser.status !== 'active' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4">
                {currentUser.status === 'pending' ? (
                  <Clock className="h-6 w-6 shrink-0 text-[#FFD100]" />
                ) : (
                  <AlertTriangle className="h-6 w-6 shrink-0 text-red-400" />
                )}
                <div>
                  <h3 className="font-display text-base font-extrabold text-white">
                    {currentUser.status === 'pending'
                      ? 'Cadastro em análise'
                      : currentUser.status === 'rejected'
                      ? 'Cadastro reprovado'
                      : 'Perfil suspenso'}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-300">
                    {currentUser.status === 'pending'
                      ? 'Seus documentos (CNH e CRLV) estão sendo revisados no Painel Administrativo.'
                      : currentUser.driver?.rejection_reason ||
                        'Entre em contato com a administração para regularizar seus documentos.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={refreshProfile}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-xs font-extrabold text-neutral-950"
              >
                <RefreshCw className="h-4 w-4" />
                Verificar aprovação agora
              </button>
            </div>
          ) : activeRide ? (
            <div className="space-y-3.5">
              {/* Passenger / Client Card with Photo, Rating, Chat & Native Tel Call */}
              <div className="flex items-center justify-between gap-2.5 rounded-2xl bg-white/[0.04] border border-white/10 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AvatarImage
                    src={activeRide.passenger?.avatar_url}
                    name={activeRide.passenger?.full_name || 'Cliente'}
                    className="h-12 w-12 rounded-2xl object-cover border-2 border-[#FFD100]/80 shrink-0 shadow-sm"
                    fallbackClassName="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950 font-extrabold text-lg"
                  />
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#FFD100]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#FFD100]">
                      {activeRide.status === 'accepted' &&
                        (activeIsDelivery
                          ? 'Etapa A · Indo para coleta'
                          : 'Etapa A · Indo buscar cliente')}
                      {activeRide.status === 'arrived' &&
                        (activeIsDelivery
                          ? 'Etapa A · No local de coleta'
                          : 'Etapa A · No local de embarque')}
                      {activeRide.status === 'in_progress' &&
                        (activeIsDelivery
                          ? 'Etapa B · Entrega em rota'
                          : 'Etapa B · Em viagem')}
                    </span>
                    <h3 className="mt-0.5 font-display text-base font-extrabold text-white truncate">
                      {activeRide.passenger?.full_name || 'Cliente'}
                    </h3>
                    <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                      <Star className="h-3 w-3 fill-[#FFD100] text-[#FFD100]" />
                      <span className="font-mono-num font-bold text-neutral-200">
                        {(activeRide.passenger?.rating_avg ?? 5).toFixed(2)}
                      </span>
                      <span>· {CATEGORY_LABELS[activeRide.category]}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {activeRide.passenger?.phone && (
                    <a
                      href={`tel:${activeRide.passenger.phone.replace(/\D/g, '')}`}
                      className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white active:scale-95 transition shadow-sm"
                      aria-label="Ligar para o cliente"
                      title="Ligar para o cliente"
                    >
                      <Phone className="h-5 w-5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setChatOpen(true)}
                    className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#FFD100] active:scale-95 transition border border-white/10"
                    aria-label="Abrir chat com cliente"
                    title={t.any_note_chat}
                  >
                    <MessageSquare className="h-5 w-5" />
                    {currentChatMessages.length > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FFD100] px-1 text-[10px] font-extrabold text-neutral-950 font-mono-num">
                        {currentChatMessages.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* 2-MINUTE WAITING TIMER PANEL (ETAPA A -> ARRIVED) */}
              {activeRide.status === 'arrived' && (
                <div
                  className={`rounded-2xl border p-3.5 transition-colors ${
                    waitingStats.isCharging
                      ? 'border-red-500/60 bg-red-950/60 text-red-100'
                      : 'border-[#FFD100]/40 bg-[#1D212B] text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock
                        className={`h-5 w-5 shrink-0 ${
                          waitingStats.isCharging ? 'text-red-400 animate-pulse' : 'text-[#FFD100]'
                        }`}
                      />
                      <div>
                        <p className="text-xs font-extrabold">
                          {waitingStats.isCharging
                            ? 'Taxa de espera em cobrança!'
                            : 'Temporizador de espera (2 min grátis)'}
                        </p>
                        <p className="text-[11px] opacity-80">
                          {waitingStats.isCharging
                            ? `Tempo extra: +${formatTimerClock(waitingStats.extraSec)} (+${formatBRL(waitingStats.waitingFee)})`
                            : 'Após 02:00 a taxa de espera é iniciada (+R$ 0,50/min)'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-mono-num text-xl font-extrabold shrink-0 ${
                        waitingStats.isCharging ? 'text-red-300' : 'text-[#FFD100]'
                      }`}
                    >
                      {waitingStats.isCharging
                        ? `+${formatTimerClock(waitingStats.extraSec)}`
                        : formatTimerClock(waitingStats.remainingFreeSec)}
                    </span>
                  </div>
                  {!waitingStats.isCharging && (
                    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-[#FFD100] transition-all duration-500"
                        style={{
                          width: `${Math.max(0, Math.min(100, (waitingStats.remainingFreeSec / 120) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Current Target Address & Value */}
              <div className="rounded-2xl bg-[#1A1F29] p-3.5 text-xs space-y-2 border border-white/10">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="inline-flex items-center gap-1.5 font-bold text-neutral-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {activeRide.payment_method === 'wallet'
                      ? t.pay_with_wallet
                      : activeRide.payment_method === 'pix'
                      ? t.pay_with_pix
                      : t.pay_with_cash}
                  </span>
                  <span className="font-mono-num text-base font-extrabold text-[#FFD100]">
                    {formatBRL(activeRide.estimated_fare + waitingStats.waitingFee)}
                    {waitingStats.waitingFee > 0 && (
                      <span className="ml-1 text-[10px] text-amber-300">
                        (+{formatBRL(waitingStats.waitingFee)} esp.)
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-neutral-300">
                  <strong className="text-white">
                    {activeIsDelivery ? 'Coleta:' : 'Embarque:'}
                  </strong>{' '}
                  {activeRide.origin_address}
                </p>
                <p className="text-neutral-300">
                  <strong className="text-white">Destino:</strong> {activeRide.destination_address}
                </p>
                {activeRide.delivery_notes && (
                  <p className="text-[#FFD100] font-semibold">
                    Obs. pacote: {activeRide.delivery_notes}
                  </p>
                )}
              </div>

              {/* ETAPA A / B / C ACTION CONTROLS */}
              {activeRide.status === 'accepted' && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleMarkArrived}
                  className="min-h-[54px] w-full rounded-2xl bg-[#FFD100] px-4 text-sm font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
                >
                  {activeIsDelivery ? t.arrived_collection : t.arrived_pickup}
                </button>
              )}

              {activeRide.status === 'arrived' && (
                <SlideToConfirm
                  label={
                    activeIsDelivery
                      ? activeRide.require_pin === false
                        ? 'Arraste para confirmar coleta (Sem PIN)'
                        : 'Arraste para coletar (PIN 4 dígitos)'
                      : 'Arraste para embarcar (PIN 4 dígitos)'
                  }
                  disabled={actionLoading}
                  onConfirm={() => {
                    if (activeIsDelivery && activeRide.require_pin === false) {
                      void handlePickupWithoutPin();
                    } else {
                      setPinError(null);
                      setPinInput('');
                      setPinModalMode('pickup');
                    }
                  }}
                />
              )}

              {activeRide.status === 'in_progress' && (
                <SlideToConfirm
                  variant="emerald"
                  label={
                    activeIsDelivery
                      ? activeRide.require_pin !== false
                        ? 'Arraste para finalizar entrega (PIN 4 dígitos)'
                        : 'Arraste para finalizar entrega'
                      : 'Arraste para finalizar corrida no destino'
                  }
                  disabled={actionLoading}
                  onConfirm={completeRideDirect}
                />
              )}

              {activeRide.payment_status !== 'disputed' && (
                <button
                  type="button"
                  onClick={() => {
                    setDisputeRide(activeRide);
                    setDisputeReason('');
                  }}
                  className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/40 text-xs font-bold text-red-300 hover:bg-red-950/60"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Relatar problema no pagamento
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3.5 w-3.5 text-[#FFD100] shrink-0" />
                  {driverGpsFixed
                    ? weather?.city || platformConfig.platform_city
                    : t.detecting_gps}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {weather && driverGpsFixed && (
                    <span className="flex items-center gap-1 font-mono-num font-bold text-[#FFD100]">
                      <Thermometer className="h-3.5 w-3.5" />
                      {weather.temperatureC}°C · {weather.label}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIdleCleanMap(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-neutral-200 hover:bg-white/15"
                    title="Ocultar painel e ver mapa 100% livre"
                  >
                    <EyeOff className="h-3 w-3" />
                    {t.clean_map}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-base font-extrabold text-white">
                    {isOnline ? `${t.online}!` : t.offline}
                  </h3>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {isOnline ? t.waiting_rides_region : t.tap_connect_hint}
                  </p>
                  <p className="mt-1.5 text-xs font-bold text-neutral-300 font-mono-num">
                    {currentUser.driver?.vehicle_model} · {currentUser.driver?.vehicle_plate}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleOnline}
                  disabled={togglingOnline}
                  className={`min-h-[48px] shrink-0 rounded-2xl px-5 text-sm font-extrabold shadow-sm transition active:scale-95 ${
                    isOnline
                      ? 'bg-white/10 text-white border border-white/15'
                      : 'bg-[#FFD100] text-neutral-950'
                  }`}
                >
                  {isOnline ? t.pause : t.connect}
                </button>
              </div>

              {relevantEvents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEventsOpen(true)}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-[#FFD100]/40 bg-[#FFD100]/10 px-3.5 py-2 text-left"
                >
                  <span className="flex items-center gap-2 text-xs font-extrabold text-[#FFD100] truncate">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    Evento ativo: {relevantEvents[0].title}
                    {relevantEvents[0].bonus_amount > 0 &&
                      ` (+${formatBRL(relevantEvents[0].bonus_amount)})`}
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#FFD100] shrink-0" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  loadFinancePanel();
                  setFinanceOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl bg-[#1D212B] px-4 py-2.5 border border-white/5 hover:border-[#FFD100]/40 transition"
              >
                <div className="flex items-center gap-2.5 text-left">
                  <Wallet className="h-4 w-4 text-[#FFD100] shrink-0" />
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      {t.earnings_center}
                    </p>
                    <p className="text-[11px] text-neutral-400 font-mono-num">
                      {t.wallet_balance}: {formatBRL(financeSummary.pendingToReceive)} · {t.pay_with_cash}:{' '}
                      {formatBRL(financeSummary.totalCashCollected)}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => openDriverWallet('withdraw')}
                  className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 text-xs font-extrabold text-emerald-300 hover:bg-emerald-500/25 active:scale-[0.98] transition"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span>{t.withdraw}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openDriverWallet('transfer')}
                  className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-white/10 border border-white/10 px-3 text-xs font-extrabold text-white hover:bg-white/15 active:scale-[0.98] transition"
                >
                  <ChevronRight className="h-3.5 w-3.5 text-[#FFD100]" />
                  <span>{t.transfer}</span>
                </button>
              </div>

              {/* Navegação Livre no Mapa (Disponível somente fora de corrida ativa) */}
              <div className="rounded-2xl border border-white/10 bg-[#1A1D24] p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setFreeNavOpen((v) => !v)}
                    className="flex items-center gap-2 text-left text-xs font-extrabold text-white"
                  >
                    <Navigation className="h-4 w-4 text-[#FFD100]" />
                    <span>Navegação Livre (Sem corrida)</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    {freeNavDest && (
                      <button
                        type="button"
                        onClick={clearFreeNav}
                        className="rounded-lg bg-red-500/15 px-2 py-1 text-[10px] font-bold text-red-300"
                      >
                        Limpar rota
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFreeNavOpen((v) => !v)}
                      className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-[#FFD100]"
                    >
                      {freeNavOpen ? 'Ocultar' : 'Buscar endereço'}
                    </button>
                  </div>
                </div>

                {freeNavOpen && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="text"
                          value={freeNavQuery}
                          onChange={(e) => setFreeNavQuery(e.target.value)}
                          placeholder="Buscar rua, bairro ou ponto de apoio..."
                          className="min-h-[40px] w-full rounded-xl border border-white/10 bg-[#11141B] pl-8 pr-3 text-xs font-semibold text-white outline-none focus:border-[#FFD100]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setFreeNavPickMode((v) => !v)}
                        className={`min-h-[40px] shrink-0 rounded-xl px-2.5 text-[11px] font-extrabold transition ${
                          freeNavPickMode
                            ? 'bg-[#FFD100] text-neutral-950'
                            : 'bg-white/10 text-neutral-200 border border-white/10'
                        }`}
                        title="Toque no mapa para definir destino"
                      >
                        {freeNavPickMode ? 'Toque no mapa...' : 'No mapa'}
                      </button>
                    </div>

                    {freeNavSearching && (
                      <p className="text-[11px] text-neutral-400">Buscando endereços...</p>
                    )}

                    {freeNavSuggestions.length > 0 && (
                      <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-[#11141B] divide-y divide-white/5">
                        {freeNavSuggestions.map((s, idx) => (
                          <button
                            key={`${s.lat}-${s.lng}-${idx}`}
                            type="button"
                            onClick={() => {
                              void selectFreeNavDestination({
                                lat: s.lat,
                                lng: s.lng,
                                address: s.address,
                              });
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/5"
                          >
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFD100]" />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-white">
                                {s.address}
                              </span>
                              {s.subtitle && (
                                <span className="block truncate text-[10px] text-neutral-400">
                                  {s.subtitle}
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {freeNavDest && freeNavRouteInfo && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-[11px]">
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">{freeNavDest.address}</p>
                      <p className="font-mono-num text-[#FFD100] font-bold">
                        {freeNavRouteInfo.distanceKm} km · ~{freeNavRouteInfo.durationMin} min
                      </p>
                    </div>
                    <a
                      href={buildGoogleMapsDirectionsUrl(freeNavDest.lat, freeNavDest.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Maps
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* POP-UP MODERNO DE ACEITAÇÃO DE CORRIDA (TELA BRANCA COM AMARELO E BOTÕES REDONDOS) */}
      {incomingRide && (
        <div className="fixed inset-0 z-[1200] flex flex-col justify-between bg-white p-5 pt-safe pb-safe text-neutral-950 overflow-y-auto">
          <div className="mx-auto w-full max-w-md space-y-4">
            {/* Top Status Pill Bar */}
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#FFD100] px-3.5 py-1.5 shadow-xs">
                <span className="flex h-2.5 w-2.5 rounded-full bg-neutral-950 animate-ping" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-neutral-950">
                  {isDeliveryCategory(incomingRide.category)
                    ? `Nova ${CATEGORY_LABELS[incomingRide.category]}`
                    : incomingRide.category === 'negocia'
                    ? 'Oferta Negocia'
                    : `Nova Chamada · ${CATEGORY_LABELS[incomingRide.category]}`}
                </span>
              </div>
              <span className="font-mono-num rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-extrabold text-neutral-900 border border-neutral-200">
                {incomingRide.distance_km} km · ~{Math.max(3, Math.round(incomingRide.distance_km * 2.2))} min
              </span>
            </div>

            {/* Client Photo, Name, Verified Account & Rating Hero Card */}
            <div className="flex items-center gap-4 rounded-3xl bg-neutral-50 p-4 border-2 border-[#FFD100] shadow-sm">
              <AvatarImage
                src={incomingRide.passenger?.avatar_url}
                name={incomingRide.passenger?.full_name || 'Passageiro'}
                className="h-16 w-16 rounded-full object-cover border-4 border-[#FFD100] shadow-md shrink-0"
                fallbackClassName="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#FFD100] border-2 border-neutral-950 text-neutral-950 font-extrabold text-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                    {isDeliveryCategory(incomingRide.category) ? 'Solicitante da Entrega' : 'Passageiro'}
                  </p>
                  {incomingRide.passenger?.status === 'active' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                      <ShieldCheck className="h-3 w-3" />
                      Conta Verificada
                    </span>
                  )}
                </div>
                <h2 className="truncate font-display text-xl font-extrabold text-neutral-950">
                  {incomingRide.passenger?.full_name || 'Cliente 66 Mobilidade'}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FFD100]/45 px-2.5 py-0.5 text-xs font-extrabold text-neutral-950">
                    ★ {(incomingRide.passenger?.rating_avg ?? 5).toFixed(1)}
                    <span className="text-[10px] font-bold text-neutral-700">
                      ({incomingRide.passenger?.rating_count || 1} aval.)
                    </span>
                  </span>
                  <span className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-neutral-800 border border-neutral-200">
                    {incomingRide.payment_method === 'wallet'
                      ? '66pay · Saldo Reservado'
                      : incomingRide.payment_method === 'pix'
                      ? 'Pix Plataforma'
                      : 'Dinheiro ao Motorista'}
                  </span>
                  {Boolean(incomingRide.discount_amount && incomingRide.discount_amount > 0) && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                      Cupom aplicado
                    </span>
                  )}
                  {Boolean(incomingRide.pending_debt_included && incomingRide.pending_debt_included > 0) && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                      +Pendência {formatBRL(incomingRide.pending_debt_included || 0)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Highlighted Yellow Fare Card */}
            <div className="rounded-3xl bg-[#FFD100] p-5 text-center shadow-lg border-2 border-neutral-950/10">
              <p className="text-xs font-extrabold uppercase tracking-wider text-neutral-900">
                Valor da Corrida
              </p>
              <p className="mt-1 font-display text-5xl font-extrabold text-neutral-950 font-mono-num tracking-tight">
                {formatBRL(incomingRide.estimated_fare)}
              </p>
              <p className="mt-1.5 text-xs font-bold text-neutral-900">
                {incomingRide.distance_km} km de trajeto estimado
              </p>
            </div>

            {/* Clean White Route Details Card */}
            <div className="space-y-3 rounded-3xl bg-neutral-50 p-4 text-sm border border-neutral-200 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 mt-0.5">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                    {isDeliveryCategory(incomingRide.category) ? 'Local de Coleta' : 'Partida / Embarque'}
                  </span>
                  <span className="font-bold text-neutral-950 leading-snug block">
                    {incomingRide.origin_address}
                  </span>
                </div>
              </div>
              <div className="border-t border-neutral-200 pt-3 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 mt-0.5">
                  <Navigation className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                    Destino Final
                  </span>
                  <span className="font-bold text-neutral-950 leading-snug block">
                    {incomingRide.destination_address}
                  </span>
                </div>
              </div>
              {incomingRide.delivery_notes && (
                <p className="border-t border-neutral-200 pt-2.5 text-xs text-neutral-900 font-bold bg-[#FFD100]/25 rounded-2xl px-3 py-2">
                  Obs.: {incomingRide.delivery_notes}
                </p>
              )}
            </div>
          </div>

          {/* Round / Pill-Shaped Action Buttons */}
          <div className="mx-auto w-full max-w-md grid grid-cols-3 gap-3 pt-4">
            <button
              type="button"
              onClick={() => handleDeclineRide(incomingRide.id)}
              className="min-h-[60px] rounded-full border-2 border-neutral-300 bg-neutral-100 text-sm font-extrabold text-neutral-800 hover:bg-neutral-200 active:scale-95 transition shadow-xs"
            >
              {t.decline_ride}
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleAcceptRide(incomingRide.id)}
              className="col-span-2 min-h-[60px] rounded-full bg-[#FFD100] border-2 border-neutral-950 text-lg font-extrabold text-neutral-950 shadow-xl hover:brightness-95 active:scale-95 transition"
            >
              {actionLoading ? '...' : t.accept_ride}
            </button>
          </div>
        </div>
      )}

      {/* ETAPA C: DESTINATION CHECKOUT WITH 66PAY QR, ADMIN PIX QR & CONFIRMATION + RECEIPT */}
      {checkoutRide && (() => {
        if (pixConfirmedSuccess) {
          return (
            <div className="fixed inset-0 z-[1180] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
              <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 text-center shadow-2xl space-y-4 border border-emerald-200 dark:border-emerald-800">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {walletCheckoutSuccess
                      ? 'Pagamento 66pay Confirmado'
                      : t.checkout_pix_confirmed_admin}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-extrabold text-neutral-950 dark:text-white">
                    {t.checkout_payment_success}
                  </h3>
                  <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    {walletCheckoutSuccess
                      ? 'Transferência interna 66pay recebida do passageiro. O valor de '
                      : 'O valor de '}
                    <strong className="font-mono-num text-neutral-950 dark:text-[#FFD100]">
                      {formatBRL(checkoutRide.final_fare ?? checkoutRide.estimated_fare)}
                    </strong>{' '}
                    já foi creditado no seu saldo 66pay.
                  </p>
                </div>
                <div className="space-y-2">
                  {walletCheckoutSuccess && (
                    <button
                      type="button"
                      onClick={() => openRide66PayReceipt(checkoutRide)}
                      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98]"
                    >
                      <Receipt className="h-4 w-4" />
                      Gerar Comprovante 66pay
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (pixSuccessTimerRef.current) {
                        window.clearTimeout(pixSuccessTimerRef.current);
                      }
                      setCheckoutRide(null);
                      setPixConfirmedSuccess(false);
                      setWalletCheckoutSuccess(false);
                    }}
                    className="min-h-[48px] w-full rounded-2xl bg-emerald-600 text-sm font-extrabold text-white shadow-sm active:scale-[0.98]"
                  >
                    {t.continue_btn}
                  </button>
                </div>
              </div>
            </div>
          );
        }

        const isWalletQrCheckout =
          checkoutRide.payment_method === 'wallet' &&
          checkoutRide.payment_status === 'pending';

        const waitingAdminPix =
          !isWalletQrCheckout &&
          (checkoutRide.payment_method === 'pix' || Boolean(checkoutRide.pix_declared_at)) &&
          checkoutRide.payment_status === 'pending';

        return (
          <div className="fixed inset-0 z-[1180] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#14171D] p-5 text-neutral-950 dark:text-white shadow-2xl border border-neutral-200 dark:border-white/15 space-y-3.5 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-white/10 pb-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {isWalletQrCheckout
                      ? 'Etapa C · Recebimento 66pay'
                      : 'Etapa C · Pix / Pagamento'}
                  </p>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                    {isWalletQrCheckout
                      ? 'Receber Corrida via 66pay'
                      : waitingAdminPix
                      ? t.checkout_pix_waiting_title
                      : t.checkout_payment_title}
                  </h3>
                </div>
                {!waitingAdminPix && !isWalletQrCheckout && (
                  <button
                    type="button"
                    onClick={() => setCheckoutRide(null)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-white"
                    aria-label={t.close}
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              <div className="rounded-2xl bg-neutral-50 dark:bg-[#1D212B] p-4 text-center border border-neutral-200 dark:border-white/10">
                <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                  {checkoutRide.passenger?.full_name || t.passenger_role_badge}
                </p>
                <p className="mt-1 font-display text-4xl font-extrabold text-neutral-950 dark:text-[#FFD100] font-mono-num">
                  {formatBRL(checkoutRide.final_fare ?? checkoutRide.estimated_fare)}
                </p>
                {(checkoutRide.final_fare ?? checkoutRide.estimated_fare) >
                  checkoutRide.estimated_fare && (
                  <p className="mt-1 text-[11px] font-bold text-amber-600 dark:text-amber-300">
                    Inclui taxa de espera após 2 minutos gratuitos
                  </p>
                )}
                {Boolean(
                  checkoutRide.pending_debt_included && checkoutRide.pending_debt_included > 0
                ) && (
                  <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    Inclui débito anterior quitado: {formatBRL(checkoutRide.pending_debt_included || 0)}
                  </p>
                )}
              </div>

              {isWalletQrCheckout ? (
                <div className="rounded-2xl bg-[#11141B] text-white p-4 border border-[#FFD100]/40 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#FFD100]">
                      <KeyRound className="h-4 w-4" />
                      QR Code Exclusivo 66pay (Motorista)
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(myPay66Key);
                        setCopied66PayKey(true);
                        setTimeout(() => setCopied66PayKey(false), 2000);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1 text-[11px] font-extrabold text-neutral-950"
                    >
                      {copied66PayKey ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied66PayKey ? 'Copiada!' : 'Copiar Chave'}
                    </button>
                  </div>

                  <p className="text-xs text-neutral-200 leading-relaxed">
                    Mostre este QR Code ao passageiro para concluir a transferência interna 66pay
                    (saldo já reservado na corrida).
                  </p>

                  <div className="flex flex-col sm:flex-row items-center gap-3.5">
                    <div className="rounded-2xl bg-white p-2.5 shrink-0 shadow-sm">
                      <PixQrSvg payload={driver66PayQrPayload} size={144} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                          Sua Chave 66pay
                        </p>
                        <p className="font-mono-num text-sm font-extrabold text-[#FFD100] select-all">
                          {myPay66Key}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] font-bold text-amber-200 flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0 text-[#FFD100] animate-pulse" />
                        <span>Aguardando passageiro escanear QR Code 66pay...</span>
                      </div>
                      <p className="text-[10px] text-neutral-400">
                        Transferência interna 66pay (não é Pix bancário)
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {waitingAdminPix && (
                    <div className="rounded-2xl border border-amber-300 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-950/60 px-3.5 py-3 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                      <Clock className="h-5 w-5 shrink-0 text-amber-600 dark:text-[#FFD100] animate-pulse mt-0.5" />
                      <div>
                        <p className="text-neutral-950 dark:text-white font-extrabold">
                          {t.checkout_waiting_admin_headline}
                        </p>
                        <p className="mt-0.5 font-normal text-amber-800 dark:text-amber-100/80">
                          {t.checkout_waiting_admin_desc}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ALWAYS SHOW ADMIN PIX QR CODE (FOR PIX RIDES OR UNFORESEEN SWITCH FROM CASH) */}
                  <div className="rounded-2xl bg-neutral-50 dark:bg-[#1D212B] p-4 border border-neutral-200 dark:border-white/10 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold text-neutral-900 dark:text-[#FFD100]">
                        {checkoutRide.payment_method === 'cash'
                          ? t.checkout_qr_cash_option
                          : `${t.checkout_qr_admin_platform} · ${platformConfig.platform_pix_receiver}`}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(checkoutEmvPayload);
                          setCopiedCheckoutPix(true);
                          setTimeout(() => setCopiedCheckoutPix(false), 2000);
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-950 dark:bg-[#FFD100] px-2.5 py-1 text-[11px] font-extrabold text-[#FFD100] dark:text-neutral-950"
                      >
                        {copiedCheckoutPix ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedCheckoutPix ? t.checkout_copied_pix : t.checkout_copy_pix}
                      </button>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3.5">
                      <div
                        key={checkoutPixCycle}
                        className="rounded-2xl bg-white p-2.5 border border-neutral-200 dark:border-transparent shrink-0 shadow-xs"
                      >
                        {platformConfig.platform_pix_qr_url ? (
                          <img
                            src={platformConfig.platform_pix_qr_url}
                            alt={t.checkout_qr_admin_platform}
                            className="h-32 w-32 sm:h-36 sm:w-36 object-contain rounded-lg"
                          />
                        ) : (
                          <PixQrSvg payload={checkoutEmvPayload} size={132} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5 text-center sm:text-left">
                        <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                          Atualiza em <span className="font-mono-num">{checkoutPixTimer}</span> · Conta Admin
                        </p>
                        <p className="text-[11px] font-bold text-neutral-600 dark:text-neutral-300">
                          {platformConfig.platform_pix_receiver}
                        </p>
                        <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400">
                          Chave:{' '}
                          <span className="text-neutral-950 dark:text-white font-mono-num">
                            {platformConfig.platform_pix_key}
                          </span>
                        </p>
                        <p className="font-mono-num text-[10px] text-neutral-600 dark:text-neutral-300 break-all line-clamp-3 select-all">
                          {checkoutEmvPayload}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                {checkoutRide.payment_method === 'cash' && !checkoutRide.pix_declared_at && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleDeclareCheckoutPix(checkoutRide)}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-xs font-extrabold text-neutral-950 active:scale-[0.98]"
                  >
                    <QrCode className="h-4 w-4" />
                    {t.checkout_pix_sent_btn}
                  </button>
                )}

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleConfirmCashPayment(checkoutRide)}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-extrabold text-neutral-950 active:scale-[0.98]"
                >
                  <Banknote className="h-5 w-5" />
                  {actionLoading
                    ? t.saving
                    : `${t.checkout_cash_received_prefix} ${formatBRL(
                        checkoutRide.final_fare ?? checkoutRide.estimated_fare
                      )}`}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDisputeRide(checkoutRide);
                    setDisputeReason('');
                  }}
                  className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-red-500/40 bg-red-950/40 text-xs font-bold text-red-600 dark:text-red-300"
                >
                  <ShieldAlert className="h-4 w-4" />
                  {t.checkout_report_unpaid}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Instant Celebratory Modal for Rides/Deliveries Paid with 66pay */}
      {walletPaidSuccessRide && (
        <div className="fixed inset-0 z-[1185] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 text-center shadow-2xl space-y-4 border border-emerald-200 dark:border-emerald-800">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Pagamento 66pay Confirmado
              </p>
              <h3 className="mt-1 font-display text-xl font-extrabold text-neutral-950 dark:text-white">
                Valor creditado no seu saldo!
              </h3>
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                O valor de{' '}
                <strong className="font-mono-num text-neutral-950 dark:text-[#FFD100]">
                  {formatBRL(
                    walletPaidSuccessRide.final_fare ?? walletPaidSuccessRide.estimated_fare
                  )}
                </strong>{' '}
                já foi adicionado automaticamente ao seu saldo 66pay.
              </p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => openRide66PayReceipt(walletPaidSuccessRide)}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98]"
              >
                <Receipt className="h-4 w-4" />
                Gerar Comprovante 66pay
              </button>
              <button
                type="button"
                onClick={() => {
                  if (walletSuccessTimerRef.current) {
                    window.clearTimeout(walletSuccessTimerRef.current);
                  }
                  setWalletPaidSuccessRide(null);
                }}
                className="min-h-[48px] w-full rounded-2xl bg-emerald-600 text-sm font-extrabold text-white shadow-sm active:scale-[0.98]"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modern 4-Digit Interactive PIN Modal (Pickup Boarding or Delivery Completion) */}
      {pinModalMode && activeRide && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-xs">
          <form
            onSubmit={submitPinAction}
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#14171D] border border-neutral-200 dark:border-white/15 p-6 shadow-2xl text-center space-y-4"
          >
            <div className="relative flex items-center justify-center min-h-[40px]">
              <div className="flex flex-col items-center">
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white px-7">
                  {pinModalMode === 'delivery'
                    ? t.enter_pin_delivery_title
                    : t.enter_pin_title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPinModalMode(null)}
                className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-white"
                aria-label={t.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
              {pinModalMode === 'delivery'
                ? 'Peça o código PIN de 4 dígitos ao destinatário para concluir a entrega com segurança.'
                : `Peça os 4 dígitos exibidos no celular de ${
                    activeRide.passenger?.full_name || 'cliente'
                  } para liberar a partida.`}
            </p>

            {pinError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300">
                {pinError}
              </div>
            )}

            {/* Interactive 4-slot OTP PIN Boxes */}
            <div
              onClick={() => pinHiddenInputRef.current?.focus()}
              className="relative mx-auto flex max-w-[260px] cursor-text items-center justify-center gap-3 py-1"
            >
              <input
                ref={pinHiddenInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={4}
                required
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="absolute inset-0 h-full w-full opacity-0 cursor-text"
                aria-label="Código PIN de 4 dígitos"
              />
              {[0, 1, 2, 3].map((slotIdx) => {
                const digit = pinInput[slotIdx] || '';
                const isActiveSlot = pinInput.length === slotIdx || (pinInput.length === 4 && slotIdx === 3);
                return (
                  <div
                    key={slotIdx}
                    className={`flex h-16 w-14 items-center justify-center rounded-2xl border-2 font-mono-num text-2xl font-extrabold transition ${
                      digit
                        ? 'border-neutral-950 dark:border-[#FFD100] bg-neutral-50 dark:bg-[#1D212B] text-neutral-950 dark:text-[#FFD100] shadow-xs'
                        : isActiveSlot
                        ? 'border-[#FFD100] bg-[#FFD100]/10 text-neutral-400 ring-2 ring-[#FFD100]/30'
                        : 'border-neutral-200 dark:border-white/15 bg-neutral-100/70 dark:bg-white/5 text-neutral-400'
                    }`}
                  >
                    {digit || '•'}
                  </div>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={pinInput.length !== 4 || actionLoading}
              className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm disabled:opacity-40 active:scale-[0.98] transition"
            >
              {actionLoading ? '...' : t.validate_pin_btn}
            </button>
          </form>
        </div>
      )}

      {/* Non-Payment Dispute Modal */}
      {disputeRide && (
        <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={submitDispute}
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                Relatar não pagamento
              </h3>
              <button
                type="button"
                onClick={() => setDisputeRide(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Ao relatar um problema de pagamento, a corrida #{disputeRide.id.slice(-4)} (
              {formatBRL(disputeRide.final_fare ?? disputeRide.estimated_fare)}) é enviada ao Super
              Admin para auditoria e quitação.
            </p>
            <textarea
              rows={3}
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Descreva o ocorrido (ex: passageiro desembarcou sem pagar)"
              className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
            />
            <button
              type="submit"
              disabled={actionLoading}
              className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-red-600 text-sm font-extrabold text-white"
            >
              {actionLoading ? 'Enviando...' : 'Enviar Disputa ao Super Admin'}
            </button>
          </form>
        </div>
      )}

      {/* Dark Graphite Driver Drawer (99 Motorista Reference Style) */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/70">
          <div className="flex h-full w-80 max-w-[85vw] flex-col bg-[#0F1115] p-6 text-white shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
                className="flex items-center gap-3 text-left"
              >
                <AvatarImage
                  src={currentUser.avatar_url}
                  name={currentUser.full_name}
                  className="h-12 w-12 rounded-full object-cover border-2 border-[#FFD100] shrink-0"
                  fallbackClassName="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold text-lg shrink-0"
                />
                <div>
                  <h3 className="font-display text-base font-extrabold text-white">
                    {currentUser.full_name}
                  </h3>
                  <p className="text-xs font-semibold text-neutral-300 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#FFD100] text-[#FFD100]" />
                    <span className="font-mono-num">{currentUser.rating_avg.toFixed(2)}</span>
                    <span>· {completedRides.length} viagens</span>
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {weather && (
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#1A1D24] px-3.5 py-2.5 text-xs border border-white/5">
                <span className="text-neutral-300 truncate pr-2">{weather.city}</span>
                <span className="font-mono-num font-bold text-[#FFD100] shrink-0">
                  {weather.temperatureC}°C · {weather.label}
                </span>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-[#1A1D24] p-4 border border-white/5 text-center">
              <div>
                <p className="text-[11px] text-neutral-400">Taxa de Aceitação</p>
                <p className="mt-1 font-mono-num text-lg font-extrabold text-white">
                  {currentUser.driver?.acceptance_rate ?? 100}%
                </p>
              </div>
              <div>
                <p className="text-[11px] text-neutral-400">Taxa de Finalização</p>
                <p className="mt-1 font-mono-num text-lg font-extrabold text-white">
                  {currentUser.driver?.completion_rate ?? 100}%
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-1 flex-1">
              <button
                type="button"
                onClick={() => {
                  openDriverWallet('withdraw');
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-3 text-sm font-extrabold text-emerald-300 hover:bg-emerald-500/20"
              >
                <span className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-emerald-400" />
                  <span>{t.wallet_title} · {t.withdraw} / {t.transfer}</span>
                </span>
                <span className="font-mono-num text-xs font-extrabold text-white">
                  {formatBRL(currentUser.wallet_balance || 0)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  loadFinancePanel();
                  setFinanceOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-[#FFD100]" />
                  {t.earnings_center}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setEventsOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-[#FFD100]" />
                  Eventos & Bônus ({relevantEvents.length})
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <button
                type="button"
                onClick={() => {
                  void loadNotifications();
                  setNotificationsOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-[#FFD100]" />
                  Notificações
                </span>
                {unreadNotificationsCount > 0 ? (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                    {unreadNotificationsCount}
                  </span>
                ) : (
                  <ChevronRight className="h-4 w-4 text-neutral-500" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setHistoryOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <History className="h-5 w-5 text-neutral-400" />
                  {t.ride_history} ({myDriverRides.length})
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSupportChatOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Headphones className="h-5 w-5 text-sky-400" />
                  {t.support_admin}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Settings className="h-5 w-5 text-neutral-400" />
                  {t.settings_title}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <div className="flex items-center gap-3 px-3 py-2 text-xs text-neutral-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{platformConfig.platform_city} · RLS & PIN ativos</span>
              </div>

              <div className="pt-2">
                <PWAInstallButton
                  variant="menu"
                  apkUrl={platformConfig.ota_apk_url}
                  siteName={platformConfig.site_name || '66 Mobilidade'}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-bold text-white hover:bg-white/15"
            >
              <LogOut className="h-4 w-4" />
              {t.logout}
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* FULL DRIVER PAYMENT & EARNINGS MANAGEMENT PANEL WITH DIA/SEMANA/MÊS/GERAL BREAKDOWN */}
      {financeOpen && (
        <div className="fixed inset-0 z-[1050] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4">
          <div className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl bg-[#0F1115] text-white p-6 shadow-2xl max-h-[92vh] flex flex-col border border-white/10">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="font-display text-lg font-extrabold text-white">
                  {t.earnings_center}
                </h3>
                <p className="text-xs text-neutral-400">
                  Acompanhe ganhos por Dia, Semana, Mês, repasses Pix e dinheiro recebido
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFinanceOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Period Filter Tabs: Dia / Semana / Mês / Geral */}
            <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-2xl bg-[#1A1D24] p-1 border border-white/5">
              {(
                [
                  { id: 'day', label: t.period_day },
                  { id: 'week', label: t.period_week },
                  { id: 'month', label: t.period_month },
                  { id: 'all', label: t.period_all },
                ] as const
              ).map((p) => {
                const count = myDriverRides.filter(
                  (r) =>
                    r.status === 'completed' &&
                    isDateInPeriod(r.completed_at || r.created_at, p.id)
                ).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFinancePeriod(p.id)}
                    className={`min-h-[38px] rounded-xl px-2 text-[11px] font-extrabold transition ${
                      financePeriod === p.id
                        ? 'bg-[#FFD100] text-neutral-950 shadow-xs'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    {p.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Period Earnings & Goal Progress Bar */}
            {(() => {
              const goalTarget =
                financePeriod === 'day'
                  ? 200
                  : financePeriod === 'week'
                  ? 1200
                  : financePeriod === 'month'
                  ? 4500
                  : 0;
              const pct =
                goalTarget > 0
                  ? Math.min(100, Math.round((financeSummary.grossTotal / goalTarget) * 100))
                  : 100;
              return (
                <div className="mt-3 rounded-2xl bg-[#1A1D24] p-3.5 border border-white/10 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="text-neutral-400 font-semibold">Produção no período: </span>
                      <strong className="font-mono-num text-base font-extrabold text-[#FFD100]">
                        {formatBRL(financeSummary.grossTotal)}
                      </strong>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-neutral-300">
                      <span>{financeSummary.ridesCount} corridas</span>
                      <span>·</span>
                      <span>{financeSummary.deliveriesCount} entregas</span>
                    </div>
                  </div>
                  {goalTarget > 0 && (
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#FFD100] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-bold text-neutral-400 font-mono-num">
                        <span>Meta sugerida: {formatBRL(goalTarget)}</span>
                        <span className="text-[#FFD100]">{pct}% atingido</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 4 Financial Summary Cards */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-[#FFD100]/30">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Saldo a Receber (Atual)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-[#FFD100]">
                  {formatBRL(financeSummary.pendingToReceive)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Pix + Saldo App (Período)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-white">
                  {formatBRL(financeSummary.totalPixEarned + financeSummary.totalWalletEarned)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Dinheiro (Período)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-emerald-400">
                  {formatBRL(financeSummary.totalCashCollected)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Repassado (Período)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-sky-400">
                  {formatBRL(financeSummary.totalPayoutsReceived)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#1A1D24] px-4 py-2.5 text-xs border border-white/5">
              <span className="text-neutral-400 truncate">
                {t.pix_key_label}:{' '}
                <strong className="font-mono-num text-white">
                  {currentUser.driver?.pix_key || 'Não cadastrada'}
                </strong>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setFinanceOpen(false);
                    openDriverWallet('withdraw');
                  }}
                  className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
                >
                  {t.withdraw}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFinanceOpen(false);
                    openDriverWallet('transfer');
                  }}
                  className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white"
                >
                  {t.transfer}
                </button>
                <button
                  type="button"
                  onClick={loadFinancePanel}
                  className="flex items-center gap-1 text-[#FFD100] font-bold px-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Sub-tabs: Corridas vs Extrato */}
            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-[#1A1D24] p-1">
              <button
                type="button"
                onClick={() => setFinanceTab('rides')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition ${
                  financeTab === 'rides'
                    ? 'bg-[#FFD100] text-neutral-950'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Corridas do Período ({periodDriverRides.length})
              </button>
              <button
                type="button"
                onClick={() => setFinanceTab('ledger')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition ${
                  financeTab === 'ledger'
                    ? 'bg-[#FFD100] text-neutral-950'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Extrato e Repasses ({periodTransactions.length})
              </button>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto space-y-2.5 pr-0.5">
              {financeTab === 'rides' ? (
                periodDriverRides.length === 0 ? (
                  <div className="py-10 text-center space-y-2">
                    <p className="text-xs text-neutral-400">
                      Nenhuma corrida ou entrega neste período selecionado.
                    </p>
                    {financePeriod !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setFinancePeriod('all')}
                        className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold text-[#FFD100]"
                      >
                        Ver histórico completo (Geral)
                      </button>
                    )}
                  </div>
                ) : (
                  periodDriverRides.map((r) => {
                    const statusMeta =
                      PAYMENT_STATUS_LABELS[r.payment_status] ||
                      PAYMENT_STATUS_LABELS.pending;
                    return (
                      <div
                        key={r.id}
                        className="rounded-2xl bg-[#1A1D24] p-4 border border-white/5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {r.payment_method === 'wallet' ? (
                              <Wallet className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : r.payment_method === 'pix' ? (
                              <QrCode className="h-4 w-4 text-[#FFD100] shrink-0" />
                            ) : (
                              <Banknote className="h-4 w-4 text-emerald-400 shrink-0" />
                            )}
                            <span className="text-xs font-extrabold text-white truncate">
                              {CATEGORY_LABELS[r.category]} ·{' '}
                              {r.passenger?.full_name || 'Cliente'}
                            </span>
                          </div>
                          <span className="font-mono-num text-sm font-extrabold text-[#FFD100] shrink-0">
                            {formatBRL(r.final_fare ?? r.estimated_fare)}
                          </span>
                        </div>

                        <p className="text-[11px] text-neutral-400 truncate">
                          {r.origin_address} → {r.destination_address}
                        </p>

                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <span className={`font-bold ${statusMeta.color}`}>
                            {r.payment_method === 'wallet'
                              ? 'Pago pelo App (Saldo)'
                              : r.payment_method === 'pix'
                              ? 'Pix'
                              : 'Dinheiro'}{' '}
                            · {statusMeta.label}
                          </span>
                          <span className="font-mono-num text-neutral-500">
                            {new Date(r.completed_at || r.created_at).toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {r.status === 'completed' &&
                          r.payment_status !== 'disputed' &&
                          r.payment_status !== 'admin_settled' && (
                            <button
                              type="button"
                              onClick={() => {
                                setFinanceOpen(false);
                                setDisputeRide(r);
                                setDisputeReason('');
                              }}
                              className="text-[11px] font-bold text-red-400 hover:underline"
                            >
                              Relatar problema / não pagamento ao Admin
                            </button>
                          )}
                      </div>
                    );
                  })
                )
              ) : periodTransactions.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">
                  Nenhuma movimentação financeira neste período.
                </p>
              ) : (
                periodTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#1A1D24] px-4 py-3 text-xs"
                  >
                    <div className="min-w-0 pr-3">
                      <p className="font-bold text-white truncate">{tx.description}</p>
                      <p className="text-[11px] text-neutral-400">
                        {tx.type === 'payout'
                          ? 'Repasse Pix recebido do Admin'
                          : tx.type === 'dispute_settlement'
                          ? 'Crédito de disputa quitada'
                          : tx.type === 'admin_adjustment'
                          ? 'Ajuste de saldo pelo Admin'
                          : tx.type === 'deposit'
                          ? 'Depósito Pix confirmado'
                          : 'Crédito de corrida (Pix / Saldo)'}{' '}
                        · {new Date(tx.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span
                      className={`font-mono-num font-extrabold shrink-0 ${
                        tx.amount < 0 ? 'text-sky-400' : 'text-emerald-400'
                      }`}
                    >
                      {tx.amount < 0
                        ? `- ${formatBRL(Math.abs(tx.amount))}`
                        : `+ ${formatBRL(tx.amount)}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Driver Ride History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Histórico de Viagens e Entregas
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto space-y-3">
              {myDriverRides.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  Você ainda não realizou corridas.
                </p>
              ) : (
                myDriverRides.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-neutral-200 p-3.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-bold text-neutral-950">
                      <span>
                        {CATEGORY_LABELS[r.category]} · {r.status}
                      </span>
                      <span className="font-mono-num text-emerald-700">
                        {formatBRL(r.final_fare ?? r.estimated_fare)}
                      </span>
                    </div>
                    <p className="text-neutral-600 truncate">De: {r.origin_address}</p>
                    <p className="text-neutral-900 font-medium truncate">
                      Para: {r.destination_address}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-semibold text-neutral-500">
                        {r.payment_method === 'wallet'
                          ? 'Saldo do App'
                          : r.payment_method === 'pix'
                          ? 'Pix'
                          : 'Dinheiro'}{' '}
                        · {(PAYMENT_STATUS_LABELS[r.payment_status] || PAYMENT_STATUS_LABELS.pending).label}
                      </span>
                      {r.payment_status !== 'disputed' &&
                        r.payment_status !== 'admin_settled' &&
                        r.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryOpen(false);
                              setDisputeRide(r);
                              setDisputeReason('');
                            }}
                            className="text-[11px] font-bold text-red-700 hover:underline"
                          >
                            Relatar problema de pagamento
                          </button>
                        )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Events & Bonuses Modal for Drivers / Motoboys */}
      {eventsOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl bg-[#0F1115] text-white p-6 shadow-2xl border border-white/10 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#FFD100]" />
                <h3 className="font-display text-lg font-extrabold text-white">
                  Eventos & Campanhas Ativas
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEventsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex-1 overflow-y-auto space-y-3">
              {relevantEvents.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">
                  Nenhum evento ou bônus ativo criado pela administração no momento.
                </p>
              ) : (
                relevantEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-2xl border border-[#FFD100]/30 bg-[#1A1D24] p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-display text-sm font-extrabold text-white">{ev.title}</h4>
                      {ev.bonus_amount > 0 && (
                        <span className="rounded-full bg-[#FFD100] px-2.5 py-0.5 text-[11px] font-extrabold text-neutral-950 font-mono-num">
                          +{formatBRL(ev.bonus_amount)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-300 leading-relaxed">{ev.description}</p>
                    <p className="text-[10px] text-neutral-500 font-mono-num">
                      Publicado em {new Date(ev.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <AccountSettingsModal
          currentUser={currentUser}
          platformConfig={platformConfig}
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onLogout}
          onOpenWallet={() => openDriverWallet('withdraw')}
          onOpenSupport={() => {
            setSettingsOpen(false);
            setSupportChatOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {walletOpen && (
        <ClientWalletModal
          currentUser={currentUser}
          platformConfig={platformConfig}
          initialTab={walletInitialTab}
          onUserUpdated={onUserUpdated}
          onClose={() => setWalletOpen(false)}
        />
      )}

      {chatOpen && activeRide && activeRide.passenger && (
        <RideChatModal
          rideId={activeRide.id}
          currentUser={currentUser}
          peerName={activeRide.passenger.full_name}
          peerAvatarUrl={activeRide.passenger.avatar_url}
          isDelivery={activeIsDelivery}
          messages={currentChatMessages}
          onMessageSent={onAppendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}

      {supportChatOpen && (
        <DirectChatModal
          threadUser={{
            id: currentUser.id,
            full_name: currentUser.full_name,
            role: currentUser.role,
            avatar_url: currentUser.avatar_url,
          }}
          currentUser={currentUser}
          onClose={() => setSupportChatOpen(false)}
        />
      )}

      {pendingRatingRide && (
        <RatingModal
          ride={pendingRatingRide}
          currentUser={currentUser}
          onSubmitted={(updated) => {
            markRatingHandled(updated.id);
            onRideUpsert(updated);
          }}
          onSkip={() => markRatingHandled(pendingRatingRide.id)}
        />
      )}

      {notificationsOpen && (
        <NotificationsModal
          notifications={notifications}
          loading={loadingNotifications}
          onMarkRead={(nid) => {
            setNotifications((prev) =>
              prev.map((n) => (n.id === nid ? { ...n, is_read: true } : n))
            );
            void markNotificationRead(nid, currentUser.id);
          }}
          onMarkAllRead={() => {
            const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            void markAllNotificationsRead(ids, currentUser.id);
          }}
          onOpenEvents={() => setEventsOpen(true)}
          onOpenReceipt={(tx) => {
            setReceipt66Ride(null);
            setReceiptTx(tx);
          }}
          onClose={() => setNotificationsOpen(false)}
        />
      )}

      {(receiptTx || receipt66Ride) && (
        <Receipt66PayModal
          transaction={receiptTx}
          currentUser={currentUser}
          platformConfig={platformConfig}
          onClose={() => {
            setReceiptTx(null);
            setReceipt66Ride(null);
          }}
        />
      )}
    </div>
  );
};
