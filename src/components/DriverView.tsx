import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
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
  Star,
  Wallet,
  X,
} from 'lucide-react';
import { buildGoogleMapsDirectionsUrl, fetchRouteGeometry, formatBRL } from '../lib/geo';
import type { Ride, RideMessage, UserProfile, WalletTransaction } from '../types/mobility';
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
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [driverCoords, setDriverCoords] = useState<[number, number]>([
    currentUser.driver?.current_lat ?? -23.55052,
    currentUser.driver?.current_lng ?? -46.633308,
  ]);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [declinedRideIds, setDeclinedRideIds] = useState<string[]>([]);

  // PIN verification modal
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedRatingRideId, setDismissedRatingRideId] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const isOnline = Boolean(currentUser.driver?.is_online);

  const activeRide = useMemo(
    () =>
      rides.find(
        (r) =>
          r.driver_id === currentUser.id &&
          ['accepted', 'arrived', 'in_progress'].includes(r.status)
      ) || null,
    [rides, currentUser.id]
  );

  const incomingRide = useMemo(() => {
    if (!isOnline || activeRide || currentUser.status !== 'active') return null;
    return (
      rides.find(
        (r) => r.status === 'searching' && !declinedRideIds.includes(r.id)
      ) || null
    );
  }, [isOnline, activeRide, currentUser.status, rides, declinedRideIds]);

  const pendingRatingRide = useMemo(
    () =>
      rides.find(
        (r) =>
          r.driver_id === currentUser.id &&
          r.status === 'completed' &&
          !r.driver_rating_submitted &&
          r.id !== dismissedRatingRideId
      ) || null,
    [rides, currentUser.id, dismissedRatingRideId]
  );

  const completedCount = useMemo(
    () =>
      rides.filter((r) => r.driver_id === currentUser.id && r.status === 'completed').length,
    [rides, currentUser.id]
  );

  // Watch GPS continuously when driver is online
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
      () => {
        // Fallback: keep current coords if GPS permission denied in browser
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isOnline, currentUser.id, onEmitLocation]);

  // Load chat messages for active ride
  useEffect(() => {
    if (activeRide) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  // Draw route on driver map
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
        setStatusError(data.error || 'Corrida indisponível.');
        return;
      }
      onRideUpsert(data.ride);
    } finally {
      setActionLoading(false);
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

  const submitPinToStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRide) return;
    setPinError(null);
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rides/${activeRide.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: currentUser.id, pin_code: pinInput }),
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setPinError(data.error || 'Código PIN incorreto.');
        return;
      }
      setPinModalOpen(false);
      setPinInput('');
      onRideUpsert(data.ride);
    } finally {
      setActionLoading(false);
    }
  };

  const completeRide = async () => {
    if (!activeRide) return;
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

      {/* Top 99-Driver Style Floating Bar */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] flex items-center justify-between gap-2 px-4 pt-safe py-3">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950 shadow-lg border border-neutral-200/80 active:scale-95 transition"
          aria-label="Abrir menu do motorista"
        >
          <Menu className="h-6 w-6" />
        </button>

        {/* Dark Earnings Pill matching 99 Driver Screenshot */}
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
            isOnline
              ? 'bg-emerald-600 text-white'
              : 'bg-[#FFCC00] text-neutral-950'
          }`}
        >
          <Power className="h-4 w-4" />
          <span className="whitespace-nowrap">
            {isOnline ? 'Online' : 'Ficar Online'}
          </span>
        </button>
      </div>

      {/* Bottom Floating Driver Controls */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-3 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        <div className="pointer-events-auto rounded-3xl bg-white p-5 shadow-2xl border border-neutral-200/80">
          {statusError && (
            <div className="mb-3 rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {statusError}
            </div>
          )}

          {currentUser.status !== 'active' ? (
            /* Pending / Rejected / Suspended Card */
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
                      ? 'Seus documentos (CNH e CRLV) foram recebidos. Aguarde a aprovação no Painel Administrativo para ficar online.'
                      : currentUser.driver?.rejection_reason ||
                        'Entre em contato com a administração para regularizar seus documentos.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={refreshProfile}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 text-xs font-bold text-[#FFCC00]"
              >
                <RefreshCw className="h-4 w-4" />
                Verificar aprovação agora
              </button>
            </div>
          ) : activeRide ? (
            /* Active Ride Stepper */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-700">
                    {activeRide.status === 'accepted' && 'Indo buscar o passageiro'}
                    {activeRide.status === 'arrived' && 'Aguardando embarque · Peça o PIN'}
                    {activeRide.status === 'in_progress' && 'Viagem em andamento'}
                  </span>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950">
                    {activeRide.passenger?.full_name || 'Passageiro'}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] font-medium text-neutral-500">Valor</span>
                  <span className="font-mono-num text-lg font-extrabold text-neutral-950">
                    {formatBRL(activeRide.estimated_fare)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl bg-neutral-50 p-3 text-xs space-y-1.5 border border-neutral-100">
                <p className="text-neutral-700">
                  <strong className="text-neutral-950">Embarque:</strong> {activeRide.origin_address}
                </p>
                <p className="text-neutral-700">
                  <strong className="text-neutral-950">Destino:</strong>{' '}
                  {activeRide.destination_address}
                </p>
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
                  {activeRide.status === 'in_progress' ? 'Destino' : 'Embarque'})
                </span>
                <ExternalLink className="h-4 w-4" />
              </a>

              {/* GPS Live Movement Helper for desktop testing */}
              <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-3 py-2 text-[11px]">
                <span className="font-semibold text-neutral-700">
                  GPS ao vivo transmitindo
                </span>
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
                  className="rounded-lg bg-neutral-950 px-2.5 py-1 font-bold text-[#FFCC00] active:scale-95"
                >
                  Avançar veículo no mapa
                </button>
              </div>

              {/* Step Action Buttons */}
              <div className="flex items-center gap-2.5">
                {activeRide.status === 'accepted' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={markArrived}
                    className="min-h-[52px] flex-1 rounded-2xl bg-[#FFCC00] px-4 text-sm font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
                  >
                    Cheguei no local de embarque
                  </button>
                )}

                {activeRide.status === 'arrived' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => {
                      setPinError(null);
                      setPinModalOpen(true);
                    }}
                    className="min-h-[52px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#FFCC00] px-4 text-sm font-extrabold text-neutral-950 shadow-md active:scale-[0.98] transition"
                  >
                    <KeyRound className="h-4 w-4" />
                    Iniciar Viagem (PIN)
                  </button>
                )}

                {activeRide.status === 'in_progress' && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={completeRide}
                    className="min-h-[52px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    Finalizar Corrida
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-[#FFCC00]"
                  aria-label="Abrir chat com passageiro"
                >
                  <MessageSquare className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : (
            /* Idle Online/Offline Card */
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-extrabold text-neutral-950">
                  {isOnline ? 'Você está online!' : 'Você está offline'}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {isOnline
                    ? 'Aguardando chamados na sua região...'
                    : 'Toque em "Ficar Online" no topo para receber corridas.'}
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
                  isOnline
                    ? 'bg-neutral-200 text-neutral-900'
                    : 'bg-[#FFCC00] text-neutral-950'
                }`}
              >
                {isOnline ? 'Pausar' : 'Conectar'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Incoming Ride Offer Modal */}
      {incomingRide && (
        <div className="fixed inset-0 z-[1050] flex items-end sm:items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border-2 border-[#FFCC00]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-700">
                Nova solicitação · {incomingRide.category.toUpperCase()}
              </span>
              <span className="font-mono-num text-xs font-bold text-neutral-600">
                {incomingRide.distance_km} km · {incomingRide.payment_method.toUpperCase()}
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
                  <span className="block font-bold text-neutral-500">Embarque</span>
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
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDeclinedRideIds((prev) => [...prev, incomingRide.id])}
                className="min-h-[52px] rounded-2xl border border-neutral-300 px-5 text-sm font-bold text-neutral-700 hover:bg-neutral-100"
              >
                Recusar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => acceptRide(incomingRide.id)}
                className="min-h-[52px] flex-1 rounded-2xl bg-[#FFCC00] text-base font-extrabold text-neutral-950 shadow-md hover:bg-[#f5c400] active:scale-[0.98] transition"
              >
                {actionLoading ? 'Aceitando...' : 'Aceitar Corrida'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-Digit PIN Verification Modal */}
      {pinModalOpen && activeRide && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={submitPinToStart}
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Confirmar Código PIN
              </h3>
              <button
                type="button"
                onClick={() => setPinModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-600">
              Peça os 4 dígitos exibidos no celular do passageiro{' '}
              <strong>{activeRide.passenger?.full_name}</strong> para liberar a viagem.
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
              className="mt-4 min-h-[50px] w-full rounded-2xl bg-[#FFCC00] text-sm font-extrabold text-neutral-950 disabled:opacity-40"
            >
              {actionLoading ? 'Verificando...' : 'Liberar Partida'}
            </button>
          </form>
        </div>
      )}

      {/* Left Driver Drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/50 backdrop-blur-xs">
          <div className="flex h-full w-80 max-w-[85vw] flex-col bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.full_name}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 rounded-full object-cover border border-neutral-200"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFCC00] text-neutral-950 font-extrabold text-lg">
                    {currentUser.full_name.slice(0, 1)}
                  </div>
                )}
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    {currentUser.full_name}
                  </h3>
                  <p className="text-xs font-semibold text-neutral-600 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#FFCC00] text-[#F59E0B]" />
                    <span className="font-mono-num">{currentUser.rating_avg.toFixed(2)}</span>
                    <span>· {completedCount} corridas</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-2 flex-1">
              <button
                type="button"
                onClick={() => {
                  loadWallet();
                  setWalletOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-2xl px-3.5 text-sm font-bold text-neutral-800 hover:bg-neutral-100"
              >
                <Wallet className="h-5 w-5 text-neutral-600" />
                Ganhos e Carteira Pix
              </button>
              <div className="pt-2">
                <PWAInstallButton variant="menu" />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-100 text-sm font-bold text-neutral-800"
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
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
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
              <p className="mt-1 font-mono-num text-3xl font-extrabold text-[#FFCC00]">
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
                    <span className="font-mono-num font-bold text-emerald-700 shrink-0">
                      + {formatBRL(tx.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {chatOpen && activeRide && activeRide.passenger && (
        <RideChatModal
          rideId={activeRide.id}
          currentUser={currentUser}
          peerName={activeRide.passenger.full_name}
          messages={currentChatMessages}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Rating Modal */}
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
