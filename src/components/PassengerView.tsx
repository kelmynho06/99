import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bell,
  Briefcase,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Crosshair,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Gift,
  Headphones,
  HelpCircle,
  History,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Navigation,
  Package,
  Phone,
  Plus,
  QrCode,
  Receipt,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Star,
  Tag,
  Thermometer,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { logAuditEvent } from '../lib/audit';
import { resolveBrandLogo, resolveCategoryVehicleImage } from '../lib/brandAssets';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import {
  type AddressSuggestion,
  fetchLocalWeather,
  fetchNearbyPickupCandidates,
  fetchNearbyPopularPlaces,
  fetchRouteGeometry,
  formatBRL,
  haversineKm,
  preloadLocalGeoIndex,
  reverseGeocode,
  searchAddresses,
  searchLocalGeoIndex,
} from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import {
  cancelRideWithPolicy,
  computeCancellationFeeEstimate,
  computeCouponDiscount,
  createRideRequest,
  fetchMyAvailableCoupons,
  fetchMyNotifications,
  fetchRideByIdEnriched,
  fetchUserProfileById,
  getDepositWindowStatus,
  markAllNotificationsRead,
  markNotificationRead,
  payCompletedRideWithWallet,
  switchCompletedRidePaymentMethod,
} from '../lib/mobilityApi';
import {
  loadOfflineActiveRideCache,
  saveOfflineActiveRideCache,
} from '../lib/offlineNavigation';
import { speakPtBr, unlockAudioContext } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type {
  AppNotification,
  GeoPoint,
  Pay66ReceiptResult,
  PaymentMethod,
  PlatformConfig,
  PricingSetting,
  Ride,
  RideCategory,
  RideMessage,
  SavedAddress,
  UserCoupon,
  UserProfile,
  WalletTransaction,
  WeatherInfo,
} from '../types/mobility';
import { AccountSettingsModal } from './AccountSettingsModal';
import { AvatarImage } from './AvatarImage';
import { BorealLogoMark } from './BorealBrandAssets';
import { ClientWalletModal, type WalletModalTab } from './ClientWalletModal';
import { DirectChatModal } from './DirectChatModal';
import { LegalDocsModal } from './LegalDocsModal';
import { LiveMap } from './LiveMap';
import { NotificationsModal } from './NotificationsModal';
import { PixPaymentModal } from './PixPaymentModal';
import { PWAInstallButton } from './PWAInstallButton';
import { Qr66PayScannerModal } from './Qr66PayScannerModal';
import { RatingModal } from './RatingModal';
import { Receipt66PayModal } from './Receipt66PayModal';
import { RideChatModal } from './RideChatModal';

interface PassengerViewProps {
  currentUser: UserProfile;
  platformConfig: PlatformConfig;
  rides: Ride[];
  pricing: PricingSetting[];
  onlineDrivers: UserProfile[];
  messagesByRide: Record<string, RideMessage[]>;
  onUserUpdated: (user: UserProfile) => void;
  onLoadMessages: (rideId: string) => void;
  onAppendMessage: (msg: RideMessage) => void;
  onRideUpsert: (ride: Ride) => void;
  onLogout: () => void;
}

const DEFAULT_ORIGIN: GeoPoint = {
  lat: -15.793889,
  lng: -47.882778,
  address: '',
};

const LOCAL_SEARCH_CHIPS = [
  'Supermercado',
  'Farmácia',
  'Posto',
  'Praça',
  'Hospital',
  'Rodoviária',
];

const CATEGORY_LABELS: Record<RideCategory, string> = {
  moto: 'Moto',
  pop: 'Pop',
  negocia: 'Negocia',
  delivery_moto: 'Entrega Moto',
  delivery_car: 'Entrega Carro',
};

