import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Banknote,
  Bike,
  Car,
  Check,
  CheckCircle2,
  Copy,
  Database,
  DollarSign,
  Eye,
  LogOut,
  Package,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatBRL } from '../lib/geo';
import {
  adminPayDriverPix,
  adminReviewDriver,
  adminSavePlatformConfig,
  adminSavePricing,
  adminSettleDispute,
  adminUpdateUserStatus,
  cancelRide,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRICING_LIST,
  fetchAdminOverview,
  resolveDocumentDisplayUrl,
} from '../lib/mobilityApi';
import type {
  PlatformConfig,
  PricingSetting,
  Ride,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';
import migrationSqlRaw from '../../supabase/migration_update.sql?raw';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
}

type AdminTab =
  | 'drivers'
  | 'deliverers'
  | 'clients'
  | 'rides'
  | 'payments'
  | 'pricing'
  | 'infra';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser, onLogout }) => {
  const [tab, setTab] = useState<AdminTab>('drivers');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>(DEFAULT_PRICING_LIST);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);

  const [migrationSql, setMigrationSql] = useState<string>(migrationSqlRaw);
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
      const data = await fetchAdminOverview();
      setPlatformConfig(data.platformConfig);
      setUsers(data.users);
      setRides(data.rides);
      setPricing(data.pricing);
      setTransactions(data.transactions);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar dados do Supabase.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
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
    };
  }, [rides, allDriversAndDeliverers]);

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
      showToast('Conta Pix Oficial e Cidade salvos!');
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar Pix Oficial. Verifique se o SQL incremental foi aplicado.'
      );
    } finally {
      setSavingPlatform(false);
    }
  };

  const handleSettleDispute = async (ride: Ride) => {
    try {
      await adminSettleDispute(ride);
      await loadOverview();
      showToast('Disputa assumida e valor creditado ao motorista!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao quitar disputa.');
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
            return (
              <div
                key={d.id}
                className="rounded-2xl border border-neutral-200 bg-white p-5 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-extrabold text-neutral-950">
                        {d.full_name}
                      </h3>
                      <p className="text-xs text-neutral-500">
                        {d.phone} · {d.email}
                      </p>
                    </div>
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

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setInspectDriver(d)}
                    className="min-h-[42px] flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-neutral-300 bg-neutral-50 px-3 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                  >
                    <Eye className="h-4 w-4" />
                    Documentos
                  </button>
                  {d.status !== 'active' ? (
                    <button
                      type="button"
                      onClick={() => handleReviewDriver(d.id, 'active')}
                      className="min-h-[42px] flex items-center justify-center gap-1 rounded-xl bg-[#FFD100] px-4 text-xs font-extrabold text-neutral-950"
                    >
                      <Check className="h-4 w-4" />
                      Aprovar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReviewDriver(d.id, 'suspended', 'Suspenso pelo Admin')}
                      className="min-h-[42px] flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Suspender
                    </button>
                  )}
                </div>
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD100] font-display text-lg font-extrabold text-neutral-950">
              99
            </div>
            <div>
              <h1 className="font-display text-base sm:text-lg font-extrabold text-neutral-950 leading-tight">
                Painel Super Admin
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

        {/* Separated Admin Management Navigation */}
        <nav className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {[
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
              label: 'Pagamentos & Pix Central',
              icon: Wallet,
            },
            {
              id: 'pricing' as AdminTab,
              label: 'Tarifas & Cidade',
              icon: DollarSign,
            },
            {
              id: 'infra' as AdminTab,
              label: 'SQL Atualização & APK',
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
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {clients.map((c) => {
                      const clientRides = rides.filter((r) => r.passenger_id === c.id);
                      return (
                        <tr key={c.id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3 font-bold text-neutral-950">{c.full_name}</td>
                          <td className="px-4 py-3 font-mono-num">
                            {c.phone} · {c.cpf}
                          </td>
                          <td className="px-4 py-3">{c.email}</td>
                          <td className="px-4 py-3 font-mono-num">{c.rating_avg.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono-num font-bold">
                            {clientRides.length}
                          </td>
                          <td className="px-4 py-3 font-bold">
                            <span
                              className={
                                c.status === 'active' ? 'text-emerald-700' : 'text-red-600'
                              }
                            >
                              {c.status === 'active' ? 'Ativo' : 'Suspenso'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleClientStatus(c)}
                              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${
                                c.status === 'active'
                                  ? 'border border-red-200 bg-red-50 text-red-700'
                                  : 'bg-[#FFD100] text-neutral-950'
                              }`}
                            >
                              {c.status === 'active' ? 'Suspender' : 'Reativar'}
                            </button>
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
                        <td className="px-4 py-3 text-right space-x-1.5">
                          {r.payment_status === 'disputed' && (
                            <button
                              type="button"
                              onClick={() => handleSettleDispute(r)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Quitar Motorista
                            </button>
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

        {/* TAB 6: TARIFAS & CIDADE */}
        {tab === 'pricing' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-4">
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

            <div className="lg:col-span-4 space-y-4">
              <form
                onSubmit={handleSavePlatformConfig}
                className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-950">
                  <UserCheck className="h-5 w-5 text-amber-600" />
                  <span>Cidade da Operação Local</span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Cidade exibida no aplicativo
                  </label>
                  <input
                    type="text"
                    required
                    value={platformConfig.platform_city}
                    onChange={(e) =>
                      setPlatformConfig((prev) => ({ ...prev, platform_city: e.target.value }))
                    }
                    className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingPlatform}
                  className="min-h-[46px] w-full rounded-2xl bg-neutral-950 text-sm font-extrabold text-[#FFD100]"
                >
                  {savingPlatform ? 'Salvando...' : 'Salvar Cidade'}
                </button>
              </form>
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
    </div>
  );
};
