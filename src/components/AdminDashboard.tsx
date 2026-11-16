import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Bike,
  Camera,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  DollarSign,
  Eye,
  FileText,
  Image as ImageIcon,
  LogOut,
  MapPin,
  MessageSquare,
  Music,
  Package,
  Plus,
  Power,
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
  Wallet,
  X,
} from 'lucide-react';
import { resolveBrandLogo, resolveCategoryVehicleImage } from '../lib/brandAssets';
import { formatBRL } from '../lib/geo';
import {
  adminAssignClientDebt,
  adminConfirmPixRide,
  adminCreatePlatformEvent,
  adminDeletePlatformEvent,
  adminDeleteUserAccount,
  adminPayDriverPix,
  adminReviewDriver,
  adminSavePlatformConfig,
  adminSavePricing,
  adminSettleDispute,
  adminTogglePlatformEvent,
  adminUpdateUserStatus,
  cancelRide,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRICING_LIST,
  fetchAdminOverview,
  fetchPlatformEvents,
  resolveDocumentDisplayUrl,
  uploadPlatformAssetFile,
} from '../lib/mobilityApi';
import { playSoundCue, syncPlatformSounds } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
  PlatformEvent,
  PricingSetting,
  Ride,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';
import { DirectChatModal } from './DirectChatModal';
import { LegalDocsModal } from './LegalDocsModal';
import { LiveMap } from './LiveMap';
import migrationSqlRaw from '../../supabase/migration_update.sql?raw';

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
  | 'pricing'
  | 'infra';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  initialPlatformConfig,
  onLogout,
}) => {
  const [tab, setTab] = useState<AdminTab>('livemap');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>(DEFAULT_PRICING_LIST);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(
    initialPlatformConfig ?? DEFAULT_PLATFORM_CONFIG
  );
  const [platformEvents, setPlatformEvents] = useState<PlatformEvent[]>([]);

  const [migrationSql] = useState<string>(migrationSqlRaw);
  const [copiedSql, setCopiedSql] = useState(false);

  const [driverFilter, setDriverFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('all');
  const [delivererFilter, setDelivererFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('all');
  const [rideFilter, setRideFilter] = useState<'all' | 'active' | 'completed' | 'disputed' | 'cancelled'>('all');

  const [inspectDriver, setInspectDriver] = useState<UserProfile | null>(null);
  const [resolvedCnhUrl, setResolvedCnhUrl] = useState<string>('');
  const [resolvedCrlvUrl, setResolvedCrlvUrl] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState('');

  const [payoutModalDriver, setPayoutModalDriver] = useState<UserProfile | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutNote, setPayoutNote] = useState<string>('');

  const [confirmingPixRideId, setConfirmingPixRideId] = useState<string | null>(null);
  const [debtModalClient, setDebtModalClient] = useState<UserProfile | null>(null);
  const [debtAmountInput, setDebtAmountInput] = useState<string>('');
  const [debtNoteInput, setDebtNoteInput] = useState<string>('Corrida não paga');
  const [savingDebt, setSavingDebt] = useState(false);
  const [inspectPhotoUrl, setInspectPhotoUrl] = useState<string | null>(null);
  const [showLegalDocs, setShowLegalDocs] = useState(false);
  const [uploadingAssetKind, setUploadingAssetKind] = useState<string | null>(null);

  const [chatTargetUser, setChatTargetUser] = useState<UserProfile | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-23.55052, -46.633308]);

  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventBonus, setEventBonus] = useState('15.00');
  const [eventTargetRole, setEventTargetRole] = useState<PlatformEvent['target_role']>('all');
  const [savingEvent, setSavingEvent] = useState(false);

  const [savingPricing, setSavingPricing] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadOverview = useCallback(async () => {
    setLoadingData(true);
    try {
      const [data, events] = await Promise.all([fetchAdminOverview(), fetchPlatformEvents()]);
      setPlatformConfig(data.platformConfig);
      syncPlatformSounds(data.platformConfig);
      setUsers(data.users);
      setRides(data.rides);
      setPricing(data.pricing);
      setTransactions(data.transactions);
      setPlatformEvents(events);

      const firstOnlineWithGps = data.users.find(
        (u) => u.role === 'driver' && u.driver?.is_online && u.driver.current_lat && u.driver.current_lng
      );
      if (firstOnlineWithGps?.driver?.current_lat && firstOnlineWithGps?.driver?.current_lng) {
        setMapCenter([firstOnlineWithGps.driver.current_lat, firstOnlineWithGps.driver.current_lng]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar dados do Supabase.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();

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
      .filter((r) => r.payment_method === 'pix')
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
      showToast('Configurações, Marca, Pix Oficial e Sons salvos!');
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

  const handleUploadPlatformAsset = async (
    file: File | undefined,
    kind:
      | 'logo'
      | 'moto'
      | 'pop'
      | 'delivery_moto'
      | 'delivery_car'
      | 'sound_offer'
      | 'sound_accepted'
      | 'sound_arrived'
  ) => {
    if (!file) return;
    setUploadingAssetKind(kind);
    try {
      const uploadedUrl = await uploadPlatformAssetFile(file, kind);
      const fieldMap: Record<typeof kind, keyof PlatformConfig> = {
        logo: 'app_logo_url',
        moto: 'vehicle_img_moto',
        pop: 'vehicle_img_pop',
        delivery_moto: 'vehicle_img_delivery_moto',
        delivery_car: 'vehicle_img_delivery_car',
        sound_offer: 'sound_offer_url',
        sound_accepted: 'sound_accepted_url',
        sound_arrived: 'sound_arrived_url',
      };
      const updatedCfg: PlatformConfig = {
        ...platformConfig,
        [fieldMap[kind]]: uploadedUrl,
      };
      setPlatformConfig(updatedCfg);
      syncPlatformSounds(updatedCfg);
      await adminSavePlatformConfig(updatedCfg);
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
      | 'vehicle_img_moto'
      | 'vehicle_img_pop'
      | 'vehicle_img_delivery_moto'
      | 'vehicle_img_delivery_car'
      | 'sound_offer_url'
      | 'sound_accepted_url'
      | 'sound_arrived_url'
  ) => {
    const updatedCfg: PlatformConfig = { ...platformConfig, [field]: null };
    setPlatformConfig(updatedCfg);
    syncPlatformSounds(updatedCfg);
    try {
      await adminSavePlatformConfig(updatedCfg);
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
      await adminCreatePlatformEvent({
        title: eventTitle,
        description: eventDesc,
        bonus_amount: parseFloat(eventBonus.replace(',', '.')) || 0,
        target_role: eventTargetRole,
      });
      setEventTitle('');
      setEventDesc('');
      setEventBonus('15.00');
      await loadOverview();
      showToast('Evento / Campanha publicado para os parceiros!');
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
                      {d.avatar_url ? (
                        <img
                          src={d.avatar_url}
                          alt={d.full_name}
                          className="h-10 w-10 rounded-full object-cover border border-neutral-200 shrink-0"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-extrabold text-[#FFD100]">
                          {d.full_name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
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
                            ? 'text-amber-600'
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
                        <Package className="h-3.5 w-3.5 text-amber-600" />
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
                        className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl bg-[#FFD100] px-3 text-xs font-extrabold text-neutral-950"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Aprovar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReviewDriver(d.id, 'suspended', 'Bloqueado pelo Admin')}
                        className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2.5 text-xs font-bold text-amber-800"
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

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white px-4 sm:px-8 py-3.5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={resolveBrandLogo(platformConfig)}
              alt={platformConfig.site_name || 'Velo99'}
              className="h-10 w-10 rounded-xl object-cover border border-neutral-200 shadow-xs"
            />
            <div>
              <h1 className="font-display text-base sm:text-lg font-extrabold text-neutral-950 leading-tight">
                {platformConfig.site_name || 'Velo99'} · Painel Super Admin
              </h1>
              <p className="text-xs text-neutral-500">
                {platformConfig.platform_city} · {currentUser.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loadingData}
              onClick={loadOverview}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-neutral-950 px-3.5 text-xs font-bold text-[#FFD100]"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl bg-neutral-950 px-4 py-3 text-xs font-bold text-[#FFD100] shadow-xl">
          {toast}
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-8 py-6">
        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Volume Total</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-neutral-950">
              {formatBRL(metrics.totalRevenue)}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Entradas Pix Central</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-emerald-700">
              {formatBRL(metrics.totalPixPlatform)}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">A Repassar (Pix)</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-amber-600">
              {formatBRL(metrics.totalPendingToDrivers)}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Concluídas / Ativas</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-neutral-950">
              {metrics.completedCount} / {metrics.activeRidesCount}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Aprovações Pend.</p>
            <p className="mt-1 font-mono-num text-xl font-extrabold text-amber-600">
              {metrics.pendingApprovalsCount}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Disputas Abertas</p>
            <p
              className={`mt-1 font-mono-num text-xl font-extrabold ${
                metrics.disputedCount > 0 ? 'text-red-600' : 'text-neutral-950'
              }`}
            >
              {metrics.disputedCount}
            </p>
          </div>
        </div>

        {awaitingPixRides.length > 0 && (
          <div className="mb-5 rounded-3xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-extrabold text-amber-950">
                  {awaitingPixRides.length}{' '}
                  {awaitingPixRides.length === 1
                    ? 'corrida aguardando sua confirmação de Pix'
                    : 'corridas aguardando sua confirmação de Pix'}
                </p>
                <p className="text-[11px] text-amber-800">
                  Enquanto você não confirmar o recebimento do Pix, o motorista permanece bloqueado
                  na tela de finalização.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTab('payments')}
              className="min-h-[42px] shrink-0 rounded-xl bg-neutral-950 px-4 text-xs font-extrabold text-[#FFD100]"
            >
              Conferir & Confirmar Pix
            </button>
          </div>
        )}

        {/* Separated Admin Management Navigation */}
        <nav className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {[
            {
              id: 'livemap' as AdminTab,
              label: `Mapa ao Vivo (${metrics.onlineCount} online)`,
              icon: Radio,
            },
            {
              id: 'drivers' as AdminTab,
              label: `Motoristas (${passengerDrivers.length})`,
              icon: Car,
            },
            {
              id: 'deliverers' as AdminTab,
              label: `Entregadores (${deliverers.length})`,
              icon: Package,
            },
            {
              id: 'clients' as AdminTab,
              label: `Clientes (${clients.length})`,
              icon: Users,
            },
            {
              id: 'rides' as AdminTab,
              label: `Corridas & Disputas (${rides.length})`,
              icon: ShieldCheck,
            },
            {
              id: 'payments' as AdminTab,
              label: `Pagamentos & Pix (${awaitingPixRides.length})`,
              icon: Wallet,
            },
            {
              id: 'events' as AdminTab,
              label: `Eventos Motoboys (${platformEvents.filter((e) => e.active).length})`,
              icon: Sparkles,
            },
            {
              id: 'pricing' as AdminTab,
              label: 'Tarifas, Marca & Sons',
              icon: Settings,
            },
            {
              id: 'infra' as AdminTab,
              label: 'SQL & APK',
              icon: Database,
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl px-4 text-xs font-bold transition whitespace-nowrap ${
                  active
                    ? 'bg-neutral-950 text-[#FFD100] shadow-sm'
                    : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* TAB 0: MAPA AO VIVO & ONLINE */}
        {tab === 'livemap' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 rounded-3xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5">
                <div>
                  <h2 className="font-display text-base font-extrabold text-neutral-950 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    Monitoramento GPS ao Vivo ({onlineDrivers.length} online)
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Total de cadastros: {users.length} usuários · Alterne entre modo Urbano e Satélite no mapa
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
              <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    Quem está Online Agora
                  </h3>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                    {onlineDrivers.length} ativos
                  </span>
                </div>

                {onlineDrivers.length === 0 ? (
                  <p className="py-6 text-center text-xs text-neutral-500">
                    Nenhum motorista ou entregador online neste momento.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {onlineDrivers.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-neutral-950 truncate flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            {d.full_name}
                          </p>
                          <p className="text-[11px] text-neutral-600 truncate">
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
                              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-neutral-200 text-blue-600 hover:bg-blue-50"
                              title="Focar no mapa"
                            >
                              <MapPin className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setChatTargetUser(d)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-950 text-[#FFD100]"
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

              <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-2">
                <h3 className="font-display text-sm font-extrabold text-neutral-950">
                  Resumo da Base Cadastrada
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="rounded-xl bg-neutral-50 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950">
                      {clients.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500">Clientes</p>
                  </div>
                  <div className="rounded-xl bg-neutral-50 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950">
                      {passengerDrivers.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500">Motoristas</p>
                  </div>
                  <div className="rounded-xl bg-neutral-50 p-2.5">
                    <p className="font-mono-num text-lg font-extrabold text-neutral-950">
                      {deliverers.length}
                    </p>
                    <p className="text-[10px] font-bold text-neutral-500">Entregadores</p>
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
                              {c.avatar_url ? (
                                <img
                                  src={c.avatar_url}
                                  alt={c.full_name}
                                  className="h-8 w-8 rounded-full object-cover border border-neutral-200 shrink-0"
                                />
                              ) : (
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-extrabold text-neutral-800">
                                  {c.full_name.slice(0, 2).toUpperCase()}
                                </div>
                              )}
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
                                      ? 'border border-amber-200 bg-amber-50 text-amber-800'
                                      : 'bg-[#FFD100] text-neutral-950'
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
                                  r.payment_status === 'paid_cash' ||
                                  r.payment_status === 'admin_settled'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {r.payment_method.toUpperCase()} · {r.payment_status}
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
                            {r.delivery_photo_url && (
                              <button
                                type="button"
                                onClick={() => setInspectPhotoUrl(r.delivery_photo_url || null)}
                                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-100"
                                title="Ver foto de comprovante da entrega"
                              >
                                <Camera className="h-3.5 w-3.5" />
                                Foto Entrega
                              </button>
                            )}
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
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
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
                  <h2 className="font-display text-lg font-extrabold text-neutral-950 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-600" />
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
                      className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex flex-col justify-between gap-3"
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
                        <p className="text-[11px] font-bold text-amber-800">
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

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Official Owner Pix Configuration */}
              <form
                onSubmit={handleSavePlatformConfig}
                className="lg:col-span-4 rounded-2xl border border-neutral-200 bg-white p-5 space-y-4 h-fit"
              >
                <div className="flex items-center gap-2.5 text-neutral-950 font-extrabold text-sm">
                  <QrCode className="h-5 w-5 text-amber-600" />
                  <span>Minha Conta Pix Oficial (Dono)</span>
                </div>
                <p className="text-xs text-neutral-600">
                  Todo passageiro que escolher pagar por Pix pagará diretamente para esta chave.
                  Depois, você realiza os repasses abaixo para cada motorista ou entregador.
                </p>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Chave Pix Recebedora
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.platform_pix_key}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, platform_pix_key: e.target.value }))
                    }
                    className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-sm font-bold outline-none focus:border-neutral-950"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
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
                    className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingPlatform}
                  className="min-h-[48px] w-full rounded-2xl bg-neutral-950 text-sm font-extrabold text-[#FFD100]"
                >
                  {savingPlatform ? 'Salvando...' : 'Salvar Minha Chave Pix'}
                </button>
              </form>

              {/* Driver & Deliverer Payout Ledger Table */}
              <div className="lg:col-span-8 space-y-4">
                <div>
                  <h2 className="font-display text-xl font-extrabold text-neutral-950">
                    Repasses aos Motoristas & Entregadores
                  </h2>
                  <p className="text-xs text-neutral-600">
                    Confira o total recebido em Pix (centralizado em você), o total em dinheiro
                    (recebido direto pelo motorista) e o saldo pendente para transferir.
                  </p>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                      <tr>
                        <th className="px-4 py-3 font-bold">Motorista / Entregador</th>
                        <th className="px-4 py-3 font-bold">Chave Pix Dele</th>
                        <th className="px-4 py-3 font-bold text-right">Pix Feito</th>
                        <th className="px-4 py-3 font-bold text-right">Dinheiro</th>
                        <th className="px-4 py-3 font-bold text-right">Já Pago</th>
                        <th className="px-4 py-3 font-bold text-right">A Pagar</th>
                        <th className="px-4 py-3 font-bold text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {allDriversAndDeliverers.map((d) => {
                        const drvRides = rides.filter(
                          (r) => r.driver_id === d.id && r.status === 'completed'
                        );
                        const pixTotal = drvRides
                          .filter((r) => r.payment_method === 'pix')
                          .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
                        const cashTotal = drvRides
                          .filter((r) => r.payment_method === 'cash')
                          .reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0);
                        const paidOut = transactions
                          .filter((t) => t.user_id === d.id && t.type === 'payout')
                          .reduce((acc, t) => acc + Math.abs(t.amount), 0);

                        return (
                          <tr key={d.id} className="hover:bg-neutral-50">
                            <td className="px-4 py-3">
                              <p className="font-bold text-neutral-950">{d.full_name}</p>
                              <p className="text-[11px] text-neutral-500">
                                {d.driver?.vehicle_type === 'delivery'
                                  ? 'Entregador'
                                  : d.driver?.vehicle_type === 'moto'
                                  ? 'Moto'
                                  : 'Carro'}{' '}
                                · {d.driver?.vehicle_plate}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-mono-num text-neutral-700">
                              {d.driver?.pix_key || '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num font-bold text-neutral-900">
                              {formatBRL(pixTotal)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num text-emerald-700">
                              {formatBRL(cashTotal)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num text-sky-700">
                              {formatBRL(paidOut)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono-num font-extrabold text-amber-700">
                              {formatBRL(d.wallet_balance)}
                            </td>
                            <td className="px-4 py-3 text-right">
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
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-3 py-1.5 text-[11px] font-extrabold text-neutral-950"
                                >
                                  <Wallet className="h-3.5 w-3.5" />
                                  Pagar Pix
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Em dia
                                </span>
                              )}
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
                <Sparkles className="h-5 w-5 text-amber-600" />
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

              <button
                type="submit"
                disabled={savingEvent}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm"
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
                        ev.active ? 'border-amber-300' : 'border-neutral-200 opacity-75'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-extrabold text-neutral-950">{ev.title}</h3>
                          {ev.bonus_amount > 0 && (
                            <span className="rounded-lg bg-[#FFD100] px-2 py-0.5 font-mono-num text-[11px] font-extrabold text-neutral-950">
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
                      <div className="flex items-center gap-2 shrink-0">
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
                  className="min-h-[48px] rounded-2xl bg-[#FFD100] px-6 text-sm font-extrabold text-neutral-950 shadow-sm"
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
                  <Settings className="h-5 w-5 text-amber-600" />
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
                  className="min-h-[46px] w-full rounded-2xl bg-neutral-950 text-sm font-extrabold text-[#FFD100]"
                >
                  {savingPlatform ? 'Salvando...' : 'Salvar Configurações do Site'}
                </button>
              </form>

              {/* Identidade Visual, Logo & Imagens dos Veículos */}
              <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950">
                  <ImageIcon className="h-5 w-5 text-amber-600" />
                  <span>Logo & Imagens dos Veículos (White-Label)</span>
                </div>
                <p className="text-xs text-neutral-600">
                  Personalize o logotipo da plataforma e os ícones de Moto, Pop e Entregas exibidos
                  para passageiros e motoristas.
                </p>

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
                        <p className="text-xs font-extrabold text-neutral-950">Logo Principal</p>
                        <p className="text-[11px] text-neutral-500">
                          {platformConfig.app_logo_url ? 'Personalizada' : 'Padrão Velo'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="cursor-pointer rounded-xl bg-neutral-950 px-3 py-2 text-[11px] font-bold text-[#FFD100]">
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
                        <label className="cursor-pointer rounded-xl bg-neutral-950 px-3 py-2 text-[11px] font-bold text-[#FFD100]">
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

              {/* Áudios & Toques de Notificação Personalizados */}
              <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950">
                  <Music className="h-5 w-5 text-amber-600" />
                  <span>Sons & Toques de Notificação (MP3/WAV/OGG)</span>
                </div>
                <p className="text-xs text-neutral-600">
                  Envie áudios personalizados para toques de chamada de corrida, aceite e chegada do
                  motorista.
                </p>

                <div className="space-y-2.5">
                  {(
                    [
                      {
                        kind: 'sound_offer' as const,
                        field: 'sound_offer_url' as const,
                        cue: 'offer' as const,
                        label: 'Toque Nova Corrida (Motorista)',
                      },
                      {
                        kind: 'sound_accepted' as const,
                        field: 'sound_accepted_url' as const,
                        cue: 'accepted' as const,
                        label: 'Som Corrida Aceita',
                      },
                      {
                        kind: 'sound_arrived' as const,
                        field: 'sound_arrived_url' as const,
                        cue: 'arrived' as const,
                        label: 'Som Motorista Chegou',
                      },
                    ] as const
                  ).map((snd) => (
                    <div
                      key={snd.kind}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-neutral-950">{snd.label}</p>
                        <p className="text-[11px] text-neutral-500">
                          {platformConfig[snd.field] ? 'Áudio personalizado ativo' : 'Áudio padrão'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            syncPlatformSounds(platformConfig);
                            void playSoundCue(snd.cue);
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[11px] font-bold text-neutral-800"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          Testar
                        </button>
                        <label className="cursor-pointer rounded-xl bg-neutral-950 px-3 py-2 text-[11px] font-bold text-[#FFD100]">
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
                            className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[11px] font-bold text-neutral-700"
                          >
                            Padrão
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowLegalDocs(true)}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 text-xs font-extrabold text-neutral-900 hover:bg-neutral-100"
                >
                  <FileText className="h-4 w-4 text-amber-600" />
                  Visualizar Termos, Privacidade, Segurança & Cookies
                </button>
              </div>
            </div>
          </section>
        )}

        {/* TAB 7: SQL INCREMENTAL & APK */}
        {tab === 'infra' && (
          <section className="mt-5 space-y-6">
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center gap-2.5">
                <Smartphone className="h-5 w-5 text-neutral-950" />
                <h3 className="font-display text-base font-extrabold text-neutral-950">
                  Conexão Direta Supabase (Web, PWA & Capacitor APK)
                </h3>
              </div>
              <p className="mt-2 text-xs text-neutral-700 leading-relaxed">
                O aplicativo agora conecta diretamente no seu projeto Supabase em todas as telas
                (inclusive dentro do APK Android sem depender de servidor local), usando{' '}
                <span className="font-mono-num">capacitor.config.ts</span> e{' '}
                <span className="font-mono-num">.github/workflows/build-apk.yml</span>.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    SQL Incremental de Atualização (supabase/migration_update.sql)
                  </h3>
                  <p className="text-xs text-neutral-600">
                    Contém apenas as tabelas, colunas, triggers e políticas que faltavam no seu
                    banco Supabase atual (sem recriar nada do zero).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copySql}
                  className="flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-xs font-bold text-[#FFD100]"
                >
                  <Copy className="h-4 w-4" />
                  {copiedSql ? 'Copiado!' : 'Copiar SQL'}
                </button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-xl bg-neutral-950 p-4 text-[11px] font-mono text-neutral-200 leading-relaxed">
                {migrationSql || 'Veja o arquivo supabase/migration_update.sql no repositório.'}
              </pre>
            </div>
          </section>
        )}
      </div>

      {/* Document Inspection Modal */}
      {inspectDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950">
                  Documentos de {inspectDriver.full_name}
                </h3>
                <p className="text-xs text-neutral-600">
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
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-neutral-700 mb-1.5">CNH (Habilitação)</p>
                <img
                  src={resolvedCnhUrl || inspectDriver.driver?.cnh_url}
                  alt="CNH do Motorista"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full rounded-2xl border border-neutral-200 object-cover bg-neutral-100"
                />
              </div>
              <div>
                <p className="text-xs font-bold text-neutral-700 mb-1.5">CRLV (Documento Veículo)</p>
                <img
                  src={resolvedCrlvUrl || inspectDriver.driver?.crlv_url}
                  alt="CRLV do Veículo"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full rounded-2xl border border-neutral-200 object-cover bg-neutral-100"
                />
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t border-neutral-100 pt-4">
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Motivo caso reprove ou suspenda (opcional)"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3.5 text-xs outline-none focus:border-neutral-950"
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
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-bold text-red-700"
                >
                  <Ban className="h-4 w-4" />
                  Reprovar
                </button>
                <button
                  type="button"
                  onClick={() => handleReviewDriver(inspectDriver.id, 'active')}
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl bg-[#FFD100] px-5 text-xs font-extrabold text-neutral-950"
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
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950">
                  Registrar Repasse Pix
                </h3>
                <p className="text-xs text-neutral-500">
                  {payoutModalDriver.full_name} · Saldo:{' '}
                  <strong className="font-mono-num">
                    {formatBRL(payoutModalDriver.wallet_balance)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayoutModalDriver(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3.5 text-xs">
              <p className="text-neutral-500 font-bold">Chave Pix do Motorista / Entregador</p>
              <p className="mt-1 font-mono-num text-sm font-extrabold text-neutral-950">
                {payoutModalDriver.driver?.pix_key || payoutModalDriver.email}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
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
                className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-base font-extrabold outline-none focus:border-neutral-950"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Observação / Comprovante
              </label>
              <input
                type="text"
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
                placeholder="Ex: Pix enviado às 18:30"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-xs outline-none focus:border-neutral-950"
              />
            </div>

            <button
              type="submit"
              className="min-h-[48px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950"
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
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="font-display text-lg font-extrabold text-neutral-950">
                  Cobrança / Corrida não paga
                </h3>
                <p className="text-xs text-neutral-500">{debtModalClient.full_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDebtModalClient(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              O valor definido aqui será exibido como pendência para o cliente e somado
              automaticamente na próxima corrida que ele solicitar (ou digite <strong>0</strong>{' '}
              para limpar a dívida).
            </p>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
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
                className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 font-mono-num text-base font-extrabold outline-none focus:border-neutral-950"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Motivo / Descrição exibida ao cliente
              </label>
              <input
                type="text"
                value={debtNoteInput}
                onChange={(e) => setDebtNoteInput(e.target.value)}
                placeholder="Ex: Corrida não paga"
                className="min-h-[44px] w-full rounded-xl border border-neutral-200 px-3 text-xs outline-none focus:border-neutral-950"
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
                className="min-h-[48px] flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 text-xs font-extrabold text-neutral-800"
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

      {/* Delivery Photo Inspection Modal */}
      {inspectPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
              <h3 className="font-display text-base font-extrabold text-neutral-950">
                Foto de Comprovante da Entrega
              </h3>
              <button
                type="button"
                onClick={() => setInspectPhotoUrl(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={inspectPhotoUrl}
              alt="Foto da entrega realizada"
              referrerPolicy="no-referrer"
              className="max-h-[70vh] w-full rounded-2xl object-contain bg-neutral-100 border border-neutral-200"
            />
          </div>
        </div>
      )}

      {showLegalDocs && (
        <LegalDocsModal
          siteName={platformConfig.site_name}
          onClose={() => setShowLegalDocs(false)}
        />
      )}
    </div>
  );
};
