import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  Briefcase,
  Car,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Crosshair,
  Eye,
  EyeOff,
  FileText,
  Flag,
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
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Star,
  Tag,
  Thermometer,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { resolveBrandLogo, resolveCategoryVehicleImage } from '../lib/brandAssets';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import {
  type AddressSuggestion,
  fetchLocalWeather,
  fetchRouteGeometry,
  formatBRL,
  haversineKm,
  reverseGeocode,
  searchAddresses,
} from '../lib/geo';
import { cancelRide, createRideRequest } from '../lib/mobilityApi';
import { playRideAcceptedChime } from '../lib/sound';
import type {
  GeoPoint,
  PaymentMethod,
  PlatformConfig,
  PricingSetting,
  Ride,
  RideCategory,
  RideMessage,
  SavedAddress,
  UserProfile,
  WeatherInfo,
} from '../types/mobility';
import { AccountSettingsModal } from './AccountSettingsModal';
import { AvatarImage } from './AvatarImage';
import { DirectChatModal } from './DirectChatModal';
import { LegalDocsModal } from './LegalDocsModal';
import { LiveMap } from './LiveMap';
import { PixPaymentModal } from './PixPaymentModal';
import { PWAInstallButton } from './PWAInstallButton';
import { RatingModal } from './RatingModal';
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
  lat: -23.55052,
  lng: -46.633308,
  address: 'Centro · Localização inicial',
};

