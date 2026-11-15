import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  KeyRound,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Navigation,
  Power,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Wallet,
  X,
} from 'lucide-react';
import { buildGoogleMapsDirectionsUrl, fetchRouteGeometry, formatBRL } from '../lib/geo';
import { playOfferAlertSound } from '../lib/sound';
import type {
  Ride,
  RideCategory,
  RideMessage,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';
import { AccountSettingsModal } from './AccountSettingsModal';
import { LiveMap } from './LiveMap';
import { PWAInstallButton } from './PWAInstallButton';
import { RatingModal } from './RatingModal';
import { RideChatModal } from './RideChatModal';

interface DriverViewProps {
  currentUser: UserProfile;
  rides: Ride[];
  messagesByRide: Record<string, RideMessage[]>;
  onUserUpdated: (user: UserProfile) => void;
  onLoadMessages: (rideId: string) => void;
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

export const DriverView: React.FC<DriverViewProps> = ({
  currentUser,
  rides,
  messagesByRide,
  onUserUpdated,
  onLoadMessages,
  onRideUpsert,
  onEmitLocation,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [driverCoords, setDriverCoords] = useState<[number, number]>([
    currentUser.driver?.current_lat ?? -23.55052,
    currentUser.driver?.current_lng ?? -46.633308,
  ]);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [declinedRideIds, setDeclinedRideIds] = useState<string[]>([]);

  // PIN verification modal (supports both pickup/start AND delivery completion!)
  const [pinModalMode, setPinModalMode] = useState<'pickup' | 'delivery' | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Non-payment dispute reporting modal
  const [disputeRide, setDisputeRide] = useState<Ride | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedRatingRideId, setDismissedRatingRideId] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastAlertedRideIdRef = useRef<string | null>(null);
  const isOnline = Boolean(currentUser.driver?.is_online);

  const myDriverRides = useMemo(
    () => rides.filter((r) => r.driver_id === currentUser.id),
    [rides, currentUser.id]
  );

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

  useEffect(() => {
    if (incomingRide && incomingRide.id !== lastAlertedRideIdRef.current) {
      lastAlertedRideIdRef.current = incomingRide.id;
      playOfferAlertSound();
    }
  }, [incomingRide]);

  const pendingRatingRide = useMemo(
    () =>
      myDriverRides.find(
        (r) =>
          r.status === 'completed' &&
          !r.driver_rating_submitted &&
          r.id !== dismissedRatingRideId
      ) || null,
    [myDriverRides, dismissedRatingRideId]
  );

  const completedCount = useMemo(
    () => myDriverRides.filter((r) => r.status === 'completed').length,
    [myDriverRides]
  );

  useEffect(() => {
    if (!isOnline || !navigator.geolocation) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const heading = pos.coords.heading || 0;
        setDriverCoords([lat, lng]);
        onEmitLocation(currentUser.id, lat, lng, heading);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isOnline, currentUser.id, onEmitLocation]);

  useEffect(() => {
    if (activeRide) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  useEffect(() => {
    if (!activeRide) {
      setRouteCoords([]);
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
      if (!cancelled) setRouteCoords(res.coords);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRide, driverCoords]);

  const refreshProfile = useCallback(async () => {
    const res = await fetch(`/api/users/${currentUser.id}`);
    if (res.ok) {
      const data = (await res.json()) as { user: UserProfile };
      onUserUpdated(data.user);
    }
  }, [currentUser.id, onUserUpdated]);

  const loadWallet = useCallback(async () => {
    const res = await fetch(`/api/wallet/${currentUser.id}`);
    if (res.ok) {
      const data = (await res.json()) as { balance: number; transactions: WalletTransaction[] };
      setTransactions(data.transactions);
    }
  }, [currentUser.id]);

  const toggleOnline = async () => {
    setStatusError(null);
    setTogglingOnline(true);
    try {
      const res = await fetch('/api/driver/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          is_online: !isOnline,
          lat: driverCoords[0],
          lng: driverCoords[1],
        }),
      });
      const data = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok || !data.user) {
        setStatusError(data.error || 'Não foi possível alterar status online.');
        return;
      }
      onUserUpdated(data.user);
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

  const acceptRide = async (rideId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rides/${rideId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id }),
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setStatusError(data.error || 'Solicitação indisponível.');
        return;
      }
      onRideUpsert(data.ride);
    } finally {
      setActionLoading(false);
    }
  };

  const declineRide = async (rideId: string) => {
    setDeclinedRideIds((prev) => [...prev, rideId]);
    const res = await fetch(`/api/rides/${rideId}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: currentUser.id }),
    });
    if (res.ok) {
      const data = (await res.json()) as { user?: UserProfile };
      if (data.user) onUserUpdated(data.user);
    }
  };

  const markArrived = async () => {
    if (!activeRide) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rides/${activeRide.id}/arrive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ride: Ride };
        onRideUpsert(data.ride);
      }
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
      const endpoint =
        pinModalMode === 'pickup'
          ? `/api/rides/${activeRide.id}/start`
          : `/api/rides/${activeRide.id}/complete`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id, pin_code: pinInput }),
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setPinError(data.error || 'Código PIN incorreto.');
        return;
      }
      setPinModalMode(null);
      setPinInput('');
      onRideUpsert(data.ride);
      if (pinModalMode === 'delivery') {
        await refreshProfile();
      }
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
      const res = await fetch(`/api/rides/${activeRide.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ride: Ride };
        onRideUpsert(data.ride);
        await refreshProfile();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const submitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeRide) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rides/${disputeRide.id}/report-unpaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disputeReason }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ride: Ride };
        onRideUpsert(data.ride);
        setDisputeRide(null);
        setDisputeReason('');
      }
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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100">
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
        driverPosition={{
          lat: driverCoords[0],
          lng: driverCoords[1],
          heading: currentUser.driver?.heading || 0,
          vehicleType: currentUser.driver?.vehicle_type || 'car',
          label: 'Você (GPS ativo)',
        }}
        onRecenter={() => {
          navigator.geolocation?.getCurrentPosition((pos) => {
            setDriverCoords([pos.coords.latitude, pos.coords.longitude]);
            onEmitLocation(currentUser.id, pos.coords.latitude, pos.coords.longitude, 0);
          });
        }}
      />

      {/* Top Floating Bar */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] flex items-center justify-between gap-2 px-4 pt-safe py-3">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950 shadow-lg border border-neutral-200 active:scale-95 transition"
          aria-label="Abrir menu do motorista"
        >
          <Menu className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={() => {
            loadWallet();
            setWalletOpen(true);
          }}
          className="pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full bg-neutral-950 px-5 text-white shadow-xl active:scale-95 transition"
        >
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
          <span className="whitespace-nowrap">{isOnline ? 'Online' : 'Ficar Online'}</span>
        </button>
      </div>

      {/* Bottom Floating Driver Card */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-3 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        <div className="pointer-events-auto rounded-3xl bg-white p-5 shadow-2xl border border-neutral-200 max-h-[76vh] overflow-y-auto">
          {statusError && (
            <div className="mb-3 rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {statusError}
            </div>
          )}

          {currentUser.status !== 'active' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                {currentUser.status === 'pending' ? (
                  <Clock className="h-6 w-6 shrink-0 text-amber-600" />
                ) : (
                  <AlertTriangle className="h-6 w-6 shrink-0 text-red-600" />
                )}
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    {currentUser.status === 'pending'
                      ? 'Cadastro em análise'
                      : currentUser.status === 'rejected'
                      ? 'Cadastro reprovado'
                      : 'Perfil suspenso'}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-700">
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
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 text-xs font-bold text-[#FFD100]"
              >
                <RefreshCw className="h-4 w-4" />
                Verificar aprovação agora
              </button>
            </div>
          ) : activeRide ? (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-xs font-bold text-amber-700">
                    {activeRide.status === 'accepted' &&
                      (activeIsDelivery
                        ? 'Indo para o local de coleta'
                        : 'Indo buscar o passageiro')}
                    {activeRide.status === 'arrived' &&
                      (activeIsDelivery
                        ? 'No local de coleta · Peça o PIN'
                        : 'Aguardando embarque · Peça o PIN')}
                    {activeRide.status === 'in_progress' &&
                      (activeIsDelivery
                        ? 'Entrega em trânsito · PIN no destino'
                        : 'Viagem em andamento')}
                  </span>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950 truncate">
                    {activeRide.passenger?.full_name || 'Cliente'} ·{' '}
                    {CATEGORY_LABELS[activeRide.category]}
                  </h3>
                </div>
                <div className="text-right shrink-0">
                  <span className="block text-[11px] font-medium text-neutral-500">
                    {activeRide.payment_method === 'pix' ? 'Pix Plataforma' : 'Dinheiro'}
                  </span>
                  <span className="font-mono-num text-lg font-extrabold text-neutral-950">
                    {formatBRL(activeRide.estimated_fare)}
                  </span>
                </div>
              </div>

              {/* Payment Status Banner */}
              <div
                className={`rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-between ${
                  activeRide.payment_status === 'paid_pix'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : activeRide.payment_status === 'disputed'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-neutral-100 text-neutral-700'
                }`}
              >
                <span>
                  {activeRide.payment_status === 'paid_pix'
                    ? 'Pix confirmado pela plataforma'
                    : activeRide.payment_status === 'disputed'
                    ? 'Disputa de pagamento aberta ao Admin'
                    : activeRide.payment_method === 'pix'
                    ? 'Aguardando Pix do passageiro'
                    : 'Receber em dinheiro do passageiro'}
                </span>
              </div>

              <div className="rounded-2xl bg-neutral-50 p-3 text-xs space-y-1.5 border border-neutral-100">
                <p className="text-neutral-700">
                  <strong className="text-neutral-950">
                    {activeIsDelivery ? 'Coleta:' : 'Embarque:'}
                  </strong>{' '}
                  {activeRide.origin_address}
                </p>
                <p className="text-neutral-700">
                  <strong className="text-neutral-950">Destino:</strong>{' '}
                  {activeRide.destination_address}
                </p>
                {activeRide.delivery_notes && (
                  <p className="text-amber-800 font-semibold">
                    Obs. pacote: {activeRide.delivery_notes}
                  </p>
                )}
              </div>

              {/* Google Maps External Deep-Link */}
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-neutral-950 bg-white text-sm font-extrabold text-neutral-950 hover:bg-neutral-50 active:scale-[0.98] transition"
              >
                <Navigation className="h-4 w-4" />
                <span>
                  Abrir Rota no Google Maps (
                  {activeRide.status === 'in_progress'
                    ? 'Destino'
                    : activeIsDelivery
                    ? 'Coleta'
                    : 'Embarque'}
                  )
                </span>
                <ExternalLink className="h-4 w-4" />
              </a>

              <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-3 py-2 text-[11px]">
                <span className="font-semibold text-neutral-700">GPS ao vivo ativo</span>
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
                  className="rounded-lg bg-neutral-950 px-2.5 py-1 font-bold text-[#FFD100] active:scale-95"
                >
                  Avançar veículo no mapa
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                {activeRide.status === 'accepted' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={markArrived}
                    className="min-h-[52px] flex-1 rounded-2xl bg-[#FFD100] px-4 text-sm font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
                  >
                    {activeIsDelivery
                      ? 'Cheguei no local de coleta'
                      : 'Cheguei no local de embarque'}
                  </button>
                )}

                {activeRide.status === 'arrived' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => {
                      setPinError(null);
                      setPinInput('');
                      setPinModalMode('pickup');
                    }}
                    className="min-h-[52px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#FFD100] px-4 text-sm font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
                  >
                    <KeyRound className="h-4 w-4" />
                    {activeIsDelivery ? 'Confirmar Coleta (PIN)' : 'Iniciar Viagem (PIN)'}
                  </button>
                )}

                {activeRide.status === 'in_progress' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={completeRideDirect}
                    className="min-h-[52px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    {activeIsDelivery ? 'Confirmar Entrega (PIN)' : 'Finalizar Corrida'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-[#FFD100]"
                  aria-label="Abrir chat com cliente"
                >
                  <MessageSquare className="h-5 w-5" />
                </button>
              </div>

              {activeRide.payment_status !== 'disputed' && (
                <button
                  type="button"
                  onClick={() => {
                    setDisputeRide(activeRide);
                    setDisputeReason('');
                  }}
                  className="flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Passageiro não pagou / Relatar problema
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-extrabold text-neutral-950">
                  {isOnline ? 'Você está online!' : 'Você está offline'}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {isOnline
                    ? 'Aguardando corridas e entregas na sua região...'
                    : 'Toque em "Ficar Online" no topo para receber chamados.'}
                </p>
                <p className="mt-1.5 text-xs font-bold text-neutral-800 font-mono-num">
                  {currentUser.driver?.vehicle_model} · {currentUser.driver?.vehicle_plate}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleOnline}
                disabled={togglingOnline}
                className={`min-h-[48px] shrink-0 rounded-2xl px-5 text-sm font-extrabold shadow-sm transition active:scale-95 ${
                  isOnline ? 'bg-neutral-200 text-neutral-900' : 'bg-[#FFD100] text-neutral-950'
                }`}
              >
                {isOnline ? 'Pausar' : 'Conectar'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Incoming Ride / Delivery Offer Modal */}
      {incomingRide && (
        <div className="fixed inset-0 z-[1050] flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border-2 border-[#FFD100]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-700">
                {isDeliveryCategory(incomingRide.category)
                  ? `Nova ${CATEGORY_LABELS[incomingRide.category]}`
                  : incomingRide.category === 'negocia'
                  ? 'Oferta Negocia (Proposta)'
                  : `Nova Corrida · ${CATEGORY_LABELS[incomingRide.category]}`}
              </span>
              <span className="font-mono-num text-xs font-bold text-neutral-600">
                {incomingRide.distance_km} km ·{' '}
                {incomingRide.payment_method === 'pix' ? 'PIX PLATAFORMA' : 'DINHEIRO'}
              </span>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <span className="font-display text-3xl font-extrabold text-neutral-950 font-mono-num">
                {formatBRL(incomingRide.estimated_fare)}
              </span>
              <span className="text-xs font-bold text-neutral-600">
                {incomingRide.passenger?.full_name} ★ {incomingRide.passenger?.rating_avg.toFixed(1)}
              </span>
            </div>

            <div className="mt-4 space-y-2.5 rounded-2xl bg-neutral-50 p-3.5 text-xs border border-neutral-100">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="block font-bold text-neutral-500">
                    {isDeliveryCategory(incomingRide.category) ? 'Local de Coleta' : 'Embarque'}
                  </span>
                  <span className="font-semibold text-neutral-950">
                    {incomingRide.origin_address}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Navigation className="h-4 w-4 shrink-0 text-neutral-950 mt-0.5" />
                <div>
                  <span className="block font-bold text-neutral-500">Destino</span>
                  <span className="font-semibold text-neutral-950">
                    {incomingRide.destination_address}
                  </span>
                </div>
              </div>
              {incomingRide.delivery_notes && (
                <p className="pt-1 text-amber-800 font-semibold">
                  Obs.: {incomingRide.delivery_notes}
                </p>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => declineRide(incomingRide.id)}
                className="min-h-[52px] rounded-2xl border border-neutral-300 px-5 text-sm font-bold text-neutral-700 hover:bg-neutral-100"
              >
                Recusar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => acceptRide(incomingRide.id)}
                className="min-h-[52px] flex-1 rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
              >
                {actionLoading ? 'Aceitando...' : 'Aceitar Corrida'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-Digit PIN Modal (Pickup or Final Delivery) */}
      {pinModalMode && activeRide && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/65 p-4">
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
                ? 'Informe o código PIN de 4 dígitos para confirmar a entrega no destino e liberar seu pagamento.'
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
        <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/65 p-4">
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
              Admin para auditoria e quitação garantida.
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

      {/* Dark Graphite Driver Drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/65">
          <div className="flex h-full w-80 max-w-[85vw] flex-col bg-[#0F1115] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.full_name}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 rounded-full object-cover border border-white/15"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold text-lg">
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
                    <span>· {completedCount} viagens</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-[#1A1D24] p-4 border border-white/5 text-center">
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
                  loadWallet();
                  setWalletOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-[#FFD100]" />
                  Ganhos e Carteira Pix
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
                  setSettingsOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold text-neutral-100 hover:bg-white/5"
              >
                <span className="flex items-center gap-3">
                  <Settings className="h-5 w-5 text-neutral-400" />
                  Configurações e Veículo
                </span>
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>

              <div className="flex items-center gap-3 px-3 py-2 text-xs text-neutral-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Proteção PIN & RLS ativa</span>
              </div>

              <div className="pt-2">
                <PWAInstallButton variant="menu" />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-bold text-white hover:bg-white/15"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Wallet Modal */}
      {walletOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Ganhos do Motorista
              </h3>
              <button
                type="button"
                onClick={() => setWalletOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-neutral-950 p-4 text-white">
              <p className="text-xs text-neutral-400">Saldo disponível para repasse</p>
              <p className="mt-1 font-mono-num text-3xl font-extrabold text-[#FFD100]">
                {formatBRL(currentUser.wallet_balance)}
              </p>
              <p className="mt-2 text-xs text-neutral-300">
                Chave Pix: <span className="font-mono-num">{currentUser.driver?.pix_key}</span>
              </p>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto space-y-2">
              {transactions.length === 0 ? (
                <p className="py-6 text-center text-xs text-neutral-500 flex items-center justify-center gap-1.5">
                  <History className="h-4 w-4" /> Nenhuma movimentação ainda.
                </p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-2xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5 text-xs"
                  >
                    <span className="font-medium text-neutral-800 truncate pr-3">
                      {tx.description}
                    </span>
                    <span
                      className={`font-mono-num font-bold shrink-0 ${
                        tx.amount < 0 ? 'text-neutral-700' : 'text-emerald-700'
                      }`}
                    >
                      {tx.amount < 0 ? `- ${formatBRL(Math.abs(tx.amount))}` : `+ ${formatBRL(tx.amount)}`}
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
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/60 p-4">
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
                      {r.payment_status !== 'disputed' && r.payment_status !== 'admin_settled' && r.status === 'completed' && (
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
          messages={currentChatMessages}
          onClose={() => setChatOpen(false)}
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
