import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  Bike,
  Briefcase,
  Car,
  ChevronRight,
  Crosshair,
  Flag,
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
  Plus,
  QrCode,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Star,
  Tag,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  fetchRouteGeometry,
  formatBRL,
  haversineKm,
  reverseGeocode,
  searchAddresses,
} from '../lib/geo';
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
} from '../types/mobility';
import { AccountSettingsModal } from './AccountSettingsModal';
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
  { lat: -23.5673, lng: -46.6931, address: 'Pinheiros · Largo da Batata' },
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
  onRideUpsert,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addressScreenOpen, setAddressScreenOpen] = useState(false);
  const [addressTab, setAddressTab] = useState<'search' | 'favorites'>('search');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<'help' | 'discounts' | 'wallet' | 'security' | 'become_driver' | null>(null);
  const [pixModalRide, setPixModalRide] = useState<Ride | null>(null);

  const [origin, setOrigin] = useState<GeoPoint>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [originQuery, setOriginQuery] = useState('Localização atual');
  const [destQuery, setDestQuery] = useState('');

  const [originSuggestions, setOriginSuggestions] = useState<GeoPoint[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeoPoint[]>([]);
  const [activeSearchField, setActiveSearchField] = useState<'origin' | 'destination'>('destination');
  const [pickOnMapMode, setPickOnMapMode] = useState<'origin' | 'destination' | null>(null);

  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [durationMin, setDurationMin] = useState<number>(0);

  const [category, setCategory] = useState<RideCategory>('pop');
  const [negotiatedFare, setNegotiatedFare] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    currentUser.preferred_payment === 'cash' ? 'cash' : 'pix'
  );
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedCompletedRideId, setDismissedCompletedRideId] = useState<string | null>(null);

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

  const pendingRatingRide = useMemo(
    () =>
      myRides.find(
        (r) =>
          r.status === 'completed' &&
          !r.passenger_rating_submitted &&
          r.id !== dismissedCompletedRideId &&
          !(r.payment_method === 'pix' && r.payment_status === 'pending')
      ) || null,
    [myRides, dismissedCompletedRideId]
  );

  const detectMyGps = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const addr = await reverseGeocode(latitude, longitude);
        setOrigin({ lat: latitude, lng: longitude, address: addr });
        setOriginQuery(addr);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000 }
    );
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
    const timer = setTimeout(async () => {
      if (
        originQuery.trim().length < 3 ||
        originQuery === 'Localização atual' ||
        originQuery === origin.address
      ) {
        setOriginSuggestions([]);
        return;
      }
      const res = await searchAddresses(originQuery, origin.lat, origin.lng);
      setOriginSuggestions(res);
    }, 350);
    return () => clearTimeout(timer);
  }, [originQuery, addressScreenOpen, activeSearchField, origin.address, origin.lat, origin.lng]);

  useEffect(() => {
    if (!addressScreenOpen || activeSearchField !== 'destination') return;
    const timer = setTimeout(async () => {
      if (destQuery.trim().length < 3 || (destination && destQuery === destination.address)) {
        setDestSuggestions([]);
        return;
      }
      const res = await searchAddresses(destQuery, origin.lat, origin.lng);
      setDestSuggestions(res);
    }, 350);
    return () => clearTimeout(timer);
  }, [destQuery, addressScreenOpen, activeSearchField, destination, origin.lat, origin.lng]);

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

  const handleRequestRide = async () => {
    if (!destination || submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const isDelivery = category === 'delivery_moto' || category === 'delivery_car';
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
          negotiated_fare: category === 'negocia' ? activeNegociaFare : undefined,
          delivery_notes: isDelivery ? deliveryNotes : null,
        }),
      });
      const data = (await res.json()) as { ride?: Ride; error?: string };
      if (!res.ok || !data.ride) {
        setErrorMsg(data.error || 'Erro ao solicitar corrida.');
        return;
      }
      setDeliveryNotes('');
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

  const selectedCategoryObj = pricing.find((p) => p.category === category);
  const selectedCategoryFare =
    category === 'negocia'
      ? activeNegociaFare
      : selectedCategoryObj
      ? getFareForCategory(selectedCategoryObj)
      : 0;

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
  const isDeliveryActive =
    activeRide?.category === 'delivery_moto' || activeRide?.category === 'delivery_car';

  const savedFavorites: SavedAddress[] = currentUser.favorites || [];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100">
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
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950 shadow-lg border border-neutral-200 active:scale-95 transition"
          aria-label="Abrir menu"
        >
          <Menu className="h-6 w-6" />
        </button>

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
          ) : destination && !activeRide ? (
            <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-neutral-950 shadow-lg border border-neutral-200 font-mono-num">
              <span>{distanceKm} km · {durationMin} min</span>
            </div>
          ) : null}
          <PWAInstallButton />
        </div>
      </div>

      {/* Bottom Sheet / Floating Card */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[600] p-0 sm:p-4 lg:inset-y-auto lg:left-6 lg:bottom-6 lg:w-[440px]">
        <div className="pointer-events-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 pb-safe shadow-2xl border-t sm:border border-neutral-200 max-h-[76vh] overflow-y-auto">
          {!activeRide ? (
            !destination ? (
              /* HOME CARD ("Para onde vamos?" + Casa / Trabalho / Favoritos) */
              <div className="space-y-3.5">
                <div className="mx-auto h-1 w-10 rounded-full bg-neutral-200 sm:hidden" />

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-500">
                    {platformConfig.platform_city}
                  </span>
                  <span className="text-xs font-bold text-neutral-700">
                    {onlineDrivers.length > 0
                      ? `${onlineDrivers.length} online agora`
                      : 'Mapa em tempo real'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSearchField('destination');
                    setAddressTab('search');
                    setAddressScreenOpen(true);
                  }}
                  className="flex min-h-[54px] w-full items-center gap-3 rounded-2xl bg-neutral-100 px-4 text-left hover:bg-neutral-200/70 active:scale-[0.99] transition"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 shrink-0">
                    <Search className="h-4 w-4" />
                  </span>
                  <span className="font-display text-lg font-extrabold text-neutral-950">
                    Para onde vamos?
                  </span>
                </button>

                {/* Casa / Trabalho / Favoritos Quick Row */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (currentUser.home_address) {
                        selectDestinationPoint(currentUser.home_address);
                      } else {
                        setSettingsOpen(true);
                      }
                    }}
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-bold text-neutral-900 hover:border-neutral-950"
                  >
                    <Home className="h-4 w-4 shrink-0" />
                    <span className="truncate">Casa</span>
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
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-bold text-neutral-900 hover:border-neutral-950"
                  >
                    <Briefcase className="h-4 w-4 shrink-0" />
                    <span className="truncate">Trabalho</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddressTab('favorites');
                      setAddressScreenOpen(true);
                    }}
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-bold text-neutral-900 hover:border-neutral-950"
                  >
                    <Star className="h-4 w-4 shrink-0" />
                    <span className="truncate">Favoritos</span>
                  </button>
                </div>

                {unpaidCompletedPixRide && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-neutral-950">
                        Pix pendente da última viagem
                      </p>
                      <p className="text-[11px] text-neutral-700 font-mono-num">
                        {formatBRL(unpaidCompletedPixRide.final_fare ?? unpaidCompletedPixRide.estimated_fare)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPixModalRide(unpaidCompletedPixRide)}
                      className="min-h-[42px] shrink-0 rounded-xl bg-[#FFD100] px-3.5 text-xs font-extrabold text-neutral-950"
                    >
                      Pagar Pix
                    </button>
                  </div>
                )}
              </div>
            ) : (
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

                {errorMsg && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">
                    {errorMsg}
                  </div>
                )}

                {/* 5-Category Vertical 99-Style List */}
                <div className="space-y-1.5 max-h-[34vh] overflow-y-auto pr-0.5">
                  {pricing
                    .filter((c) => c.active !== false)
                    .map((cat) => {
                      const selected = category === cat.category;
                      const fare =
                        cat.category === 'negocia' && selected
                          ? activeNegociaFare
                          : getFareForCategory(cat);
                      const isMoto =
                        cat.category === 'moto' || cat.category === 'delivery_moto';
                      const isDeliveryCat =
                        cat.category === 'delivery_moto' || cat.category === 'delivery_car';

                      return (
                        <div
                          key={cat.category}
                          className={`rounded-2xl border-2 transition ${
                            selected
                              ? 'border-neutral-950 bg-[#FFD100]/15'
                              : 'border-neutral-100 bg-neutral-50 hover:border-neutral-300'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setCategory(cat.category)}
                            className="flex min-h-[58px] w-full items-center justify-between gap-3 px-3.5 py-2 text-left"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                  selected
                                    ? 'bg-neutral-950 text-[#FFD100]'
                                    : 'bg-white text-neutral-900 border border-neutral-200'
                                }`}
                              >
                                {isDeliveryCat ? (
                                  <Package className="h-5 w-5" />
                                ) : isMoto ? (
                                  <Bike className="h-5 w-5" />
                                ) : (
                                  <Car className="h-5 w-5" />
                                )}
                              </div>
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
                                {formatBRL(fare)}
                              </p>
                              <p className="text-[10px] text-neutral-500 font-mono-num">
                                ~{Math.max(2, isMoto ? Math.round(durationMin * 0.75) : durationMin)} min
                              </p>
                            </div>
                          </button>

                          {/* Interactive Fare Negotiation Stepper for Negocia */}
                          {cat.category === 'negocia' && selected && (
                            <div className="flex items-center justify-between border-t border-neutral-950/10 px-3.5 py-2 bg-white/80 rounded-b-2xl">
                              <span className="text-[11px] font-bold text-neutral-700">
                                Sua oferta (mín. {formatBRL(cat.min_fare)}):
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setNegotiatedFare(
                                      Number(
                                        Math.max(cat.min_fare, activeNegociaFare - 1).toFixed(2)
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
                                    setNegotiatedFare(Number((activeNegociaFare + 1).toFixed(2)))
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
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Instruções de coleta ou destinatário (opcional)"
                    className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs outline-none focus:border-neutral-950"
                  />
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
                    : `${formatBRL(selectedCategoryFare)} · Solicitar ${CATEGORY_LABELS[category]}`}
                </button>
              </div>
            )
          ) : activeRide.status === 'searching' ? (
            /* SEARCHING RADAR */
            <div className="py-4 text-center">
              <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-[#FFD100]/50 animate-radar-ring" />
                <span className="absolute inset-0 rounded-full bg-[#FFD100]/40 animate-radar-ring-delayed" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] shadow-lg">
                  {isDeliveryActive ? (
                    <Package className="h-7 w-7" />
                  ) : (
                    <Car className="h-7 w-7" />
                  )}
                </div>
              </div>
              <h3 className="mt-4 font-display text-lg font-extrabold text-neutral-950">
                {isDeliveryActive ? 'Procurando entregador...' : 'Procurando motorista...'}
              </h3>
              <p className="mt-1 text-xs text-neutral-600 truncate">
                {activeRide.origin_address} → {activeRide.destination_address}
              </p>
              <p className="mt-1 text-sm font-extrabold text-neutral-950 font-mono-num">
                {CATEGORY_LABELS[activeRide.category]} · {formatBRL(activeRide.estimated_fare)} ·{' '}
                {activeRide.distance_km} km
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
            /* ACTIVE MATCHED RIDE / DELIVERY */
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-xs font-bold text-amber-700">
                    {activeRide.status === 'accepted' &&
                      (isDeliveryActive
                        ? 'Entregador a caminho da coleta'
                        : 'Motorista a caminho do embarque')}
                    {activeRide.status === 'arrived' &&
                      (isDeliveryActive
                        ? 'Entregador chegou para retirar o pacote!'
                        : 'Motorista chegou no local de embarque!')}
                    {activeRide.status === 'in_progress' &&
                      (isDeliveryActive ? 'Pacote em rota de entrega' : 'Em viagem para o destino')}
                  </span>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950 truncate">
                    {activeRide.driver?.driver?.vehicle_model || 'Veículo'}
                  </h3>
                </div>
                <div className="rounded-2xl bg-neutral-950 px-3.5 py-2 text-center text-white shrink-0">
                  <span className="block text-[10px] font-semibold text-neutral-400">PLACA</span>
                  <span className="font-mono-num text-sm font-extrabold text-[#FFD100]">
                    {activeRide.driver?.driver?.vehicle_plate || '---'}
                  </span>
                </div>
              </div>

              {/* 4-Digit Security PIN Box */}
              <div className="flex items-center justify-between rounded-2xl bg-[#FFD100]/25 border border-[#FFD100] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-5 w-5 text-neutral-950 shrink-0" />
                  <div>
                    <p className="text-xs font-extrabold text-neutral-950">
                      {isDeliveryActive ? 'PIN de Coleta e Entrega' : 'PIN de segurança'}
                    </p>
                    <p className="text-[11px] text-neutral-700">
                      {isDeliveryActive
                        ? 'Valida a retirada e a entrega final'
                        : 'Informe ao motorista ao embarcar'}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-neutral-950 px-3.5 py-1.5 font-mono-num text-xl font-extrabold tracking-widest text-[#FFD100]">
                  {activeRide.pin_code}
                </div>
              </div>

              {/* Driver Info & Fare */}
              <div className="flex items-center justify-between rounded-2xl bg-neutral-50 p-3 border border-neutral-100">
                <div className="flex items-center gap-3 min-w-0">
                  {activeRide.driver?.avatar_url ? (
                    <img
                      src={activeRide.driver.avatar_url}
                      alt={activeRide.driver.full_name}
                      referrerPolicy="no-referrer"
                      className="h-12 w-12 rounded-full object-cover border border-neutral-200 shrink-0"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] font-bold shrink-0">
                      {activeRide.driver?.full_name.slice(0, 1) || 'M'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-neutral-950 truncate">
                      {activeRide.driver?.full_name}
                    </p>
                    <p className="text-xs text-neutral-600 flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-[#FFD100] text-[#F59E0B]" />
                      <span className="font-bold font-mono-num">
                        {activeRide.driver?.rating_avg.toFixed(2)}
                      </span>
                      <span>· {activeRide.driver?.driver?.vehicle_color}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="block font-mono-num text-sm font-extrabold text-neutral-950">
                    {formatBRL(activeRide.estimated_fare)}
                  </span>
                  <span className="text-[11px] font-bold text-neutral-600">
                    {activeRide.payment_method === 'pix'
                      ? activeRide.payment_status === 'paid_pix'
                        ? 'Pix confirmado'
                        : 'Pix pendente'
                      : 'Dinheiro'}
                  </span>
                </div>
              </div>

              {/* Centralized Platform Pix Payment CTA */}
              {activeRide.payment_method === 'pix' && activeRide.payment_status === 'pending' && (
                <button
                  type="button"
                  onClick={() => setPixModalRide(activeRide)}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition"
                >
                  <QrCode className="h-4 w-4" />
                  Pagar com Pix da Plataforma ({formatBRL(activeRide.estimated_fare)})
                </button>
              )}

              {activeRide.payment_status === 'paid_pix' && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 py-2 text-xs font-bold text-emerald-800">
                  <ShieldCheck className="h-4 w-4" />
                  Pix enviado para {platformConfig.platform_pix_receiver}
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="min-h-[48px] flex-1 flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 text-sm font-bold text-[#FFD100] active:scale-[0.98] transition"
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

            {/* Origin + Destination Bars */}
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

            {/* Casa | Trabalho | Favoritos Row */}
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

          {/* Results List with KM distances */}
          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
            {activeSearchField === 'origin' && originSuggestions.length > 0 ? (
              originSuggestions.map((item, i) => {
                const km = haversineKm(origin.lat, origin.lng, item.lat, item.lng);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setOrigin(item);
                      setOriginQuery(item.address);
                      setOriginSuggestions([]);
                      setActiveSearchField('destination');
                    }}
                    className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-neutral-950 truncate">
                          {item.address.split('·')[0].trim()}
                        </p>
                        <p className="text-xs text-neutral-500 truncate">{item.address}</p>
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
            ) : (
              (destSuggestions.length > 0 ? destSuggestions : QUICK_DESTINATIONS).map((item, i) => {
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

          {/* Footer "Marque o local no mapa" */}
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

      {/* 99-STYLE PASSENGER DRAWER (3x2 Icon Grid + "Outros recursos") */}
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] flex bg-black/55">
          <div className="flex h-full w-80 max-w-[86vw] flex-col bg-white p-5 shadow-2xl overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-200 text-neutral-900 font-display text-xl font-extrabold">
                  {currentUser.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-display text-xl font-extrabold text-neutral-950 leading-tight">
                    {currentUser.full_name.split(' ')[0]}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-neutral-600 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#FFD100] text-[#F59E0B]" />
                    <span className="font-mono-num font-bold text-neutral-900">
                      {currentUser.rating_avg.toFixed(2).replace('.', ',')}
                    </span>
                    <span>· Verificado</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 3-Column Icon Shortcut Grid */}
            <div className="mt-6 grid grid-cols-3 gap-y-5 gap-x-2 text-center">
              {[
                {
                  label: 'Atividade',
                  icon: History,
                  action: () => setHistoryOpen(true),
                },
                {
                  label: 'Ajuda',
                  icon: HelpCircle,
                  action: () => setInfoModal('help'),
                },
                {
                  label: 'Descontos',
                  icon: Tag,
                  action: () => setInfoModal('discounts'),
                },
                {
                  label: 'Carteira',
                  icon: Wallet,
                  action: () => setInfoModal('wallet'),
                },
                {
                  label: 'Configurações',
                  icon: Settings,
                  action: () => setSettingsOpen(true),
                },
                {
                  label: 'Segurança',
                  icon: Shield,
                  action: () => setInfoModal('security'),
                },
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

            {/* Outros recursos */}
            <div className="flex-1 space-y-1">
              <h4 className="font-display text-sm font-extrabold text-neutral-950 mb-2">
                Outros recursos
              </h4>

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

      {/* Drawer Shortcut Modals (Ajuda, Descontos, Carteira, Segurança, Seja Motorista) */}
      {infoModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                {infoModal === 'help' && 'Ajuda e Suporte'}
                {infoModal === 'discounts' && 'Descontos e Cupons'}
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
                <p className="font-bold text-neutral-950">Atendimento local Velo99 ({platformConfig.platform_city})</p>
                <p>• Esquecimento de objeto ou dúvida sobre cobrança? Use o chat da viagem ou informe o número da corrida.</p>
                <p>• Pagamentos via Pix vão diretamente para a conta oficial <strong>{platformConfig.platform_pix_receiver}</strong>.</p>
              </div>
            )}

            {infoModal === 'discounts' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-extrabold text-neutral-950">Modo Negocia ativo!</p>
                  <p className="mt-1 text-xs text-neutral-700">
                    Escolha a categoria <strong>Negocia</strong> ao selecionar seu destino para sugerir o valor ideal da sua corrida.
                  </p>
                </div>
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
                  <strong>{currentUser.preferred_payment === 'cash' ? 'Dinheiro' : 'Pix (Plataforma)'}</strong>
                </p>
              </div>
            )}

            {infoModal === 'security' && (
              <div className="space-y-2.5 text-xs text-neutral-700 leading-relaxed">
                <p className="font-bold text-neutral-950">Verificação com PIN de 4 dígitos</p>
                <p>
                  • Em todas as corridas, o motorista precisa digitar o seu código PIN de 4 dígitos para iniciar a viagem.
                </p>
                <p>
                  • Em entregas (Moto ou Carro), o PIN protege tanto a coleta quanto a entrega final no destinatário.
                </p>
              </div>
            )}

            {infoModal === 'become_driver' && (
              <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
                <p>
                  Quer dirigir ou fazer entregas na sua cidade? Saia da sua conta atual e crie um cadastro escolhendo{' '}
                  <strong>Opção B · Motorista</strong> enviando CNH, CRLV e sua chave Pix para aprovação.
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
                        {r.payment_method === 'pix' ? 'Pix Plataforma' : 'Dinheiro'} · {r.payment_status}
                      </span>
                      {r.payment_method === 'pix' && r.payment_status === 'pending' && r.status !== 'cancelled' && (
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
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onLogout}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {chatOpen && activeRide && activeRide.driver && (
        <RideChatModal
          rideId={activeRide.id}
          currentUser={currentUser}
          peerName={activeRide.driver.full_name}
          messages={currentChatMessages}
          onClose={() => setChatOpen(false)}
        />
      )}

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
