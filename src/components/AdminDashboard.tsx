import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Car,
  Check,
  Copy,
  Database,
  DollarSign,
  Eye,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { formatBRL } from '../lib/geo';
import type { PricingSetting, Ride, UserProfile } from '../types/mobility';

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
  const [schemaSql, setSchemaSql] = useState<string>('');
  const [copiedSql, setCopiedSql] = useState(false);

  const [driverFilter, setDriverFilter] = useState<'all' | 'pending' | 'active' | 'rejected'>(
    'pending'
  );
  const [inspectDriver, setInspectDriver] = useState<UserProfile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      const data = (await res.json()) as {
        users: UserProfile[];
        rides: Ride[];
        pricing: PricingSetting[];
      };
      setUsers(data.users);
      setRides(data.rides);
      setPricing(data.pricing);
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
        showToast('Tarifas atualizadas em tempo real!');
      }
    } finally {
      setSavingPricing(false);
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFCC00] font-display text-lg font-extrabold text-neutral-950">
              99
            </div>
            <div>
              <h1 className="font-display text-base sm:text-lg font-extrabold text-neutral-950 leading-tight">
                Painel Super Admin
              </h1>
              <p className="text-xs text-neutral-500">{currentUser.email}</p>
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
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-neutral-950 px-3.5 text-xs font-bold text-[#FFCC00]"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl bg-neutral-950 px-4 py-3 text-xs font-bold text-[#FFCC00] shadow-xl">
          {toast}
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-8 py-6">
        {/* Segmented Navigation Tabs */}
        <nav className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {[
            { id: 'drivers' as AdminTab, label: `Motoristas (${pendingCount} pend.)`, icon: ShieldCheck },
            { id: 'rides' as AdminTab, label: `Corridas (${rides.length})`, icon: Car },
            { id: 'pricing' as AdminTab, label: 'Tarifas Base / KM', icon: DollarSign },
            { id: 'users' as AdminTab, label: `Usuários (${users.length})`, icon: Users },
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
                    ? 'bg-neutral-950 text-[#FFCC00] shadow-sm'
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
                          className="min-h-[44px] flex items-center justify-center gap-1 rounded-xl bg-[#FFCC00] px-4 text-xs font-extrabold text-neutral-950"
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

        {/* TAB 2: RIDES */}
        {tab === 'rides' && (
          <section className="mt-5 space-y-4">
            <h2 className="font-display text-xl font-extrabold text-neutral-950">
              Monitoramento de Corridas
            </h2>
            {rides.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
                Nenhuma corrida registrada ainda.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">Corrida</th>
                      <th className="px-4 py-3 font-bold">Passageiro</th>
                      <th className="px-4 py-3 font-bold">Motorista</th>
                      <th className="px-4 py-3 font-bold">Trajeto</th>
                      <th className="px-4 py-3 font-bold">PIN</th>
                      <th className="px-4 py-3 font-bold text-right">Valor</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {rides.map((r) => (
                      <tr key={r.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono-num font-bold">{r.id.slice(-6)}</td>
                        <td className="px-4 py-3">{r.passenger?.full_name || '—'}</td>
                        <td className="px-4 py-3">{r.driver?.full_name || 'Buscando'}</td>
                        <td className="px-4 py-3 max-w-xs truncate">
                          {r.origin_address} → {r.destination_address}
                        </td>
                        <td className="px-4 py-3 font-mono-num font-bold">{r.pin_code}</td>
                        <td className="px-4 py-3 text-right font-mono-num font-bold">
                          {formatBRL(r.final_fare ?? r.estimated_fare)}
                        </td>
                        <td className="px-4 py-3 font-bold">{r.status}</td>
                        <td className="px-4 py-3 text-right">
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

        {/* TAB 3: PRICING */}
        {tab === 'pricing' && (
          <section className="mt-5 max-w-3xl">
            <h2 className="font-display text-xl font-extrabold text-neutral-950">
              Tarifas Base, Valor por KM e Mínimo
            </h2>
            <p className="mt-1 text-xs text-neutral-600">
              Alterações aqui atualizam imediatamente a cotação exibida aos passageiros.
            </p>

            <form onSubmit={savePricing} className="mt-4 space-y-4">
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
                className="min-h-[48px] rounded-2xl bg-[#FFCC00] px-6 text-sm font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400]"
              >
                {savingPricing ? 'Salvando...' : 'Salvar Tarifas'}
              </button>
            </form>
          </section>
        )}

        {/* TAB 4: USERS */}
        {tab === 'users' && (
          <section className="mt-5 space-y-4">
            <h2 className="font-display text-xl font-extrabold text-neutral-950">
              Usuários Cadastrados
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-4 py-3 font-bold">Nome</th>
                    <th className="px-4 py-3 font-bold">Perfil</th>
                    <th className="px-4 py-3 font-bold">Telefone</th>
                    <th className="px-4 py-3 font-bold">E-mail</th>
                    <th className="px-4 py-3 font-bold">Nota</th>
                    <th className="px-4 py-3 font-bold text-right">Carteira</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-bold text-neutral-950">{u.full_name}</td>
                      <td className="px-4 py-3">{u.role}</td>
                      <td className="px-4 py-3 font-mono-num">{u.phone}</td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3 font-mono-num">{u.rating_avg.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono-num font-bold">
                        {formatBRL(u.wallet_balance)}
                      </td>
                      <td className="px-4 py-3 font-bold">{u.status}</td>
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
                Câmera no AndroidManifest e o workflow automático em{' '}
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
                    Tabelas, Storage Bucket (driver-documents), políticas RLS e Supabase Realtime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copySql}
                  className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-xs font-bold text-[#FFCC00]"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
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
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl bg-[#FFCC00] px-5 text-xs font-extrabold text-neutral-950"
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
