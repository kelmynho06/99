import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Bike,
  Car,
  CreditCard,
  Crosshair,
  History,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Navigation,
  Package,
  QrCode,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import {
  fetchRouteGeometry,
  formatBRL,
  reverseGeocode,
  searchAddresses,
} from '../lib/geo';
import type {
  GeoPoint,
  PaymentMethod,
  PricingSetting,
  Ride,
  RideCategory,
  RideMessage,
  UserProfile,
} from '../types/mobility';
import { LiveMap } from './LiveMap';
import { PWAInstallButton } from './PWAInstallButton';
import { RideChatModal } from './RideChatModal';
import { RatingModal } from './RatingModal';

interface PassengerViewProps {
  currentUser: UserProfile;
  rides: Ride[];
  pricing: PricingSetting[];
  onlineDrivers: UserProfile[];
  messagesByRide: Record<string, RideMessage[]>;
  onLoadMessages: (rideId: string) => void;
  onRideUpsert: (ride: Ride) => void;
  onLogout: () => void;
}

const DEFAULT_ORIGIN: GeoPoint = {
  lat: -23.55052,
  lng: -46.633308,
  address: 'Praça da Sé · Centro, São Paulo',
};

const QUICK_DESTINATIONS: GeoPoint[] = [
  { lat: -23.561414, lng: -46.655881, address: 'Av. Paulista, 1578 · MASP' },
  { lat: -23.587416, lng: -46.657634, address: 'Parque Ibirapuera · Portão 3' },
  { lat: -23.54198, lng: -46.62952, address: 'Estação da Luz · Bom Retiro' },
];

