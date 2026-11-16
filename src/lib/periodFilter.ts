import type { PeriodFilter } from '../types/mobility';

export function isDateInPeriod(isoDate: string | null | undefined, period: PeriodFilter): boolean {
  if (period === 'all') return true;
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (period === 'day') {
    return d.getTime() >= startOfToday;
  }

  if (period === 'week') {
    const dayOfWeek = now.getDay(); // 0 = Sun
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diffToMonday
    ).getTime();
    return d.getTime() >= startOfWeek;
  }

  if (period === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return d.getTime() >= startOfMonth;
  }

  return true;
}

export function getPeriodRangeLabel(period: PeriodFilter): string {
  const now = new Date();
  if (period === 'day') {
    return `Hoje (${now.toLocaleDateString('pt-BR')})`;
  }
  if (period === 'week') {
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    return `Semana (${start.toLocaleDateString('pt-BR')} a ${now.toLocaleDateString('pt-BR')})`;
  }
  if (period === 'month') {
    return `Mês (${now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })})`;
  }
  return 'Todo o Histórico';
}
