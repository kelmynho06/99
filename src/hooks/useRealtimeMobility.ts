import { useCallback, useEffect, useRef, useState } from 'react';
import { initLocalNotifications, triggerLocalNotification } from '../lib/capacitorDevice';
import {
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRICING_LIST,
  fetchEnrichedRides,
  fetchOnlineDriversPublic,
  fetchPlatformConfig,
  fetchPlatformEvents,
  fetchPricingList,
  fetchRideByIdEnriched,
  fetchRideMessages,
  fetchUserProfileById,
  pushDriverLocation,
  rideMatchesDriverVehicle,
} from '../lib/mobilityApi';
import { formatBRL } from '../lib/geo';
import { speakPtBr, syncPlatformSounds } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
  PlatformEvent,
  PricingSetting,
  Ride,
  RideMessage,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';

export function useRealtimeMobility(
  currentUser: UserProfile | null,
  onCurrentUserUpdated: (user: UserProfile) => void
) {
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);
  const [platformEvents, setPlatformEvents] = useState<PlatformEvent[]>([]);
  const RIDES_CACHE_PREFIX = 'velo99_cached_rides_';
  const [rides, setRides] = useState<Ride[]>(() => {
    if (!currentUser?.id) return [];
    try {
      const raw = localStorage.getItem(`${RIDES_CACHE_PREFIX}${currentUser.id}`);
      return raw ? (JSON.parse(raw) as Ride[]) : [];
    } catch {
      return [];
    }
  });
  const [pricing, setPricing] = useState<PricingSetting[]>(DEFAULT_PRICING_LIST);
  const [onlineDrivers, setOnlineDrivers] = useState<UserProfile[]>([]);
  const [messagesByRide, setMessagesByRide] = useState<Record<string, RideMessage[]>>({});

  const userRef = useRef<UserProfile | null>(currentUser);
  userRef.current = currentUser;

  const ridesRef = useRef<Ride[]>([]);
  ridesRef.current = rides;

  useEffect(() => {
    if (!currentUser?.id) return;
    try {
      localStorage.setItem(`${RIDES_CACHE_PREFIX}${currentUser.id}`, JSON.stringify(rides.slice(0, 30)));
    } catch {
      // Ignore storage quota restrictions
    }
  }, [currentUser?.id, rides]);

  useEffect(() => {
    syncPlatformSounds(platformConfig);
  }, [platformConfig]);

  const upsertRide = useCallback((ride: Ride) => {
    setRides((prev) => {
      const idx = prev.findIndex((r) => r.id === ride.id);
      if (idx === -1) return [ride, ...prev];
      const next = [...prev];
      next[idx] = ride;
      return next;
    });
  }, []);

  const appendMessage = useCallback((msg: RideMessage) => {
    setMessagesByRide((prev) => {
      const existing = prev[msg.ride_id] || [];
      if (existing.some((m) => m.id === msg.id)) return prev;
      return {
        ...prev,
        [msg.ride_id]: [...existing, msg],
      };
    });
  }, []);

  const loadRideMessages = useCallback(async (rideId: string) => {
    try {
      const msgs = await fetchRideMessages(rideId);
      setMessagesByRide((prev) => ({ ...prev, [rideId]: msgs }));
    } catch {
      // Ignore network hiccup
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    try {
      const [cfg, evs, pr, rd, drvs] = await Promise.all([
        fetchPlatformConfig(),
        fetchPlatformEvents(),
        fetchPricingList(),
        userRef.current ? fetchEnrichedRides() : Promise.resolve([]),
        fetchOnlineDriversPublic(),
      ]);
      setPlatformConfig(cfg);
      syncPlatformSounds(cfg);
      setPlatformEvents(evs);
      setPricing(pr);
      if (userRef.current && (rd.length > 0 || navigator.onLine !== false)) {
        setRides((prev) => (rd.length === 0 && prev.some((r) => ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status)) && navigator.onLine === false ? prev : rd));
      }
      setOnlineDrivers(drvs);
    } catch {
      // Ignore transient network hiccup
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      initLocalNotifications().catch(() => {});
    }
  }, [currentUser?.id]);

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      if (!active) return;
      await refreshAll();
    };
    loadInitial();

    // Realtime subscriptions via Supabase + Capacitor LocalNotifications
    const channel = supabase
      .channel('velo99-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as {
            id?: string;
            status?: string;
            payment_status?: string;
            passenger_id?: string;
            driver_id?: string | null;
            origin_address?: string;
            destination_address?: string;
          } | undefined;
          const oldRow = payload.old as { status?: string; payment_status?: string } | undefined;

          if (row?.id) {
            const prevLocal = ridesRef.current.find((r) => r.id === row.id);
            const prevStatus = oldRow?.status ?? prevLocal?.status;
            const prevPayStatus = oldRow?.payment_status ?? prevLocal?.payment_status;
            const enriched = await fetchRideByIdEnriched(row.id);
            if (enriched && active) {
              upsertRide(enriched);
              const u = userRef.current;
              if (u) {
                const isDelivery =
                  enriched.category === 'delivery_moto' || enriched.category === 'delivery_car';

                // Driver / Motoboy online receives single deduped local notification (+ voice if minimized) ONLY when ride matches active vehicle
                if (
                  u.role === 'driver' &&
                  u.status === 'active' &&
                  u.driver?.is_online &&
                  payload.eventType === 'INSERT' &&
                  enriched.status === 'searching' &&
                  rideMatchesDriverVehicle(enriched.category, u.driver.vehicle_type)
                ) {
                  const fareVoice = Number(enriched.estimated_fare || 0).toFixed(2).replace('.', ',');
                  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                    speakPtBr(
                      isDelivery
                        ? `Você está recebendo uma solicitação de uma entrega. Valor de ${fareVoice} reais. Coleta em ${enriched.origin_address}.`
                        : `Você está recebendo uma solicitação de uma corrida. Valor de ${fareVoice} reais. Embarque em ${enriched.origin_address}.`
                    );
                  }
                  triggerLocalNotification({
                    dedupeKey: `ride-offer-${enriched.id}`,
                    title: isDelivery ? 'Nova Entrega Disponível!' : 'Nova Corrida Disponível!',
                    body: `${formatBRL(enriched.estimated_fare)} · ${enriched.origin_address} → ${enriched.destination_address}`,
                    playSound: false,
                  });
                }

                // Driver receives voice confirmation when Admin approves Pix
                if (
                  u.role === 'driver' &&
                  enriched.driver_id === u.id &&
                  prevPayStatus !== 'paid_pix' &&
                  enriched.payment_status === 'paid_pix'
                ) {
                  speakPtBr('Pagamento Pix confirmado pelo administrador. Corrida liberada.');
                  triggerLocalNotification({
                    dedupeKey: `ride-${enriched.id}-paid-pix`,
                    title: 'Pix Confirmado pelo Admin!',
                    body: 'Saldo creditado e tela liberada para sua próxima corrida.',
                    playSound: false,
                  });
                }

                // Passenger receives PT-BR voice + single deduped local notification on status changes
                if (u.role === 'passenger' && enriched.passenger_id === u.id && prevStatus !== enriched.status) {
                  const driverDisplayName =
                    enriched.driver?.full_name?.trim() || 'seu parceiro';
                  if (enriched.status === 'accepted') {
                    speakPtBr(
                      isDelivery
                        ? `O entregador ${driverDisplayName} aceitou a sua entrega.`
                        : `O motorista ${driverDisplayName} aceitou a sua corrida.`
                    );
                    triggerLocalNotification({
                      dedupeKey: `ride-${enriched.id}-accepted`,
                      title: isDelivery ? 'Entregador aceitou seu pedido!' : 'Motorista aceitou sua corrida!',
                      body: `${driverDisplayName} está indo até você.`,
                      playSound: false,
                    });
                  } else if (enriched.status === 'arrived') {
                    const pinSpeech =
                      !isDelivery || enriched.require_pin !== false
                        ? ` Informe o código PIN ${enriched.pin_code.split('').join(' ')}.`
                        : '';
                    speakPtBr(
                      isDelivery
                        ? `O entregador ${driverDisplayName} chegou no local de coleta.${pinSpeech}`
                        : `O motorista ${driverDisplayName} chegou no local de embarque.${pinSpeech}`
                    );
                    triggerLocalNotification({
                      dedupeKey: `ride-${enriched.id}-arrived`,
                      title: isDelivery ? 'Entregador chegou para a coleta!' : 'Seu motorista chegou!',
                      body:
                        !isDelivery || enriched.require_pin !== false
                          ? `Informe o código PIN ${enriched.pin_code} ao encontrar ${driverDisplayName}.`
                          : `Encontre ${driverDisplayName} no ponto combinado.`,
                      playSound: false,
                    });
                  } else if (enriched.status === 'in_progress') {
                    speakPtBr(
                      isDelivery
                        ? 'Pacote coletado e em rota de entrega.'
                        : 'Corrida iniciada. Bom trajeto.'
                    );
                    triggerLocalNotification({
                      dedupeKey: `ride-${enriched.id}-in_progress`,
                      title: isDelivery ? 'Pacote em rota de entrega!' : 'Viagem iniciada!',
                      body: `Destino: ${enriched.destination_address}`,
                      playSound: false,
                    });
                  } else if (enriched.status === 'completed') {
                    const needs66PayQr =
                      enriched.payment_method === 'wallet' && enriched.payment_status === 'pending';
                    const isMoto = enriched.category === 'moto' || enriched.category === 'delivery_moto';
                    const exitVehicleSpeech = isMoto
                      ? 'Lembre-se de pegar o seu celular e objetos pessoais antes de sair da moto.'
                      : 'Lembre-se de pegar o seu celular e objetos pessoais antes de sair do carro.';
                    speakPtBr(
                      needs66PayQr
                        ? isDelivery
                          ? `Entrega finalizada. Escaneie o QR Code BorealPay na tela de ${driverDisplayName} para concluir o pagamento.`
                          : `Você está chegando ao seu destino. ${exitVehicleSpeech} Escaneie o QR Code BorealPay na tela de ${driverDisplayName} para concluir o pagamento.`
                        : isDelivery
                        ? 'Entrega concluída com sucesso.'
                        : `Você está chegando ao seu destino. ${exitVehicleSpeech}`
                    );
                    triggerLocalNotification({
                      dedupeKey: `ride-${enriched.id}-completed`,
                      title: isDelivery ? 'Entrega concluída!' : 'Você chegou ao destino!',
                      body: needs66PayQr
                        ? `Leia o QR Code BorealPay de ${driverDisplayName} para liberar o pagamento.`
                        : isDelivery
                        ? 'Avalie o entregador no aplicativo.'
                        : 'Não esqueça seus objetos pessoais no veículo.',
                      playSound: false,
                    });
                  } else if (enriched.status === 'cancelled') {
                    speakPtBr(
                      isDelivery ? 'Sua entrega foi cancelada.' : 'Sua corrida foi cancelada.'
                    );
                    triggerLocalNotification({
                      dedupeKey: `ride-${enriched.id}-cancelled`,
                      title: isDelivery ? 'Entrega cancelada' : 'Corrida cancelada',
                      body: 'A solicitação foi encerrada.',
                      playSound: false,
                    });
                  }
                }

                // Driver receives immediate voice + single deduped alert if passenger cancels before boarding
                if (
                  u.role === 'driver' &&
                  enriched.driver_id === u.id &&
                  prevStatus !== 'cancelled' &&
                  enriched.status === 'cancelled'
                ) {
                  const passengerFirstName =
                    enriched.passenger?.full_name?.split(' ')[0] || 'cliente';
                  speakPtBr(
                    isDelivery
                      ? `O cliente ${passengerFirstName} cancelou a entrega.`
                      : `O passageiro ${passengerFirstName} cancelou a corrida.`
                  );
                  triggerLocalNotification({
                    dedupeKey: `driver-ride-${enriched.id}-cancelled`,
                    title: isDelivery ? 'Entrega cancelada pelo cliente' : 'Corrida cancelada',
                    body: `${enriched.passenger?.full_name || 'Cliente'} cancelou antes do embarque.`,
                    playSound: false,
                  });
                }
              }
            }
          } else {
            const list = await fetchEnrichedRides();
            if (active) setRides(list);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_profiles' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as {
            user_id?: string;
            current_lat?: number | null;
            current_lng?: number | null;
            heading?: number;
            is_online?: boolean;
          };

          if (row?.user_id && typeof row.current_lat === 'number' && typeof row.current_lng === 'number') {
            setRides((prev) =>
              prev.map((r) =>
                r.driver_id === row.user_id && r.driver?.driver
                  ? {
                      ...r,
                      driver: {
                        ...r.driver,
                        driver: {
                          ...r.driver.driver,
                          current_lat: row.current_lat ?? null,
                          current_lng: row.current_lng ?? null,
                          heading: Number(row.heading ?? 0),
                          is_online: Boolean(row.is_online),
                        },
                      },
                    }
                  : r
              )
            );
          }

          if (userRef.current?.id && row?.user_id === userRef.current.id) {
            const refreshed = await fetchUserProfileById(userRef.current.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);
          }

          const drvs = await fetchOnlineDriversPublic();
          if (active) setOnlineDrivers(drvs);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as { id?: string } | undefined;
          if (userRef.current?.id && row?.id === userRef.current.id) {
            const refreshed = await fetchUserProfileById(userRef.current.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'platform_settings' },
        async () => {
          if (!active) return;
          const cfg = await fetchPlatformConfig();
          if (active) setPlatformConfig(cfg);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'configuracoes_app' },
        async () => {
          if (!active) return;
          const cfg = await fetchPlatformConfig();
          if (active) setPlatformConfig(cfg);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'platform_events' },
        async (payload) => {
          if (!active) return;
          const evs = await fetchPlatformEvents();
          if (active) setPlatformEvents(evs);

          const inserted = payload.new as { id?: string; title?: string; description?: string; active?: boolean } | undefined;
          if (
            payload.eventType === 'INSERT' &&
            inserted?.active &&
            userRef.current?.role === 'driver'
          ) {
            triggerLocalNotification({
              dedupeKey: `event-${inserted.id || inserted.title || 'active'}`,
              title: `Novo Evento: ${inserted.title || 'Campanha Ativa'}`,
              body: inserted.description || 'Confira os bônus disponíveis no seu painel.',
              playSound: false,
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pricing_settings' },
        async () => {
          if (!active) return;
          const pr = await fetchPricingList();
          if (active) setPricing(pr);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ride_messages' },
        (payload) => {
          if (!active) return;
          const m = payload.new as Record<string, unknown>;
          if (m?.id && m?.ride_id) {
            const msgObj: RideMessage = {
              id: String(m.id),
              ride_id: String(m.ride_id),
              sender_id: String(m.sender_id),
              sender_name: String(m.sender_name),
              content: String(m.content),
              created_at: String(m.created_at),
            };
            appendMessage(msgObj);
            if (userRef.current && msgObj.sender_id !== userRef.current.id) {
              speakPtBr(`Mensagem de ${msgObj.sender_name}: ${msgObj.content}`, false);
              triggerLocalNotification({
                dedupeKey: `ride-msg-${msgObj.id}`,
                title: `Mensagem de ${msgObj.sender_name}`,
                body: msgObj.content,
                playSound: false,
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_deposits' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as { id?: string; user_id?: string; status?: string; amount?: number } | undefined;
          const oldRow = payload.old as { status?: string } | undefined;
          const u = userRef.current;
          if (u && row?.user_id === u.id) {
            const refreshed = await fetchUserProfileById(u.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);
            if (row.status === 'approved' && oldRow?.status !== 'approved') {
              const amountNum = Number(row.amount || 0).toFixed(2).replace('.', ',');
              speakPtBr(`Depósito de ${amountNum} reais confirmado na sua carteira.`);
              triggerLocalNotification({
                dedupeKey: `deposit-approved-${row.id || amountNum}`,
                title: 'Saldo Creditado!',
                body: `Seu depósito Pix de R$ ${amountNum} foi confirmado pelo Administrador.`,
                playSound: false,
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wallet_transactions' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as {
            id?: string;
            user_id?: string;
            type?: string;
            amount?: number;
            description?: string;
            created_at?: string;
          } | undefined;
          const u = userRef.current;
          if (u && row?.user_id === u.id) {
            const refreshed = await fetchUserProfileById(u.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);

            const txType = String(row.type || '');
            const absAmt = Math.abs(Number(row.amount || 0));
            const formattedAmt = formatBRL(absAmt);
            const desc = String(row.description || '');
            const receiptTx: WalletTransaction | undefined = row.id
              ? {
                  id: String(row.id),
                  user_id: String(row.user_id),
                  amount: Number(row.amount || 0),
                  type: (txType as WalletTransaction['type']) || 'transfer_in',
                  description: desc,
                  created_at: String(row.created_at || new Date().toISOString()),
                }
              : undefined;

            if (txType === 'transfer_in' && absAmt > 0) {
              const senderMatch = desc.match(/(?:Recebido de|Transferência (?:66 Pay|BorealPay) recebida de)\s+([^·]+)/i);
              const senderName = senderMatch?.[1]?.trim() || 'Um usuário BorealPay';
              const msg = `${senderName} enviou uma transferência de ${formattedAmt} para você.`;
              speakPtBr(
                `${senderName} enviou uma transferência de ${absAmt.toFixed(2).replace('.', ',')} reais para você.`
              );
              triggerLocalNotification({
                dedupeKey: `tx-in-${row.id || absAmt}`,
                title: 'Transferência BorealPay Recebida!',
                body: msg,
                playSound: false,
              });
              window.dispatchEvent(
                new CustomEvent('mobilidade66:wallet-toast', {
                  detail: {
                    title: 'BorealPay · Transferência Recebida!',
                    message: msg,
                    receiptTx,
                  },
                })
              );
            } else if (txType === 'transfer_out' && absAmt > 0) {
              const recipientMatch = desc.match(/(?:Enviado para|Transferência (?:66 Pay|BorealPay) enviada para)\s+([^·]+)/i);
              const recipientName = recipientMatch?.[1]?.trim() || '';
              const msg = recipientName
                ? `Você enviou uma transferência de ${formattedAmt} para ${recipientName}.`
                : `Transferência de ${formattedAmt} enviada com sucesso.`;
              triggerLocalNotification({
                dedupeKey: `tx-out-${row.id || absAmt}`,
                title: 'Transferência BorealPay Enviada!',
                body: msg,
                playSound: false,
              });
              window.dispatchEvent(
                new CustomEvent('mobilidade66:wallet-toast', {
                  detail: {
                    title: 'BorealPay · Transferência Enviada!',
                    message: msg,
                    receiptTx,
                  },
                })
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_notifications' },
        (payload) => {
          if (!active) return;
          const n = payload.new as {
            id?: string;
            title?: string;
            message?: string;
            category?: string;
            target_scope?: string;
            target_user_id?: string | null;
            metadata?: { source?: string; tx?: WalletTransaction } | null;
          } | undefined;
          const u = userRef.current;
          if (!u || !n?.id) return;

          const scope = String(n.target_scope || 'all');
          const appliesToMe =
            scope === 'all' ||
            (scope === 'user' && n.target_user_id === u.id) ||
            (scope === 'passengers' && u.role === 'passenger') ||
            (scope === 'drivers' && u.role === 'driver');

          if (!appliesToMe) return;

          window.dispatchEvent(new CustomEvent('mobilidade66:notifications-updated'));

          if (n.metadata?.source !== 'p2p_transfer') {
            if (n.title || n.message) {
              speakPtBr(`${n.title || 'Aviso'}. ${n.message || ''}`, false);
            }
            triggerLocalNotification({
              dedupeKey: `app-notif-${n.id}`,
              title: n.title || 'Nova Notificação',
              body: n.message || '',
              playSound: false,
            });
            window.dispatchEvent(
              new CustomEvent('mobilidade66:wallet-toast', {
                detail: {
                  title: n.title || 'Notificação Boreal Mobilidade',
                  message: n.message || '',
                  receiptTx: n.metadata?.tx,
                },
              })
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_coupons' },
        (payload) => {
          if (!active) return;
          const row = payload.new as { user_id?: string } | undefined;
          const u = userRef.current;
          if (!u || !row?.user_id || row.user_id === u.id) {
            window.dispatchEvent(new CustomEvent('mobilidade66:coupons-updated'));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'coupons' },
        () => {
          if (!active) return;
          window.dispatchEvent(new CustomEvent('mobilidade66:coupons-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          if (!active) return;
          const m = payload.new as Record<string, unknown>;
          const u = userRef.current;
          if (!u || !m?.sender_id || String(m.sender_id) === u.id) return;
          if (u.role === 'admin' || String(m.user_id) === u.id) {
            speakPtBr(`Nova mensagem de suporte: ${String(m.content || '')}`, false);
            triggerLocalNotification({
              dedupeKey: `direct-msg-${String(m.id || m.created_at || Date.now())}`,
              title:
                String(m.sender_role) === 'admin'
                  ? 'Mensagem da Administração'
                  : `Suporte: ${String(m.sender_name || 'Usuário')}`,
              body: String(m.content || ''),
              playSound: false,
            });
          }
        }
      )
      .subscribe();

    // Gentle mobile-network backup poll every 8s when logged in & online
    const poll = setInterval(() => {
      if (active && userRef.current && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        fetchEnrichedRides()
          .then((rd) => {
            if (!active) return;
            if (rd.length > 0 || navigator.onLine !== false) {
              setRides(rd);
            }
          })
          .catch(() => {});
        fetchOnlineDriversPublic().then((d) => active && setOnlineDrivers(d)).catch(() => {});
      }
    }, 8000);

    return () => {
      active = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [appendMessage, currentUser?.id, onCurrentUserUpdated, refreshAll, upsertRide]);

  const emitDriverLocation = useCallback(
    (userId: string, lat: number, lng: number, heading = 0) => {
      pushDriverLocation(userId, lat, lng, heading).catch(() => {});
    },
    []
  );

  return {
    platformConfig,
    platformEvents,
    rides,
    pricing,
    onlineDrivers,
    messagesByRide,
    upsertRide,
    appendMessage,
    loadRideMessages,
    emitDriverLocation,
    refreshAll,
  };
}