const QUICK_DESTINATIONS: GeoPoint[] = [
  { lat: -23.561414, lng: -46.655881, address: 'Av. Paulista, 1578 · Centro Empresarial' },
  { lat: -23.587416, lng: -46.657634, address: 'Parque Municipal · Portão Principal' },
  { lat: -23.54198, lng: -46.62952, address: 'Terminal Rodoviário Central' },
  { lat: -23.5673, lng: -46.6931, address: 'Shopping Plaza · Entrada Norte' },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [addressScreenOpen, setAddressScreenOpen] = useState(false);
  const [addressTab, setAddressTab] = useState<'search' | 'favorites'>('search');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<
    'help' | 'discounts' | 'wallet' | 'security' | 'become_driver' | null
  >(null);
  const [pixModalRide, setPixModalRide] = useState<Ride | null>(null);

  const [origin, setOrigin] = useState<GeoPoint>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [originQuery, setOriginQuery] = useState('Localização atual');
  const [destQuery, setDestQuery] = useState('');

  const [originSuggestions, setOriginSuggestions] = useState<AddressSuggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<AddressSuggestion[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<'origin' | 'destination'>('destination');
  const [pickOnMapMode, setPickOnMapMode] = useState<'origin' | 'destination' | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [durationMin, setDurationMin] = useState<number>(0);

  const [serviceTab, setServiceTab] = useState<'rides' | 'delivery'>('rides');
  const [category, setCategory] = useState<RideCategory>('pop');
  const [negotiatedFare, setNegotiatedFare] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    currentUser.preferred_payment === 'cash' ? 'cash' : 'pix'
  );
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [requireDeliveryPin, setRequireDeliveryPin] = useState(true);
  const [idleCleanMap, setIdleCleanMap] = useState(false);
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);

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

  const siteName = platformConfig.site_name || 'Velo99';
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

  const unpaidCompletedPixRide = useMemo(
    () =>
      myRides.find(
        (r) =>
          r.status === 'completed' &&
          r.payment_method === 'pix' &&
          r.payment_status === 'pending'
      ) || null,
    [myRides]
  );

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

  // Play pleasant chime on ride acceptance and track freshly completed rides for RatingModal
  useEffect(() => {
    const prevMap = prevRideStatusMapRef.current;
    const nextMap: Record<string, Ride['status']> = {};
    for (const r of myRides) {
      nextMap[r.id] = r.status;
      const prevStatus = prevMap[r.id];
      if (prevStatus === 'searching' && r.status === 'accepted') {
        void playRideAcceptedChime();
      }
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
        if (r.payment_method === 'pix' && r.payment_status === 'pending') return false;
        const completedMs = new Date(r.completed_at || r.created_at).getTime();
        return (
          r.id === justCompletedRideIdRef.current ||
          completedMs >= sessionStartedAtRef.current - 60_000
        );
      }) || null,
    [myRides, dismissedRatingIds]
  );

  const detectMyGps = useCallback(async () => {
    const pos = await getCurrentGpsPosition();
    if (!pos) {
      fetchLocalWeather(DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lng).then((w) => w && setWeather(w));
      return;
    }
    const [addr, w] = await Promise.all([
      reverseGeocode(pos.lat, pos.lng),
      fetchLocalWeather(pos.lat, pos.lng),
    ]);
    setOrigin({ lat: pos.lat, lng: pos.lng, address: addr });
    setOriginQuery(addr);
    if (w) setWeather(w);
  }, []);

  useEffect(() => {
    detectMyGps();
  }, [detectMyGps]);

  useEffect(() => {
    if (activeRide && activeRide.driver_id) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  useEffect(() => {
    if (!addressScreenOpen || activeSearchField !== 'origin') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (
        originQuery.trim().length < 2 ||
        originQuery === 'Localização atual' ||
        originQuery === origin.address
      ) {
        setOriginSuggestions([]);
        setSearchingAddress(false);
        return;
      }
      setSearchingAddress(true);
      const res = await searchAddresses(originQuery, origin.lat, origin.lng, controller.signal);
      if (!controller.signal.aborted) {
        setOriginSuggestions(res);
        setSearchingAddress(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [originQuery, addressScreenOpen, activeSearchField, origin.address, origin.lat, origin.lng]);

  useEffect(() => {
    if (!addressScreenOpen || activeSearchField !== 'destination') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (destQuery.trim().length < 2 || (destination && destQuery === destination.address)) {
        setDestSuggestions([]);
        setSearchingAddress(false);
        return;
      }
      setSearchingAddress(true);
      const res = await searchAddresses(destQuery, origin.lat, origin.lng, controller.signal);
      if (!controller.signal.aborted) {
        setDestSuggestions(res);
        setSearchingAddress(false);
      }
    }, 300);
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
      let cancelled = false;
      fetchRouteGeometry(
        activeRide.origin_lat,
        activeRide.origin_lng,
        activeRide.destination_lat,
        activeRide.destination_lng
      ).then((res) => {
        if (cancelled) return;
        setRouteCoords(res.coords);
        setDistanceKm(res.distanceKm);
        setDurationMin(res.durationMin);
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
    let cancelled = false;
    fetchRouteGeometry(startLat, startLng, targetLat, targetLng).then((res) => {
      if (cancelled) return;
      setRouteCoords(res.coords);
      setDistanceKm(res.distanceKm);
      setDurationMin(res.durationMin);
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
  const totalFareWithDebt = Number((selectedCategoryFare + pendingDebt).toFixed(2));

  const handleRequestRide = async () => {
    if (!destination || submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const isDelivery = category === 'delivery_moto' || category === 'delivery_car';
      const created = await createRideRequest({
        passenger_id: currentUser.id,
        category,
        payment_method: paymentMethod,
        origin,
        destination,
        distance_km: Math.max(0.6, distanceKm),
        estimated_fare: totalFareWithDebt,
        negotiated_fare: category === 'negocia' ? activeNegociaFare : null,
        delivery_notes: isDelivery ? deliveryNotes : null,
        require_pin: isDelivery ? requireDeliveryPin : true,
        pending_debt_included: pendingDebt,
      });
      setDeliveryNotes('');
      onRideUpsert(created);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Falha de rede ao chamar motorista.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRide = async () => {
    if (!activeRide) return;
    try {
      const updated = await cancelRide(activeRide.id);
      if (updated) onRideUpsert(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao cancelar corrida.');
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
    const decay = window.setTimeout(() => setDriverSpeedKmh(0), 5000);
    return () => window.clearTimeout(decay);
  }, [activeDriverPos?.lat, activeDriverPos?.lng, activeRide]);

  const currentChatMessages = activeRide ? messagesByRide[activeRide.id] || [] : [];
  const isDeliveryActive =
    activeRide?.category === 'delivery_moto' || activeRide?.category === 'delivery_car';

  const savedFavorites: SavedAddress[] = currentUser.favorites || [];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100">
      <LiveMap
        center={[origin.lat, origin.lng]}
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
          !activeRide && !destination && !idleCleanMap
            ? 'bottom-6'
            : activeRide
            ? 'top-24'
            : 'top-20'
        }
        nearbyDrivers={activeRide ? [] : onlineDrivers}
        pickOnMapMode={pickOnMapMode}
        onMapPick={handleMapPick}
        onRecenter={detectMyGps}
      />

      {/* Top Floating Bar + Top Search Card ("Para onde vamos?" at top + Clean Map toggle) */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] px-3 sm:px-4 pt-safe py-3 space-y-2.5">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-neutral-950 shadow-lg border border-neutral-200 active:scale-95 transition"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            {!activeRide && !destination && !idleCleanMap && (
              <div className="pointer-events-auto hidden xs:flex items-center gap-2 rounded-2xl bg-white px-3 py-1.5 shadow-md border border-neutral-200">
                <img
                  src={brandLogoUrl}
                  alt={siteName}
                  className="h-7 w-7 rounded-lg object-cover shrink-0"
                />
                <span className="font-display text-sm font-extrabold text-neutral-950">
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
                className="flex min-h-[44px] items-center gap-2 rounded-full bg-neutral-950 px-4 text-xs font-bold text-[#FFD100] shadow-lg"
              >
                <MapPin className="h-4 w-4" />
                Toque no mapa ({pickOnMapMode === 'origin' ? 'Embarque' : 'Destino'}) · Cancelar
              </button>
            ) : activeRide && activeRide.status !== 'searching' ? (
              <div className="flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs font-extrabold text-white shadow-lg font-mono-num">
                <span className="text-[#FFD100]">
                  {activeRide.status === 'in_progress'
                    ? 'Em rota'
                    : activeRide.status === 'arrived'
                    ? 'No embarque'
                    : 'A caminho'}
                </span>
                {durationMin > 0 && <span>· ~{durationMin} min</span>}
              </div>
            ) : destination && !activeRide ? (
              <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-neutral-950 shadow-lg border border-neutral-200 font-mono-num">
                <span>
                  {distanceKm} km · {durationMin} min
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIdleCleanMap((v) => !v)}
                className="flex min-h-[42px] items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-extrabold text-neutral-900 shadow-lg border border-neutral-200 active:scale-95 transition"
                title={idleCleanMap ? 'Mostrar barra de destino' : 'Ocultar cartões e ver mapa livre'}
              >
                {idleCleanMap ? (
                  <>
                    <Eye className="h-4 w-4 text-neutral-950" />
                    <span>Para onde vamos?</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="h-4 w-4 text-neutral-600" />
                    <span>Mapa limpo</span>
                  </>
                )}
              </button>
            )}
            <PWAInstallButton />
          </div>
        </div>

        {/* TOP SEARCH CARD ("Para onde vamos?") — LEAVES BOTTOM OF MAP 100% OPEN */}
        {!activeRide && !destination && !idleCleanMap && !pickOnMapMode && (
          <div className="pointer-events-auto mx-auto max-w-lg rounded-3xl bg-white p-3.5 shadow-2xl border border-neutral-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 min-w-0">
                <MapPin className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span className="truncate">{weather?.city || platformConfig.platform_city}</span>
                {weather && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-neutral-950 font-mono-num shrink-0">
                    <Thermometer className="h-3 w-3 text-amber-700" />
                    {weather.temperatureC}°C
                  </span>
                )}
              </div>
              <span className="text-[11px] font-extrabold text-emerald-700 shrink-0">
                {onlineDrivers.length > 0 ? `${onlineDrivers.length} online` : 'GPS ao vivo'}
              </span>
            </div>

            {currentUser.status === 'suspended' && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-2.5 text-xs font-bold text-red-700">
                Sua conta está temporariamente bloqueada/suspensa. Fale com a administração no Suporte.
              </div>
            )}

            {platformConfig.maintenance_mode && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-2.5 text-xs font-bold text-amber-900">
                Plataforma em manutenção programada. Algumas solicitações podem estar pausadas.
              </div>
            )}

            {pendingDebt > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <span className="font-extrabold">
                  Pendência anterior ({currentUser.pending_debt_note || 'Corrida não paga'}):{' '}
                  <span className="font-mono-num">{formatBRL(pendingDebt)}</span>
                </span>
                <span className="block text-[11px] text-amber-800">
                  Será somado automaticamente ao valor da sua próxima corrida.
                </span>
              </div>
            )}

            {unpaidCompletedPixRide && (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-neutral-950">
                    Pix pendente da última viagem
                  </p>
                  <p className="text-[11px] text-neutral-700 font-mono-num">
                    {formatBRL(
                      unpaidCompletedPixRide.final_fare ?? unpaidCompletedPixRide.estimated_fare
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPixModalRide(unpaidCompletedPixRide)}
                  className="min-h-[38px] shrink-0 rounded-xl bg-[#FFD100] px-3 text-xs font-extrabold text-neutral-950"
                >
                  Pagar Pix
                </button>
              </div>
            )}

            {/* PRIMARY TOP SEARCH TRIGGER */}
            <button
              type="button"
              onClick={() => {
                setActiveSearchField('destination');
                setAddressTab('search');
                setAddressScreenOpen(true);
              }}
              className="flex min-h-[50px] w-full items-center gap-3 rounded-2xl bg-neutral-100 px-3.5 text-left hover:bg-neutral-200/70 active:scale-[0.99] transition"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 shrink-0">
                <Search className="h-4 w-4" />
              </span>
              <span className="font-display text-base sm:text-lg font-extrabold text-neutral-950">
                Para onde vamos?
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
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-2 px-1 text-center hover:border-neutral-950"
              >
                <img
                  src={resolveCategoryVehicleImage('pop', platformConfig)}
                  alt="Corrida"
                  className="h-7 w-9 object-contain"
                />
                <span className="text-[10px] font-extrabold text-neutral-900">Corrida</span>
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
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-2 px-1 text-center hover:border-neutral-950"
              >
                <img
                  src={resolveCategoryVehicleImage('delivery_moto', platformConfig)}
                  alt="Entrega"
                  className="h-7 w-9 object-contain"
                />
                <span className="text-[10px] font-extrabold text-neutral-900">Entrega</span>
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
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-2 px-1 text-center hover:border-neutral-950"
              >
                <Home className="h-4 w-4 text-neutral-800" />
                <span className="text-[10px] font-bold text-neutral-800">Casa</span>
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
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-2 px-1 text-center hover:border-neutral-950"
              >
                <Briefcase className="h-4 w-4 text-neutral-800" />
                <span className="text-[10px] font-bold text-neutral-800">Trabalho</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAddressTab('favorites');
                  setAddressScreenOpen(true);
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-2 px-1 text-center hover:border-neutral-950"
              >
                <Star className="h-4 w-4 text-neutral-800" />
                <span className="text-[10px] font-bold text-neutral-800">Favoritos</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sheet / Floating Card (Shown ONLY when choosing fare/category OR active ride) */}
      {(Boolean(destination) || Boolean(activeRide)) && (
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
            className="pointer-events-auto m-2.5 sm:m-0 flex items-center justify-between gap-2 rounded-2xl bg-white px-3.5 py-3 shadow-2xl border border-neutral-200"
          >
            <button
              type="button"
              onClick={() => setSheetMinimized(false)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-950 font-mono-num text-xs font-extrabold text-[#FFD100]">
                {isDeliveryActive && activeRide.require_pin === false ? 'OK' : activeRide.pin_code}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-neutral-950 truncate">
                  {activeRide.driver?.driver?.vehicle_plate || 'Veículo'} ·{' '}
                  {activeRide.driver?.full_name.split(' ')[0]}
                </p>
                <p className="text-[11px] font-semibold text-amber-700 truncate">
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
                className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-950 text-[#FFD100] active:scale-95"
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
        <div className="pointer-events-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 pb-safe shadow-2xl border-t sm:border border-neutral-200 max-h-[78vh] overflow-y-auto">
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
              className="mb-3 -mt-2 flex items-center justify-between border-b border-neutral-100 pb-2 touch-none"
            >
              <div className="h-1 w-10 rounded-full bg-neutral-300" />
              <button
                type="button"
                onClick={() => setSheetMinimized(true)}
                className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-700 hover:bg-neutral-200"
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
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-100">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSearchField('destination');
                      setAddressTab('search');
                      setAddressScreenOpen(true);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0 text-neutral-700" />
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-neutral-950 truncate">
                        {destination.address}
                      </p>
                      <p className="text-[11px] text-neutral-500 font-mono-num truncate">
                        De: {origin.address} · {distanceKm} km · {durationMin} min
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDestination(null);
                      setDestQuery('');
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                    aria-label="Limpar destino"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Service Switch: Viagens vs Entregas */}
                <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 p-1">
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
                        ? 'bg-white text-neutral-950 shadow-xs'
                        : 'text-neutral-600'
                    }`}
                  >
                    Viagens (Carro / Moto)
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
                        ? 'bg-white text-neutral-950 shadow-xs'
                        : 'text-neutral-600'
                    }`}
                  >
                    Entregas (Pacotes)
                  </button>
                </div>

                {errorMsg && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">
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
                            ? 'border-neutral-950 bg-[#FFD100]/15'
                            : 'border-neutral-100 bg-white hover:border-neutral-300'
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
                              <p className="text-sm font-extrabold text-neutral-950 truncate">
                                {cat.label}
                              </p>
                              <p className="text-[11px] text-neutral-600 truncate">
                                {cat.description}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono-num text-sm font-extrabold text-neutral-950">
                              {formatBRL(fare + pendingDebt)}
                            </p>
                            <p className="text-[10px] text-neutral-500 font-mono-num">
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
                          <div className="flex items-center justify-between border-t border-neutral-950/10 px-3.5 py-2 bg-white rounded-b-2xl">
                            <span className="text-[11px] font-bold text-neutral-700">
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
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-300 bg-white text-neutral-950 active:scale-95"
                                aria-label="Diminuir oferta"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="min-w-[74px] text-center font-mono-num text-sm font-extrabold text-neutral-950">
                                {formatBRL(activeNegociaFare)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNegotiatedFare(
                                    Number((activeNegociaFare + 1).toFixed(2))
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-950 text-[#FFD100] active:scale-95"
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
                      className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs outline-none focus:border-neutral-950"
                    />
                    <label className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 cursor-pointer">
                      <span className="text-xs font-bold text-neutral-800">
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
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    <span className="font-extrabold">
                      Débito pendente incluído: +{formatBRL(pendingDebt)}
                    </span>{' '}
                    ({currentUser.pending_debt_note || 'Corrida não paga'})
                  </div>
                )}

                {/* Payment Method: Pix vs Dinheiro */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'pix' as PaymentMethod, label: 'Pix (Plataforma)', icon: QrCode },
                    { id: 'cash' as PaymentMethod, label: 'Dinheiro', icon: Banknote },
                  ].map((pm) => {
                    const active = paymentMethod === pm.id;
                    const PmIcon = pm.icon;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPaymentMethod(pm.id)}
                        className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-xs font-extrabold transition ${
                          active
                            ? 'border-neutral-950 bg-neutral-950 text-[#FFD100]'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                        }`}
                      >
                        <PmIcon className="h-4 w-4 shrink-0" />
                        <span>{pm.label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleRequestRide}
                  disabled={submitting}
                  className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition disabled:opacity-50"
                >
                  {submitting
                    ? 'Solicitando...'
                    : `${formatBRL(totalFareWithDebt)} · Solicitar ${CATEGORY_LABELS[category]}`}
                </button>
              </div>
            ) : null
          ) : activeRide.status === 'searching' ? (
            /* MODERN CLEAN LIGHT SEARCHING POP-UP */
            <div className="space-y-4 py-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full w-1/2 rounded-full bg-[#FFD100] animate-pulse" />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-extrabold text-neutral-950">
                    {isDeliveryActive ? 'Seu pedido foi solicitado' : 'Sua corrida foi solicitada'}
                  </h3>
                  <p className="text-xs font-medium text-neutral-500">
                    {isDeliveryActive
                      ? 'Encontraremos o entregador mais próximo de você'
                      : 'Encontraremos o motorista mais indicado na sua região'}
                  </p>
                </div>
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 border border-amber-200">
                  <span className="absolute inset-0 rounded-full bg-[#FFD100]/45 animate-radar-ring" />
                  {isDeliveryActive ? (
                    <Package className="relative h-6 w-6 text-amber-600" />
                  ) : (
                    <Car className="relative h-6 w-6 text-neutral-900" />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-neutral-200/80 bg-neutral-50 px-3.5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={resolveCategoryVehicleImage(activeRide.category, platformConfig)}
                    alt={CATEGORY_LABELS[activeRide.category]}
                    className="h-11 w-14 rounded-xl object-cover bg-white border border-neutral-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-neutral-950">
                      {CATEGORY_LABELS[activeRide.category]} · {activeRide.distance_km} km
                    </p>
                    <p className="text-[11px] text-neutral-500 truncate">
                      {activeRide.origin_address} → {activeRide.destination_address}
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-base font-extrabold text-neutral-950 shrink-0 pl-2">
                  {formatBRL(activeRide.estimated_fare)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCancelRide}
                className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 text-sm font-bold text-neutral-700 hover:bg-neutral-100 transition"
              >
                Cancelar solicitação
              </button>
            </div>
          ) : (
            /* MODERN CLEAN LIGHT MATCHED / LIVE TRACKING POP-UP (99 STYLE) */
            <div className="space-y-3.5">
              {/* Live ETA & Status Banner */}
              <div className="text-center space-y-2">
                <h3 className="font-display text-lg font-extrabold text-neutral-950">
                  {activeRide.status === 'accepted' && (
                    <>
                      {isDeliveryActive ? 'Coleta em ' : 'Embarque em '}
                      <span className="text-blue-600 font-mono-num">
                        {durationMin > 0 ? `${durationMin} min` : 'instantes'}
                      </span>
                    </>
                  )}
                  {activeRide.status === 'arrived' && (
                    <span className="text-emerald-700">
                      {isDeliveryActive
                        ? 'Entregador chegou para a coleta!'
                        : 'Motorista no ponto de embarque!'}
                    </span>
                  )}
                  {activeRide.status === 'in_progress' && (
                    <>
                      {isDeliveryActive ? 'Entrega em rota · ' : 'Chegada em '}
                      <span className="text-blue-600 font-mono-num">
                        {durationMin > 0 ? `${durationMin} min` : 'em breve'}
                      </span>
                    </>
                  )}
                </h3>

                <div className="rounded-xl bg-amber-50 border border-amber-200/70 px-3 py-2 text-xs font-bold text-amber-800">
                  {activeRide.status === 'accepted' &&
                    (isDeliveryActive
                      ? 'Pedido aceito · Entregador a caminho da coleta'
                      : 'Corrida aceita · Acompanhe seu motorista no mapa')}
                  {activeRide.status === 'arrived' &&
                    (isDeliveryActive
                      ? 'Encontre seu entregador com o pacote'
                      : 'Seu motorista está aguardando no embarque')}
                  {activeRide.status === 'in_progress' &&
                    (isDeliveryActive
                      ? 'Pacote coletado · Em rota para o destino'
                      : 'Viagem em andamento · Trajeto acompanhado por GPS')}
                </div>
              </div>

              {/* Plate + Vehicle & Driver Avatar Cluster */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-mono-num text-2xl font-extrabold tracking-tight text-neutral-950 leading-none">
                    {activeRide.driver?.driver?.vehicle_plate || '---'}
                  </p>
                  <p className="text-xs font-semibold text-neutral-600 truncate">
                    {activeRide.driver?.driver?.vehicle_color || ''}{' '}
                    {activeRide.driver?.driver?.vehicle_model || 'Veículo'}
                  </p>
                  <div className="flex items-center gap-1.5 pt-1 text-xs text-neutral-800">
                    <span className="font-extrabold uppercase truncate">
                      {activeRide.driver?.full_name || 'Parceiro'}
                    </span>
                    <span className="font-mono-num font-bold text-neutral-950 flex items-center gap-0.5 shrink-0">
                      {(activeRide.driver?.rating_avg ?? 5).toFixed(1)}
                      <Star className="h-3.5 w-3.5 fill-[#FFD100] text-[#F59E0B]" />
                    </span>
                  </div>
                  <div className="pt-0.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {isDeliveryActive ? 'Entregador verificado' : 'Motorista verificado'}
                    </span>
                    <span className="font-mono-num text-xs font-extrabold text-neutral-900">
                      {formatBRL(activeRide.estimated_fare)}
                    </span>
                  </div>
                </div>

                {/* Overlapping Vehicle Photo + Driver Avatar */}
                <div className="relative flex items-center shrink-0 pr-1">
                  <img
                    src={resolveCategoryVehicleImage(activeRide.category, platformConfig)}
                    alt={CATEGORY_LABELS[activeRide.category]}
                    className="h-14 w-20 rounded-2xl object-cover border border-neutral-200 bg-neutral-50 shadow-xs"
                  />
                  <div className="-ml-4 rounded-full border-2 border-white shadow-md">
                    <AvatarImage
                      src={activeRide.driver?.avatar_url}
                      name={activeRide.driver?.full_name || 'M'}
                      className="h-14 w-14 rounded-full object-cover shrink-0"
                      fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] font-extrabold text-lg shrink-0"
                    />
                  </div>
                </div>
              </div>

              {/* 4-Digit Security PIN Box (Required on boarding for rides; Optional on deliveries) */}
              {(!isDeliveryActive || activeRide.require_pin !== false) ? (
                <div className="flex items-center justify-between rounded-2xl bg-[#FFD100]/20 border border-[#FFD100] px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-5 w-5 text-neutral-950 shrink-0" />
                    <div>
                      <p className="text-xs font-extrabold text-neutral-950">
                        {isDeliveryActive ? 'PIN de Coleta e Entrega' : 'PIN de segurança (Embarque)'}
                      </p>
                      <p className="text-[11px] text-neutral-700">
                        {isDeliveryActive
                          ? 'Informe ao entregador na coleta e entrega'
                          : activeRide.status === 'in_progress'
                          ? 'Embarque validado · Chegada sem PIN'
                          : 'Informe ao motorista ao embarcar'}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-neutral-950 px-3.5 py-1 font-mono-num text-xl font-extrabold tracking-widest text-[#FFD100]">
                    {activeRide.pin_code}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-900">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span>Entrega configurada sem PIN · Foto comprobatória no destino</span>
                </div>
              )}

              {/* 2-Minute Wait Timer synced with Driver */}
              {activeRide.status === 'arrived' && (
                <div
                  className={`flex items-center justify-between rounded-2xl border px-3.5 py-2.5 text-xs ${
                    passengerWaitingStats.isCharging
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-amber-300 bg-amber-50 text-amber-950'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Clock
                      className={`h-4 w-4 shrink-0 ${
                        passengerWaitingStats.isCharging ? 'text-red-600' : 'text-amber-700'
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

              {/* Centralized Platform Pix Payment CTA */}
              {activeRide.payment_method === 'pix' && activeRide.payment_status === 'pending' && (
                <button
                  type="button"
                  onClick={() => setPixModalRide(activeRide)}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition"
                >
                  <QrCode className="h-4 w-4" />
                  Pagar com Pix da Plataforma ({formatBRL(activeRide.estimated_fare + passengerWaitingStats.waitingFee)})
                </button>
              )}

              {activeRide.payment_status === 'paid_pix' && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 py-2 text-xs font-bold text-emerald-800">
                  <ShieldCheck className="h-4 w-4" />
                  Pix enviado para {platformConfig.platform_pix_receiver}
                </div>
              )}

              {/* Clean Light Action Row matching 99 UI */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="min-h-[48px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 border border-neutral-200/80 text-sm font-bold text-neutral-900 hover:bg-neutral-200/70 active:scale-[0.98] transition"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>
                    {currentChatMessages.length > 0
                      ? `Chat (${currentChatMessages.length})`
                      : 'Alguma observação?'}
                  </span>
                </button>
                {activeRide.driver?.phone && (
                  <a
                    href={`tel:${activeRide.driver.phone.replace(/\D/g, '')}`}
                    className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-2xl bg-neutral-100 border border-neutral-200/80 text-neutral-900 hover:bg-neutral-200/70 active:scale-[0.98] transition"
                    aria-label="Ligar para motorista"
                    title="Ligar para motorista"
                  >
                    <Phone className="h-5 w-5" />
                  </a>
                )}
                {activeRide.status !== 'in_progress' && (
                  <button
                    type="button"
                    onClick={handleCancelRide}
                    className="min-h-[48px] rounded-2xl border border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-600 hover:bg-neutral-100"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* FULL-SCREEN "SELECIONAR ENDEREÇO" VIEW (Matching 99 Screenshot) */}
      {addressScreenOpen && (
        <div className="fixed inset-0 z-[1050] flex flex-col bg-white">
          <div className="border-b border-neutral-100 px-4 pt-safe py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAddressScreenOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-950"
                aria-label="Voltar ao mapa"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <h2 className="font-display text-lg font-extrabold text-neutral-950">
                Selecionar endereço
              </h2>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="flex items-center gap-2.5 rounded-2xl border border-neutral-200 bg-white px-3.5 py-1.5 focus-within:border-neutral-950">
                <span className="h-3 w-3 shrink-0 rounded-full bg-[#FFD100] border-2 border-neutral-950" />
                <input
                  type="text"
                  value={originQuery}
                  onFocus={() => setActiveSearchField('origin')}
                  onChange={(e) => setOriginQuery(e.target.value)}
                  placeholder="Localização atual"
                  className="min-h-[40px] flex-1 bg-transparent text-sm font-semibold text-emerald-700 outline-none placeholder:text-neutral-400"
                />
                <button
                  type="button"
                  onClick={detectMyGps}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-100"
                  title="Atualizar GPS"
                >
                  <Crosshair className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-100 px-3.5 py-1.5 focus-within:border-neutral-950 focus-within:bg-white">
                  <Flag className="h-4 w-4 shrink-0 text-neutral-950" />
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
                    placeholder="Para onde vamos?"
                    className="min-h-[40px] flex-1 bg-transparent text-sm font-medium text-neutral-950 outline-none"
                  />
                  {destQuery && (
                    <button
                      type="button"
                      onClick={() => setDestQuery('')}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500"
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
                  title="Marcar destino no mapa"
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-950 hover:bg-neutral-200"
                >
                  <MapPin className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 divide-x divide-neutral-200 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (currentUser.home_address) selectDestinationPoint(currentUser.home_address);
                  else {
                    setAddressScreenOpen(false);
                    setSettingsOpen(true);
                  }
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold text-neutral-800"
              >
                <Home className="h-4 w-4 text-neutral-600" />
                <span>Casa</span>
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
                className="flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold text-neutral-800"
              >
                <Briefcase className="h-4 w-4 text-neutral-600" />
                <span>Trabalho</span>
              </button>
              <button
                type="button"
                onClick={() => setAddressTab(addressTab === 'favorites' ? 'search' : 'favorites')}
                className={`flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold ${
                  addressTab === 'favorites' ? 'text-neutral-950 underline' : 'text-neutral-800'
                }`}
              >
                <Star className="h-4 w-4 text-neutral-600" />
                <span>Favoritos</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
            {searchingAddress && (
              <div className="px-4 py-3 text-xs font-semibold text-neutral-500">
                Buscando endereços, números e estabelecimentos no Brasil...
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
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-neutral-950 truncate">
                            {item.address.split('·')[0].trim()}
                          </p>
                          <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900">
                            {item.categoryLabel}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 truncate">{item.subtitle || item.address}</p>
                      </div>
                    </div>
                    <span className="font-mono-num text-xs font-bold text-neutral-500 shrink-0">
                      {km.toFixed(1)}km
                    </span>
                  </button>
                );
              })
            ) : addressTab === 'favorites' ? (
              <div className="divide-y divide-neutral-100">
                {savedFavorites.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-sm text-neutral-600">
                      Você ainda não adicionou locais favoritos.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAddressScreenOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="min-h-[44px] rounded-2xl bg-[#FFD100] px-5 text-xs font-extrabold text-neutral-950"
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
                        className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                            <Star className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-neutral-950 truncate">{fav.label}</p>
                            <p className="text-xs text-neutral-500 truncate">{fav.address}</p>
                          </div>
                        </div>
                        <span className="font-mono-num text-xs font-bold text-neutral-500 shrink-0">
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
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                        <Navigation className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-neutral-950 truncate">{title}</p>
                          <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                            {item.categoryLabel}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 truncate">{item.subtitle || item.address}</p>
                      </div>
                    </div>
                    <span className="font-mono-num text-xs font-bold text-neutral-500 shrink-0">
                      {km.toFixed(1)}km
                    </span>
                  </button>
                );
              })
            ) : (
              QUICK_DESTINATIONS.map((item, i) => {
                const km = haversineKm(origin.lat, origin.lng, item.lat, item.lng);
                const title = item.address.split('·')[0].trim();
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectDestinationPoint(item)}
                    className="flex min-h-[62px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                        <Navigation className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-neutral-950 truncate">{title}</p>
                        <p className="text-xs text-neutral-500 truncate">{item.address}</p>
                      </div>
                    </div>
                    <span className="font-mono-num text-xs font-bold text-neutral-500 shrink-0">
                      {km.toFixed(1)}km
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-neutral-100 p-4 pb-safe bg-white">
            <button
              type="button"
              onClick={() => {
                setAddressScreenOpen(false);
                setPickOnMapMode(activeSearchField);
              }}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 text-sm font-bold text-neutral-900 hover:bg-neutral-100"
            >
              <MapPin className="h-4 w-4" />
              Marque o local no mapa
            </button>
          </div>
        </div>
      )}

      {/* 99-STYLE PASSENGER DRAWER */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/55">
          <div className="flex h-full w-80 max-w-[86vw] flex-col bg-white p-5 shadow-2xl overflow-y-auto">
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
                  className="h-14 w-14 rounded-full object-cover border-2 border-[#FFD100] shrink-0"
                  fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-200 text-neutral-900 font-display text-xl font-extrabold shrink-0"
                />
                <div>
                  <h3 className="font-display text-xl font-extrabold text-neutral-950 leading-tight">
                    {currentUser.full_name.split(' ')[0]}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-neutral-600 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#FFD100] text-[#F59E0B]" />
                    <span className="font-mono-num font-bold text-neutral-900">
                      {currentUser.rating_avg.toFixed(2).replace('.', ',')}
                    </span>
                    <span>· Editar foto/perfil</span>
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {weather && (
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-neutral-50 border border-neutral-200 px-3.5 py-2.5 text-xs">
                <span className="font-bold text-neutral-800 truncate pr-2">{weather.city}</span>
                <span className="font-mono-num font-extrabold text-neutral-950 shrink-0">
                  {weather.temperatureC}°C · {weather.label}
                </span>
              </div>
            )}

            <div className="mt-5 grid grid-cols-3 gap-y-5 gap-x-2 text-center">
              {[
                { label: 'Atividade', icon: History, action: () => setHistoryOpen(true) },
                { label: 'Ajuda', icon: HelpCircle, action: () => setInfoModal('help') },
                { label: 'Descontos', icon: Tag, action: () => setInfoModal('discounts') },
                { label: 'Carteira', icon: Wallet, action: () => setInfoModal('wallet') },
                { label: 'Configurações', icon: Settings, action: () => setSettingsOpen(true) },
                { label: 'Segurança', icon: Shield, action: () => setInfoModal('security') },
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
                    className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl p-2 hover:bg-neutral-100 active:scale-95 transition"
                  >
                    <Icon className="h-6 w-6 text-neutral-900" />
                    <span className="text-xs font-semibold text-neutral-800">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="my-5 border-t border-neutral-100" />

            <div className="flex-1 space-y-1">
              <h4 className="font-display text-sm font-extrabold text-neutral-950 mb-2">
                Outros recursos
              </h4>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportChatOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
              >
                <span className="flex items-center gap-3">
                  <Headphones className="h-5 w-5 text-blue-600" />
                  Falar com o Admin / Suporte
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setInfoModal('become_driver');
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
              >
                <span className="flex items-center gap-3">
                  <UserCheck className="h-5 w-5 text-neutral-700" />
                  Seja Motorista / Entregador
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
              >
                <span className="flex items-center gap-3">
                  <Star className="h-5 w-5 text-neutral-700" />
                  Endereços Favoritos
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setLegalDocsOpen(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
              >
                <span className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-neutral-700" />
                  Termos, Segurança e Privacidade
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>

              <div className="pt-2">
                <PWAInstallButton variant="menu" />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-100 text-sm font-bold text-neutral-800 hover:bg-neutral-200"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Drawer Shortcut Modals */}
      {infoModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                {infoModal === 'help' && 'Ajuda e Suporte'}
                {infoModal === 'discounts' && 'Descontos e Negocia'}
                {infoModal === 'wallet' && 'Carteira e Pagamentos'}
                {infoModal === 'security' && 'Central de Segurança'}
                {infoModal === 'become_driver' && 'Seja Motorista / Entregador'}
              </h3>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {infoModal === 'help' && (
              <div className="text-xs text-neutral-700 space-y-2.5 leading-relaxed">
                <p className="font-bold text-neutral-950">
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
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-extrabold text-neutral-950">Modo Negocia ativo!</p>
                <p className="mt-1 text-xs text-neutral-700">
                  Escolha a categoria <strong>Negocia</strong> ao selecionar seu destino para sugerir
                  o valor ideal da sua corrida.
                </p>
              </div>
            )}

            {infoModal === 'wallet' && (
              <div className="space-y-3 text-xs text-neutral-700">
                <div className="rounded-2xl bg-neutral-950 p-4 text-white">
                  <p className="text-neutral-400">Chave Pix Oficial da Plataforma</p>
                  <p className="mt-1 font-mono-num text-base font-extrabold text-[#FFD100]">
                    {platformConfig.platform_pix_key}
                  </p>
                  <p className="mt-1 text-neutral-300">{platformConfig.platform_pix_receiver}</p>
                </div>
                <p>
                  Pagamento preferencial configurado:{' '}
                  <strong>
                    {currentUser.preferred_payment === 'cash' ? 'Dinheiro' : 'Pix (Plataforma)'}
                  </strong>
                </p>
              </div>
            )}

            {infoModal === 'security' && (
              <div className="space-y-2.5 text-xs text-neutral-700 leading-relaxed">
                <p className="font-bold text-neutral-950">Verificação com PIN de 4 dígitos</p>
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
              <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
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
                  className="min-h-[46px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950"
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
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Atividade · Corridas e Entregas
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
              {myRides.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  Você ainda não realizou corridas ou entregas.
                </p>
              ) : (
                myRides.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-neutral-200 p-3.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-bold text-neutral-950">
                      <span>
                        {CATEGORY_LABELS[r.category]} · {r.status}
                      </span>
                      <span className="font-mono-num">
                        {formatBRL(r.final_fare ?? r.estimated_fare)}
                      </span>
                    </div>
                    <p className="text-neutral-600 truncate">De: {r.origin_address}</p>
                    <p className="text-neutral-900 font-medium truncate">
                      Para: {r.destination_address}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-semibold text-neutral-500">
                        {r.payment_method === 'pix' ? 'Pix Plataforma' : 'Dinheiro'} ·{' '}
                        {r.payment_status}
                      </span>
                      {r.payment_method === 'pix' &&
                        r.payment_status === 'pending' &&
                        r.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryOpen(false);
                              setPixModalRide(r);
                            }}
                            className="rounded-lg bg-[#FFD100] px-2.5 py-1 text-[11px] font-extrabold text-neutral-950"
                          >
                            Pagar Pix
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

      {pixModalRide && (
        <PixPaymentModal
          ride={pixModalRide}
          platformConfig={platformConfig}
          onDeclared={(updated) => {
            onRideUpsert(updated);
            setPixModalRide(null);
          }}
          onClose={() => setPixModalRide(null)}
        />
      )}

      {settingsOpen && (
        <AccountSettingsModal
          currentUser={currentUser}
          platformConfig={platformConfig}
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onLogout}
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
    </div>
  );
};