export const PassengerView: React.FC<PassengerViewProps> = ({
  currentUser,
  rides,
  pricing,
  onlineDrivers,
  messagesByRide,
  onLoadMessages,
  onRideUpsert,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [origin, setOrigin] = useState<GeoPoint>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [originQuery, setOriginQuery] = useState(DEFAULT_ORIGIN.address);
  const [destQuery, setDestQuery] = useState('');

  const [originSuggestions, setOriginSuggestions] = useState<GeoPoint[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeoPoint[]>([]);
  const [activeSearchField, setActiveSearchField] = useState<'origin' | 'destination' | null>(null);
  const [pickOnMapMode, setPickOnMapMode] = useState<'origin' | 'destination' | null>(null);

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [durationMin, setDurationMin] = useState<number>(0);

  const [category, setCategory] = useState<RideCategory>('pop');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedCompletedRideId, setDismissedCompletedRideId] = useState<string | null>(null);

  // Active or most recent passenger ride
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

  const pendingRatingRide = useMemo(
    () =>
      myRides.find(
        (r) =>
          r.status === 'completed' &&
          !r.passenger_rating_submitted &&
          r.id !== dismissedCompletedRideId
      ) || null,
    [myRides, dismissedCompletedRideId]
  );

  // Detect current GPS on mount
  const detectMyGps = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const addr = await reverseGeocode(latitude, longitude);
        setOrigin({ lat: latitude, lng: longitude, address: addr });
        setOriginQuery(addr);
      },
      () => {
        // Keep default coordinates if user denies GPS
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }, []);

  useEffect(() => {
    detectMyGps();
  }, [detectMyGps]);

  // Load chat messages when ride becomes active
  useEffect(() => {
    if (activeRide && activeRide.driver_id) {
      onLoadMessages(activeRide.id);
    }
  }, [activeRide, onLoadMessages]);

  // Debounced Nominatim autocomplete
  useEffect(() => {
    if (activeSearchField !== 'origin') return;
    const timer = setTimeout(async () => {
      if (originQuery.trim().length < 3 || originQuery === origin.address) {
        setOriginSuggestions([]);
        return;
      }
      const res = await searchAddresses(originQuery, origin.lat, origin.lng);
      setOriginSuggestions(res);
    }, 380);
    return () => clearTimeout(timer);
  }, [originQuery, activeSearchField, origin.address, origin.lat, origin.lng]);

  useEffect(() => {
    if (activeSearchField !== 'destination') return;
    const timer = setTimeout(async () => {
      if (destQuery.trim().length < 3 || (destination && destQuery === destination.address)) {
        setDestSuggestions([]);
        return;
      }
      const res = await searchAddresses(destQuery, origin.lat, origin.lng);
      setDestSuggestions(res);
    }, 380);
    return () => clearTimeout(timer);
  }, [destQuery, activeSearchField, destination, origin.lat, origin.lng]);

  // Compute OSRM route whenever origin & destination change or ride is active
  useEffect(() => {
    const o = activeRide
      ? { lat: activeRide.origin_lat, lng: activeRide.origin_lng }
      : origin;
    const d = activeRide
      ? { lat: activeRide.destination_lat, lng: activeRide.destination_lng }
      : destination;

    if (!d) {
      setRouteCoords([]);
      setDistanceKm(0);
      setDurationMin(0);
      return;
    }

    let cancelled = false;
    fetchRouteGeometry(o.lat, o.lng, d.lat, d.lng).then((res) => {
      if (cancelled) return;
      setRouteCoords(res.coords);
      setDistanceKm(res.distanceKm);
      setDurationMin(res.durationMin);
    });
    return () => {
      cancelled = true;
    };
  }, [origin, destination, activeRide]);

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

  const getFareForCategory = (cat: PricingSetting): number => {
    if (distanceKm <= 0) return cat.min_fare;
    const raw = cat.base_fare + distanceKm * cat.per_km_rate;
    return Number(Math.max(cat.min_fare, raw).toFixed(2));
  };

  const handleRequestRide = async () => {
    if (!destination || submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passenger_id: currentUser.id,
          category,
          payment_method: paymentMethod,
          origin_address: origin.address,
          origin_lat: origin.lat,
          origin_lng: origin.lng,
          destination_address: destination.address,
          destination_lat: destination.lat,
          destination_lng: destination.lng,
          distance_km: distanceKm,
        }),
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setErrorMsg(data.error || 'Erro ao solicitar corrida.');
        return;
      }
      onRideUpsert(data.ride);
    } catch {
      setErrorMsg('Falha de rede ao chamar motorista.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRide = async () => {
    if (!activeRide) return;
    const res = await fetch(`/api/rides/${activeRide.id}/cancel`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { ride: Ride };
      onRideUpsert(data.ride);
    }
  };

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

  const currentChatMessages = activeRide ? messagesByRide[activeRide.id] || [] : [];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100">
      {/* Full-viewport interactive Leaflet Map */}
      <LiveMap
        center={[origin.lat, origin.lng]}
        origin={
          activeRide
            ? { lat: activeRide.origin_lat, lng: activeRide.origin_lng, address: activeRide.origin_address }
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
        nearbyDrivers={activeRide ? [] : onlineDrivers}
        pickOnMapMode={pickOnMapMode}
        onMapPick={handleMapPick}
        onRecenter={detectMyGps}
      />

      {/* Top Floating Bar */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-[600] flex items-center justify-between px-4 pt-safe py-3">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950 shadow-lg border border-neutral-200/70 active:scale-95 transition"
          aria-label="Abrir menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <div className="pointer-events-auto flex items-center gap-2">
          {pickOnMapMode && (
            <button
              type="button"
              onClick={() => setPickOnMapMode(null)}
              className="flex min-h-[44px] items-center gap-2 rounded-full bg-neutral-950 px-4 text-xs font-bold text-[#FFCC00] shadow-lg"
            >
              <MapPin className="h-4 w-4" />
              Toque no mapa ({pickOnMapMode === 'origin' ? 'Embarque' : 'Destino'}) · Cancelar
            </button>
          )}
          <PWAInstallButton />
        </div>
      </div>

      {/* Bottom Floating Card / Desktop Left Floating Sheet */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-3 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        <div className="pointer-events-auto rounded-3xl bg-white p-5 shadow-2xl border border-neutral-200/80 max-h-[78vh] overflow-y-auto">
          {!activeRide ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-extrabold text-neutral-950">
                  Para onde vamos?
                </h2>
                <span className="text-xs font-semibold text-neutral-500">
                  {onlineDrivers.length > 0
                    ? `${onlineDrivers.length} motorista${onlineDrivers.length > 1 ? 's' : ''} online`
                    : 'Mapa ao vivo'}
                </span>
              </div>

              {errorMsg && (
                <div className="mt-3 rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                  {errorMsg}
                </div>
              )}

              {/* Origin & Destination Inputs */}
              <div className="mt-4 space-y-2.5">
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 focus-within:border-neutral-950 focus-within:bg-white transition">
                    <span className="h-3 w-3 shrink-0 rounded-full bg-[#FFCC00] border-2 border-neutral-950" />
                    <input
                      type="text"
                      value={originQuery}
                      onFocus={() => setActiveSearchField('origin')}
                      onChange={(e) => setOriginQuery(e.target.value)}
                      placeholder="Local de embarque"
                      className="min-h-[38px] flex-1 bg-transparent text-sm font-medium text-neutral-900 outline-none"
                    />
                    <button
                      type="button"
                      onClick={detectMyGps}
                      title="Usar meu GPS atual"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-200/70"
                    >
                      <Crosshair className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickOnMapMode('origin')}
                      title="Marcar no mapa"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-200/70"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  </div>

                  {activeSearchField === 'origin' && originSuggestions.length > 0 && (
                    <div className="mt-1 rounded-2xl border border-neutral-200 bg-white shadow-lg divide-y divide-neutral-100 max-h-44 overflow-y-auto">
                      {originSuggestions.map((item, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setOrigin(item);
                            setOriginQuery(item.address);
                            setOriginSuggestions([]);
                            setActiveSearchField(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-neutral-400" />
                          <span className="truncate">{item.address}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 focus-within:border-neutral-950 focus-within:bg-white transition">
                    <Search className="h-4 w-4 shrink-0 text-neutral-950" />
                    <input
                      type="text"
                      value={destQuery}
                      onFocus={() => setActiveSearchField('destination')}
                      onChange={(e) => setDestQuery(e.target.value)}
                      placeholder="Digite o endereço de destino"
                      className="min-h-[38px] flex-1 bg-transparent text-sm font-medium text-neutral-900 outline-none"
                    />
                    {destQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setDestination(null);
                          setDestQuery('');
                          setDestSuggestions([]);
                        }}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-500"
                        aria-label="Limpar destino"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPickOnMapMode('destination')}
                      title="Escolher destino no mapa"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-[#FFCC00]"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  </div>

                  {activeSearchField === 'destination' && destSuggestions.length > 0 && (
                    <div className="mt-1 rounded-2xl border border-neutral-200 bg-white shadow-lg divide-y divide-neutral-100 max-h-44 overflow-y-auto">
                      {destSuggestions.map((item, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setDestination(item);
                            setDestQuery(item.address);
                            setDestSuggestions([]);
                            setActiveSearchField(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          <Navigation className="h-4 w-4 shrink-0 text-neutral-400" />
                          <span className="truncate">{item.address}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Suggestions when no destination selected */}
              {!destination ? (
                <div className="mt-4">
                  <p className="text-xs font-bold text-neutral-500 mb-2">Destinos sugeridos</p>
                  <div className="space-y-1.5">
                    {QUICK_DESTINATIONS.map((qd) => (
                      <button
                        key={qd.address}
                        type="button"
                        onClick={() => {
                          setDestination(qd);
                          setDestQuery(qd.address);
                          setActiveSearchField(null);
                        }}
                        className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2 text-left hover:bg-neutral-100 transition"
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-neutral-700" />
                        <span className="text-xs font-semibold text-neutral-900 truncate">
                          {qd.address}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* Route Summary */}
                  <div className="mt-3 flex items-center justify-between text-xs text-neutral-600 px-1">
                    <span>
                      Distância estimada:{' '}
                      <strong className="text-neutral-950 font-mono-num">{distanceKm} km</strong>
                    </span>
                    <span>
                      Tempo est.:{' '}
                      <strong className="text-neutral-950 font-mono-num">~{durationMin} min</strong>
                    </span>
                  </div>

                  {/* Category Selector */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {pricing.map((cat) => {
                      const selected = category === cat.category;
                      const fare = getFareForCategory(cat);
                      const Icon =
                        cat.category === 'moto'
                          ? Bike
                          : cat.category === 'delivery'
                          ? Package
                          : Car;
                      return (
                        <button
                          key={cat.category}
                          type="button"
                          onClick={() => setCategory(cat.category)}
                          className={`flex flex-col items-start rounded-2xl border-2 p-2.5 text-left transition ${
                            selected
                              ? 'border-neutral-950 bg-[#FFCC00]/20'
                              : 'border-neutral-200 bg-white hover:border-neutral-300'
                          }`}
                        >
                          <Icon className="h-5 w-5 text-neutral-950" />
                          <span className="mt-1.5 text-xs font-extrabold text-neutral-950 truncate w-full">
                            {cat.label}
                          </span>
                          <span className="mt-0.5 text-xs font-bold text-neutral-800 font-mono-num">
                            {formatBRL(fare)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Payment Method Selector */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { id: 'pix' as PaymentMethod, label: 'Pix', icon: QrCode },
                      { id: 'cash' as PaymentMethod, label: 'Dinheiro', icon: Banknote },
                      { id: 'card_machine' as PaymentMethod, label: 'Maquininha', icon: CreditCard },
                    ].map((pm) => {
                      const active = paymentMethod === pm.id;
                      const PmIcon = pm.icon;
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => setPaymentMethod(pm.id)}
                          className={`min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition ${
                            active
                              ? 'border-neutral-950 bg-neutral-950 text-[#FFCC00]'
                              : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                          }`}
                        >
                          <PmIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{pm.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={handleRequestRide}
                    disabled={submitting}
                    className="mt-4 min-h-[52px] w-full rounded-2xl bg-[#FFCC00] text-base font-extrabold text-neutral-950 shadow-md hover:bg-[#f5c400] active:scale-[0.98] transition disabled:opacity-50"
                  >
                    {submitting ? 'Solicitando...' : 'Chamar Corrida Agora'}
                  </button>
                </>
              )}
            </>
          ) : activeRide.status === 'searching' ? (
            /* Radar Searching State */
            <div className="py-4 text-center">
              <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-[#FFCC00]/50 animate-radar-ring" />
                <span className="absolute inset-0 rounded-full bg-[#FFCC00]/40 animate-radar-ring-delayed" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-[#FFCC00] shadow-lg">
                  <Car className="h-7 w-7" />
                </div>
              </div>
              <h3 className="mt-4 font-display text-lg font-extrabold text-neutral-950">
                Procurando motorista...
              </h3>
              <p className="mt-1 text-xs text-neutral-600">
                {activeRide.origin_address} → {activeRide.destination_address}
              </p>
              <p className="mt-1 text-sm font-extrabold text-neutral-950 font-mono-num">
                {formatBRL(activeRide.estimated_fare)} · {activeRide.distance_km} km
              </p>
              <button
                type="button"
                onClick={handleCancelRide}
                className="mt-5 min-h-[46px] w-full rounded-2xl border border-neutral-300 bg-neutral-50 text-sm font-bold text-neutral-800 hover:bg-neutral-100 transition"
              >
                Cancelar solicitação
              </button>
            </div>
          ) : (
            /* Active Matched Ride Card */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-700">
                    {activeRide.status === 'accepted' && 'Motorista a caminho do embarque'}
                    {activeRide.status === 'arrived' && 'Motorista chegou no local de embarque!'}
                    {activeRide.status === 'in_progress' && 'Em viagem para o destino'}
                  </span>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950">
                    {activeRide.driver?.driver?.vehicle_model || 'Veículo'}
                  </h3>
                </div>
                <div className="rounded-2xl bg-neutral-950 px-3.5 py-2 text-center text-white">
                  <span className="block text-[10px] font-semibold text-neutral-400">PLACA</span>
                  <span className="font-mono-num text-sm font-extrabold text-[#FFCC00]">
                    {activeRide.driver?.driver?.vehicle_plate || '---'}
                  </span>
                </div>
              </div>

              {/* 4-Digit Security PIN Box */}
              <div className="flex items-center justify-between rounded-2xl bg-[#FFCC00]/25 border border-[#FFCC00] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-5 w-5 text-neutral-950 shrink-0" />
                  <div>
                    <p className="text-xs font-extrabold text-neutral-950">PIN de segurança</p>
                    <p className="text-[11px] text-neutral-700">Informe ao motorista ao embarcar</p>
                  </div>
                </div>
                <div className="rounded-xl bg-neutral-950 px-3.5 py-1.5 font-mono-num text-xl font-extrabold tracking-widest text-[#FFCC00]">
                  {activeRide.pin_code}
                </div>
              </div>

              {/* Driver Info Row */}
              <div className="flex items-center justify-between rounded-2xl bg-neutral-50 p-3 border border-neutral-100">
                <div className="flex items-center gap-3">
                  {activeRide.driver?.avatar_url ? (
                    <img
                      src={activeRide.driver.avatar_url}
                      alt={activeRide.driver.full_name}
                      referrerPolicy="no-referrer"
                      className="h-12 w-12 rounded-full object-cover border border-neutral-200"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950 text-[#FFCC00] font-bold">
                      {activeRide.driver?.full_name.slice(0, 1) || 'M'}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-extrabold text-neutral-950">
                      {activeRide.driver?.full_name}
                    </p>
                    <p className="text-xs text-neutral-600 flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-[#FFCC00] text-[#F59E0B]" />
                      <span className="font-bold font-mono-num">
                        {activeRide.driver?.rating_avg.toFixed(2)}
                      </span>
                      <span>· {activeRide.driver?.driver?.vehicle_color}</span>
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-sm font-extrabold text-neutral-950">
                  {formatBRL(activeRide.estimated_fare)}
                </span>
              </div>

              {/* Chat + Cancel Actions */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="min-h-[48px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 text-sm font-bold text-[#FFCC00] active:scale-[0.98] transition"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>Chat ({currentChatMessages.length})</span>
                </button>
                {activeRide.status !== 'in_progress' && (
                  <button
                    type="button"
                    onClick={handleCancelRide}
                    className="min-h-[48px] rounded-2xl border border-neutral-300 px-4 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Left Slide-out Drawer (inspired by 99 screenshot) */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/50 backdrop-blur-xs">
          <div className="flex h-full w-80 max-w-[85vw] flex-col bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFCC00] text-neutral-950 font-extrabold text-lg">
                  {currentUser.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    {currentUser.full_name}
                  </h3>
                  <p className="text-xs font-semibold text-neutral-600 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#FFCC00] text-[#F59E0B]" />
                    <span className="font-mono-num">{currentUser.rating_avg.toFixed(2)}</span>
                    <span>· Passageiro</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-2 flex-1">
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen(true);
                  setMenuOpen(false);
                }}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-2xl px-3.5 text-sm font-bold text-neutral-800 hover:bg-neutral-100"
              >
                <History className="h-5 w-5 text-neutral-600" />
                Atividade e Corridas ({myRides.length})
              </button>

              <div className="pt-2">
                <PWAInstallButton variant="menu" />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-100 text-sm font-bold text-neutral-800 hover:bg-neutral-200"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </div>
          <div className="flex-1" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Ride History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Suas Corridas
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
                  Você ainda não realizou corridas.
                </p>
              ) : (
                myRides.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-neutral-200 p-3.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-bold text-neutral-950">
                      <span>{r.category.toUpperCase()} · {r.status}</span>
                      <span className="font-mono-num">{formatBRL(r.final_fare ?? r.estimated_fare)}</span>
                    </div>
                    <p className="text-neutral-600 truncate">De: {r.origin_address}</p>
                    <p className="text-neutral-900 font-medium truncate">Para: {r.destination_address}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {chatOpen && activeRide && activeRide.driver && (
        <RideChatModal
          rideId={activeRide.id}
          currentUser={currentUser}
          peerName={activeRide.driver.full_name}
          messages={currentChatMessages}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Mutual Rating Modal */}
      {pendingRatingRide && (
        <RatingModal
          ride={pendingRatingRide}
          currentUser={currentUser}
          onSubmitted={(updated) => onRideUpsert(updated)}
          onSkip={() => setDismissedCompletedRideId(pendingRatingRide.id)}
        />
      )}
    </div>
  );
};
