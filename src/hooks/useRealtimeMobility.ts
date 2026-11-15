import { useCallback, useEffect, useRef, useState } from 'react';
import type { PricingSetting, Ride, RideMessage, UserProfile } from '../types/mobility';

interface WsMessage {
  event: string;
  payload: unknown;
}

export function useRealtimeMobility(
  currentUser: UserProfile | null,
  onCurrentUserUpdated: (user: UserProfile) => void
) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [pricing, setPricing] = useState<PricingSetting[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<UserProfile[]>([]);
  const [messagesByRide, setMessagesByRide] = useState<Record<string, RideMessage[]>>({});
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
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
      const res = await fetch(`/api/rides/${rideId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: RideMessage[] };
      setMessagesByRide((prev) => ({ ...prev, [rideId]: data.messages }));
    } catch {
      // Ignore network hiccup
    }
  }, []);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const bootstrap = async () => {
      try {
        const res = await fetch('/api/bootstrap');
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          pricing: PricingSetting[];
          rides: Ride[];
          onlineDrivers: UserProfile[];
        };
        setPricing(data.pricing);
        setRides(data.rides);
        setOnlineDrivers(data.onlineDrivers);
      } catch {
        // Retry via WS
      }
    };

    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        if (!active) return;
        try {
          const parsed = JSON.parse(evt.data) as WsMessage;
          switch (parsed.event) {
            case 'sync:init': {
              const init = parsed.payload as {
                pricing: PricingSetting[];
                rides: Ride[];
                onlineDrivers: UserProfile[];
              };
              setPricing(init.pricing);
              setRides(init.rides);
              setOnlineDrivers(init.onlineDrivers);
              break;
            }
            case 'ride:created':
            case 'ride:updated': {
              upsertRide(parsed.payload as Ride);
              break;
            }
            case 'pricing:updated': {
              setPricing(parsed.payload as PricingSetting[]);
              break;
            }
            case 'driver:status': {
              const drv = parsed.payload as UserProfile;
              setOnlineDrivers((prev) => {
                const filtered = prev.filter((d) => d.id !== drv.id);
                return drv.driver?.is_online ? [...filtered, drv] : filtered;
              });
              if (userRef.current?.id === drv.id) {
                onCurrentUserUpdated(drv);
              }
              break;
            }
            case 'driver:location': {
              const loc = parsed.payload as {
                userId: string;
                lat: number;
                lng: number;
                heading: number;
              };
              setOnlineDrivers((prev) =>
                prev.map((d) =>
                  d.id === loc.userId && d.driver
                    ? {
                        ...d,
                        driver: {
                          ...d.driver,
                          current_lat: loc.lat,
                          current_lng: loc.lng,
                          heading: loc.heading,
                        },
                      }
                    : d
                )
              );
              setRides((prev) =>
                prev.map((r) =>
                  r.driver_id === loc.userId && r.driver && r.driver.driver
                    ? {
                        ...r,
                        driver: {
                          ...r.driver,
                          driver: {
                            ...r.driver.driver,
                            current_lat: loc.lat,
                            current_lng: loc.lng,
                            heading: loc.heading,
                          },
                        },
                      }
                    : r
                )
              );
              break;
            }
            case 'user:updated': {
              const updated = parsed.payload as UserProfile;
              if (userRef.current?.id === updated.id) {
                onCurrentUserUpdated(updated);
              }
              setRides((prev) =>
                prev.map((r) => {
                  if (r.driver_id === updated.id) return { ...r, driver: updated };
                  if (r.passenger_id === updated.id) return { ...r, passenger: updated };
                  return r;
                })
              );
              break;
            }
            case 'chat:message': {
              appendMessage(parsed.payload as RideMessage);
              break;
            }
          }
        } catch {
          // Ignore invalid socket frames
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    bootstrap();
    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [appendMessage, onCurrentUserUpdated, upsertRide]);

  const emitDriverLocation = useCallback((userId: string, lat: number, lng: number, heading = 0) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: 'driver:location',
          payload: { userId, lat, lng, heading },
        })
      );
    } else {
      fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lat, lng, heading }),
      }).catch(() => {});
    }
  }, []);

  return {
    rides,
    pricing,
    onlineDrivers,
    messagesByRide,
    wsConnected,
    upsertRide,
    loadRideMessages,
    emitDriverLocation,
  };
}
