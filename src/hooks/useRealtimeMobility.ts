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
} from '../lib/mobilityApi';
import { playSoundCue, speakPtBr, syncPlatformSounds } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
  PlatformEvent,
  PricingSetting,
  Ride,
  RideMessage,
  UserProfile,
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

                // Driver / Motoboy online receives immediate local notification for new ride/delivery
                if (
                  u.role === 'driver' &&
                  u.status === 'active' &&
                  u.driver?.is_online &&
                  payload.eventType === 'INSERT' &&
                  enriched.status === 'searching'
                ) {
                  triggerLocalNotification({
                    title: isDelivery ? 'Nova Entrega Disponível!' : 'Nova Corrida Disponível!',
                    body: `${enriched.origin_address} → ${enriched.destination_address}`,
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
                  void playSoundCue('accepted');
                  speakPtBr('Pagamento Pix confirmado pelo administrador. Corrida liberada.');
                  triggerLocalNotification({
                    title: 'Pix Confirmado pelo Admin!',
                    body: 'Saldo creditado e tela liberada para sua próxima corrida.',
                    playSound: false,
                  });
                }

                // Passenger receives immediate sound + PT-BR voice + local notification on status changes
                if (u.role === 'passenger' && enriched.passenger_id === u.id && prevStatus !== enriched.status) {
                  const driverFirstName = enriched.driver?.full_name?.split(' ')[0] || 'seu parceiro';
                  if (enriched.status === 'accepted') {
                    void playSoundCue('accepted');
                    speakPtBr(
                      isDelivery
                        ? `O entregador ${driverFirstName} aceitou seu pedido e está a caminho da coleta.`
                        : `O motorista ${driverFirstName} aceitou sua corrida e está a caminho.`
                    );
                    triggerLocalNotification({
                      title: isDelivery ? 'Entregador aceitou seu pedido!' : 'Motorista a caminho!',
                      body: `${enriched.driver?.full_name || 'Parceiro'} está indo até você.`,
                      playSound: false,
                    });
                  } else if (enriched.status === 'arrived') {
                    void playSoundCue('arrived');
                    const pinSpeech =
                      !isDelivery || enriched.require_pin !== false
                        ? ` Informe o código PIN ${enriched.pin_code.split('').join(' ')}.`
                        : '';
                    speakPtBr(
                      isDelivery
                        ? `O entregador chegou no local de coleta.${pinSpeech}`
                        : `Seu motorista chegou no ponto de embarque.${pinSpeech}`
                    );
                    triggerLocalNotification({
                      title: isDelivery ? 'Entregador chegou para a coleta!' : 'Seu motorista chegou!',
                      body:
                        !isDelivery || enriched.require_pin !== false
                          ? `Informe o código PIN ${enriched.pin_code} ao encontrar.`
                          : 'Encontre seu entregador no ponto combinado.',
                      playSound: false,
                    });
                  } else if (enriched.status === 'in_progress') {
                    speakPtBr(
                      isDelivery
                        ? 'Pacote coletado e em rota de entrega.'
                        : 'Viagem iniciada. Bom trajeto.'
                    );
                    triggerLocalNotification({
                      title: isDelivery ? 'Pacote em rota de entrega!' : 'Viagem iniciada!',
                      body: `Destino: ${enriched.destination_address}`,
                      playSound: false,
                    });
                  } else if (enriched.status === 'completed') {
                    void playSoundCue('completed');
                    speakPtBr(
                      isDelivery
                        ? 'Entrega concluída com sucesso.'
                        : 'Você chegou ao seu destino. Obrigado por viajar conosco.'
                    );
                    triggerLocalNotification({
                      title: isDelivery ? 'Entrega concluída!' : 'Você chegou ao destino!',
                      body: 'Avalie a experiência no aplicativo.',
                      playSound: false,
                    });
                  } else if (enriched.status === 'cancelled') {
                    void playSoundCue('cancel');
                    triggerLocalNotification({
                      title: isDelivery ? 'Entrega cancelada' : 'Corrida cancelada',
                      body: 'A solicitação foi encerrada.',
                      playSound: false,
                    });
                  }
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

          const inserted = payload.new as { title?: string; description?: string; active?: boolean } | undefined;
          if (
            payload.eventType === 'INSERT' &&
            inserted?.active &&
            userRef.current?.role === 'driver'
          ) {
            triggerLocalNotification({
              title: `Novo Evento: ${inserted.title || 'Campanha Ativa'}`,
              body: inserted.description || 'Confira os bônus disponíveis no seu painel.',
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
              void playSoundCue('chat');
              triggerLocalNotification({
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
          const row = payload.new as { user_id?: string; status?: string; amount?: number } | undefined;
          const oldRow = payload.old as { status?: string } | undefined;
          const u = userRef.current;
          if (u && row?.user_id === u.id) {
            const refreshed = await fetchUserProfileById(u.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);
            if (row.status === 'approved' && oldRow?.status !== 'approved') {
              void playSoundCue('accepted');
              const amountNum = Number(row.amount || 0).toFixed(2).replace('.', ',');
              speakPtBr(`Depósito de ${amountNum} reais confirmado na sua carteira.`);
              triggerLocalNotification({
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
          const row = payload.new as { user_id?: string } | undefined;
          const u = userRef.current;
          if (u && row?.user_id === u.id) {
            const refreshed = await fetchUserProfileById(u.id);
            if (refreshed && active) onCurrentUserUpdated(refreshed);
          }
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
            void playSoundCue('chat');
            triggerLocalNotification({
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
