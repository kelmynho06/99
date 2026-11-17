import React, { useMemo, useState } from 'react';
import {
  Activity,
  Download,
  Monitor,
  Printer,
  RefreshCw,
  Search,
  Smartphone,
} from 'lucide-react';
import type { AuditLogEntry, PlatformConfig } from '../types/mobility';

interface AdminAuditTabProps {
  logs: AuditLogEntry[];
  loading?: boolean;
  platformConfig: PlatformConfig;
  suppressPrintSheet?: boolean;
  onRefresh: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  passenger: 'Cliente',
  driver: 'Motorista / Entregador',
  admin: 'Super Admin',
};

export const AdminAuditTab: React.FC<AdminAuditTabProps> = ({
  logs,
  loading = false,
  platformConfig,
  suppressPrintSheet = false,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'passenger' | 'driver' | 'admin'>('all');
  const [deviceFilter, setDeviceFilter] = useState<string>('all');

  const deviceTypes = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.device_type) set.add(l.device_type);
    });
    return Array.from(set);
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (roleFilter !== 'all' && l.user_role !== roleFilter) return false;
      if (deviceFilter !== 'all' && l.device_type !== deviceFilter) return false;
      if (!q) return true;
      return (
        l.user_name.toLowerCase().includes(q) ||
        l.user_email.toLowerCase().includes(q) ||
        l.event_type.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.device_type.toLowerCase().includes(q) ||
        l.os_name.toLowerCase().includes(q) ||
        l.browser_name.toLowerCase().includes(q)
      );
    });
  }, [logs, search, roleFilter, deviceFilter]);

  const handleExportCsv = () => {
    const header = [
      'Data/Hora',
      'Usuario',
      'Email',
      'Perfil',
      'Evento',
      'Descricao',
      'Plataforma',
      'Sistema Operacional',
      'Navegador/WebView',
      'Resolucao',
      'Idioma',
      'Fuso Horario',
      'Versao App',
    ];
    const escapeCsv = (val: string) => `"${String(val || '').replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((l) =>
      [
        new Date(l.created_at).toLocaleString('pt-BR'),
        l.user_name,
        l.user_email,
        ROLE_LABELS[l.user_role] || l.user_role,
        l.event_type,
        l.description,
        l.device_type,
        `${l.os_name} ${l.os_version}`.trim(),
        `${l.browser_name} ${l.browser_version}`.trim(),
        l.screen_size,
        l.language,
        l.timezone,
        `v${l.app_version}`,
      ]
        .map(escapeCsv)
        .join(';')
    );
    const csvContent = '\uFEFF' + [header.map(escapeCsv).join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria_${(platformConfig.site_name || '66mobilidade').toLowerCase().replace(/\s+/g, '')}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className={`mt-5 space-y-4 ${suppressPrintSheet ? 'no-print' : 'print-only-sheet'}`}>
      {/* Header & Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-neutral-950 dark:text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-600" />
            <span>Auditoria &amp; Telemetria de Dispositivos ({filteredLogs.length})</span>
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            Rastreamento de logins, ações críticas, Android APK / PWA / Web, sistema operacional,
            navegador, tela e fuso horário.
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-bold text-neutral-800 dark:text-neutral-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 text-xs font-extrabold text-emerald-800 dark:text-emerald-300"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-neutral-950 dark:bg-[#FFD100] px-3.5 text-xs font-extrabold text-[#FFD100] dark:text-neutral-950"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-12 gap-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5">
        <div className="sm:col-span-6 relative">
          <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuário, e-mail, evento, OS, navegador..."
            className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-9 pr-3 text-xs outline-none focus:border-neutral-950"
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(e.target.value as 'all' | 'passenger' | 'driver' | 'admin')
            }
            className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 text-xs font-bold outline-none"
          >
            <option value="all">Todos os Perfis</option>
            <option value="passenger">Passageiros / Clientes</option>
            <option value="driver">Motoristas / Entregadores</option>
            <option value="admin">Super Admin</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            className="min-h-[40px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 text-xs font-bold outline-none"
          >
            <option value="all">Todas as Plataformas</option>
            {deviceTypes.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Audit Logs Table */}
      {filteredLogs.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center text-xs text-neutral-500">
          Nenhum registro de auditoria encontrado neste filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
              <tr>
                <th className="px-4 py-3 font-bold">Data/Hora</th>
                <th className="px-4 py-3 font-bold">Usuário / Perfil</th>
                <th className="px-4 py-3 font-bold">Evento / Descrição</th>
                <th className="px-4 py-3 font-bold">Plataforma</th>
                <th className="px-4 py-3 font-bold">Sistema Operacional</th>
                <th className="px-4 py-3 font-bold">Navegador / WebView</th>
                <th className="px-4 py-3 font-bold">Tela / Idioma / App</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filteredLogs.map((l) => {
                const isApk = l.device_type.includes('APK');
                return (
                  <tr key={l.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-mono-num whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                      {new Date(l.created_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-neutral-950 dark:text-white">{l.user_name}</p>
                      <p className="text-[11px] text-neutral-500">
                        {ROLE_LABELS[l.user_role] || l.user_role} · {l.user_email}
                      </p>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <span className="inline-block rounded-md bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-neutral-800 dark:text-neutral-200 mr-1.5">
                        {l.event_type}
                      </span>
                      <span className="text-neutral-800 dark:text-neutral-200">
                        {l.description}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold border ${
                          isApk
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        {isApk ? (
                          <Smartphone className="h-3 w-3" />
                        ) : (
                          <Monitor className="h-3 w-3" />
                        )}
                        {l.device_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono-num whitespace-nowrap">
                      {l.os_name} {l.os_version}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {l.browser_name} {l.browser_version}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[11px] text-neutral-600 dark:text-neutral-400">
                      <p>
                        {l.screen_size} · {l.language} · v{l.app_version}
                      </p>
                      {l.timezone && <p className="text-[10px] opacity-75">{l.timezone}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
