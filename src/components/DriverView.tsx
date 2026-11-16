import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  ExternalLink,
  Flag,
  Headphones,
  History,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Navigation,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Thermometer,
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
  type RouteStep,
} from '../lib/geo';
import {
  acceptRide,
  completeRide,
  confirmCashReceived,
  confirmPixValidatedByDriver,
  fetchUserProfileById,
  fetchWalletTransactions,
  markRideArrived,
  reportRideUnpaid,
  startRideWithPin,
  toggleDriverOnlineStatus,
} from '../lib/mobilityApi';
import { startContinuousRideAlarm } from '../lib/sound';
import type {
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
import { DirectChatModal } from './DirectChatModal';
import { LiveMap } from './LiveMap';
import { PWAInstallButton } from './PWAInstallButton';
import { RatingModal } from './RatingModal';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeTab, setFinanceTab] = useState<'rides' | 'ledger'>('rides');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  const [driverCoords, setDriverCoords] = useState<[number, number]>([
    currentUser.driver?.current_lat ?? -23.55052,
    currentUser.driver?.current_lng ?? -46.633308,
  ]);
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
  const [copiedCheckoutPix, setCopiedCheckoutPix] = useState(false);
  const [waitNowMs, setWaitNowMs] = useState<number>(() => Date.now());

  const [disputeRide, setDisputeRide] = useState<Ride | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedRatingRideId, setDismissedRatingRideId] = useState<string | null>(null);

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

  const financeSummary = useMemo(() => {
    const totalPixEarned = completedRides
      .filter((r) => r.payment_method === 'pix')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const totalCashCollected = completedRides
      .filter((r) => r.payment_method === 'cash' && r.payment_status !== 'disputed')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    const totalPayoutsReceived = transactions
      .filter((t) => t.type === 'payout')
      .reduce((acc, t) => acc + Math.abs(t.amount), 0);

    const disputedTotal = myDriverRides
      .filter((r) => r.payment_status === 'disputed')
      .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);

    return {
      totalPixEarned: Number(totalPixEarned.toFixed(2)),
      totalCashCollected: Number(totalCashCollected.toFixed(2)),
      totalPayoutsReceived: Number(totalPayoutsReceived.toFixed(2)),
      disputedTotal: Number(disputedTotal.toFixed(2)),
      pendingToReceive: Number((currentUser.wallet_balance || 0).toFixed(2)),
    };
  }, [completedRides, myDriverRides, transactions, currentUser.wallet_balance]);

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
      `${incomingRide.origin_address} → ${incomingRide.destination_address}`
    );
    return stopAlarm;
  }, [incomingRide]);

  // Keep checkoutRide synced if passenger confirms Pix while checkout modal is open
  useEffect(() => {
    if (!checkoutRide) return;
    const latest = myDriverRides.find((r) => r.id === checkoutRide.id);
    if (latest) setCheckoutRide(latest);
  }, [myDriverRides, checkoutRide]);

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
      !checkoutRide
        ? myDriverRides.find(
            (r) =>
              r.status === 'completed' &&
              !r.driver_rating_submitted &&
              r.id !== dismissedRatingRideId
          ) || null
        : null,
    [myDriverRides, dismissedRatingRideId, checkoutRide]
  );

  useEffect(() => {
    getCurrentGpsPosition().then((pos) => {
      if (pos) {
        setDriverCoords([pos.lat, pos.lng]);
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
    if (!activeRide) {
      setRouteCoords([]);
      setRouteSteps([]);
      setRouteDistanceKm(0);
      setRouteDurationMin(0);
      return;
    }
    const targetLat =
      activeRide.status === 'in_progress'
        ? activeRide.destination_lat
        : activeRide.origin_lat;
    const targetLng =
      activeRide.status === 'in_progress'
        ? activeRide.destination_lng
        : activeRide.origin_lng;

    let cancelled = false;
    fetchRouteGeometry(driverCoords[0], driverCoords[1], targetLat, targetLng).then((res) => {
      if (!cancelled) {
        setRouteCoords(res.coords);
        setRouteSteps(res.steps);
        setRouteDistanceKm(res.distanceKm);
        setRouteDurationMin(res.durationMin);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRide, driverCoords]);

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

  useEffect(() => {
    fetchWalletTransactions(currentUser.id).then(setTransactions).catch(() => {});
  }, [currentUser.id]);

  const toggleOnline = async () => {
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
    const nextLat = driverCoords[0] + (targetLat - driverCoords[0]) * 0.45;
    const nextLng = driverCoords[1] + (targetLng - driverCoords[1]) * 0.45;
    const heading =
      (Math.atan2(targetLng - driverCoords[1], targetLat - driverCoords[0]) * 180) / Math.PI;
    setDriverCoords([nextLat, nextLng]);
    onEmitLocation(currentUser.id, nextLat, nextLng, heading);
  };

  const handleAcceptRide = async (rideId: string) => {
    setStatusError(null);
    setActionLoading(true);
    try {
      const updated = await acceptRide(rideId, currentUser.id);
      onRideUpsert(updated);
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
    } finally {
      setActionLoading(false);
    }
  };

  const submitPinAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRide || !pinModalMode) return;
    setPinError(null);
    setActionLoading(true);
    try {
      const totalWithWait = Number(
        (activeRide.estimated_fare + waitingStats.waitingFee).toFixed(2)
      );
      const updated =
        pinModalMode === 'pickup'
          ? await startRideWithPin(activeRide, pinInput)
          : await completeRide(activeRide, currentUser.id, pinInput, totalWithWait);
      setPinModalMode(null);
      setPinInput('');
      onRideUpsert(updated);
      if (pinModalMode === 'delivery') {
        setCheckoutRide(updated);
        await loadFinancePanel();
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Código PIN incorreto.');
    } finally {
      setActionLoading(false);
    }
  };

  const completeRideDirect = async () => {
    if (!activeRide) return;
    if (isDeliveryCategory(activeRide.category)) {
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
      onRideUpsert(updated);
      setCheckoutRide(updated);
      await loadFinancePanel();
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

  const handleConfirmPixPayment = async (targetRide: Ride | null) => {
    if (!targetRide) return;
    setActionLoading(true);
    try {
      const updated = await confirmPixValidatedByDriver(targetRide);
      onRideUpsert(updated);
      setCheckoutRide(null);
      await loadFinancePanel();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao validar Pix recebido.');
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

  const checkoutEmvPayload = useMemo(() => {
    if (!checkoutRide || checkoutRide.payment_method !== 'pix') return '';
    const amount = checkoutRide.final_fare ?? checkoutRide.estimated_fare;
    return buildPixEmvPayload(
      platformConfig.platform_pix_key,
      platformConfig.platform_pix_receiver,
      platformConfig.platform_city,
      amount,
      checkoutRide.id
    );
  }, [checkoutRide, platformConfig]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-900">
      <LiveMap
        center={driverCoords}
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
            : null
        }
        routeCoords={routeCoords}
        controlsTopClassName={activeRide ? 'top-28' : 'top-20'}
        driverPosition={{
          lat: driverCoords[0],
          lng: driverCoords[1],
          heading: currentUser.driver?.heading || 0,
          vehicleType: currentUser.driver?.vehicle_type || 'car',
          label: 'Você (GPS ativo)',
        }}
        onRecenter={() => {
          getCurrentGpsPosition()
            .then((pos) => {
              if (!pos) return;
              setDriverCoords([pos.lat, pos.lng]);
              onEmitLocation(currentUser.id, pos.lat, pos.lng, pos.heading ?? 0);
              fetchLocalWeather(pos.lat, pos.lng).then((w) => w && setWeather(w));
            })
            .catch(() => {});
        }}
      />

      {/* NORMAL IDLE TOP BAR — HIDDEN IN IMMERSIVE NAVIGATION MODE */}
      {!activeRide && (
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] flex items-center justify-between gap-2 px-4 pt-safe py-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#181B22] text-white shadow-lg border border-white/10 active:scale-95 transition"
            aria-label="Abrir menu do motorista"
          >
            <Menu className="h-6 w-6" />
          </button>

          <button
            type="button"
            onClick={() => {
              loadFinancePanel();
              setFinanceOpen(true);
            }}
            className="pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full bg-[#181B22] px-5 text-white shadow-xl border border-white/10 active:scale-95 transition"
          >
            <Wallet className="h-4 w-4 text-[#FFD100]" />
            <span className="font-mono-num text-base font-extrabold text-white">
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
            <span className="whitespace-nowrap">{isOnline ? 'Online' : 'Conectar'}</span>
          </button>
        </div>
      )}

      {/* IMMERSIVE TURN-BY-TURN NAVIGATION HUD (SHOWN ONLY DURING ACTIVE RIDE) */}
      {activeRide && (
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-[700] px-3 pt-safe py-2.5">
          <div className="pointer-events-auto mx-auto max-w-xl rounded-3xl bg-[#14171D] p-3.5 text-white shadow-2xl border border-white/15">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#1F242E] border border-[#FFD100]/40">
                  {renderManeuverIcon(currentNavStep)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num text-base font-extrabold text-[#FFD100]">
                      {currentNavStep ? formatStepMeters(currentNavStep.distanceMeters) : `${routeDistanceKm} km`}
                    </span>
                    <span className="text-[11px] font-bold text-neutral-400">
                      · {routeDurationMin || 3} min até{' '}
                      {activeRide.status === 'in_progress'
                        ? 'o destino'
                        : activeIsDelivery
                        ? 'a coleta'
                        : 'o embarque'}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-white truncate">
                    {currentNavStep?.instruction ||
                      (activeRide.status === 'in_progress'
                        ? activeRide.destination_address
                        : activeRide.origin_address)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-[11px] font-bold text-[#FFD100]"
                  title="Abrir no Google Maps"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Maps</span>
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
                  className="flex h-10 items-center rounded-xl bg-[#FFD100] px-2.5 text-[11px] font-extrabold text-neutral-950 active:scale-95"
                  title="Simular avanço GPS na rota"
                >
                  +GPS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM FLOATING DRIVER PANEL */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-3 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        <div className="pointer-events-auto rounded-3xl bg-[#14171D] p-5 text-white shadow-2xl border border-white/10 max-h-[76vh] overflow-y-auto">
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {activeRide.passenger?.avatar_url ? (
                    <img
                      src={activeRide.passenger.avatar_url}
                      alt={activeRide.passenger.full_name}
                      className="h-12 w-12 rounded-full object-cover border-2 border-[#FFD100] shrink-0"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold text-lg">
                      {(activeRide.passenger?.full_name || 'C').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="block text-[11px] font-bold text-[#FFD100]">
                      {activeRide.status === 'accepted' &&
                        (activeIsDelivery
                          ? 'Etapa A · Indo para coleta'
                          : 'Etapa A · Indo buscar o cliente')}
                      {activeRide.status === 'arrived' &&
                        (activeIsDelivery
                          ? 'Etapa A · No local de coleta'
                          : 'Etapa A · Aguardando cliente')}
                      {activeRide.status === 'in_progress' &&
                        (activeIsDelivery
                          ? 'Etapa B · Entrega em rota'
                          : 'Etapa B · Em viagem ao destino')}
                    </span>
                    <h3 className="font-display text-base font-extrabold text-white truncate">
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
                      className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white active:scale-95 transition"
                      aria-label="Ligar para o cliente"
                      title="Ligar para o cliente"
                    >
                      <Phone className="h-5 w-5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setChatOpen(true)}
                    className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#FFD100] active:scale-95 transition"
                    aria-label="Abrir chat com cliente"
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
              <div className="rounded-2xl bg-[#1D212B] p-3 text-xs space-y-1.5 border border-white/5">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="font-bold text-neutral-400">
                    {activeRide.payment_method === 'pix' ? 'Pagamento via Pix' : 'Pagamento em Dinheiro'}
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
                  {activeIsDelivery
                    ? 'Cheguei no local de coleta'
                    : 'Cheguei no local de embarque'}
                </button>
              )}

              {activeRide.status === 'arrived' && (
                <SlideToConfirm
                  label={
                    activeIsDelivery
                      ? 'Arraste para coletar (PIN 4 dígitos)'
                      : 'Arraste para embarcar (PIN 4 dígitos)'
                  }
                  disabled={actionLoading}
                  onConfirm={() => {
                    setPinError(null);
                    setPinInput('');
                    setPinModalMode('pickup');
                  }}
                />
              )}

              {activeRide.status === 'in_progress' && (
                <SlideToConfirm
                  variant="emerald"
                  label={
                    activeIsDelivery
                      ? 'Arraste para finalizar entrega (PIN)'
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
              <div className="flex items-center justify-between text-[11px] text-neutral-400">
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3.5 w-3.5 text-[#FFD100] shrink-0" />
                  {weather?.city || platformConfig.platform_city}
                </span>
                {weather && (
                  <span className="flex items-center gap-1 font-mono-num font-bold text-[#FFD100] shrink-0">
                    <Thermometer className="h-3.5 w-3.5" />
                    {weather.temperatureC}°C · {weather.label}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-base font-extrabold text-white">
                    {isOnline ? 'Você está online!' : 'Você está offline'}
                  </h3>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {isOnline
                      ? 'Aguardando corridas e entregas na sua região...'
                      : 'Toque em "Conectar" para receber solicitações.'}
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
                  {isOnline ? 'Pausar' : 'Conectar'}
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
                      Central de Pagamentos & Ganhos
                    </p>
                    <p className="text-[11px] text-neutral-400 font-mono-num">
                      A receber (Pix): {formatBRL(financeSummary.pendingToReceive)} · Dinheiro:{' '}
                      {formatBRL(financeSummary.totalCashCollected)}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FULL-SCREEN INCOMING RIDE / DELIVERY ALERT (SOUND + VIBRATION + ACCEPT/DECLINE) */}
      {incomingRide && (
        <div className="fixed inset-0 z-[1200] flex flex-col justify-between bg-[#0F1115] p-5 pt-safe pb-safe text-white">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-3 w-3 rounded-full bg-[#FFD100] animate-ping" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#FFD100]">
                  {isDeliveryCategory(incomingRide.category)
                    ? `Nova ${CATEGORY_LABELS[incomingRide.category]}`
                    : incomingRide.category === 'negocia'
                    ? 'Oferta Negocia'
                    : `Nova Chamada · ${CATEGORY_LABELS[incomingRide.category]}`}
                </span>
              </div>
              <span className="font-mono-num text-xs font-extrabold text-neutral-300">
                {incomingRide.distance_km} km · ~{Math.max(3, Math.round(incomingRide.distance_km * 2.2))} min
              </span>
            </div>

            <div className="rounded-3xl bg-[#181C24] p-5 border border-[#FFD100]/40 text-center">
              <p className="text-xs font-bold text-neutral-400">
                {incomingRide.payment_method === 'pix'
                  ? 'Pagamento via Pix (Plataforma)'
                  : 'Receber em Dinheiro'}
              </p>
              <p className="mt-1 font-display text-5xl font-extrabold text-[#FFD100] font-mono-num">
                {formatBRL(incomingRide.estimated_fare)}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-neutral-200">
                {incomingRide.passenger?.avatar_url && (
                  <img
                    src={incomingRide.passenger.avatar_url}
                    alt={incomingRide.passenger.full_name}
                    className="h-7 w-7 rounded-full object-cover border border-[#FFD100]"
                  />
                )}
                <span>{incomingRide.passenger?.full_name || 'Passageiro'}</span>
                <span>· ★ {(incomingRide.passenger?.rating_avg ?? 5).toFixed(1)}</span>
              </div>
            </div>

            <div className="space-y-3 rounded-3xl bg-[#181C24] p-4 text-sm border border-white/10">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 shrink-0 text-[#FFD100] mt-0.5" />
                <div>
                  <span className="block text-xs font-bold text-neutral-400">
                    {isDeliveryCategory(incomingRide.category) ? 'Local de Coleta' : 'Partida / Embarque'}
                  </span>
                  <span className="font-bold text-white leading-snug">
                    {incomingRide.origin_address}
                  </span>
                </div>
              </div>
              <div className="border-t border-white/10 pt-3 flex items-start gap-3">
                <Navigation className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
                <div>
                  <span className="block text-xs font-bold text-neutral-400">Destino Final</span>
                  <span className="font-bold text-white leading-snug">
                    {incomingRide.destination_address}
                  </span>
                </div>
              </div>
              {incomingRide.delivery_notes && (
                <p className="border-t border-white/10 pt-2 text-xs text-[#FFD100] font-semibold">
                  Obs.: {incomingRide.delivery_notes}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4">
            <button
              type="button"
              onClick={() => handleDeclineRide(incomingRide.id)}
              className="min-h-[60px] rounded-2xl border border-white/25 bg-white/5 text-sm font-extrabold text-neutral-200 hover:bg-white/10 active:scale-95 transition"
            >
              Recusar
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleAcceptRide(incomingRide.id)}
              className="col-span-2 min-h-[60px] rounded-2xl bg-[#FFD100] text-lg font-extrabold text-neutral-950 shadow-xl active:scale-95 transition"
            >
              {actionLoading ? 'Aceitando...' : 'Aceitar Corrida'}
            </button>
          </div>
        </div>
      )}

      {/* ETAPA C: AUTOMATIC PAYMENT CHECKOUT SCREEN UPON DESTINATION ARRIVAL */}
      {checkoutRide && (
        <div className="fixed inset-0 z-[1180] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#14171D] p-6 text-white shadow-2xl border border-white/15 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <p className="text-xs font-extrabold text-[#FFD100]">
                  Etapa C · Chegada ao Destino
                </p>
                <h3 className="font-display text-lg font-extrabold text-white">
                  {checkoutRide.payment_method === 'pix'
                    ? 'Conferência de Pagamento Pix'
                    : 'Recebimento em Dinheiro'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutRide(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                aria-label="Fechar checkout"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#1D212B] p-4 text-center border border-white/10">
              <p className="text-xs font-semibold text-neutral-400">
                Valor total a receber ({checkoutRide.passenger?.full_name || 'Cliente'})
              </p>
              <p className="mt-1 font-display text-4xl font-extrabold text-[#FFD100] font-mono-num">
                {formatBRL(checkoutRide.final_fare ?? checkoutRide.estimated_fare)}
              </p>
              {(checkoutRide.final_fare ?? checkoutRide.estimated_fare) >
                checkoutRide.estimated_fare && (
                <p className="mt-1 text-[11px] font-bold text-amber-300">
                  Inclui taxa de espera após 2 minutos gratuitos
                </p>
              )}
            </div>

            {checkoutRide.payment_method === 'pix' ? (
              <div className="space-y-3">
                <div
                  className={`rounded-2xl border px-3.5 py-2.5 text-xs font-bold ${
                    checkoutRide.payment_status === 'paid_pix'
                      ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                      : 'border-amber-500/40 bg-amber-950/40 text-amber-200'
                  }`}
                >
                  {checkoutRide.payment_status === 'paid_pix'
                    ? 'Cliente informou pagamento Pix! Valide o comprovante abaixo ou libere sua próxima chamada.'
                    : 'Mostre o Pix Copia e Cola ao cliente e valide o recebimento após conferir o comprovante.'}
                </div>

                <div className="rounded-2xl bg-[#1D212B] p-3 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-neutral-400">
                      Pix Copia e Cola · {platformConfig.platform_pix_receiver}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(checkoutEmvPayload);
                        setCopiedCheckoutPix(true);
                        setTimeout(() => setCopiedCheckoutPix(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1 text-[11px] font-extrabold text-neutral-950"
                    >
                      {copiedCheckoutPix ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCheckoutPix ? 'Copiado' : 'Copiar Pix'}
                    </button>
                  </div>
                  <p className="font-mono-num text-[11px] text-neutral-300 break-all select-all">
                    {checkoutEmvPayload}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleConfirmPixPayment(checkoutRide)}
                  className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-extrabold text-neutral-950 active:scale-[0.98]"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  {actionLoading ? 'Validando...' : 'Validar Comprovante Pix e Encerrar'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-neutral-300 text-center">
                  Receba o valor exato em espécie diretamente com o passageiro antes de liberar sua próxima chamada.
                </p>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleConfirmCashPayment(checkoutRide)}
                  className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-extrabold text-neutral-950 active:scale-[0.98]"
                >
                  <Banknote className="h-5 w-5" />
                  {actionLoading
                    ? 'Confirmando...'
                    : `Confirmar ${formatBRL(checkoutRide.final_fare ?? checkoutRide.estimated_fare)} em Dinheiro`}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setDisputeRide(checkoutRide);
                setDisputeReason('');
              }}
              className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-red-500/40 bg-red-950/40 text-xs font-bold text-red-300"
            >
              <ShieldAlert className="h-4 w-4" />
              Relatar erro ou não pagamento ao Admin
            </button>
          </div>
        </div>
      )}

      {/* 4-Digit PIN Modal */}
      {pinModalMode && activeRide && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={submitPinAction}
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                {pinModalMode === 'delivery'
                  ? 'PIN de Entrega Final'
                  : activeIsDelivery
                  ? 'PIN de Retirada / Coleta'
                  : 'Confirmar Código PIN'}
              </h3>
              <button
                type="button"
                onClick={() => setPinModalMode(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-600">
              {pinModalMode === 'delivery'
                ? 'Informe o código PIN de 4 dígitos para confirmar a entrega no destino.'
                : `Peça os 4 dígitos exibidos no celular de ${
                    activeRide.passenger?.full_name || 'cliente'
                  } para liberar a partida.`}
            </p>

            {pinError && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">
                {pinError}
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              required
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0000"
              className="mt-4 min-h-[58px] w-full rounded-2xl border-2 border-neutral-300 bg-neutral-50 text-center font-mono-num text-3xl font-extrabold tracking-[0.45em] text-neutral-950 outline-none focus:border-neutral-950 focus:bg-white"
            />

            <button
              type="submit"
              disabled={pinInput.length !== 4 || actionLoading}
              className="mt-4 min-h-[50px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 disabled:opacity-40"
            >
              {actionLoading
                ? 'Validando PIN...'
                : pinModalMode === 'delivery'
                ? 'Confirmar Entrega e Receber'
                : 'Liberar Partida'}
            </button>
          </form>
        </div>
      )}

      {/* Non-Payment Dispute Modal */}
      {disputeRide && (
        <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={submitDispute}
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Relatar não pagamento
              </h3>
              <button
                type="button"
                onClick={() => setDisputeRide(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Ao relatar um problema de pagamento, a corrida #{disputeRide.id.slice(-4)} (
              {formatBRL(disputeRide.final_fare ?? disputeRide.estimated_fare)}) é enviada ao Super
              Admin para auditoria e quitação.
            </p>
            <textarea
              rows={3}
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Descreva o ocorrido (ex: passageiro desembarcou sem pagar)"
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs outline-none focus:border-neutral-950"
            />
            <button
              type="submit"
              disabled={actionLoading}
              className="min-h-[48px] w-full rounded-2xl bg-red-600 text-sm font-extrabold text-white"
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
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.full_name}
                    className="h-12 w-12 rounded-full object-cover border-2 border-[#FFD100] shrink-0"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold text-lg shrink-0">
                    {currentUser.full_name.slice(0, 1)}
                  </div>
                )}
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
                  loadFinancePanel();
                  setFinanceOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-[#FFD100]" />
                  Central de Ganhos & Pagamentos
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
                  setHistoryOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <History className="h-5 w-5 text-neutral-400" />
                  Histórico de Corridas ({myDriverRides.length})
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
                  Falar com Admin / Suporte
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
                  Perfil, Foto e Veículo
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <div className="flex items-center gap-3 px-3 py-2 text-xs text-neutral-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{platformConfig.platform_city} · RLS & PIN ativos</span>
              </div>

              <div className="pt-2">
                <PWAInstallButton variant="menu" />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-bold text-white hover:bg-white/15"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* FULL DRIVER PAYMENT & EARNINGS MANAGEMENT PANEL (Matching Admin Clarity) */}
      {financeOpen && (
        <div className="fixed inset-0 z-[1050] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
          <div className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl bg-[#0F1115] text-white p-6 shadow-2xl max-h-[90vh] flex flex-col border border-white/10">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div>
                <h3 className="font-display text-lg font-extrabold text-white">
                  Gestão de Pagamentos e Ganhos
                </h3>
                <p className="text-xs text-neutral-400">
                  Acompanhe o que você tem a receber da plataforma (Pix) e em dinheiro
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

            {/* 4 Financial Summary Cards */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-[#FFD100]/30">
                <p className="text-[11px] font-semibold text-neutral-400">
                  A Receber (Admin Pix)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-[#FFD100]">
                  {formatBRL(financeSummary.pendingToReceive)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Total Corridas Pix
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-white">
                  {formatBRL(financeSummary.totalPixEarned)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Recebido em Dinheiro
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-emerald-400">
                  {formatBRL(financeSummary.totalCashCollected)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#1A1D24] p-3.5 border border-white/5">
                <p className="text-[11px] font-semibold text-neutral-400">
                  Já Repassado (Pix)
                </p>
                <p className="mt-1 font-mono-num text-xl font-extrabold text-sky-400">
                  {formatBRL(financeSummary.totalPayoutsReceived)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#1A1D24] px-4 py-2.5 text-xs border border-white/5">
              <span className="text-neutral-400">
                Sua Chave Pix para repasse:{' '}
                <strong className="font-mono-num text-white">
                  {currentUser.driver?.pix_key || 'Não cadastrada'}
                </strong>
              </span>
              <button
                type="button"
                onClick={loadFinancePanel}
                className="flex items-center gap-1 text-[#FFD100] font-bold"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </button>
            </div>

            {/* Sub-tabs: Corridas vs Extrato */}
            <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-2xl bg-[#1A1D24] p-1">
              <button
                type="button"
                onClick={() => setFinanceTab('rides')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition ${
                  financeTab === 'rides'
                    ? 'bg-[#FFD100] text-neutral-950'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Pagamentos por Corrida ({myDriverRides.length})
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
                Extrato e Repasses ({transactions.length})
              </button>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto space-y-2.5 pr-0.5">
              {financeTab === 'rides' ? (
                myDriverRides.length === 0 ? (
                  <p className="py-10 text-center text-xs text-neutral-400">
                    Nenhuma corrida ou entrega registrada ainda.
                  </p>
                ) : (
                  myDriverRides.map((r) => {
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
                            {r.payment_method === 'pix' ? (
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
                            {r.payment_method === 'pix' ? 'Pix' : 'Dinheiro'} ·{' '}
                            {statusMeta.label}
                          </span>
                          <span className="font-mono-num text-neutral-500">
                            {new Date(r.created_at).toLocaleDateString('pt-BR')}
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
              ) : transactions.length === 0 ? (
                <p className="py-10 text-center text-xs text-neutral-400">
                  Nenhuma movimentação financeira registrada ainda.
                </p>
              ) : (
                transactions.map((tx) => (
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
                          : 'Crédito de corrida Pix'}{' '}
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
                        {r.payment_method === 'pix' ? 'Pix' : 'Dinheiro'} · {r.payment_status}
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
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onLogout}
          onClose={() => setSettingsOpen(false)}
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
          onSubmitted={(updated) => onRideUpsert(updated)}
          onSkip={() => setDismissedRatingRideId(pendingRatingRide.id)}
        />
      )}
    </div>
  );
};
