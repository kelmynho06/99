import React from 'react';
import {
  Bell,
  CheckCheck,
  CreditCard,
  Flame,
  Gift,
  Receipt,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AppNotification,
  NotificationCategory,
  WalletTransaction,
} from '../types/mobility';

interface NotificationsModalProps {
  notifications: AppNotification[];
  loading?: boolean;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onOpenReceipt?: (tx: WalletTransaction) => void;
  onOpenEvents?: () => void;
  onClose: () => void;
}

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeClass: string }
> = {
  wallet: {
    label: '66 Pay',
    icon: Wallet,
    badgeClass: 'bg-[#FFD100]/20 text-amber-900 dark:text-[#FFD100] border-[#FFD100]/40',
  },
  coupon: {
    label: 'Cupom',
    icon: Gift,
    badgeClass: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  },
  event: {
    label: 'Evento',
    icon: Flame,
    badgeClass: 'bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800',
  },
  payment: {
    label: 'Pagamento',
    icon: CreditCard,
    badgeClass: 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-800',
  },
  general: {
    label: 'Aviso',
    icon: Bell,
    badgeClass: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700',
  },
};

function extractReceiptTx(notif: AppNotification): WalletTransaction | null {
  const raw = notif.metadata?.tx as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    user_id: String(raw.user_id || notif.target_user_id || ''),
    amount: Number(raw.amount ?? 0),
    type: (raw.type as WalletTransaction['type']) || 'transfer_in',
    description: String(raw.description || notif.message),
    created_at: String(raw.created_at || notif.created_at),
  };
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  notifications,
  loading = false,
  onMarkRead,
  onMarkAllRead,
  onOpenReceipt,
  onOpenEvents,
  onClose,
}) => {
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleTapNotification = (notif: AppNotification) => {
    if (!notif.is_read) {
      onMarkRead(notif.id);
    }
    const tx = extractReceiptTx(notif);
    if (tx && onOpenReceipt) {
      onOpenReceipt(tx);
      return;
    }
    if ((notif.category === 'event' || notif.action_tab === 'events') && onOpenEvents) {
      onClose();
      onOpenEvents();
    }
  };

  return (
    <div className="fixed inset-0 z-[1260] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-4">
      <div className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950 shadow-2xs">
              <Bell className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-display text-base font-extrabold text-neutral-950 dark:text-white">
                Notificações
              </h3>
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                {unreadCount > 0
                  ? `${unreadCount} não lida(s)`
                  : 'Tudo atualizado por aqui'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="flex min-h-[38px] items-center gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2.5 text-[11px] font-extrabold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition whitespace-nowrap"
              >
                <CheckCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Ler todas</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading && notifications.length === 0 ? (
            <div className="py-12 text-center text-xs font-semibold text-neutral-500">
              Carregando notificações...
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 p-8 text-center space-y-2">
              <Bell className="mx-auto h-8 w-8 text-neutral-400" />
              <p className="text-sm font-extrabold text-neutral-900 dark:text-white">
                Nenhuma notificação ainda
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Avisos da plataforma, transferências 66 Pay, eventos e cupons aparecerão aqui.
              </p>
            </div>
          ) : (
            notifications.map((notif) => {
              const meta = CATEGORY_META[notif.category] || CATEGORY_META.general;
              const Icon = meta.icon;
              const receiptTx = extractReceiptTx(notif);
              const isEvent = notif.category === 'event' || notif.action_tab === 'events';
              return (
                <button
                  key={notif.id}
                  type="button"
                  onClick={() => handleTapNotification(notif)}
                  className={`w-full rounded-2xl border p-3.5 text-left transition active:scale-[0.99] ${
                    notif.is_read
                      ? 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
                      : 'border-[#FFD100] bg-[#FFD100]/10 dark:bg-[#FFD100]/10 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-extrabold ${meta.badgeClass}`}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono-num text-[10px] font-semibold text-neutral-400">
                        {new Date(notif.created_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {!notif.is_read && (
                        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-extrabold text-neutral-950 dark:text-white">
                    {notif.title}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    {notif.message}
                  </p>
                  {receiptTx && onOpenReceipt && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-xl bg-neutral-950 dark:bg-[#FFD100] px-2.5 py-1 text-[11px] font-extrabold text-[#FFD100] dark:text-neutral-950">
                      <Receipt className="h-3.5 w-3.5" />
                      Ver Comprovante 66 Pay
                    </span>
                  )}
                  {!receiptTx && isEvent && onOpenEvents && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-xl bg-orange-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
                      <Flame className="h-3.5 w-3.5" />
                      Abrir Eventos
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
