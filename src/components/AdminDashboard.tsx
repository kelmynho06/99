import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Car,
  Check,
  CheckCircle2,
  Copy,
  Database,
  DollarSign,
  Eye,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatBRL } from '../lib/geo';
import type { PlatformConfig, PricingSetting, Ride, UserProfile } from '../types/mobility';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
}

type AdminTab = 'drivers' | 'rides' | 'pricing' | 'users' | 'infra';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser, onLogout }) => {
  const [tab, setTab] = useState<AdminTab>('drivers');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>({
    platform_pix_key: 'pix@velo99.app',
    platform_pix_receiver: 'Velo99 Mobilidade Ltda',
    platform_city: 'São Paulo, SP',
  });
  const [schemaSql, setSchemaSql] = useState<string>('');
  const [copiedSql, setCopiedSql] = useState(false);

  const [driverFilter, setDriverFilter] = useState<'all' | 'pending' | 'active' | 'rejected'>(
    'pending'
  );
  const [rideFilter, setRideFilter] = useState<'all' | 'disputed'>('all');
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    completedCount: 0,
    activeRidesCount: 0,
    pendingDriversCount: 0,
    disputedCount: 0,
  });
  const [inspectDriver, setInspectDriver] = useState<UserProfile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      const data = (await res.json()) as {
        platformConfig?: PlatformConfig;
        users: UserProfile[];
        rides: Ride[];
        pricing: PricingSetting[];
        metrics?: {
          totalRevenue: number;
          completedCount: number;
          activeRidesCount: number;
          pendingDriversCount: number;
          disputedCount?: number;
        };
      };
      if (data.platformConfig) setPlatformConfig(data.platformConfig);
      setUsers(data.users);
      setRides(data.rides);
      setPricing(data.pricing);
      if (data.metrics) {
        setMetrics({
          totalRevenue: data.metrics.totalRevenue,
          completedCount: data.metrics.completedCount,
          activeRidesCount: data.metrics.activeRidesCount,
          pendingDriversCount: data.metrics.pendingDriversCount,
          disputedCount: data.metrics.disputedCount ?? 0,
        });
      }
    }
  }, []);

  useEffect(() => {
    loadOverview();
    fetch('/api/schema-sql')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => setSchemaSql(txt))
      .catch(() => {});
  }, [loadOverview]);

  const drivers = users.filter((u) => u.role === 'driver');
  const pendingCount = drivers.filter((d) => d.status === 'pending').length;
  const filteredDrivers = drivers.filter((d) =>
    driverFilter === 'all' ? true : d.status === driverFilter
  );
  const filteredRides =
    rideFilter === 'disputed'
      ? rides.filter((r) => r.payment_status === 'disputed')
      : rides;

  const reviewDriver = async (
    userId: string,
    status: 'active' | 'rejected' | 'suspended',
    reason?: string
  ) => {
    const res = await fetch(`/api/admin/drivers/${userId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, rejection_reason: reason }),
    });
    if (res.ok) {
      await loadOverview();
      setInspectDriver(null);
      setRejectionReason('');
      showToast(
        status === 'active'
          ? 'Motorista aprovado e liberado!'
          : status === 'rejected'
          ? 'Motorista reprovado.'
          : 'Motorista suspenso.'
      );
    }
  };

  const savePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPricing(true);
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing }),
      });
      if (res.ok) {
        showToast('Tarifas das 5 categorias atualizadas!');
      }
    } finally {
      setSavingPricing(false);
    }
  };

  const savePlatformConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlatform(true);
    try {
      const res = await fetch('/api/admin/platform', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(platformConfig),
      });
      if (res.ok) {
        showToast('Pix Centralizado e Cidade salvos em tempo real!');
      }
    } finally {
      setSavingPlatform(false);
    }
  };

  const settleDispute = async (rideId: string) => {
    const res = await fetch(`/api/admin/rides/${rideId}/settle-dispute`, { method: 'POST' });
    if (res.ok) {
      await loadOverview();
      showToast('Disputa assumida pelo Admin e motorista quitado!');
    }
  };

  const payoutDriver = async (userId: string) => {
    const res = await fetch(`/api/admin/drivers/${userId}/payout`, { method: 'POST' });
    if (res.ok) {
      await loadOverview();
      showToast('Repasse Pix registrado na carteira do motorista!');
    }
  };

  const cancelRide = async (rideId: string) => {
    const res = await fetch(`/api/rides/${rideId}/cancel`, { method: 'POST' });
    if (res.ok) {
      await loadOverview();
      showToast('Corrida cancelada.');
    }
  };

  const copySql = async () => {
    if (!schemaSql) return;
    await navigator.clipboard.writeText(schemaSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

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
              onClick={loadOverview}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className="h-4 w-4" />
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
        {/* Financial & Operational Metrics */}
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Volume Financeiro</p>
            <p className="mt-1 font-mono-num text-2xl font-extrabold text-neutral-950">
              {formatBRL(metrics.totalRevenue)}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Corridas / Entregas</p>
            <p className="mt-1 font-mono-num text-2xl font-extrabold text-neutral-950">
              {metrics.completedCount}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Em Andamento Agora</p>
            <p className="mt-1 font-mono-num text-2xl font-extrabold text-neutral-950">
              {metrics.activeRidesCount}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-500">Aprovações Pendentes</p>
            <p className="mt-1 font-mono-num text-2xl font-extrabold text-amber-600">
              {metrics.pendingDriversCount}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 col-span-2 lg:col-span-1">
            <p className="text-xs font-semibold text-neutral-500">Disputas ("Calote")</p>
            <p
              className={`mt-1 font-mono-num text-2xl font-extrabold ${
                metrics.disputedCount > 0 ? 'text-red-600' : 'text-neutral-950'
              }`}
            >
              {metrics.disputedCount}
            </p>
          </div>
        </div>

        {/* Segmented Navigation Tabs */}
        <nav className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {[
            { id: 'drivers' as AdminTab, label: `Motoristas (${pendingCount} pend.)`, icon: ShieldCheck },
            {
              id: 'rides' as AdminTab,
              label: `Corridas & Disputas (${rides.length})`,
              icon: Car,
            },
            { id: 'pricing' as AdminTab, label: 'Tarifas & Pix Central', icon: DollarSign },
            { id: 'users' as AdminTab, label: `Usuários & Repasses`, icon: Users },
            { id: 'infra' as AdminTab, label: 'Supabase SQL & APK', icon: Database },
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

        {/* TAB 1: DRIVERS & DOCUMENTS */}
        {tab === 'drivers' && (
          <section className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Aprovação de Motoristas e Documentos
              </h2>
              <div className="flex items-center gap-1 rounded-xl bg-neutral-200/70 p-1">
                {(['pending', 'active', 'rejected', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDriverFilter(f)}
                    className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition ${
                      driverFilter === f
                        ? 'bg-white text-neutral-950 shadow-xs'
                        : 'text-neutral-600'
                    }`}
                  >
                    {f === 'pending'
                      ? 'Pendentes'
                      : f === 'active'
                      ? 'Aprovados'
                      : f === 'rejected'
                      ? 'Reprovados'
                      : 'Todos'}
                  </button>
                ))}
              </div>
            </div>

            {filteredDrivers.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                Nenhum motorista nesta categoria.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDrivers.map((d) => (
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
                          <p className="text-xs text-neutral-500">{d.phone} · {d.email}</p>
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
                        <p>
                          <strong>Veículo:</strong> {d.driver?.vehicle_model} ({d.driver?.vehicle_color})
                        </p>
                        <p className="font-mono-num">
                          <strong>Placa:</strong> {d.driver?.vehicle_plate} ·{' '}
                          <strong>CPF:</strong> {d.cpf}
                        </p>
                        <p className="font-mono-num truncate">
                          <strong>Pix:</strong> {d.driver?.pix_key}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setInspectDriver(d)}
                        className="min-h-[44px] flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-neutral-300 bg-neutral-50 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                      >
                        <Eye className="h-4 w-4" />
                        Ver CNH / CRLV
                      </button>
                      {d.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => reviewDriver(d.id, 'active')}
                          className="min-h-[44px] flex items-center justify-center gap-1 rounded-xl bg-[#FFD100] px-4 text-xs font-extrabold text-neutral-950"
                        >
                          <Check className="h-4 w-4" />
                          Aprovar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: RIDES & DISPUTE RESOLUTION */}
        {tab === 'rides' && (
          <section className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-extrabold text-neutral-950">
                Monitoramento de Corridas & Disputas
              </h2>
              <div className="flex items-center gap-1 rounded-xl bg-neutral-200/70 p-1">
                <button
                  type="button"
                  onClick={() => setRideFilter('all')}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                    rideFilter === 'all' ? 'bg-white text-neutral-950 shadow-xs' : 'text-neutral-600'
                  }`}
                >
                  Todas ({rides.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRideFilter('disputed')}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                    rideFilter === 'disputed'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-red-700'
                  }`}
                >
                  Em disputa ({metrics.disputedCount})
                </button>
              </div>
            </div>

            {filteredRides.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                {rideFilter === 'disputed'
                  ? 'Nenhuma disputa de não pagamento aberta.'
                  : 'Nenhuma corrida registrada ainda.'}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">ID / Cat.</th>
                      <th className="px-4 py-3 font-bold">Passageiro</th>
                      <th className="px-4 py-3 font-bold">Motorista</th>
                      <th className="px-4 py-3 font-bold">Trajeto</th>
                      <th className="px-4 py-3 font-bold">Pgto / Status</th>
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
                              onClick={() => settleDispute(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Quitar Motorista
                            </button>
                          )}
                          {['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status) && (
                            <button
                              type="button"
                              onClick={() => cancelRide(r.id)}
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

        {/* TAB 3: PRICING (5 CATEGORIES) + CENTRALIZED PIX CONFIG */}
        {tab === 'pricing' && (
          <section className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div>
                <h2 className="font-display text-xl font-extrabold text-neutral-950">
                  Tarifas por Categoria (5 modalidades)
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  Alterações atualizam instantaneamente o cálculo para todos os passageiros.
                </p>
              </div>

              <form onSubmit={savePricing} className="space-y-4">
                {pricing.map((cat, idx) => (
                  <div
                    key={cat.category}
                    className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3"
                  >
                    <div>
                      <h3 className="font-display text-base font-extrabold text-neutral-950">
                        {cat.label}
                      </h3>
                      <p className="text-xs text-neutral-500">{cat.description}</p>
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

            {/* Centralized Platform Pix & City Form */}
            <div className="lg:col-span-5 space-y-4">
              <div>
                <h2 className="font-display text-xl font-extrabold text-neutral-950">
                  Pix Centralizado & Operação Local
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  Chave Pix oficial da plataforma exibida aos passageiros no checkout Pix.
                </p>
              </div>

              <form
                onSubmit={savePlatformConfig}
                className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-center gap-2.5 text-neutral-950 font-bold text-sm">
                  <QrCode className="h-5 w-5 text-amber-600" />
                  <span>Conta Recebedora Oficial (Dono)</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Chave Pix Oficial da Plataforma
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
                    Nome do Favorecido / Empresa
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
                    className="min-h-[46px] w-full rounded-xl border border-neutral-200 px-3 text-sm font-semibold outline-none focus:border-neutral-950"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingPlatform}
                  className="min-h-[48px] w-full rounded-2xl bg-neutral-950 text-sm font-extrabold text-[#FFD100]"
                >
                  {savingPlatform ? 'Salvando...' : 'Atualizar Pix & Cidade'}
                </button>
              </form>
            </div>
          </section>
        )}

        {/* TAB 4: USERS & DRIVER PAYOUTS */}
        {tab === 'users' && (
          <section className="mt-5 space-y-4">
            <h2 className="font-display text-xl font-extrabold text-neutral-950">
              Usuários Cadastrados & Repasses Pix
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-4 py-3 font-bold">Nome</th>
                    <th className="px-4 py-3 font-bold">Perfil</th>
                    <th className="px-4 py-3 font-bold">Telefone</th>
                    <th className="px-4 py-3 font-bold">Pix / E-mail</th>
                    <th className="px-4 py-3 font-bold">Nota</th>
                    <th className="px-4 py-3 font-bold text-right">Saldo Carteira</th>
                    <th className="px-4 py-3 font-bold text-right">Repasse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-bold text-neutral-950">{u.full_name}</td>
                      <td className="px-4 py-3">
                        {u.role} · {u.status}
                      </td>
                      <td className="px-4 py-3 font-mono-num">{u.phone}</td>
                      <td className="px-4 py-3 font-mono-num">
                        {u.driver?.pix_key || u.email}
                      </td>
                      <td className="px-4 py-3 font-mono-num">{u.rating_avg.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono-num font-bold">
                        {formatBRL(u.wallet_balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.role === 'driver' && u.wallet_balance > 0 ? (
                          <button
                            type="button"
                            onClick={() => payoutDriver(u.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#FFD100] px-2.5 py-1.5 text-[11px] font-extrabold text-neutral-950"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            Repassar Pix
                          </button>
                        ) : (
                          <span className="text-neutral-400">
                            <CheckCircle2 className="inline h-3.5 w-3.5" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TAB 5: SUPABASE SQL & APK */}
        {tab === 'infra' && (
          <section className="mt-5 space-y-6">
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="h-5 w-5 text-neutral-950" />
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    Empacotamento Android (Capacitor + GitHub Actions)
                  </h3>
                </div>
              </div>
              <p className="mt-2 text-xs text-neutral-700 leading-relaxed">
                O projeto já está configurado com <strong>capacitor.config.ts</strong> (
                <span className="font-mono-num">com.mobilidade99.app</span>), permissões de GPS e
                Câmera no AndroidManifest e o workflow automático sem cache falho em{' '}
                <span className="font-mono-num">.github/workflows/build-apk.yml</span>. Ao realizar
                um push no GitHub, o arquivo <strong>app-debug.apk</strong> é compilado na nuvem e
                disponibilizado em Actions → Artifacts.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display text-base font-extrabold text-neutral-950">
                    Script SQL do Supabase (supabase/schema.sql)
                  </h3>
                  <p className="text-xs text-neutral-600">
                    Tabelas, Storage Bucket (driver-documents), Pix centralizado, 5 categorias, RLS
                    estrito e Supabase Realtime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copySql}
                  className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-xs font-bold text-[#FFD100]"
                >
                  <Copy className="h-4 w-4" />
                  {copiedSql ? 'Copiado!' : 'Copiar SQL'}
                </button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-xl bg-neutral-950 p-4 text-[11px] font-mono text-neutral-200 leading-relaxed">
                {schemaSql || 'Carregando SQL...'}
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
                  src={inspectDriver.driver?.cnh_url}
                  alt="CNH do Motorista"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full rounded-2xl border border-neutral-200 object-cover bg-neutral-100"
                />
              </div>
              <div>
                <p className="text-xs font-bold text-neutral-700 mb-1.5">CRLV (Documento Veículo)</p>
                <img
                  src={inspectDriver.driver?.crlv_url}
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
                    reviewDriver(
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
                  onClick={() => reviewDriver(inspectDriver.id, 'active')}
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl bg-[#FFD100] px-5 text-xs font-extrabold text-neutral-950"
                >
                  <Check className="h-4 w-4" />
                  Aprovar Motorista
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
