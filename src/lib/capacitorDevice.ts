import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { playOfferAlertSound } from './sound';

export interface DeviceCoords {
  lat: number;
  lng: number;
  heading: number;
}

let notificationsInitialized = false;
let nextNotificationId = 1000;

export async function initLocalNotifications(): Promise<void> {
  if (notificationsInitialized) return;
  notificationsInitialized = true;

  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      await LocalNotifications.createChannel({
        id: 'velo99_rides',
        name: 'Corridas e Entregas Velo99',
        description: 'Alertas imediatos de status, mensagens e eventos',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#FFD100',
      });
    } catch {
      // Ignore if running in unsupported WebView
    }
  } else if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }
}

export async function triggerLocalNotification(input: {
  title: string;
  body: string;
  playSound?: boolean;
}): Promise<void> {
  const { title, body, playSound = true } = input;

  if (playSound) {
    playOfferAlertSound();
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([180, 90, 220]);
    } catch {
      // Ignore vibration errors
    }
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await initLocalNotifications();
      nextNotificationId = (nextNotificationId % 900000) + 1;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: nextNotificationId,
            title,
            body,
            channelId: 'velo99_rides',
            schedule: { at: new Date(Date.now() + 80) },
            smallIcon: 'ic_launcher',
            iconColor: '#FFD100',
          },
        ],
      });
      return;
    } catch {
      // Fall through to web notification fallback
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore if browser blocks Notification constructor in SW-only contexts
    }
  }
}

export async function getCurrentGpsPosition(): Promise<DeviceCoords | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        await Geolocation.requestPermissions();
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading ?? 0,
      };
    } catch {
      // Fallback below
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? 0,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export function watchGpsPosition(
  onUpdate: (coords: DeviceCoords) => void
): () => void {
  let active = true;
  let nativeWatchId: string | null = null;
  let webWatchId: number | null = null;

  if (Capacitor.isNativePlatform()) {
    Geolocation.requestPermissions()
      .catch(() => {})
      .finally(() => {
        if (!active) return;
        Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 2500 },
          (pos) => {
            if (!active || !pos) return;
            onUpdate({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? 0,
            });
          }
        )
          .then((id) => {
            if (!active) {
              Geolocation.clearWatch({ id }).catch(() => {});
            } else {
              nativeWatchId = id;
            }
          })
          .catch(() => {});
      });
  } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!active) return;
        onUpdate({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? 0,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  }

  return () => {
    active = false;
    if (nativeWatchId) {
      Geolocation.clearWatch({ id: nativeWatchId }).catch(() => {});
    }
    if (webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(webWatchId);
    }
  };
}
