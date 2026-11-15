import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRICING_LIST,
  fetchEnrichedRides,
  fetchOnlineDriversPublic,
  fetchPlatformConfig,
  fetchPricingList,
  fetchRideByIdEnriched,
  fetchRideMessages,
  fetchUserProfileById,
  pushDriverLocation,
} from '../lib/mobilityApi';
import { supabase } from '../lib/supabase';
import type {
  PlatformConfig,
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
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>(DEFAULT_PRICING_LIST);
  const [onlineDrivers, setOnlineDrivers] = useState<UserProfile[]>([]);
  const [messagesByRide, setMessagesByRide] = useState<Record<string, RideMessage[]>>({});

  const userRef = useRef<UserProfile | null>(currentUser);
  userRef.current = currentUser;

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
    try {
      const [cfg, pr, rd, drvs] = await Promise.all([
        fetchPlatformConfig(),
        fetchPricingList(),
        userRef.current ? fetchEnrichedRides() : Promise.resolve([]),
        fetchOnlineDriversPublic(),
      ]);
      setPlatformConfig(cfg);
      setPricing(pr);
      if (userRef.current) setRides(rd);
      setOnlineDrivers(drvs);
    } catch {
      // Ignore transient network hiccup
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      if (!active) return;
      await refreshAll();
    };
    loadInitial();

    // Realtime subscriptions via Supabase
    const channel = supabase
      .channel('velo99-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        async (payload) => {
          if (!active) return;
          const row = payload.new as { id?: string } | undefined;
          if (row?.id) {
            const enriched = await fetchRideByIdEnriched(row.id);
            if (enriched && active) upsertRide(enriched);
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
            appendMessage({
              id: String(m.id),
              ride_id: String(m.ride_id),
              sender_id: String(m.sender_id),
              sender_name: String(m.sender_name),
              content: String(m.content),
              created_at: String(m.created_at),
            });
          }
        }
      )
      .subscribe();

    // Gentle mobile-network backup poll every 8s when logged in
    const poll = setInterval(() => {
      if (active && userRef.current) {
        fetchEnrichedRides().then((rd) => active && setRides(rd)).catch(() => {});
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
