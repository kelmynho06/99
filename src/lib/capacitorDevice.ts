import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { DevicePermissionsState, PermissionGrantState } from '../types/mobility';
import { getUserPreferences } from './userPrefs';

export interface DeviceCoords {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
}

function toSpeedKmh(rawSpeed: number | null | undefined): number {
  if (typeof rawSpeed !== 'number' || !Number.isFinite(rawSpeed) || rawSpeed < 0) {
    return 0;
  }
  return Math.round(rawSpeed * 3.6);
}

const VOICE_ALERT_CHANNEL_ID = 'mobilidade66_voice_alerts';
const recentNotifDedupeMap = new Map<string, number>();
let notificationsInitialized = false;
let nextNotificationId = 1000;

function hashDedupeKeyToId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 900000) + 1000;
}

function shouldSkipDuplicateNotification(dedupeKey?: string, cooldownMs = 9000): boolean {
  if (!dedupeKey) return false;
  const now = Date.now();
  const prev = recentNotifDedupeMap.get(dedupeKey);
  if (prev && now - prev < cooldownMs) {
    return true;
  }
  recentNotifDedupeMap.set(dedupeKey, now);
  if (recentNotifDedupeMap.size > 150) {
    for (const [k, ts] of recentNotifDedupeMap.entries()) {
      if (now - ts > 60_000) recentNotifDedupeMap.delete(k);
    }
  }
  return false;
}

export async function initLocalNotifications(): Promise<void> {
  if (notificationsInitialized) return;
  notificationsInitialized = true;

  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      if (Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({
          id: VOICE_ALERT_CHANNEL_ID,
          name: 'Go Driver · Assistente Évelyn',
          description: 'Alertas discretos em segundo plano enquanto a assistente Évelyn fala',
          importance: 4,
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: '#2563EB',
        }).catch(() => {});
      }
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
  dedupeKey?: string;
  vibrate?: boolean;
}): Promise<void> {
  const prefs = getUserPreferences();
  const { title, body, dedupeKey, vibrate = true } = input;

  if (!prefs.notifications_enabled) return;
  // Evita pop-ups chatos enquanto o usuário já está com o aplicativo aberto na frente: a assistente Evelyn fala diretamente.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  if (shouldSkipDuplicateNotification(dedupeKey)) return;

  if (vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(70);
    } catch {
      // Ignore vibration errors
    }
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await initLocalNotifications();
      const id = dedupeKey
        ? hashDedupeKeyToId(dedupeKey)
        : (nextNotificationId = (nextNotificationId % 900000) + 1);
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            channelId: Capacitor.getPlatform() === 'android' ? VOICE_ALERT_CHANNEL_ID : undefined,
            schedule: { at: new Date(Date.now() + 80) },
            smallIcon: 'ic_launcher',
            iconColor: '#2563EB',
          },
        ],
      });
      return;
    } catch {
      // Fall through to web notification fallback
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const webOptions: NotificationOptions = {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: dedupeKey || 'mobilidade66-alert',
      silent: true,
    };

    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, webOptions);
          return;
        }
      }
      new Notification(title, webOptions);
    } catch {
      // Ignore notification restrictions
    }
  }
}

function mapPermValue(val?: string | null): PermissionGrantState {
  if (val === 'granted') return 'granted';
  if (val === 'denied') return 'denied';
  if (val === 'prompt' || val === 'prompt-with-rationale' || val === 'default') return 'prompt';
  return 'unknown';
}

export async function checkDevicePermissionsStatus(): Promise<DevicePermissionsState> {
  let notifications: PermissionGrantState = 'unknown';
  let location: PermissionGrantState = 'unknown';
  let camera: PermissionGrantState = 'unknown';
  let microphone: PermissionGrantState = 'unknown';
  const photos: PermissionGrantState =
    typeof document !== 'undefined' ? 'granted' : 'unknown';

  try {
    if (Capacitor.isNativePlatform()) {
      const nPerm = await LocalNotifications.checkPermissions();
      notifications = mapPermValue(nPerm.display);
      const lPerm = await Geolocation.checkPermissions();
      location = mapPermValue(lPerm.location || lPerm.coarseLocation);
    } else {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        notifications = mapPermValue(Notification.permission);
      }
      if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
        try {
          const geoStatus = await navigator.permissions.query({
            name: 'geolocation' as PermissionName,
          });
          location = mapPermValue(geoStatus.state);
        } catch {
          location = 'prompt';
        }
        try {
          const camStatus = await navigator.permissions.query({
            name: 'camera' as PermissionName,
          });
          camera = mapPermValue(camStatus.state);
        } catch {
          camera = 'prompt';
        }
        try {
          const micStatus = await navigator.permissions.query({
            name: 'microphone' as PermissionName,
          });
          microphone = mapPermValue(micStatus.state);
        } catch {
          microphone = 'prompt';
        }
      }
    }
  } catch {
    // Ignore unsupported checks
  }

  return { notifications, location, camera, microphone, photos };
}

export async function requestNotificationPermission(): Promise<PermissionGrantState> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await LocalNotifications.requestPermissions();
      await initLocalNotifications();
      return mapPermValue(res.display);
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const res = await Notification.requestPermission();
      return mapPermValue(res);
    }
  } catch {
    // Ignore
  }
  return 'unknown';
}

export async function requestLocationPermission(): Promise<PermissionGrantState> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await Geolocation.requestPermissions({
        permissions: ['location', 'coarseLocation'],
      });
      return mapPermValue(res.location || res.coarseLocation);
    }
    const pos = await getCurrentGpsPosition();
    return pos ? 'granted' : 'prompt';
  } catch {
    return 'denied';
  }
}

export async function requestCameraPermission(): Promise<PermissionGrantState> {
  try {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    }
  } catch {
    return 'denied';
  }
  return 'prompt';
}

export async function requestMicrophonePermission(): Promise<PermissionGrantState> {
  try {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    }
  } catch {
    return 'denied';
  }
  return 'prompt';
}

export async function requestAllDevicePermissions(): Promise<DevicePermissionsState> {
  const notifications = await requestNotificationPermission();
  const location = await requestLocationPermission();
  const camera = await requestCameraPermission();
  const microphone = await requestMicrophonePermission();
  return {
    notifications,
    location,
    camera,
    microphone,
    photos: 'granted',
  };
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
        speedKmh: toSpeedKmh(pos.coords.speed),
      };
    } catch {
      // Fallback below
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? 0,
            speedKmh: toSpeedKmh(pos.coords.speed),
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch {
      resolve(null);
    }
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
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
          (pos) => {
            if (!active || !pos) return;
            onUpdate({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? 0,
              speedKmh: toSpeedKmh(pos.coords.speed),
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
    try {
      webWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!active) return;
          onUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? 0,
            speedKmh: toSpeedKmh(pos.coords.speed),
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    } catch {
      // Ignore restricted geolocation contexts
    }
  }

  return () => {
    active = false;
    if (nativeWatchId) {
      Geolocation.clearWatch({ id: nativeWatchId }).catch(() => {});
    }
    if (webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(webWatchId);
      } catch {
        // Ignore clearWatch errors
      }
    }
  };
}