export const PassengerView: React.FC<PassengerViewProps> = ({
  currentUser,
  platformConfig,
  rides,
  pricing,
  onlineDrivers,
  messagesByRide,
  onUserUpdated,
  onLoadMessages,
  onAppendMessage,
  onRideUpsert,
  onLogout,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addressScreenOpen, setAddressScreenOpen] = useState(false);
  const [addressTab, setAddressTab] = useState<'search' | 'favorites'>('search');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletInitialTab, setWalletInitialTab] = useState<WalletModalTab>('deposit');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const depositWindow = useMemo(
    () => getDepositWindowStatus(platformConfig, new Date(nowTick)),
    [platformConfig, nowTick]
  );
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [infoModal, setInfoModal] = useState<
    'help' | 'discounts' | 'security' | 'become_driver' | null
  >(null);
  const [pixModalRide, setPixModalRide] = useState<Ride | null>(null);

  const [origin, setOrigin] = useState<GeoPoint>(DEFAULT_ORIGIN);
  const [gpsFixed, setGpsFixed] = useState(false);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');

  const [originSuggestions, setOriginSuggestions] = useState<AddressSuggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<AddressSuggestion[]>([]);
  const [nearbyPickupOptions, setNearbyPickupOptions] = useState<AddressSuggestion[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<AddressSuggestion[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<'origin' | 'destination'>('destination');
  const [pickOnMapMode, setPickOnMapMode] = useState<'origin' | 'destination' | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [durationMin, setDurationMin] = useState<number>(0);

  const [homeTab, setHomeTab] = useState<'rides' | 'delivery'>('rides');
  const [deliveryDirection, setDeliveryDirection] = useState<'send' | 'receive'>('send');
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [serviceTab, setServiceTab] = useState<'rides' | 'delivery'>('rides');
  const [category, setCategory] = useState<RideCategory>('pop');
  const [negotiatedFare, setNegotiatedFare] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    currentUser.preferred_payment === 'cash' ? 'cash' : 'wallet'
  );
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [requireDeliveryPin, setRequireDeliveryPin] = useState(true);
  const [idleCleanMap, setIdleCleanMap] = useState(false);
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelNowMs, setCancelNowMs] = useState<number>(() => Date.now());
  const [cancelNotice, setCancelNotice] = useState<{ text: string; isFree: boolean } | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [postRidePaymentBusy, setPostRidePaymentBusy] = useState<'wallet' | 'pix' | 'cash' | null>(null);
  const [postRidePaymentError, setPostRidePaymentError] = useState<string | null>(null);
  const [cashChoiceConfirmedRideIds, setCashChoiceConfirmedRideIds] = useState<string[]>([]);
  const [dismissedCompletedPayIds, setDismissedCompletedPayIds] = useState<string[]>([]);

  // Notificações, Cupons e Pagamento QR 66pay no destino
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [availableCoupons, setAvailableCoupons] = useState<UserCoupon[]>([]);
  const [selectedUserCoupon, setSelectedUserCoupon] = useState<UserCoupon | null>(null);
  const [qrScannerRide, setQrScannerRide] = useState<Ride | null>(null);
  const [receiptModalState, setReceiptModalState] = useState<{
    transaction?: WalletTransaction | null;
    receipt66?: Pay66ReceiptResult | null;
  } | null>(null);
  const [receiptsByRideId, setReceiptsByRideId] = useState<Record<string, Pay66ReceiptResult>>({});

  const ratingStorageKey = `velo99_passenger_dismissed_ratings_${currentUser.id}`;
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
  const prevRideStatusMapRef = useRef<Record<string, Ride['status']>>({});
  const spokenNearDestIdsRef = useRef<Set<string>>(new Set());

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

  const [sheetMinimized, setSheetMinimized] = useState(false);
  const [driverSpeedKmh, setDriverSpeedKmh] = useState(0);
  const dragStartYRef = useRef<number | null>(null);
  const prevDriverSampleRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const fetchedRideRouteStageRef = useRef<string | null>(null);

  const siteName = platformConfig.site_name || 'Boreal Mobilidade';
  const brandLogoUrl = resolveBrandLogo(platformConfig);
  const pendingDebt = Number(currentUser.pending_debt_amount || 0);

  const myRides = useMemo(
    () => rides.filter((r) => r.passenger_id === currentUser.id),
    [rides, currentUser.id]
  );

  const activeRide = useMemo(
    () =>
      myRides.find((r) =>
        ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status)
      ) || null,
    [myRides]
  );

  const unpaidCompletedRide = useMemo(
    () =>
      myRides.find(
        (r) =>
          r.status === 'completed' &&
          r.payment_status === 'pending'
      ) || null,
    [myRides]
  );

  const unpaidCompletedWalletRide =
    unpaidCompletedRide?.payment_method === 'wallet' ? unpaidCompletedRide : null;
  const unpaidCompletedPixRide =
    unpaidCompletedRide?.payment_method === 'pix' ? unpaidCompletedRide : null;
  const unpaidCompletedCashRide =
    unpaidCompletedRide?.payment_method === 'cash' ? unpaidCompletedRide : null;

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const loadNotificationsAndCoupons = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const [notifs, coupons] = await Promise.all([
        fetchMyNotifications(currentUser),
        fetchMyAvailableCoupons(currentUser.id),
      ]);
      setNotifications(notifs);
      setAvailableCoupons(coupons);
      setSelectedUserCoupon((prev) =>
        prev ? coupons.find((c) => c.id === prev.id) || null : null
      );
    } catch {
      // Ignore transient load error
    } finally {
      setLoadingNotifications(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadNotificationsAndCoupons();
    const ch = supabase
      .channel(`passenger-notif-coupons-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notifications' },
        () => {
          void loadNotificationsAndCoupons();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_coupons', filter: `user_id=eq.${currentUser.id}` },
        () => {
          void loadNotificationsAndCoupons();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUser.id, loadNotificationsAndCoupons]);

  const livePixModalRide = useMemo(
    () =>
      pixModalRide
        ? myRides.find((r) => r.id === pixModalRide.id) || pixModalRide
        : null,
    [pixModalRide, myRides]
  );

  useEffect(() => {
    const onBubbleTap = () => {
      setSheetMinimized(false);
      setIdleCleanMap(false);
    };
    window.addEventListener('mobilidade66:bubble-tap', onBubbleTap);
    return () => window.removeEventListener('mobilidade66:bubble-tap', onBubbleTap);
  }, []);

  const [waitNowMs, setWaitNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!activeRide || activeRide.status !== 'arrived' || !activeRide.arrived_at) return;
    setWaitNowMs(Date.now());
    const id = window.setInterval(() => setWaitNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeRide]);

  const passengerWaitingStats = useMemo(() => {
    if (!activeRide?.arrived_at) {
      return { remainingFreeSec: 120, extraSec: 0, waitingFee: 0, isCharging: false };
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
    return { remainingFreeSec, extraSec, waitingFee, isCharging: extraSec > 0 };
  }, [activeRide, waitNowMs]);

  // Track completion transitions for immediate post-ride rating modal (pop-ups & voice handled centrally in useRealtimeMobility)
  useEffect(() => {
    const prevMap = prevRideStatusMapRef.current;
    const nextMap: Record<string, Ride['status']> = {};
    for (const r of myRides) {
      nextMap[r.id] = r.status;
      const prevStatus = prevMap[r.id];
      if (
        prevStatus &&
        prevStatus !== 'completed' &&
        r.status === 'completed'
      ) {
        justCompletedRideIdRef.current = r.id;
      }
    }
    prevRideStatusMapRef.current = nextMap;
  }, [myRides]);

  const pendingRatingRide = useMemo(
    () =>
      myRides.find((r) => {
        if (r.status !== 'completed' || r.passenger_rating_submitted) return false;
        if (dismissedRatingIds.includes(r.id)) return false;
        if (r.payment_status === 'pending') return false;
        if (pixModalRide?.id === r.id || qrScannerRide?.id === r.id || receiptModalState) {
          return false;
        }
        const completedMs = new Date(r.completed_at || r.created_at).getTime();
        return (
          r.id === justCompletedRideIdRef.current ||
          completedMs >= sessionStartedAtRef.current - 60_000
        );
      }) || null,
    [myRides, dismissedRatingIds, pixModalRide?.id, qrScannerRide?.id, receiptModalState]
  );

  const loadNearbyForCoords = useCallback(async (lat: number, lng: number) => {
    setLoadingNearby(true);
    try {
      const places = await fetchNearbyPopularPlaces(lat, lng);
      setNearbyPlaces(places);
    } catch {
      // Ignore nearby fetch issues
    } finally {
      setLoadingNearby(false);
    }
  }, []);

  const detectMyGps = useCallback(async () => {
    const pos = await getCurrentGpsPosition();
    if (!pos) {
      return;
    }
    setGpsFixed(true);
    const [addr, w, nearbyCandidates] = await Promise.all([
      reverseGeocode(pos.lat, pos.lng),
      fetchLocalWeather(pos.lat, pos.lng),
      fetchNearbyPickupCandidates(pos.lat, pos.lng).catch(() => []),
    ]);
    setOrigin({ lat: pos.lat, lng: pos.lng, address: addr });
    setOriginQuery(addr);
    setNearbyPickupOptions(nearbyCandidates);
    if (w) setWeather(w);
    void preloadLocalGeoIndex(pos.lat, pos.lng);
    void loadNearbyForCoords(pos.lat, pos.lng);
  }, [loadNearbyForCoords]);

  useEffect(() => {
    detectMyGps();
  }, [detectMyGps]);

  useEffect(() => {
    if (addressScreenOpen && gpsFixed && nearbyPlaces.length === 0 && !loadingNearby) {
      void loadNearbyForCoords(origin.lat, origin.lng);
    }
  }, [addressScreenOpen, gpsFixed, nearbyPlaces.length, loadingNearby, loadNearbyForCoords, origin.lat, origin.lng]);

  useEffect(() => {
    if (activeRide && activeRide.driver_id) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  useEffect(() => {
    if (!addressScreenOpen || activeSearchField !== 'origin') return;
    const trimmed = originQuery.trim();
    if (
      trimmed.length < 1 ||
      originQuery === t.current_location ||
      originQuery === origin.address
    ) {
      setOriginSuggestions([]);
      setSearchingAddress(false);
      return;
    }

    const immediateLocal = searchLocalGeoIndex(trimmed, origin.lat, origin.lng);
    if (immediateLocal.length > 0) {
      setOriginSuggestions(immediateLocal);
    }

    const controller = new AbortController();
    setSearchingAddress(true);
    const timer = setTimeout(async () => {
      const res = await searchAddresses(trimmed, origin.lat, origin.lng, controller.signal);
      if (!controller.signal.aborted) {
        const merged = [...immediateLocal];
        const seenKeys = new Set(
          merged.map((m) => `${m.address.toLowerCase()}|${m.lat.toFixed(4)}|${m.lng.toFixed(4)}`)
        );
        for (const r of res) {
          const k = `${r.address.toLowerCase()}|${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`;
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            merged.push(r);
          }
        }
        setOriginSuggestions(merged.slice(0, 12));
        setSearchingAddress(false);
      }
    }, 260);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [originQuery, addressScreenOpen, activeSearchField, origin.address, origin.lat, origin.lng, t.current_location]);

  useEffect(() => {
    if (!addressScreenOpen || activeSearchField !== 'destination') return;
    const trimmed = destQuery.trim();
    if (trimmed.length < 1 || (destination && destQuery === destination.address)) {
      setDestSuggestions([]);
      setSearchingAddress(false);
      return;
    }

    const immediateLocal = searchLocalGeoIndex(trimmed, origin.lat, origin.lng);
    if (immediateLocal.length > 0) {
      setDestSuggestions(immediateLocal);
    }

    const controller = new AbortController();
    setSearchingAddress(true);
    const timer = setTimeout(async () => {
      const res = await searchAddresses(trimmed, origin.lat, origin.lng, controller.signal);
      if (!controller.signal.aborted) {
        const merged = [...immediateLocal];
        const seenKeys = new Set(
          merged.map((m) => `${m.address.toLowerCase()}|${m.lat.toFixed(4)}|${m.lng.toFixed(4)}`)
        );
        for (const r of res) {
          const k = `${r.address.toLowerCase()}|${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`;
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            merged.push(r);
          }
        }
        setDestSuggestions(merged.slice(0, 12));
        setSearchingAddress(false);
      }
    }, 260);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [destQuery, addressScreenOpen, activeSearchField, destination, origin.lat, origin.lng]);

  useEffect(() => {
    setSheetMinimized(false);
  }, [activeRide?.id]);

  // Pre-ride route preview
  useEffect(() => {
    if (activeRide) return;
    fetchedRideRouteStageRef.current = null;
    if (!destination) {
      setRouteCoords([]);
      setDistanceKm(0);
      setDurationMin(0);
      return;
    }

    let cancelled = false;
    fetchRouteGeometry(origin.lat, origin.lng, destination.lat, destination.lng).then((res) => {
      if (cancelled) return;
      setRouteCoords(res.coords);
      setDistanceKm(res.distanceKm);
      setDurationMin(res.durationMin);
    });
    return () => {
      cancelled = true;
    };
  }, [origin, destination, activeRide]);

  // Persistent stage route for active ride so traveled segment turns gray and ahead stays blue
  useEffect(() => {
    if (!activeRide) return;
    const stage = activeRide.status === 'in_progress' ? 'B' : 'A';
    const stageKey = `${activeRide.id}:${stage}`;
    if (fetchedRideRouteStageRef.current === stageKey) return;

    const drvLat = activeRide.driver?.driver?.current_lat;
    const drvLng = activeRide.driver?.driver?.current_lng;

    if (stage === 'A' && activeRide.status === 'searching') {
      fetchedRideRouteStageRef.current = `${activeRide.id}:searching`;
      const cachedSearch = loadOfflineActiveRideCache(activeRide.id, 'searching');
      if (cachedSearch) {
        setRouteCoords(cachedSearch.routeCoords);
        setDistanceKm(cachedSearch.distanceKm);
        setDurationMin(cachedSearch.durationMin);
      }
      let cancelled = false;
      fetchRouteGeometry(
        activeRide.origin_lat,
        activeRide.origin_lng,
        activeRide.destination_lat,
        activeRide.destination_lng
      ).then((res) => {
        if (cancelled) return;
        if (cachedSearch && cachedSearch.routeCoords.length > 2 && res.coords.length <= 2) return;
        setRouteCoords(res.coords);
        setDistanceKm(res.distanceKm);
        setDurationMin(res.durationMin);
        saveOfflineActiveRideCache({
          rideId: activeRide.id,
          stage: 'searching',
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
    }

    const startLat = stage === 'A' && drvLat ? drvLat : activeRide.origin_lat;
    const startLng = stage === 'A' && drvLng ? drvLng : activeRide.origin_lng;
    const targetLat = stage === 'B' ? activeRide.destination_lat : activeRide.origin_lat;
    const targetLng = stage === 'B' ? activeRide.destination_lng : activeRide.origin_lng;

    if (stage === 'A' && (!drvLat || !drvLng)) {
      return;
    }

    fetchedRideRouteStageRef.current = stageKey;
    const cachedStage = loadOfflineActiveRideCache(activeRide.id, stage);
    if (cachedStage) {
      setRouteCoords(cachedStage.routeCoords);
      setDistanceKm(cachedStage.distanceKm);
      setDurationMin(cachedStage.durationMin);
    }
    let cancelled = false;
    fetchRouteGeometry(startLat, startLng, targetLat, targetLng).then((res) => {
      if (cancelled) return;
      if (cachedStage && cachedStage.routeCoords.length > 2 && res.coords.length <= 2) return;
      setRouteCoords(res.coords);
      setDistanceKm(res.distanceKm);
      setDurationMin(res.durationMin);
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
  }, [
    activeRide?.id,
    activeRide?.status,
    activeRide?.origin_lat,
    activeRide?.origin_lng,
    activeRide?.destination_lat,
    activeRide?.destination_lng,
    activeRide?.driver?.driver?.current_lat,
    activeRide?.driver?.driver?.current_lng,
  ]);

  const getFareForCategory = useCallback(
    (cat: PricingSetting): number => {
      if (distanceKm <= 0) return cat.min_fare;
      const raw = cat.base_fare + distanceKm * cat.per_km_rate;
      return Number(Math.max(cat.min_fare, raw).toFixed(2));
    },
    [distanceKm]
  );

  const negociaPricing = useMemo(
    () => pricing.find((p) => p.category === 'negocia'),
    [pricing]
  );
  const baseNegociaFare = negociaPricing ? getFareForCategory(negociaPricing) : 10;
  const activeNegociaFare = negotiatedFare ?? baseNegociaFare;

  useEffect(() => {
    setNegotiatedFare(null);
  }, [distanceKm, destination]);

  const handleMapPick = async (lat: number, lng: number) => {
    const addr = await reverseGeocode(lat, lng);
    if (pickOnMapMode === 'origin') {
      setOrigin({ lat, lng, address: addr });
      setOriginQuery(addr);
      fetchNearbyPickupCandidates(lat, lng)
        .then(setNearbyPickupOptions)
        .catch(() => {});
    } else if (pickOnMapMode === 'destination') {
      setDestination({ lat, lng, address: addr });
      setDestQuery(addr);
    }
    setPickOnMapMode(null);
  };

  const selectDestinationPoint = (pt: GeoPoint) => {
    setDestination(pt);
    setDestQuery(pt.address);
    setDestSuggestions([]);
    setAddressScreenOpen(false);
  };

  const selectedCategoryObj = pricing.find((p) => p.category === category);
  const selectedCategoryFare =
    category === 'negocia'
      ? activeNegociaFare
      : selectedCategoryObj
      ? getFareForCategory(selectedCategoryObj)
      : 0;
  const couponDiscount =
    availableCoupons.length > 0 && selectedUserCoupon?.coupon
      ? computeCouponDiscount(selectedUserCoupon.coupon, selectedCategoryFare)
      : 0;
  const discountedCategoryFare = Math.max(0, Number((selectedCategoryFare - couponDiscount).toFixed(2)));
  const totalFareWithDebt = Number((discountedCategoryFare + pendingDebt).toFixed(2));
  const walletBalance = Number((currentUser.wallet_balance || 0).toFixed(2));
  const hasEnoughWalletBalance = walletBalance >= totalFareWithDebt;

  const openWallet = (tab: WalletModalTab = 'deposit') => {
    setWalletInitialTab(tab);
    setWalletOpen(true);
  };

  const handleRequestRide = async () => {
    if (!destination || submitting) return;
    unlockAudioContext();
    if (paymentMethod === 'wallet' && !hasEnoughWalletBalance) {
      setErrorMsg(
        `Saldo BorealPay insuficiente (${formatBRL(walletBalance)}). Deposite via Pix na BorealPay ou escolha Dinheiro.`
      );
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const isDelivery = category === 'delivery_moto' || category === 'delivery_car';
      const created = await createRideRequest({
        passenger_id: currentUser.id,
        category,
        payment_method: paymentMethod,
        origin: {
          ...origin,
          address: origin.address || t.current_location,
        },
        destination,
        distance_km: Math.max(0.6, distanceKm),
        estimated_fare: totalFareWithDebt,
        negotiated_fare: category === 'negocia' ? activeNegociaFare : null,
        delivery_notes: isDelivery ? deliveryNotes : null,
        require_pin: isDelivery ? requireDeliveryPin : true,
        pending_debt_included: pendingDebt,
        coupon_id: couponDiscount > 0 ? selectedUserCoupon?.coupon_id || null : null,
        user_coupon_id: couponDiscount > 0 ? selectedUserCoupon?.id || null : null,
        discount_amount: couponDiscount,
      });
      setDeliveryNotes('');
      setSelectedUserCoupon(null);
      if (couponDiscount > 0) {
        void loadNotificationsAndCoupons();
      }
      onRideUpsert(created);
      void logAuditEvent({
        user: currentUser,
        event_type: 'ride_requested',
        description: `Solicitou ${CATEGORY_LABELS[category]} (${formatBRL(totalFareWithDebt)} · ${paymentMethod})`,
        metadata: {
          ride_id: created.id,
          category,
          payment_method: paymentMethod,
          fare: totalFareWithDebt,
          discount_amount: couponDiscount,
        },
      });
      if (paymentMethod === 'wallet') {
        fetchUserProfileById(currentUser.id).then((u) => u && onUserUpdated(u)).catch(() => {});
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Falha de rede ao chamar motorista.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const executeCancelRide = async () => {
    if (!activeRide || cancelBusy) return;
    if (activeRide.status === 'in_progress') {
      setErrorMsg('Não é possível cancelar após o início do embarque.');
      return;
    }
    setCancelBusy(true);
    try {
      const drvCoords: [number, number] | null =
        activeRide.driver?.driver?.current_lat && activeRide.driver?.driver?.current_lng
          ? [activeRide.driver.driver.current_lat, activeRide.driver.driver.current_lng]
          : null;
      const estimate = computeCancellationFeeEstimate(activeRide, drvCoords);
      const updated = await cancelRideWithPolicy(activeRide, drvCoords);
      if (updated) onRideUpsert(updated);
      setCancelConfirmOpen(false);
      setCancelNotice(
        estimate.feeAmount === 0
          ? { text: 'Sua corrida foi cancelada sem taxa.', isFree: true }
          : {
              text: `Corrida cancelada · Taxa de ${formatBRL(estimate.feeAmount)} aplicada.`,
              isFree: false,
            }
      );
      window.setTimeout(() => setCancelNotice(null), 4500);
      void logAuditEvent({
        user: currentUser,
        event_type: 'ride_cancelled',
        description:
          estimate.feeAmount > 0
            ? `Passageiro cancelou (${CATEGORY_LABELS[activeRide.category]}) · Taxa ${formatBRL(estimate.feeAmount)} ao motorista`
            : `Passageiro cancelou solicitação gratuitamente (${CATEGORY_LABELS[activeRide.category]})`,
        metadata: { ride_id: activeRide.id, fee_amount: estimate.feeAmount },
      });
      fetchUserProfileById(currentUser.id).then((u) => u && onUserUpdated(u)).catch(() => {});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao cancelar corrida.');
    } finally {
      setCancelBusy(false);
    }
  };

  const handleCancelRide = async () => {
    if (!activeRide) return;
    if (activeRide.status === 'in_progress') {
      setErrorMsg('Não é possível cancelar depois que a viagem já começou.');
      return;
    }
    if (activeRide.status === 'searching') {
      await executeCancelRide();
      return;
    }
    setCancelNowMs(Date.now());
    setCancelConfirmOpen(true);
  };

  const handlePayCompletedWithWallet = async (ride: Ride) => {
    setPostRidePaymentError(null);
    setPostRidePaymentBusy('wallet');
    try {
      const updated = await payCompletedRideWithWallet(ride);
      onRideUpsert(updated);
      justCompletedRideIdRef.current = updated.id;
      const fresh = await fetchUserProfileById(currentUser.id);
      if (fresh) onUserUpdated(fresh);
    } catch (err) {
      setPostRidePaymentError(
        err instanceof Error ? err.message : 'Erro ao pagar corrida com Saldo do App.'
      );
    } finally {
      setPostRidePaymentBusy(null);
    }
  };

  const handleChooseCompletedPix = async (ride: Ride) => {
    setPostRidePaymentError(null);
    setPostRidePaymentBusy('pix');
    try {
      const updated =
        ride.payment_method !== 'pix'
          ? await switchCompletedRidePaymentMethod(ride.id, 'pix')
          : ride;
      onRideUpsert(updated);
      setPixModalRide(updated);
    } catch (err) {
      setPostRidePaymentError(
        err instanceof Error ? err.message : 'Não foi possível preparar o pagamento Pix.'
      );
    } finally {
      setPostRidePaymentBusy(null);
    }
  };

  const handleChooseCompletedCash = async (ride: Ride) => {
    setPostRidePaymentError(null);
    setPostRidePaymentBusy('cash');
    try {
      const updated =
        ride.payment_method !== 'cash'
          ? await switchCompletedRidePaymentMethod(ride.id, 'cash')
          : ride;
      onRideUpsert(updated);
      setCashChoiceConfirmedRideIds((prev) =>
        prev.includes(updated.id) ? prev : [...prev, updated.id]
      );
    } catch (err) {
      setPostRidePaymentError(
        err instanceof Error ? err.message : 'Não foi possível confirmar pagamento em dinheiro.'
      );
    } finally {
      setPostRidePaymentBusy(null);
    }
  };

  const visiblePricingList = useMemo(() => {
    const activeOnes = pricing.filter((c) => c.active !== false);
    if (serviceTab === 'delivery') {
      return activeOnes.filter(
        (c) => c.category === 'delivery_moto' || c.category === 'delivery_car'
      );
    }
    return activeOnes.filter(
      (c) => c.category === 'pop' || c.category === 'moto' || c.category === 'negocia'
    );
  }, [pricing, serviceTab]);

  const activeDriverPos =
    activeRide?.driver?.driver?.current_lat && activeRide?.driver?.driver?.current_lng
      ? {
          lat: activeRide.driver.driver.current_lat,
          lng: activeRide.driver.driver.current_lng,
          heading: activeRide.driver.driver.heading,
          vehicleType: activeRide.driver.driver.vehicle_type,
          label: `${activeRide.driver.full_name} · ${activeRide.driver.driver.vehicle_plate}`,
        }
      : null;

  useEffect(() => {
    if (!activeRide || !['accepted', 'arrived'].includes(activeRide.status)) {
      setCancelConfirmOpen(false);
      return;
    }
    setCancelNowMs(Date.now());
    const timer = window.setInterval(() => setCancelNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRide?.id, activeRide?.status]);

  const cancelEstimate = useMemo(() => {
    void cancelNowMs;
    if (!activeRide) return null;
    const coords: [number, number] | null = activeDriverPos
      ? [activeDriverPos.lat, activeDriverPos.lng]
      : null;
    return computeCancellationFeeEstimate(activeRide, coords);
  }, [activeRide, activeDriverPos, cancelNowMs]);

  useEffect(() => {
    if (!activeDriverPos || !activeRide || activeRide.status === 'searching') {
      prevDriverSampleRef.current = null;
      setDriverSpeedKmh(0);
      return;
    }
    const now = Date.now();
    const prev = prevDriverSampleRef.current;
    if (prev && (prev.lat !== activeDriverPos.lat || prev.lng !== activeDriverPos.lng)) {
      const distKm = haversineKm(prev.lat, prev.lng, activeDriverPos.lat, activeDriverPos.lng);
      const dtHours = Math.max(0.0005, (now - prev.ts) / 3600000);
      const computed = Math.min(120, Math.round(distKm / dtHours));
      setDriverSpeedKmh(computed > 1 ? computed : 0);
    }
    prevDriverSampleRef.current = {
      lat: activeDriverPos.lat,
      lng: activeDriverPos.lng,
      ts: now,
    };

    if (
      activeRide.status === 'in_progress' &&
      !spokenNearDestIdsRef.current.has(activeRide.id)
    ) {
      const distDestKm = haversineKm(
        activeDriverPos.lat,
        activeDriverPos.lng,
        activeRide.destination_lat,
        activeRide.destination_lng
      );
      if (distDestKm <= 0.25) {
        spokenNearDestIdsRef.current.add(activeRide.id);
        const isDel =
          activeRide.category === 'delivery_moto' || activeRide.category === 'delivery_car';
        if (isDel) {
          speakPtBr('Seu entregador está chegando ao destino final.', true);
        } else if (activeRide.category === 'moto') {
          speakPtBr(
            'Você está chegando ao seu destino. Lembre-se de pegar o seu celular e objetos pessoais antes de sair da moto.',
            true
          );
        } else {
          speakPtBr(
            'Você está chegando ao seu destino. Lembre-se de pegar o seu celular e objetos pessoais antes de sair do carro.',
            true
          );
        }
      }
    }

    const decay = window.setTimeout(() => setDriverSpeedKmh(0), 5000);
    return () => window.clearTimeout(decay);
  }, [activeDriverPos?.lat, activeDriverPos?.lng, activeRide]);

  const currentChatMessages = activeRide ? messagesByRide[activeRide.id] || [] : [];
  const isDeliveryActive =
    activeRide?.category === 'delivery_moto' || activeRide?.category === 'delivery_car';

  const savedFavorites: SavedAddress[] = currentUser.favorites || [];

  const handleShareActiveTrip = async () => {
    if (!activeRide) return;
    const summary = `Acompanhe minha viagem na ${siteName}: ${
      activeRide.driver?.full_name || 'Motorista'
    } (${activeRide.driver?.driver?.vehicle_model || 'Veículo'} · ${
      activeRide.driver?.driver?.vehicle_plate || '---'
    }) indo de ${activeRide.origin_address} até ${activeRide.destination_address}.`;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: `${siteName} · Viagem em andamento`,
          text: summary,
        });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
        setShareNotice('Resumo da viagem copiado!');
        window.setTimeout(() => setShareNotice(null), 2600);
      }
    } catch {
      // Ignore cancelled share sheet
    }
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100 dark:bg-neutral-950">
      <LiveMap
        center={[origin.lat, origin.lng]}
        userLocation={gpsFixed ? { lat: origin.lat, lng: origin.lng } : null}
        isDelivery={
          activeRide
            ? isDeliveryActive
            : Boolean(destination)
            ? serviceTab === 'delivery'
            : homeTab === 'delivery'
        }
        origin={
          activeRide
            ? {
                lat: activeRide.origin_lat,
                lng: activeRide.origin_lng,
                address: activeRide.origin_address,
              }
            : origin
        }
        destination={
          activeRide
            ? {
                lat: activeRide.destination_lat,
                lng: activeRide.destination_lng,
                address: activeRide.destination_address,
              }
            : destination
        }
        routeCoords={routeCoords}
        driverPosition={activeDriverPos}
        followVehicle={Boolean(activeRide && activeDriverPos && activeRide.status !== 'searching')}
        showSpeedometer={Boolean(activeRide && activeRide.status === 'in_progress')}
        speedKmh={driverSpeedKmh}
        controlsTopClassName={
          !activeRide && !destination && !unpaidCompletedRide && !idleCleanMap
            ? 'top-[62%] -translate-y-1/2 sm:top-24 sm:translate-y-0'
            : activeRide
            ? 'top-24'
            : 'top-1/2 -translate-y-1/2 sm:top-24 sm:translate-y-0'
        }
        nearbyDrivers={activeRide ? [] : onlineDrivers}
        pickOnMapMode={pickOnMapMode}
        onMapPick={handleMapPick}
        onRecenter={detectMyGps}
      />

      {/* FULL-SCREEN "BOREAL ENTREGA" HUB WHEN DELIVERY TAB IS SELECTED ON IDLE */}
      {!activeRide &&
        !destination &&
        !unpaidCompletedRide &&
        !idleCleanMap &&
        !pickOnMapMode &&
        !addressScreenOpen &&
        homeTab === 'delivery' && (
          <div className="fixed inset-0 z-[580] flex flex-col aurora-surface-flow">
            {/* Aurora Boreal Top Header */}
            <div className="flex items-center justify-between gap-3 px-4 pt-safe py-3.5">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="flex items-center gap-3 min-w-0 text-left active:scale-[0.98] transition"
              >
                <div className="relative shrink-0">
                  <AvatarImage
                    src={currentUser.avatar_url}
                    name={currentUser.full_name}
                    className="h-11 w-11 rounded-full object-cover border-2 border-white shadow-xs"
                    fallbackClassName="flex h-11 w-11 items-center justify-center rounded-full bg-[#ECFDF5] text-[#047857] border-2 border-[#6EE7B7] font-display text-base font-extrabold shadow-xs"
                  />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 border-2 border-white" />
                  )}
                </div>
                <span className="font-display text-xl font-extrabold text-[#0F2421] truncate">
                  Olá, {currentUser.full_name.split(' ')[0]}!
                </span>
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(true);
                    void loadNotificationsAndCoupons();
                  }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/90 border border-[#2DD4BF]/35 text-[#0F2421] shadow-xs active:scale-95 transition"
                  aria-label="Notificações"
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-extrabold text-white font-mono-num">
                      {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 border border-[#2DD4BF]/35 text-[#0F2421] shadow-xs active:scale-95 transition"
                  aria-label="Abrir menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* White Rounded Sheet Body */}
            <div className="flex-1 overflow-y-auto rounded-t-[28px] bg-white dark:bg-[#081513] px-5 pt-7 pb-32 shadow-2xl border-t border-[#2DD4BF]/35">
              <div className="mx-auto max-w-md space-y-6">
                {/* Headline + Brand Arrow Lockup */}
                <div className="text-center space-y-2">
                  <p className="text-xs font-extrabold tracking-widest text-[#334E4A] dark:text-[#6EE7B7] uppercase">
                    VOCÊ PRECISA,
                  </p>
                  <div className="inline-flex items-center justify-center gap-2.5">
                    <BorealLogoMark className="h-9 w-9 rounded-xl shadow-xs" />
                    <h2 className="font-display text-3xl font-extrabold tracking-tight text-[#0F2421] dark:text-white">
                      Boreal <span className="font-semibold text-[#047857] dark:text-[#6EE7B7]">Entrega</span>
                    </h2>
                  </div>
                </div>

                {/* Side-by-side Moto & Carro Package Cards */}
                <div className="grid grid-cols-2 gap-4 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('delivery');
                      setCategory('delivery_moto');
                      setActiveSearchField('destination');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="group flex flex-col items-center justify-center rounded-3xl bg-[#F7FBFA] dark:bg-[#0F2421] p-4 border border-[#CCFBF1] dark:border-teal-900 hover:border-[#047857] active:scale-[0.98] transition"
                  >
                    <div className="relative flex h-24 w-full items-center justify-center">
                      <img
                        src={resolveCategoryVehicleImage('delivery_moto', platformConfig)}
                        alt="Entrega Moto"
                        className="h-20 w-28 object-contain"
                      />
                      <span className="absolute bottom-1 left-4 flex h-7 w-7 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm border border-[#6EE7B7]">
                        <Package className="h-4 w-4" />
                      </span>
                    </div>
                    <span className="mt-1 text-xs font-extrabold text-[#0F2421] dark:text-white">
                      Moto Entrega
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('delivery');
                      setCategory('delivery_car');
                      setActiveSearchField('destination');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="group flex flex-col items-center justify-center rounded-3xl bg-[#F7FBFA] dark:bg-[#0F2421] p-4 border border-[#CCFBF1] dark:border-teal-900 hover:border-[#047857] active:scale-[0.98] transition"
                  >
                    <div className="relative flex h-24 w-full items-center justify-center">
                      <img
                        src={resolveCategoryVehicleImage('delivery_car', platformConfig)}
                        alt="Entrega Carro"
                        className="h-20 w-28 object-contain"
                      />
                      <span className="absolute bottom-1 left-4 flex h-7 w-7 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm border border-[#6EE7B7]">
                        <Package className="h-4 w-4" />
                      </span>
                    </div>
                    <span className="mt-1 text-xs font-extrabold text-[#0F2421] dark:text-white">
                      Carro Entrega
                    </span>
                  </button>
                </div>

                {/* Enviar / Receber Card with Teal & Orange Rings */}
                <div className="rounded-3xl bg-[#F6F7F9] dark:bg-neutral-900 p-4 space-y-3 border border-neutral-100 dark:border-neutral-800">
                  <div className="flex items-center gap-6 px-1">
                    <button
                      type="button"
                      onClick={() => setDeliveryDirection('send')}
                      className={`pb-1.5 text-lg font-extrabold border-b-[3px] transition ${
                        deliveryDirection === 'send'
                          ? 'border-[#FF6B00] text-neutral-950 dark:text-white'
                          : 'border-transparent text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      Enviar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryDirection('receive')}
                      className={`pb-1.5 text-lg font-extrabold border-b-[3px] transition ${
                        deliveryDirection === 'receive'
                          ? 'border-[#FF6B00] text-neutral-950 dark:text-white'
                          : 'border-transparent text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      Receber
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('delivery');
                      if (category !== 'delivery_moto' && category !== 'delivery_car') {
                        setCategory('delivery_moto');
                      }
                      setActiveSearchField('origin');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left rounded-2xl hover:bg-white/60 dark:hover:bg-neutral-800/60 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3.5px] border-[#00BFA5] bg-white" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                          {origin.address || t.current_location}
                        </p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                          {currentUser.full_name.split(' ')[0]} ·{' '}
                          {currentUser.phone || t.current_location}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('delivery');
                      if (category !== 'delivery_moto' && category !== 'delivery_car') {
                        setCategory('delivery_moto');
                      }
                      setActiveSearchField('destination');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white dark:bg-neutral-800 px-4 shadow-xs hover:shadow-md active:scale-[0.99] transition text-left"
                  >
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3.5px] border-[#FF6B00] bg-white" />
                    <span className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                      {deliveryDirection === 'receive' ? 'Coletar em' : 'Entregar para'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Top Floating Bar + Top Search Card */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] px-3 sm:px-4 pt-safe py-3 space-y-2.5">
        {activeRide && activeRide.status !== 'searching' ? (
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSheetMinimized((v) => !v)}
              className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white dark:bg-neutral-900 text-neutral-950 dark:text-white shadow-lg border border-neutral-200 dark:border-neutral-700 active:scale-95 transition"
              aria-label={sheetMinimized ? 'Mostrar detalhes da corrida' : 'Ver mapa'}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="pointer-events-auto flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-white/95 dark:bg-[#0F2421]/95 px-3.5 py-2 shadow-lg border border-[#2DD4BF]/35">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#34D399]">
                  <span className="h-2 w-2 rounded-full bg-[#065F46]" />
                </span>
                <span className="truncate text-xs sm:text-sm font-bold text-[#0F2421] dark:text-white">
                  {activeRide.status === 'in_progress'
                    ? activeRide.destination_address
                    : activeRide.origin_address}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSheetMinimized(false)}
                className="shrink-0 border-l border-[#CCFBF1] dark:border-teal-800 pl-2.5 text-xs font-extrabold text-[#047857] dark:text-[#6EE7B7]"
              >
                {activeRide.status === 'in_progress'
                  ? durationMin > 0
                    ? `${durationMin} min`
                    : 'Em rota'
                  : 'Detalhes'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setNotificationsOpen(true);
                void loadNotificationsAndCoupons();
              }}
              className="pointer-events-auto relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white dark:bg-neutral-900 text-neutral-950 dark:text-white shadow-lg border border-neutral-200 dark:border-neutral-700 active:scale-95 transition"
              aria-label="Notificações"
            >
              <Bell className="h-5 w-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white font-mono-num shadow-sm">
                  {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                </span>
              )}
            </button>
          </div>
        ) : (
        <div className={`mx-auto flex max-w-2xl items-center justify-between gap-2 ${
          !activeRide && !destination && !unpaidCompletedRide && !idleCleanMap && !pickOnMapMode && homeTab === 'delivery'
            ? 'hidden'
            : ''
        }`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-neutral-900 text-neutral-950 dark:text-white shadow-lg border border-neutral-200 dark:border-neutral-700 active:scale-95 transition"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            {!activeRide && !destination && !idleCleanMap && (
              <div className="pointer-events-auto hidden xs:flex items-center gap-2 rounded-2xl bg-white dark:bg-neutral-900 px-3 py-1.5 shadow-md border border-neutral-200 dark:border-neutral-700">
                <img
                  src={brandLogoUrl}
                  alt={siteName}
                  className="h-7 w-7 rounded-lg object-cover shrink-0"
                />
                <span className="font-display text-sm font-extrabold text-neutral-950 dark:text-white">
                  {siteName}
                </span>
              </div>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            {pickOnMapMode ? (
              <button
                type="button"
                onClick={() => setPickOnMapMode(null)}
                className="aurora-accent-flow flex min-h-[44px] items-center gap-2 rounded-full px-4 text-xs font-bold text-white shadow-lg"
              >
                <MapPin className="h-4 w-4" />
                Toque no mapa ({pickOnMapMode === 'origin' ? 'Embarque' : 'Destino'}) · Cancelar
              </button>
            ) : destination && !activeRide ? (
              <div className="flex items-center gap-2 rounded-full bg-white/95 dark:bg-[#0F2421] px-4 py-2 text-xs font-extrabold text-[#0F2421] dark:text-white shadow-lg border border-[#2DD4BF]/40 font-mono-num">
                <span>
                  {distanceKm} km · {durationMin} min
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIdleCleanMap((v) => !v)}
                className="flex min-h-[42px] items-center gap-1.5 rounded-full bg-white/95 dark:bg-[#0F2421] px-3.5 text-xs font-extrabold text-[#0F2421] dark:text-white shadow-lg border border-[#2DD4BF]/35 active:scale-95 transition"
                title={idleCleanMap ? t.show_panel : t.clean_map}
              >
                {idleCleanMap ? (
                  <>
                    <Eye className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                    <span>{t.where_to}</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="h-4 w-4 text-[#334E4A] dark:text-neutral-300" />
                    <span>{t.clean_map}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setNotificationsOpen(true);
                void loadNotificationsAndCoupons();
              }}
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/95 dark:bg-[#0F2421] text-[#0F2421] dark:text-white shadow-lg border border-[#2DD4BF]/35 active:scale-95 transition"
              aria-label="Notificações"
              title="Notificações"
            >
              <Bell className="h-5 w-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white font-mono-num shadow-sm">
                  {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                </span>
              )}
            </button>
          </div>
        </div>
        )}

        {/* TOP SEARCH CARD ("Para onde vamos?") — SHOWN ON IDLE RIDES TAB */}
        {!activeRide && !destination && !idleCleanMap && !pickOnMapMode && homeTab === 'rides' && (
          <div className="aurora-border-glow pointer-events-auto mx-auto max-w-lg rounded-3xl bg-white/95 dark:bg-[#0F2421]/95 backdrop-blur-md p-3.5 shadow-2xl space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#334E4A] dark:text-neutral-300 min-w-0">
                <MapPin className="h-3.5 w-3.5 text-[#047857] dark:text-[#2DD4BF] shrink-0" />
                <span className="truncate">
                  {gpsFixed
                    ? weather?.city || origin.address || platformConfig.platform_city
                    : t.detecting_gps}
                </span>
                {weather && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFEFF] dark:bg-cyan-950/60 border border-[#2DD4BF]/40 px-2 py-0.5 text-[11px] font-extrabold text-[#0F2421] dark:text-cyan-200 font-mono-num shrink-0">
                    <Thermometer className="h-3 w-3 text-[#0891B2] dark:text-[#2DD4BF]" />
                    {weather.temperatureC}°C
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => openWallet('deposit')}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] dark:bg-teal-950/70 px-3 py-1 text-[11px] font-extrabold text-[#065F46] dark:text-[#6EE7B7] shrink-0 active:scale-95 transition border border-[#34D399]/60"
                title={t.wallet_title}
              >
                <Wallet className="h-3.5 w-3.5 text-[#047857] dark:text-[#6EE7B7]" />
                <span className="font-mono-num">{t.wallet_balance}: {formatBRL(walletBalance)}</span>
                <span className="text-[#047857] dark:text-[#2DD4BF]">· +{t.deposit}</span>
              </button>
            </div>

            {currentUser.status === 'suspended' && (
              <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs font-bold text-red-700 dark:text-red-300">
                Sua conta está temporariamente bloqueada/suspensa. Fale com a administração no Suporte.
              </div>
            )}

            {platformConfig.maintenance_mode && (
              <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                Plataforma em manutenção programada. Algumas solicitações podem estar pausadas.
              </div>
            )}

            {pendingDebt > 0 && (
              <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-950 dark:text-amber-200">
                <span className="font-extrabold">
                  Pendência anterior ({currentUser.pending_debt_note || 'Corrida não paga'}):{' '}
                  <span className="font-mono-num">{formatBRL(pendingDebt)}</span>
                </span>
                <span className="block text-[11px] text-amber-800 dark:text-amber-300">
                  Será somado automaticamente ao valor da sua próxima corrida.
                </span>
              </div>
            )}

            {unpaidCompletedWalletRide && (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#2DD4BF] bg-[#ECFDF5] dark:bg-teal-950/60 px-3 py-2.5 text-[#0F2421] dark:text-white shadow-sm">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#047857] dark:text-[#6EE7B7]">
                    Corrida finalizada · Confirmar pagamento BorealPay
                  </p>
                  <p className="text-[11px] text-[#334E4A] dark:text-neutral-300 font-mono-num">
                    {formatBRL(
                      unpaidCompletedWalletRide.final_fare ?? unpaidCompletedWalletRide.estimated_fare
                    )}{' '}
                    · Leia o QR Code do motorista
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQrScannerRide(unpaidCompletedWalletRide)}
                  className="aurora-accent-flow min-h-[38px] shrink-0 rounded-xl px-3 text-xs font-extrabold text-white"
                >
                  Ler QR BorealPay
                </button>
              </div>
            )}

            {!unpaidCompletedWalletRide && unpaidCompletedPixRide && (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#2DD4BF]/60 bg-[#ECFEFF] dark:bg-cyan-950/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#0F2421] dark:text-white">
                    Corrida finalizada · Pagamento Pix pendente
                  </p>
                  <p className="text-[11px] text-[#334E4A] dark:text-neutral-300 font-mono-num">
                    {formatBRL(
                      unpaidCompletedPixRide.final_fare ?? unpaidCompletedPixRide.estimated_fare
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPixModalRide(unpaidCompletedPixRide)}
                  className="aurora-accent-flow min-h-[38px] shrink-0 rounded-xl px-3 text-xs font-extrabold text-white"
                >
                  Pagar Pix
                </button>
              </div>
            )}

            {!unpaidCompletedWalletRide && !unpaidCompletedPixRide && unpaidCompletedCashRide && (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#2DD4BF]/60 bg-[#ECFDF5] dark:bg-teal-950/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#0F2421] dark:text-white">
                    Corrida finalizada · Pagamento em Dinheiro
                  </p>
                  <p className="text-[11px] text-[#334E4A] dark:text-neutral-300">
                    Pague {formatBRL(unpaidCompletedCashRide.final_fare ?? unpaidCompletedCashRide.estimated_fare)} ao motorista ou escolha outra opção abaixo.
                  </p>
                </div>
                {dismissedCompletedPayIds.includes(unpaidCompletedCashRide.id) ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDismissedCompletedPayIds((prev) =>
                        prev.filter((id) => id !== unpaidCompletedCashRide.id)
                      )
                    }
                    className="aurora-accent-flow min-h-[36px] shrink-0 rounded-xl px-2.5 text-[11px] font-extrabold text-white"
                  >
                    Opções
                  </button>
                ) : (
                  <Clock className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7] shrink-0 animate-pulse" />
                )}
              </div>
            )}

            {/* EXACT GPS EMBARQUE + 1-TAP NEARBY PLACE CHIPS */}
            {gpsFixed && (
              <div className="space-y-1.5 px-0.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSearchField('origin');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
                    <span className="truncate font-bold text-[#0F2421] dark:text-neutral-200">
                      Embarque: {origin.address || t.current_location}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSearchField('origin');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="shrink-0 text-[11px] font-extrabold text-[#047857] dark:text-[#6EE7B7] hover:underline"
                  >
                    Editar
                  </button>
                </div>

                {nearbyPickupOptions.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                    {nearbyPickupOptions.map((opt, idx) => {
                      const shortName = opt.address.split('·')[0].trim();
                      const isSelected = origin.address
                        .toLowerCase()
                        .startsWith(shortName.toLowerCase());
                      return (
                        <button
                          key={`${opt.lat}-${opt.lng}-${idx}`}
                          type="button"
                          onClick={() => {
                            setOrigin({
                              lat: opt.lat,
                              lng: opt.lng,
                              address: opt.address,
                            });
                            setOriginQuery(opt.address);
                          }}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                            isSelected
                              ? 'border-[#047857] bg-[#ECFDF5] dark:bg-emerald-950/50 text-[#065F46] dark:text-emerald-200'
                              : 'border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] text-[#334E4A] dark:text-neutral-200 hover:border-[#047857]'
                          }`}
                        >
                          <MapPin className="h-3 w-3 shrink-0 text-[#047857] dark:text-[#6EE7B7]" />
                          <span className="max-w-[140px] truncate">{shortName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* PRIMARY TOP SEARCH TRIGGER (AURORA BOREAL LIGHT WAVE) */}
            <button
              type="button"
              onClick={() => {
                setActiveSearchField('destination');
                setAddressTab('search');
                setAddressScreenOpen(true);
              }}
              className="aurora-search-trigger flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3.5 text-left"
            >
              <span className="aurora-accent-flow flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm shrink-0">
                <Search className="h-4 w-4" />
              </span>
              <span className="font-display text-base sm:text-lg font-extrabold text-[#0F2421] dark:text-white">
                {t.where_to}
              </span>
            </button>

            {/* Quick Mode + Saved Shortcut Row */}
            <div className="grid grid-cols-5 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setServiceTab('rides');
                  setCategory('pop');
                  setActiveSearchField('destination');
                  setAddressTab('search');
                  setAddressScreenOpen(true);
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] py-2 px-1 text-center hover:border-[#047857]"
              >
                <img
                  src={resolveCategoryVehicleImage('pop', platformConfig)}
                  alt={t.rides_tab}
                  className="h-7 w-9 object-contain"
                />
                <span className="text-[10px] font-extrabold text-[#0F2421] dark:text-neutral-100 truncate w-full">{t.rides_tab}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setServiceTab('delivery');
                  setCategory('delivery_moto');
                  setActiveSearchField('destination');
                  setAddressTab('search');
                  setAddressScreenOpen(true);
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] py-2 px-1 text-center hover:border-[#047857]"
              >
                <img
                  src={resolveCategoryVehicleImage('delivery_moto', platformConfig)}
                  alt={t.deliveries_tab}
                  className="h-7 w-9 object-contain"
                />
                <span className="text-[10px] font-extrabold text-[#0F2421] dark:text-neutral-100 truncate w-full">{t.deliveries_tab}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (currentUser.home_address) {
                    selectDestinationPoint(currentUser.home_address);
                  } else {
                    setSettingsOpen(true);
                  }
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] py-2 px-1 text-center hover:border-[#047857]"
              >
                <Home className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                <span className="text-[10px] font-bold text-[#0F2421] dark:text-neutral-200 truncate w-full">{t.home_label}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (currentUser.work_address) {
                    selectDestinationPoint(currentUser.work_address);
                  } else {
                    setSettingsOpen(true);
                  }
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] py-2 px-1 text-center hover:border-[#047857]"
              >
                <Briefcase className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
                <span className="text-[10px] font-bold text-[#0F2421] dark:text-neutral-200 truncate w-full">{t.work_label}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAddressTab('favorites');
                  setAddressScreenOpen(true);
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[#CCFBF1] dark:border-teal-900 bg-[#F7FBFA] dark:bg-[#081513] py-2 px-1 text-center hover:border-[#047857]"
              >
                <Star className="h-4 w-4 text-[#0891B2] dark:text-[#2DD4BF]" />
                <span className="text-[10px] font-bold text-[#0F2421] dark:text-neutral-200 truncate w-full">{t.favorites_label}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING BOTTOM NAVIGATION PILL (Corrida | Entrega | BorealPay) ON IDLE SCREEN */}
      {!activeRide &&
        !destination &&
        !unpaidCompletedRide &&
        !idleCleanMap &&
        !pickOnMapMode &&
        !addressScreenOpen && (
          <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-[610] flex justify-center px-4 pb-safe">
            <nav
              aria-label="Navegação principal"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/95 dark:bg-[#0F2421]/95 backdrop-blur-md px-3 py-1.5 shadow-2xl border border-[#2DD4BF]/40"
            >
              <button
                type="button"
                onClick={() => {
                  setHomeTab('rides');
                  setServiceTab('rides');
                  if (category === 'delivery_moto' || category === 'delivery_car') {
                    setCategory('pop');
                  }
                }}
                className={`flex min-w-[74px] flex-col items-center justify-center rounded-full px-3 py-1.5 transition active:scale-95 ${
                  homeTab === 'rides'
                    ? 'aurora-accent-flow text-white shadow-sm'
                    : 'text-[#334E4A] dark:text-neutral-300 hover:bg-[#ECFDF5] dark:hover:bg-teal-950/60'
                }`}
              >
                <Car className="h-5 w-5" />
                <span className="mt-0.5 text-[11px] font-extrabold leading-none">
                  Corrida
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setHomeTab('delivery');
                  setServiceTab('delivery');
                  if (category !== 'delivery_moto' && category !== 'delivery_car') {
                    setCategory('delivery_moto');
                  }
                }}
                className={`flex min-w-[74px] flex-col items-center justify-center rounded-full px-3 py-1.5 transition active:scale-95 ${
                  homeTab === 'delivery'
                    ? 'aurora-accent-flow text-white shadow-sm'
                    : 'text-[#334E4A] dark:text-neutral-300 hover:bg-[#ECFDF5] dark:hover:bg-teal-950/60'
                }`}
              >
                <Package className="h-5 w-5" />
                <span className="mt-0.5 text-[11px] font-extrabold leading-none">
                  Entrega
                </span>
              </button>

              <button
                type="button"
                onClick={() => openWallet('deposit')}
                className="flex min-w-[74px] flex-col items-center justify-center rounded-full px-3 py-1.5 text-[#047857] dark:text-[#6EE7B7] hover:bg-[#ECFDF5] dark:hover:bg-teal-950/60 transition active:scale-95"
              >
                <DollarSign className="h-5 w-5" />
                <span className="mt-0.5 text-[11px] font-extrabold leading-none">
                  BorealPay
                </span>
              </button>
            </nav>
          </div>
        )}

      {/* Bottom Sheet / Floating Card (Shown ONLY when choosing fare/category, active ride, OR post-ride payment) */}
      {(Boolean(destination) ||
        Boolean(activeRide) ||
        Boolean(
          unpaidCompletedRide && !dismissedCompletedPayIds.includes(unpaidCompletedRide.id)
        )) && (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-0 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        {activeRide && activeRide.status !== 'searching' && sheetMinimized ? (
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
            className="pointer-events-auto m-2.5 sm:m-0 flex items-center justify-between gap-2 rounded-2xl bg-white dark:bg-neutral-900 px-3.5 py-3 shadow-2xl border border-neutral-200 dark:border-neutral-800"
          >
            <button
              type="button"
              onClick={() => setSheetMinimized(false)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#047857] font-mono-num text-xs font-extrabold text-white">
                {isDeliveryActive && activeRide.require_pin === false ? 'OK' : activeRide.pin_code}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                  {activeRide.driver?.driver?.vehicle_plate || 'Veículo'} ·{' '}
                  {activeRide.driver?.full_name.split(' ')[0]}
                </p>
                <p className="text-[11px] font-semibold text-[#047857] dark:text-[#6EE7B7] truncate">
                  {activeRide.status === 'arrived'
                    ? passengerWaitingStats.isCharging
                      ? `Espera +${formatBRL(passengerWaitingStats.waitingFee)}`
                      : `Aguardando (${String(Math.floor(passengerWaitingStats.remainingFreeSec / 60)).padStart(2, '0')}:${String(passengerWaitingStats.remainingFreeSec % 60).padStart(2, '0')})`
                    : activeRide.status === 'in_progress'
                    ? 'Em viagem para o destino'
                    : 'Motorista a caminho'}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeRide.driver?.phone && (
                <a
                  href={`tel:${activeRide.driver.phone.replace(/\D/g, '')}`}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white active:scale-95"
                  aria-label="Ligar para motorista"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#ECFDF5] border border-[#6EE7B7] text-[#047857] active:scale-95"
                aria-label="Abrir chat"
              >
                <MessageSquare className="h-4 w-4" />
                {currentChatMessages.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#047857] px-1 text-[9px] font-extrabold text-white font-mono-num">
                    {currentChatMessages.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSheetMinimized(false)}
                className="aurora-accent-flow flex h-10 items-center gap-1 rounded-xl px-3 text-xs font-extrabold text-white active:scale-95"
                aria-label="Expandir painel"
              >
                <ChevronUp className="h-4 w-4" />
                <span>Abrir</span>
              </button>
            </div>
          </div>
        ) : (
        <div className="pointer-events-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-5 pb-safe shadow-2xl border-t sm:border border-neutral-200 dark:border-neutral-800 max-h-[78vh] overflow-y-auto">
          {activeRide && activeRide.status !== 'searching' && (
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
              className="mb-3 -mt-2 flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-2 touch-none"
            >
              <div className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <button
                type="button"
                onClick={() => setSheetMinimized(true)}
                className="flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-[11px] font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Minimizar mapa</span>
              </button>
            </div>
          )}
          {!activeRide ? (
            destination ? (
              /* CATEGORY & FARE SELECTION BOTTOM SHEET */
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSearchField('destination');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0 text-neutral-700 dark:text-neutral-300" />
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                        {destination.address}
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono-num truncate">
                        {origin.address || t.current_location} · {distanceKm} km · {durationMin} min
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDestination(null);
                      setDestQuery('');
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                    aria-label="Limpar destino"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Service Switch: Viagens vs Entregas */}
                <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('rides');
                      if (category === 'delivery_moto' || category === 'delivery_car') {
                        setCategory('pop');
                      }
                    }}
                    className={`min-h-[38px] rounded-xl text-xs font-extrabold transition ${
                      serviceTab === 'rides'
                        ? 'bg-white dark:bg-neutral-950 text-[#047857] dark:text-[#6EE7B7] shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {t.rides_tab}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setServiceTab('delivery');
                      if (category !== 'delivery_moto' && category !== 'delivery_car') {
                        setCategory('delivery_moto');
                      }
                    }}
                    className={`min-h-[38px] rounded-xl text-xs font-extrabold transition ${
                      serviceTab === 'delivery'
                        ? 'bg-white dark:bg-neutral-950 text-[#047857] dark:text-[#6EE7B7] shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {t.deliveries_tab}
                  </button>
                </div>

                {errorMsg && (
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300">
                    {errorMsg}
                  </div>
                )}

                {/* Vehicle List with 3D Vehicle Assets */}
                <div className="space-y-1.5 max-h-[32vh] overflow-y-auto pr-0.5">
                  {visiblePricingList.map((cat) => {
                    const selected = category === cat.category;
                    const fare =
                      cat.category === 'negocia' && selected
                        ? activeNegociaFare
                        : getFareForCategory(cat);
                    const isMoto =
                      cat.category === 'moto' || cat.category === 'delivery_moto';
                    const imgSrc = resolveCategoryVehicleImage(cat.category, platformConfig);

                    return (
                      <div
                        key={cat.category}
                        className={`rounded-2xl border-2 transition ${
                          selected
                            ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#ECFDF5]/85 dark:bg-emerald-950/35'
                            : 'border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-800/60 hover:border-[#6EE7B7] dark:hover:border-emerald-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setCategory(cat.category)}
                          className="flex min-h-[64px] w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={imgSrc}
                              alt={cat.label}
                              className="h-12 w-14 shrink-0 rounded-xl object-contain bg-white"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-extrabold text-neutral-950 dark:text-white truncate">
                                {cat.label}
                              </p>
                              <p className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
                                {cat.description}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono-num text-sm font-extrabold text-neutral-950 dark:text-white">
                              {formatBRL(fare + pendingDebt)}
                            </p>
                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono-num">
                              ~
                              {Math.max(
                                2,
                                isMoto ? Math.round(durationMin * 0.75) : durationMin
                              )}{' '}
                              min
                            </p>
                          </div>
                        </button>

                        {/* Interactive Fare Negotiation Stepper for Negocia */}
                        {cat.category === 'negocia' && selected && (
                          <div className="flex items-center justify-between border-t border-neutral-950/10 dark:border-neutral-700 px-3.5 py-2 bg-white dark:bg-neutral-900 rounded-b-2xl">
                            <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300">
                              Sua oferta (mín. {formatBRL(cat.min_fare)}):
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setNegotiatedFare(
                                    Number(
                                      Math.max(
                                        cat.min_fare,
                                        activeNegociaFare - 1
                                      ).toFixed(2)
                                    )
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white active:scale-95"
                                aria-label="Diminuir oferta"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="min-w-[74px] text-center font-mono-num text-sm font-extrabold text-neutral-950 dark:text-white">
                                {formatBRL(activeNegociaFare)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNegotiatedFare(
                                    Number((activeNegociaFare + 1).toFixed(2))
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421] active:scale-95"
                                aria-label="Aumentar oferta"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(category === 'delivery_moto' || category === 'delivery_car') && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      placeholder="Instruções de coleta ou destinatário (opcional)"
                      className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
                    />
                    <label className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 cursor-pointer">
                      <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                        Exigir PIN de 4 dígitos na entrega (opcional)
                      </span>
                      <input
                        type="checkbox"
                        checked={requireDeliveryPin}
                        onChange={(e) => setRequireDeliveryPin(e.target.checked)}
                        className="h-4 w-4 accent-neutral-950"
                      />
                    </label>
                  </div>
                )}

                {pendingDebt > 0 && (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-950 dark:text-amber-200">
                    <span className="font-extrabold">
                      Débito pendente incluído: +{formatBRL(pendingDebt)}
                    </span>{' '}
                    ({currentUser.pending_debt_note || 'Corrida não paga'})
                  </div>
                )}

                {/* CUPONS DISPONÍVEIS — EXIBIDO SOMENTE QUANDO O USUÁRIO POSSUI CUPONS ATIVOS */}
                {availableCoupons.length > 0 && (
                  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-900 dark:text-emerald-300">
                        <Gift className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Cupons disponíveis ({availableCoupons.length})
                      </span>
                      {selectedUserCoupon && couponDiscount > 0 && (
                        <span className="rounded-lg bg-emerald-600 px-2 py-0.5 font-mono-num text-[10px] font-extrabold text-white">
                          -{formatBRL(couponDiscount)} aplicado
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                      <button
                        type="button"
                        onClick={() => setSelectedUserCoupon(null)}
                        className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-bold transition ${
                          !selectedUserCoupon
                            ? 'border-neutral-950 dark:border-white bg-neutral-950 dark:bg-white text-white dark:text-neutral-950'
                            : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        Sem cupom
                      </button>
                      {availableCoupons.map((uc) => {
                        const c = uc.coupon;
                        if (!c) return null;
                        const active = selectedUserCoupon?.id === uc.id;
                        const previewDiscount = computeCouponDiscount(c, selectedCategoryFare);
                        return (
                          <button
                            key={uc.id}
                            type="button"
                            onClick={() => setSelectedUserCoupon(active ? null : uc)}
                            className={`shrink-0 rounded-xl border px-3 py-1.5 text-left transition ${
                              active
                                ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                                : 'border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white'
                            }`}
                          >
                            <span className="block text-[11px] font-extrabold font-mono-num">
                              {c.code} ·{' '}
                              {c.discount_type === 'percent'
                                ? `${c.discount_value}% OFF`
                                : `-${formatBRL(c.discount_value)}`}
                            </span>
                            <span className="block text-[10px] opacity-80">
                              {previewDiscount > 0
                                ? `Economiza ${formatBRL(previewDiscount)}`
                                : `Mín. ${formatBRL(c.min_ride_fare)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Payment Method: EXCLUSIVAMENTE BorealPay (Saldo na Conta) vs Dinheiro */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      id: 'wallet' as PaymentMethod,
                      label: 'BorealPay (Saldo na Conta)',
                      sub: `Disponível: ${formatBRL(walletBalance)}`,
                      icon: Wallet,
                    },
                    {
                      id: 'cash' as PaymentMethod,
                      label: t.pay_with_cash,
                      sub: 'Pagar ao motorista',
                      icon: Banknote,
                    },
                  ].map((pm) => {
                    const active = paymentMethod === pm.id;
                    const PmIcon = pm.icon;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(pm.id);
                          setErrorMsg(null);
                        }}
                        className={`min-h-[58px] flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2.5 py-2 transition ${
                          active
                            ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421] shadow-sm'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-extrabold">
                          <PmIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{pm.label}</span>
                        </div>
                        <span
                          className={`text-[10px] font-mono-num font-bold ${
                            active ? 'text-white/90 dark:text-[#0F2421]/80' : 'text-neutral-500 dark:text-neutral-400'
                          }`}
                        >
                          {pm.sub}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {paymentMethod === 'wallet' && !hasEnoughWalletBalance && (
                  <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#6EE7B7] dark:border-emerald-800 bg-[#ECFDF5] dark:bg-emerald-950/40 px-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-extrabold text-[#065F46] dark:text-[#6EE7B7]">
                        Saldo BorealPay insuficiente ({formatBRL(walletBalance)})
                      </p>
                      <p className="text-[11px] text-[#047857] dark:text-emerald-300">
                        {depositWindow.isOpen ? (
                          <>
                            Deposite{' '}
                            <strong className="font-mono-num">
                              {formatBRL(totalFareWithDebt - walletBalance)}
                            </strong>{' '}
                            na carteira BorealPay via Pix ou pague em Dinheiro.
                          </>
                        ) : (
                          <>
                            Depósitos Pix pausados fora do horário ({depositWindow.startTime} às{' '}
                            {depositWindow.endTime}). Quem já tem saldo usa normal; use{' '}
                            <strong>Dinheiro</strong> agora.
                          </>
                        )}
                      </p>
                    </div>
                    {depositWindow.isOpen ? (
                      <button
                        type="button"
                        onClick={() => openWallet('deposit')}
                        className="min-h-[38px] shrink-0 rounded-xl bg-[#047857] px-3 text-[11px] font-extrabold text-white"
                      >
                        Depositar BorealPay
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cash')}
                        className="min-h-[38px] shrink-0 rounded-xl bg-emerald-600 px-3 text-[11px] font-extrabold text-white"
                      >
                        Usar Dinheiro
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRequestRide}
                  disabled={submitting || (paymentMethod === 'wallet' && !hasEnoughWalletBalance)}
                  className="aurora-accent-flow min-h-[52px] w-full rounded-2xl text-base font-extrabold text-white shadow-md active:scale-[0.98] transition disabled:opacity-50"
                >
                  {submitting
                    ? t.requesting_btn
                    : `${formatBRL(totalFareWithDebt)} · ${t.request_ride_btn} ${CATEGORY_LABELS[category]}`}
                </button>
              </div>
            ) : unpaidCompletedRide && !dismissedCompletedPayIds.includes(unpaidCompletedRide.id) ? (
              /* POST-RIDE CHECKOUT: BOREALPAY QR/CHAVE OR DINHEIRO */
              (() => {
                const unpaidFare = Number(
                  (unpaidCompletedRide.final_fare ?? unpaidCompletedRide.estimated_fare).toFixed(2)
                );
                const canPayWithWallet =
                  unpaidCompletedRide.payment_method === 'wallet' || walletBalance >= unpaidFare;
                const isCashChosen =
                  unpaidCompletedRide.payment_method === 'cash' &&
                  cashChoiceConfirmedRideIds.includes(unpaidCompletedRide.id);

                return (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Corrida finalizada
                          </span>
                          <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white leading-tight">
                            {unpaidCompletedRide.payment_method === 'wallet'
                              ? 'Confirmar pagamento BorealPay'
                              : 'Como você quer pagar a corrida?'}
                          </h3>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedCompletedPayIds((prev) =>
                            prev.includes(unpaidCompletedRide.id)
                              ? prev
                              : [...prev, unpaidCompletedRide.id]
                          )
                        }
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                        aria-label="Minimizar resumo de pagamento"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-neutral-950 dark:text-white truncate">
                          {CATEGORY_LABELS[unpaidCompletedRide.category]} ·{' '}
                          {unpaidCompletedRide.driver?.full_name.split(' ')[0] || 'Motorista'}
                        </p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                          Para: {unpaidCompletedRide.destination_address}
                        </p>
                      </div>
                      <span className="font-mono-num text-xl font-extrabold text-[#047857] dark:text-[#6EE7B7] shrink-0">
                        {formatBRL(unpaidFare)}
                      </span>
                    </div>

                    {postRidePaymentError && (
                      <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300">
                        {postRidePaymentError}
                      </div>
                    )}

                    {unpaidCompletedRide.payment_method === 'wallet' && (
                      <div className="rounded-2xl border border-[#6EE7B7] bg-[#ECFDF5] dark:bg-emerald-950/40 p-3 text-xs text-[#0F2421] dark:text-emerald-100">
                        <p className="font-extrabold">Valor reservado na sua carteira BorealPay</p>
                        <p className="mt-0.5 text-[11px]">
                          Escaneie o QR Code BorealPay na tela do motorista (ou informe a Chave BorealPay dele) para transferir o valor e emitir seu comprovante.
                        </p>
                      </div>
                    )}

                    {isCashChosen && (
                      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs">
                        <Banknote className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400 mt-0.5" />
                        <div>
                          <p className="font-extrabold text-emerald-950 dark:text-emerald-200">
                            Pagamento em Dinheiro selecionado
                          </p>
                          <p className="mt-0.5 text-emerald-800 dark:text-emerald-300">
                            Pague <strong className="font-mono-num">{formatBRL(unpaidFare)}</strong> em dinheiro diretamente ao motorista (aguardando confirmação dele), ou conclua via QR BorealPay abaixo.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={Boolean(postRidePaymentBusy) || !canPayWithWallet}
                        onClick={() => setQrScannerRide(unpaidCompletedRide)}
                        className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center transition active:scale-[0.98] disabled:opacity-55 ${
                          canPayWithWallet
                            ? 'border-[#047857] dark:border-[#2DD4BF] bg-[#047857] dark:bg-[#2DD4BF] text-white dark:text-[#0F2421] shadow-sm'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        <QrCode className="h-5 w-5 shrink-0" />
                        <span className="text-xs font-extrabold leading-tight">
                          Ler QR / Pagar BorealPay
                        </span>
                        <span className="font-mono-num text-[10px] font-bold opacity-85">
                          {unpaidCompletedRide.payment_method === 'wallet'
                            ? 'Saldo reservado'
                            : formatBRL(walletBalance)}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={Boolean(postRidePaymentBusy)}
                        onClick={() => handleChooseCompletedCash(unpaidCompletedRide)}
                        className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center transition active:scale-[0.98] disabled:opacity-55 ${
                          unpaidCompletedRide.payment_method === 'cash'
                            ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                            : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-50'
                        }`}
                      >
                        <Banknote className="h-5 w-5 shrink-0" />
                        <span className="text-xs font-extrabold leading-tight">
                          {postRidePaymentBusy === 'cash' ? 'Salvando...' : 'Dinheiro'}
                        </span>
                        <span className="text-[10px] font-bold opacity-80">Ao motorista</span>
                      </button>
                    </div>

                    {!canPayWithWallet && (
                      <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#6EE7B7] dark:border-emerald-800 bg-[#ECFDF5] dark:bg-emerald-950/30 px-3 py-2 text-[11px]">
                        <span className="font-semibold text-[#065F46] dark:text-[#6EE7B7]">
                          {depositWindow.isOpen
                            ? `Saldo BorealPay insuficiente (${formatBRL(walletBalance)}).`
                            : `Depósitos Pix das ${depositWindow.startTime} às ${depositWindow.endTime}. Selecione Dinheiro para pagar ao motorista.`}
                        </span>
                        {depositWindow.isOpen ? (
                          <button
                            type="button"
                            onClick={() => openWallet('deposit')}
                            className="shrink-0 rounded-xl bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1.5 font-extrabold text-white dark:text-[#0F2421]"
                          >
                            Depositar BorealPay
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(postRidePaymentBusy)}
                            onClick={() => handleChooseCompletedCash(unpaidCompletedRide)}
                            className="shrink-0 rounded-xl bg-emerald-600 px-2.5 py-1.5 font-extrabold text-white"
                          >
                            Pagar em Dinheiro
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : null
          ) : activeRide.status === 'searching' ? (
            /* MODERN CLEAN SEARCHING POP-UP */
            <div className="space-y-4 py-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div className="h-full w-1/2 rounded-full aurora-accent-flow animate-pulse" />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                    {t.ride_requested_title}
                  </h3>
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {t.finding_driver_sub}
                  </p>
                </div>
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#6EE7B7] dark:border-emerald-800">
                  <span className="absolute inset-0 rounded-full bg-[#2DD4BF]/40 animate-radar-ring" />
                  {isDeliveryActive ? (
                    <Package className="relative h-6 w-6 text-[#047857] dark:text-[#6EE7B7]" />
                  ) : (
                    <Car className="relative h-6 w-6 text-[#047857] dark:text-[#6EE7B7]" />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-neutral-200/80 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={resolveCategoryVehicleImage(activeRide.category, platformConfig)}
                    alt={CATEGORY_LABELS[activeRide.category]}
                    className="h-11 w-14 rounded-xl object-cover bg-white border border-neutral-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-neutral-950 dark:text-white">
                      {CATEGORY_LABELS[activeRide.category]} · {activeRide.distance_km} km
                    </p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                      {activeRide.origin_address} → {activeRide.destination_address}
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-base font-extrabold text-[#047857] dark:text-[#6EE7B7] shrink-0 pl-2">
                  {formatBRL(activeRide.estimated_fare)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCancelRide}
                className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
              >
                {t.cancel_request}
              </button>
            </div>
          ) : (
            /* MODERN MATCHED / LIVE TRACKING BOTTOM SHEET */
            (() => {
              const drvName = activeRide.driver?.full_name || 'Parceiro';
              const drvRating = (activeRide.driver?.rating_avg ?? 5).toFixed(1);
              const drvTrips = activeRide.driver?.rating_count ?? 0;
              const etaMinutes = Math.max(2, durationMin || 3);
              const arrivalClock = new Date(Date.now() + etaMinutes * 60_000).toLocaleTimeString(
                'pt-BR',
                { hour: '2-digit', minute: '2-digit' }
              );
              const pickupClock = new Date(
                activeRide.started_at || activeRide.accepted_at || activeRide.created_at
              ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              const currentFareTotal =
                activeRide.estimated_fare + passengerWaitingStats.waitingFee;

              if (activeRide.status === 'in_progress') {
                return (
                  <div className="space-y-4">
                    {/* Header: Previsão de chegada HH:MM */}
                    <div className="text-center">
                      <h3 className="font-display text-xl font-extrabold text-neutral-950 dark:text-white">
                        Previsão de chegada{' '}
                        <span className="font-mono-num">{arrivalClock}</span>
                      </h3>
                    </div>

                    {/* Driver Photo + Name + Rating + Excelente motorista + Chat Icon w/ Dot */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <AvatarImage
                          src={activeRide.driver?.avatar_url}
                          name={drvName}
                          className="h-14 w-14 rounded-full object-cover border-2 border-white dark:border-neutral-800 shadow-sm shrink-0"
                          fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-[#047857] text-[#6EE7B7] font-extrabold text-lg shrink-0"
                        />
                        <div className="min-w-0 space-y-1">
                          <p className="text-base font-extrabold uppercase text-neutral-950 dark:text-white truncate leading-tight">
                            {drvName}
                          </p>
                          <div className="flex items-center gap-1 text-xs font-bold text-neutral-700 dark:text-neutral-300">
                            <span className="font-mono-num">{drvRating}</span>
                            <Star className="h-3.5 w-3.5 fill-[#047857] dark:fill-[#6EE7B7] text-[#047857] dark:text-[#6EE7B7]" />
                            {drvTrips > 0 && (
                              <span className="text-neutral-500 dark:text-neutral-400 font-mono-num">
                                · {drvTrips} avaliações
                              </span>
                            )}
                          </div>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-[#065F46] dark:text-[#6EE7B7]">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#047857] text-white">
                              <Star className="h-2.5 w-2.5 fill-white text-white" />
                            </span>
                            {isDeliveryActive ? 'Excelente entregador' : 'Excelente motorista'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setChatOpen(true)}
                        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition"
                        aria-label="Abrir chat com motorista"
                      >
                        <MessageSquare className="h-5 w-5" />
                        <span
                          className={`absolute top-2 right-2 h-2.5 w-2.5 rounded-full ${
                            currentChatMessages.length > 0 ? 'bg-[#FF6B00]' : 'bg-[#FF6B00]/80'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Category & Fare Row */}
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
                      <span className="text-base font-extrabold text-neutral-950 dark:text-white">
                        {CATEGORY_LABELS[activeRide.category]}
                      </span>
                      <span className="font-mono-num text-base font-extrabold text-neutral-950 dark:text-white">
                        {formatBRL(currentFareTotal)}
                      </span>
                    </div>

                    {/* Payment Method Row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] dark:bg-emerald-950/60 text-[#047857] dark:text-[#6EE7B7]">
                          {activeRide.payment_method === 'wallet' ? (
                            <Wallet className="h-4 w-4" />
                          ) : (
                            <Banknote className="h-4 w-4" />
                          )}
                        </span>
                        <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                          {activeRide.payment_method === 'wallet'
                            ? 'BorealPay (Saldo na Conta)'
                            : activeRide.payment_method === 'pix'
                            ? 'Pix'
                            : 'Dinheiro'}
                        </span>
                      </div>

                      {activeRide.payment_method === 'wallet' &&
                      activeRide.payment_status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => setQrScannerRide(activeRide)}
                          className="shrink-0 rounded-full bg-[#047857] dark:bg-[#2DD4BF] px-3.5 py-1.5 text-xs font-extrabold text-white dark:text-[#0F2421] shadow-xs active:scale-95"
                        >
                          Ler QR BorealPay
                        </button>
                      ) : activeRide.payment_method === 'pix' &&
                        activeRide.payment_status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => setPixModalRide(activeRide)}
                          className="shrink-0 rounded-full bg-[#047857] dark:bg-[#2DD4BF] px-3.5 py-1.5 text-xs font-extrabold text-white dark:text-[#0F2421] shadow-xs active:scale-95"
                        >
                          Pagar Pix
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800 px-3 py-1 text-xs font-bold text-neutral-600 dark:text-neutral-300">
                          {activeRide.payment_status === 'paid' ||
                          activeRide.payment_status === 'paid_wallet' ||
                          activeRide.payment_status === 'paid_pix'
                            ? 'Pago'
                            : 'Ao chegar'}
                        </span>
                      )}
                    </div>

                    {/* Paid BorealPay Receipt Banner if already settled */}
                    {activeRide.payment_method === 'wallet' &&
                      (activeRide.payment_status === 'paid' ||
                        activeRide.payment_status === 'paid_wallet') && (
                        <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                          <span className="flex items-center gap-1.5">
                            <Wallet className="h-4 w-4" />
                            Pago via BorealPay!
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const savedReceipt = receiptsByRideId[activeRide.id];
                              if (savedReceipt) {
                                setReceiptModalState({ receipt66: savedReceipt });
                              } else {
                                setReceiptModalState({
                                  transaction: {
                                    id: activeRide.id,
                                    user_id: currentUser.id,
                                    ride_id: activeRide.id,
                                    amount: -(activeRide.final_fare ?? activeRide.estimated_fare),
                                    type: 'ride_debit',
                                    description: `Corrida BorealPay #${activeRide.id.slice(-4)} · ${activeRide.destination_address}`,
                                    auth_code: `BPAY-${activeRide.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
                                    sender_name: currentUser.full_name,
                                    recipient_name: drvName,
                                    recipient_key:
                                      activeRide.driver?.pay66_key ||
                                      (activeRide.driver_id
                                        ? `BOREAL-${activeRide.driver_id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
                                        : 'BorealPay'),
                                    created_at: activeRide.completed_at || activeRide.created_at,
                                  },
                                });
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1 text-[11px] font-extrabold text-white dark:text-[#0F2421]"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Comprovante
                          </button>
                        </div>
                      )}

                    {/* Route Timeline: ◉ Origin + ⚑ Destination */}
                    <div className="space-y-1 pt-1">
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center pt-1">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#6EE7B7]/45">
                            <span className="h-2 w-2 rounded-full bg-[#047857] ring-2 ring-[#2DD4BF]/50" />
                          </span>
                          <span className="mt-1 h-5 w-[1.5px] bg-neutral-200 dark:bg-neutral-700" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-neutral-400 dark:text-neutral-500 truncate">
                            {activeRide.origin_address}
                          </p>
                          <p className="font-mono-num text-xs text-neutral-400 dark:text-neutral-500">
                            {pickupClock}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="pt-0.5">
                          <Flag className="h-4 w-4 fill-[#047857] text-[#047857] dark:fill-[#6EE7B7] dark:text-[#6EE7B7]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                            {activeRide.destination_address}
                          </p>
                          <p className="font-mono-num text-xs text-neutral-500 dark:text-neutral-400">
                            {arrivalClock}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Help & Share Pill Buttons */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setSupportChatOpen(true)}
                        className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-sm font-extrabold text-neutral-950 dark:text-white hover:bg-neutral-200/70 dark:hover:bg-neutral-700 active:scale-[0.98] transition"
                      >
                        <Headphones className="h-4 w-4" />
                        <span>Ajuda</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleShareActiveTrip}
                        className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-sm font-extrabold text-neutral-950 dark:text-white hover:bg-neutral-200/70 dark:hover:bg-neutral-700 active:scale-[0.98] transition"
                      >
                        <Share2 className="h-4 w-4" />
                        <span>Compartilhar</span>
                      </button>
                    </div>

                    {shareNotice && (
                      <p className="text-center text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        {shareNotice}
                      </p>
                    )}

                    {/* Security Center Footer Link */}
                    <button
                      type="button"
                      onClick={() => setInfoModal('security')}
                      className="flex w-full items-center justify-start gap-1 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-sm font-extrabold text-neutral-950 dark:text-white"
                    >
                      <span>Central de Segurança</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-3.5">
                  {/* Floating Security Prompt Pill above main sheet details */}
                  <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#F8FAFC] dark:bg-neutral-800/70 border border-neutral-200/70 dark:border-neutral-700 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] dark:bg-blue-950/60 text-[#1677FF]">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <span className="text-xs font-bold text-[#1677FF] dark:text-blue-300 truncate">
                        Central de Segurança e contatos
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInfoModal('security')}
                      className="shrink-0 rounded-full bg-[#EFF6FF] dark:bg-blue-950/80 px-3 py-1 text-xs font-extrabold text-[#1677FF] dark:text-blue-300"
                    >
                      Abrir
                    </button>
                  </div>

                  {/* Headline: Embarque em X min (blue ETA) or Motorista no local */}
                  <div className="text-center">
                    <h3 className="font-display text-xl font-extrabold text-neutral-950 dark:text-white">
                      {activeRide.status === 'accepted' ? (
                        <>
                          {isDeliveryActive ? `${t.pickup_in} ` : `${t.boarding_in} `}
                          <span className="text-[#1677FF] dark:text-blue-400 font-mono-num">
                            {durationMin > 0 ? `${durationMin} min` : '3 min'}
                          </span>
                        </>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {isDeliveryActive ? t.deliverer_arrived : t.driver_arrived}
                        </span>
                      )}
                    </h3>
                  </div>

                  {/* 4-Digit Boarding PIN Card (Ice-Blue Card + 4 Vibrant Blue Digit Tiles) */}
                  {!isDeliveryActive || activeRide.require_pin !== false ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#EFF6FF] dark:bg-blue-950/40 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-neutral-950 dark:text-white truncate">
                          {isDeliveryActive ? t.delivery_pin_title : 'PIN desta corrida'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {String(activeRide.pin_code || '0000')
                          .padStart(4, '0')
                          .slice(0, 4)
                          .split('')
                          .map((digit, idx) => (
                            <span
                              key={idx}
                              className="flex h-9 w-8 items-center justify-center rounded-lg bg-[#1677FF] font-mono-num text-base font-extrabold text-white shadow-xs"
                            >
                              {digit}
                            </span>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                      <span>Entrega direta sem necessidade de código PIN</span>
                    </div>
                  )}

                  {/* Plate & Vehicle Model + Overlapping Car & Driver Avatar */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="min-w-0 space-y-1">
                      <p className="font-mono-num text-[26px] font-extrabold tracking-tight text-neutral-950 dark:text-white leading-none">
                        {activeRide.driver?.driver?.vehicle_plate || '---'}
                      </p>
                      <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 truncate">
                        {activeRide.driver?.driver?.vehicle_color || ''}{' '}
                        {activeRide.driver?.driver?.vehicle_model || 'Veículo'}
                      </p>
                    </div>

                    <div className="relative flex items-center shrink-0 pr-1">
                      <img
                        src={resolveCategoryVehicleImage(activeRide.category, platformConfig)}
                        alt={CATEGORY_LABELS[activeRide.category]}
                        className="h-14 w-22 object-contain"
                      />
                      <div className="-ml-4 rounded-full border-2 border-white dark:border-neutral-900 shadow-md">
                        <AvatarImage
                          src={activeRide.driver?.avatar_url}
                          name={drvName}
                          className="h-14 w-14 rounded-full object-cover shrink-0"
                          fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-[#047857] text-[#6EE7B7] font-extrabold text-lg shrink-0"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Driver Meta + Excelente motorista badge */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-neutral-800 dark:text-neutral-200">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-extrabold uppercase truncate text-sm text-neutral-950 dark:text-white">
                          {drvName}
                        </span>
                        <span className="font-mono-num font-bold text-neutral-950 dark:text-white flex items-center gap-0.5 shrink-0">
                          {drvRating}
                          <Star className="h-3.5 w-3.5 fill-[#047857] dark:fill-[#6EE7B7] text-[#047857] dark:text-[#6EE7B7]" />
                        </span>
                        {drvTrips > 0 && (
                          <span className="text-neutral-500 dark:text-neutral-400 font-mono-num shrink-0">
                            · {drvTrips} avaliações
                          </span>
                        )}
                      </div>
                      <span className="font-mono-num text-xs font-extrabold text-[#047857] dark:text-[#6EE7B7] shrink-0">
                        {formatBRL(activeRide.estimated_fare)}
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-[#065F46] dark:text-[#6EE7B7]">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#047857] text-white">
                        <Star className="h-2.5 w-2.5 fill-white text-white" />
                      </span>
                      {isDeliveryActive ? 'Excelente entregador' : 'Excelente motorista'}
                    </span>
                  </div>

                  {/* 2-Minute Wait Timer synced with Driver */}
                  {activeRide.status === 'arrived' && (
                    <div
                      className={`flex items-center justify-between rounded-2xl border px-3.5 py-2.5 text-xs ${
                        passengerWaitingStats.isCharging
                          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                          : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Clock
                          className={`h-4 w-4 shrink-0 ${
                            passengerWaitingStats.isCharging
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        />
                        <div>
                          <p className="font-extrabold">
                            {passengerWaitingStats.isCharging
                              ? 'Taxa de espera iniciada (+R$ 0,50/min)'
                              : 'Motorista aguardando no embarque'}
                          </p>
                          <p className="text-[11px] opacity-80">
                            {passengerWaitingStats.isCharging
                              ? `Acréscimo atual: +${formatBRL(passengerWaitingStats.waitingFee)}`
                              : 'Embarque dentro de 2 min sem custo adicional'}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono-num text-base font-extrabold shrink-0">
                        {passengerWaitingStats.isCharging
                          ? `+${String(Math.floor(passengerWaitingStats.extraSec / 60)).padStart(2, '0')}:${String(
                              passengerWaitingStats.extraSec % 60
                            ).padStart(2, '0')}`
                          : `${String(Math.floor(passengerWaitingStats.remainingFreeSec / 60)).padStart(
                              2,
                              '0'
                            )}:${String(passengerWaitingStats.remainingFreeSec % 60).padStart(2, '0')}`}
                      </span>
                    </div>
                  )}

                  {/* Payment Status Badges */}
                  {activeRide.payment_method === 'wallet' &&
                    activeRide.payment_status === 'pending' && (
                      <div className="flex items-center justify-center gap-2 rounded-xl bg-[#ECFDF5] dark:bg-emerald-950/40 border border-[#6EE7B7] dark:border-emerald-800 py-2 px-3 text-xs font-extrabold text-[#065F46] dark:text-[#6EE7B7] text-center">
                        <Wallet className="h-4 w-4 shrink-0" />
                        Saldo BorealPay reservado · Escaneie o QR Code do motorista ao chegar
                      </div>
                    )}

                  {activeRide.payment_method === 'pix' &&
                    activeRide.payment_status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => setPixModalRide(activeRide)}
                        className="aurora-accent-flow flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                      >
                        <QrCode className="h-4 w-4" />
                        Pagar com Pix da Plataforma ({formatBRL(currentFareTotal)})
                      </button>
                    )}

                  {/* Action Row: "Alguma observação?" + Phone + Cancel */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setChatOpen(true)}
                      className="min-h-[48px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-sm font-extrabold text-neutral-950 dark:text-white hover:bg-neutral-200/70 dark:hover:bg-neutral-700 active:scale-[0.98] transition"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>
                        {currentChatMessages.length > 0
                          ? `Chat (${currentChatMessages.length})`
                          : t.any_note_chat}
                      </span>
                    </button>
                    {activeRide.driver?.phone && (
                      <a
                        href={`tel:${activeRide.driver.phone.replace(/\D/g, '')}`}
                        className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-950 dark:text-white hover:bg-neutral-200/70 dark:hover:bg-neutral-700 active:scale-[0.98] transition"
                        aria-label="Ligar para motorista"
                        title="Ligar para motorista"
                      >
                        <Phone className="h-5 w-5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleCancelRide}
                      className="min-h-[48px] rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3.5 text-xs font-extrabold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                    >
                      {cancelEstimate?.isFreeGrace
                        ? `${t.cancel} (${cancelEstimate.remainingFreeSec}s grátis)`
                        : t.cancel}
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
        )}
      </div>
      )}

      {/* FULL-SCREEN "SELECIONAR ENDEREÇO" VIEW (Matching 99 Screenshot) */}
      {addressScreenOpen && (
        <div className="fixed inset-0 z-[1050] flex flex-col bg-white dark:bg-neutral-950">
          <div className="border-b border-neutral-100 dark:border-neutral-800 px-4 pt-safe py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAddressScreenOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-950 dark:text-white"
                aria-label="Voltar ao mapa"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <h2 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                {t.select_address}
              </h2>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="flex items-center gap-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3.5 py-1.5 focus-within:border-[#047857] dark:focus-within:border-[#2DD4BF]">
                {serviceTab === 'delivery' ? (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3.5px] border-[#047857] bg-white" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#6EE7B7]">
                    <span className="h-2 w-2 rounded-full bg-[#047857]" />
                  </span>
                )}
                <input
                  type="text"
                  value={originQuery}
                  onFocus={() => setActiveSearchField('origin')}
                  onChange={(e) => setOriginQuery(e.target.value)}
                  placeholder={gpsFixed ? t.current_location : t.detecting_gps}
                  className="min-h-[40px] flex-1 bg-transparent text-sm font-semibold text-emerald-700 dark:text-emerald-400 outline-none placeholder:text-neutral-400"
                />
                <button
                  type="button"
                  onClick={detectMyGps}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  title="Atualizar GPS"
                >
                  <Crosshair className="h-4 w-4" />
                </button>
              </div>

              {activeSearchField === 'origin' && nearbyPickupOptions.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {nearbyPickupOptions.map((opt, idx) => {
                    const shortName = opt.address.split('·')[0].trim();
                    const isSelected = origin.address
                      .toLowerCase()
                      .startsWith(shortName.toLowerCase());
                    return (
                      <button
                        key={`modal-pickup-${idx}`}
                        type="button"
                        onClick={() => {
                          setOrigin({ lat: opt.lat, lng: opt.lng, address: opt.address });
                          setOriginQuery(opt.address);
                          setOriginSuggestions([]);
                          setActiveSearchField('destination');
                        }}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
                        }`}
                      >
                        <MapPin className="h-3 w-3 shrink-0 text-emerald-600 dark:text-[#6EE7B7]" />
                        <span className="max-w-[160px] truncate">{shortName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 px-3.5 py-1.5 focus-within:border-[#047857] dark:focus-within:border-[#2DD4BF] focus-within:bg-white dark:focus-within:bg-neutral-900">
                  {serviceTab === 'delivery' ? (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3.5px] border-[#0891B2] bg-white" />
                  ) : (
                    <Flag className="h-4 w-4 shrink-0 fill-[#047857] text-[#047857] dark:fill-[#6EE7B7] dark:text-[#6EE7B7]" />
                  )}
                  <input
                    type="text"
                    autoFocus
                    value={destQuery}
                    onFocus={() => {
                      setActiveSearchField('destination');
                      setAddressTab('search');
                    }}
                    onChange={(e) => {
                      setDestQuery(e.target.value);
                      setAddressTab('search');
                    }}
                    placeholder={t.where_to}
                    className="min-h-[40px] flex-1 bg-transparent text-sm font-medium text-neutral-950 dark:text-white outline-none placeholder:text-neutral-400"
                  />
                  {destQuery && (
                    <button
                      type="button"
                      onClick={() => setDestQuery('')}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAddressScreenOpen(false);
                    setPickOnMapMode('destination');
                  }}
                  title={t.mark_on_map}
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[#ECFDF5] dark:bg-emerald-950/50 text-[#047857] dark:text-[#6EE7B7] hover:bg-[#CCFBF1] dark:hover:bg-emerald-900/60"
                >
                  <MapPin className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 divide-x divide-neutral-200 dark:divide-neutral-800 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (currentUser.home_address) selectDestinationPoint(currentUser.home_address);
                  else {
                    setAddressScreenOpen(false);
                    setSettingsOpen(true);
                  }
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold text-neutral-800 dark:text-neutral-200"
              >
                <Home className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                <span>{t.home_label}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentUser.work_address) selectDestinationPoint(currentUser.work_address);
                  else {
                    setAddressScreenOpen(false);
                    setSettingsOpen(true);
                  }
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold text-neutral-800 dark:text-neutral-200"
              >
                <Briefcase className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                <span>{t.work_label}</span>
              </button>
              <button
                type="button"
                onClick={() => setAddressTab(addressTab === 'favorites' ? 'search' : 'favorites')}
                className={`flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold ${
                  addressTab === 'favorites' ? 'text-[#047857] dark:text-[#6EE7B7] underline' : 'text-neutral-800 dark:text-neutral-200'
                }`}
              >
                <Star className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                <span>{t.favorites_label}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
            {searchingAddress && (
              <div className="px-4 py-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t.searching_addresses}
              </div>
            )}
            {activeSearchField === 'origin' && originSuggestions.length > 0 ? (
              originSuggestions.map((item, i) => {
                const km = haversineKm(origin.lat, origin.lng, item.lat, item.lng);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setOrigin({ lat: item.lat, lng: item.lng, address: item.address });
                      setOriginQuery(item.address);
                      setOriginSuggestions([]);
                      setActiveSearchField('destination');
                    }}
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                            {item.address.split('·')[0].trim()}
                          </p>
                          <span className="shrink-0 rounded-md bg-[#ECFDF5] dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-[#065F46] dark:text-[#6EE7B7]">
                            {item.categoryLabel}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{item.subtitle || item.address}</p>
                      </div>
                    </div>
                    <span className="font-mono-num text-xs font-bold text-neutral-500 dark:text-neutral-400 shrink-0">
                      {km.toFixed(1)}km
                    </span>
                  </button>
                );
              })
            ) : addressTab === 'favorites' ? (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {savedFavorites.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      Você ainda não adicionou locais favoritos.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAddressScreenOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="aurora-accent-flow min-h-[44px] rounded-2xl px-5 text-xs font-extrabold text-white"
                    >
                      Cadastrar favoritos agora
                    </button>
                  </div>
                ) : (
                  savedFavorites.map((fav, idx) => {
                    const km = haversineKm(origin.lat, origin.lng, fav.lat, fav.lng);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => selectDestinationPoint(fav)}
                        className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                            <Star className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">{fav.label}</p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{fav.address}</p>
                          </div>
                        </div>
                        <span className="font-mono-num text-xs font-bold text-neutral-500 dark:text-neutral-400 shrink-0">
                          {km.toFixed(1)}km
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : destSuggestions.length > 0 ? (
              destSuggestions.map((item, i) => {
                const km = haversineKm(origin.lat, origin.lng, item.lat, item.lng);
                const title = item.address.split('·')[0].trim();
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      selectDestinationPoint({ lat: item.lat, lng: item.lng, address: item.address })
                    }
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        <Navigation className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">{title}</p>
                          <span className="shrink-0 rounded-md bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                            {item.categoryLabel}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{item.subtitle || item.address}</p>
                      </div>
                    </div>
                    <span className="font-mono-num text-xs font-bold text-neutral-500 dark:text-neutral-400 shrink-0">
                      {km.toFixed(1)}km
                    </span>
                  </button>
                );
              })
            ) : (
              <div>
                <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-3 no-scrollbar border-b border-neutral-100 dark:border-neutral-800">
                  {LOCAL_SEARCH_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setActiveSearchField('destination');
                        setDestQuery(chip);
                      }}
                      className="shrink-0 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-1.5 text-xs font-bold text-neutral-800 dark:text-neutral-200 hover:border-[#047857] dark:hover:border-[#2DD4BF] active:scale-95 transition"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    {t.nearby_places_label}
                  </span>
                  {loadingNearby && (
                    <span className="text-[11px] font-semibold text-[#047857] dark:text-[#6EE7B7]">
                      Carregando...
                    </span>
                  )}
                </div>

                {nearbyPlaces.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-neutral-500 dark:text-neutral-400 space-y-2">
                    <p>
                      {gpsFixed
                        ? 'Digite o nome da rua, número, bairro ou estabelecimento (ex: mercado, farmácia, praça).'
                        : t.detecting_gps}
                    </p>
                  </div>
                ) : (
                  nearbyPlaces.map((item, i) => {
                    const km = haversineKm(origin.lat, origin.lng, item.lat, item.lng);
                    const title = item.address.split('·')[0].trim();
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          selectDestinationPoint({ lat: item.lat, lng: item.lng, address: item.address })
                        }
                        className="flex min-h-[62px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                            <Navigation className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">{title}</p>
                              <span className="shrink-0 rounded-md bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900 dark:text-amber-200">
                                {item.categoryLabel}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                              {item.subtitle || item.address}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono-num text-xs font-bold text-neutral-500 dark:text-neutral-400 shrink-0">
                          {km.toFixed(1)}km
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="border-t border-neutral-100 dark:border-neutral-800 p-4 pb-safe bg-white dark:bg-neutral-950">
            <button
              type="button"
              onClick={() => {
                setAddressScreenOpen(false);
                setPickOnMapMode(activeSearchField);
              }}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-sm font-bold text-neutral-900 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <MapPin className="h-4 w-4" />
              {t.mark_on_map}
            </button>
          </div>
        </div>
      )}

      {/* 99-STYLE PASSENGER DRAWER */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/55">
          <div className="flex h-full w-80 max-w-[86vw] flex-col bg-white dark:bg-neutral-900 p-5 shadow-2xl overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
            <div className="flex items-start justify-between">
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
                  className="h-14 w-14 rounded-full object-cover border-2 border-[#2DD4BF] shrink-0"
                  fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-[#ECFDF5] dark:bg-emerald-950 text-[#047857] dark:text-[#6EE7B7] font-display text-xl font-extrabold shrink-0"
                />
                <div>
                  <h3 className="font-display text-xl font-extrabold text-neutral-950 dark:text-white leading-tight">
                    {currentUser.full_name.split(' ')[0]}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#047857] text-[#047857] dark:fill-[#6EE7B7] dark:text-[#6EE7B7]" />
                    <span className="font-mono-num font-bold text-neutral-900 dark:text-white">
                      {currentUser.rating_avg.toFixed(2).replace('.', ',')}
                    </span>
                    <span>· Editar foto/perfil</span>
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {weather && (
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3.5 py-2.5 text-xs">
                <span className="font-bold text-neutral-800 dark:text-neutral-200 truncate pr-2">{weather.city}</span>
                <span className="font-mono-num font-extrabold text-neutral-950 dark:text-white shrink-0">
                  {weather.temperatureC}°C · {weather.label}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openWallet('deposit');
              }}
              className="aurora-border-glow mt-4 flex w-full items-center justify-between rounded-2xl bg-[#ECFDF5] dark:bg-emerald-950/60 px-4 py-3 text-left text-[#0F2421] dark:text-white shadow-sm border border-[#6EE7B7] dark:border-emerald-700"
            >
              <div>
                <p className="text-[11px] font-bold text-[#334E4A] dark:text-[#6EE7B7]">{t.wallet_title}</p>
                <p className="font-mono-num text-lg font-extrabold text-[#047857] dark:text-[#2DD4BF]">
                  {formatBRL(walletBalance)}
                </p>
              </div>
              <span className="aurora-accent-flow rounded-xl px-3 py-1.5 text-xs font-extrabold text-white">
                {t.deposit} / {t.transfer}
              </span>
            </button>

            <div className="mt-5 grid grid-cols-3 gap-y-5 gap-x-2 text-center">
              {[
                { label: t.ride_history.split(' ')[0], icon: History, action: () => setHistoryOpen(true) },
                { label: t.help_label, icon: HelpCircle, action: () => setInfoModal('help') },
                { label: t.discounts_label, icon: Tag, action: () => setInfoModal('discounts') },
                { label: t.wallet_balance, icon: Wallet, action: () => openWallet('deposit') },
                { label: t.configure_label, icon: Settings, action: () => setSettingsOpen(true) },
                { label: t.security_label, icon: Shield, action: () => setInfoModal('security') },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      item.action();
                    }}
                    className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition"
                  >
                    <Icon className="h-6 w-6 text-neutral-900 dark:text-neutral-100" />
                    <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="my-5 border-t border-neutral-100 dark:border-neutral-800" />

            <div className="flex-1 space-y-1">
              <h4 className="font-display text-sm font-extrabold text-neutral-950 dark:text-white mb-2">
                {t.other_features}
              </h4>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportChatOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-3">
                  <Headphones className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {t.support_admin}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setInfoModal('become_driver');
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-3">
                  <UserCheck className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
                  {t.become_partner}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-3">
                  <Star className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
                  {t.settings_title} & Favoritos
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setLegalDocsOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
                  {t.privacy_security}
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <div className="pt-2">
                <PWAInstallButton
                  variant="menu"
                  apkUrl={platformConfig.ota_apk_url}
                  siteName={siteName}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-sm font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              <LogOut className="h-4 w-4" />
              {t.logout}
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Drawer Shortcut Modals */}
      {infoModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-4 border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                {infoModal === 'help' && 'Ajuda e Suporte'}
                {infoModal === 'discounts' && 'Descontos e Negocia'}
                {infoModal === 'security' && 'Central de Segurança'}
                {infoModal === 'become_driver' && 'Seja Motorista / Entregador'}
              </h3>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {infoModal === 'help' && (
              <div className="text-xs text-neutral-700 dark:text-neutral-300 space-y-2.5 leading-relaxed">
                <p className="font-bold text-neutral-950 dark:text-white">
                  Atendimento local {siteName} ({platformConfig.platform_city})
                </p>
                <p>
                  • Esquecimento de objeto ou dúvida sobre cobrança? Use o chat da viagem ou informe
                  o código da corrida ao suporte.
                </p>
                <p>
                  • Pagamentos via Pix vão diretamente para a conta oficial{' '}
                  <strong>{platformConfig.platform_pix_receiver}</strong>.
                </p>
              </div>
            )}

            {infoModal === 'discounts' && (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
                <p className="text-xs font-extrabold text-neutral-950 dark:text-amber-200">Modo Negocia ativo!</p>
                <p className="mt-1 text-xs text-neutral-700 dark:text-amber-100">
                  Escolha a categoria <strong>Negocia</strong> ao selecionar seu destino para sugerir
                  o valor ideal da sua corrida.
                </p>
              </div>
            )}

            {infoModal === 'security' && (
              <div className="space-y-2.5 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <p className="font-bold text-neutral-950 dark:text-white">Verificação com PIN de 4 dígitos</p>
                <p>
                  • Em todas as corridas, o motorista precisa digitar o seu código PIN de 4 dígitos
                  para iniciar a viagem.
                </p>
                <p>
                  • Em entregas (Moto ou Carro), o PIN protege tanto a coleta quanto a entrega final
                  no destinatário.
                </p>
              </div>
            )}

            {infoModal === 'become_driver' && (
              <div className="space-y-3 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <p>
                  Quer dirigir ou fazer entregas na sua cidade? Saia da sua conta atual e crie um
                  cadastro escolhendo <strong>Opção B · Motorista / Entregador</strong> enviando
                  CNH, CRLV e sua chave Pix para aprovação.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setInfoModal(null);
                    onLogout();
                  }}
                  className="aurora-accent-flow min-h-[46px] w-full rounded-2xl text-sm font-extrabold text-white"
                >
                  Ir para tela de cadastro de Motorista
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl max-h-[80vh] flex flex-col border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                Atividade · Corridas e Entregas
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto space-y-3">
              {myRides.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Você ainda não realizou corridas ou entregas.
                </p>
              ) : (
                myRides.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-800/60 p-3.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-bold text-neutral-950 dark:text-white">
                      <span>
                        {CATEGORY_LABELS[r.category]} · {r.status}
                      </span>
                      <span className="font-mono-num">
                        {formatBRL(r.final_fare ?? r.estimated_fare)}
                      </span>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 truncate">De: {r.origin_address}</p>
                    <p className="text-neutral-900 dark:text-neutral-200 font-medium truncate">
                      Para: {r.destination_address}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                        {r.payment_method === 'wallet'
                          ? 'BorealPay'
                          : r.payment_method === 'pix'
                          ? 'Pix Plataforma'
                          : 'Dinheiro'}{' '}
                        · {r.payment_status}
                      </span>
                      {r.payment_method === 'wallet' &&
                      (r.payment_status === 'paid' || r.payment_status === 'paid_wallet') ? (
                        <button
                          type="button"
                          onClick={() => {
                            setHistoryOpen(false);
                            const saved = receiptsByRideId[r.id];
                            if (saved) {
                              setReceiptModalState({ receipt66: saved });
                            } else {
                              setReceiptModalState({
                                transaction: {
                                  id: r.id,
                                  user_id: currentUser.id,
                                  ride_id: r.id,
                                  amount: -(r.final_fare ?? r.estimated_fare),
                                  type: 'ride_debit',
                                  description: `Corrida BorealPay #${r.id.slice(-4)} · ${r.destination_address}`,
                                  auth_code: `BPAY-${r.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
                                  sender_name: currentUser.full_name,
                                  recipient_name: r.driver?.full_name || 'Motorista BorealPay',
                                  recipient_key:
                                    r.driver?.pay66_key ||
                                    (r.driver_id
                                      ? `BOREAL-${r.driver_id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
                                      : 'BorealPay'),
                                  created_at: r.completed_at || r.created_at,
                                },
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1 text-[11px] font-extrabold text-white dark:text-[#0F2421]"
                        >
                          <Receipt className="h-3 w-3" />
                          Comprovante BorealPay
                        </button>
                      ) : r.payment_status === 'pending' &&
                        r.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryOpen(false);
                              if (r.payment_method === 'wallet') {
                                setQrScannerRide(r);
                              } else if (r.payment_method === 'pix') {
                                setPixModalRide(r);
                              } else {
                                setDismissedCompletedPayIds((prev) =>
                                  prev.filter((id) => id !== r.id)
                                );
                              }
                            }}
                            className="rounded-lg bg-[#047857] dark:bg-[#2DD4BF] px-2.5 py-1 text-[11px] font-extrabold text-white dark:text-[#0F2421]"
                          >
                            {r.payment_method === 'wallet'
                              ? 'Pagar BorealPay'
                              : r.payment_method === 'pix'
                              ? 'Pagar Pix'
                              : 'Pagar Corrida'}
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

      {livePixModalRide && (
        <PixPaymentModal
          ride={livePixModalRide}
          platformConfig={platformConfig}
          onDeclared={(updated) => {
            onRideUpsert(updated);
            if (updated.status !== 'completed') {
              setPixModalRide(null);
            }
          }}
          onClose={() => setPixModalRide(null)}
        />
      )}

      {walletOpen && (
        <ClientWalletModal
          currentUser={currentUser}
          platformConfig={platformConfig}
          initialTab={walletInitialTab}
          suggestedMinAmount={
            destination && !hasEnoughWalletBalance
              ? Math.max(10, totalFareWithDebt - walletBalance)
              : undefined
          }
          onUserUpdated={onUserUpdated}
          onClose={() => setWalletOpen(false)}
        />
      )}

      {settingsOpen && (
        <AccountSettingsModal
          currentUser={currentUser}
          platformConfig={platformConfig}
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onLogout}
          onOpenWallet={() => openWallet('deposit')}
          onOpenSupport={() => {
            setSettingsOpen(false);
            setSupportChatOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {legalDocsOpen && (
        <LegalDocsModal
          initialTab="terms"
          siteName={siteName}
          onClose={() => setLegalDocsOpen(false)}
        />
      )}

      {chatOpen && activeRide && activeRide.driver && (
        <RideChatModal
          rideId={activeRide.id}
          currentUser={currentUser}
          peerName={activeRide.driver.full_name}
          peerAvatarUrl={activeRide.driver.avatar_url}
          isDelivery={isDeliveryActive}
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

      {cancelConfirmOpen && activeRide && cancelEstimate && activeRide.status !== 'in_progress' && (
        <div className="fixed inset-0 z-[1250] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-4 border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">
                  Política de Cancelamento
                </p>
                <h3 className="mt-1 font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                  {cancelEstimate.isFreeGrace
                    ? `Cancelar sem custo (${cancelEstimate.remainingFreeSec}s)`
                    : `Taxa de cancelamento: ${formatBRL(cancelEstimate.feeAmount)}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCancelConfirmOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className={`rounded-2xl border p-4 text-xs leading-relaxed ${
                cancelEstimate.isFreeGrace
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                  : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
              }`}
            >
              {cancelEstimate.isFreeGrace ? (
                <p>
                  Você ainda está dentro dos <strong>20 segundos gratuitos</strong> após o aceite do
                  parceiro. Restam <strong className="font-mono-num">{cancelEstimate.remainingFreeSec}s</strong>{' '}
                  para cancelar sem nenhuma cobrança.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p>{cancelEstimate.reasonLabel}</p>
                  {activeRide.status === 'arrived' ? (
                    <p>
                      Como o motorista/entregador já chegou ao ponto de embarque, o cancelamento
                      cobra <strong>100%</strong> do valor da corrida.
                    </p>
                  ) : (
                    <p>
                      Após os <strong>20 segundos gratuitos</strong> do aceite, com o parceiro já a
                      caminho, aplica-se a taxa fixa de <strong>R$ 3,00</strong>.
                    </p>
                  )}
                  <p className="font-extrabold">
                    Valor repassado integralmente ao motorista/entregador:{' '}
                    <span className="font-mono-num">{formatBRL(cancelEstimate.feeAmount)}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={cancelBusy}
                onClick={executeCancelRide}
                className={`min-h-[48px] w-full rounded-2xl text-sm font-extrabold shadow-sm active:scale-[0.98] transition disabled:opacity-50 ${
                  cancelEstimate.isFreeGrace
                    ? 'bg-neutral-950 dark:bg-white text-white dark:text-neutral-950'
                    : 'bg-red-600 text-white'
                }`}
              >
                {cancelBusy
                  ? 'Cancelando...'
                  : cancelEstimate.isFreeGrace
                  ? 'Confirmar Cancelamento Gratuito'
                  : `Confirmar Cancelamento (${formatBRL(cancelEstimate.feeAmount)})`}
              </button>
              <button
                type="button"
                disabled={cancelBusy}
                onClick={() => setCancelConfirmOpen(false)}
                className="min-h-[44px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold text-neutral-700 dark:text-neutral-300"
              >
                Manter Solicitação
              </button>
            </div>
          </div>
        </div>
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
            const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            void markAllNotificationsRead(unreadIds, currentUser.id);
          }}
          onOpenReceipt={(tx) => {
            setNotificationsOpen(false);
            setReceiptModalState({ transaction: tx });
          }}
          onClose={() => setNotificationsOpen(false)}
        />
      )}

      {qrScannerRide && (
        <Qr66PayScannerModal
          ride={qrScannerRide}
          onPaid={async (receipt) => {
            setReceiptsByRideId((prev) => ({ ...prev, [qrScannerRide.id]: receipt }));
            justCompletedRideIdRef.current = qrScannerRide.id;
            setQrScannerRide(null);
            setReceiptModalState({ receipt66: receipt });
            const [freshRide, freshProfile] = await Promise.all([
              fetchRideByIdEnriched(receipt.ride_id).catch(() => null),
              fetchUserProfileById(currentUser.id).catch(() => null),
            ]);
            if (freshRide) onRideUpsert(freshRide);
            if (freshProfile) onUserUpdated(freshProfile);
            speakPtBr('Pagamento BorealPay confirmado com sucesso.', true);
          }}
          onClose={() => setQrScannerRide(null)}
        />
      )}

      {receiptModalState && (
        <Receipt66PayModal
          transaction={receiptModalState.transaction}
          receipt66={receiptModalState.receipt66}
          currentUser={currentUser}
          platformConfig={platformConfig}
          onClose={() => setReceiptModalState(null)}
        />
      )}

      {cancelNotice && (
        <div className="pointer-events-none fixed bottom-24 left-0 right-0 z-[1300] flex justify-center px-4">
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold shadow-2xl border ${
              cancelNotice.isFree
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-[#0F2421] text-[#6EE7B7] border-[#047857]'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{cancelNotice.text}</span>
          </div>
        </div>
      )}
    </div>
  );
};
