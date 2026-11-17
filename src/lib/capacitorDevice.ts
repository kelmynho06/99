import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { DevicePermissionsState, PermissionGrantState } from '../types/mobility';
import { playOfferAlertSound } from './sound';
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
        name: 'Corridas e Entregas 66 Mobilidade',
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
  const prefs = getUserPreferences();
  const { title, body, playSound = true } = input;

  if (playSound && prefs.sounds_enabled) {
    playOfferAlertSound();
  }

  if (!prefs.notifications_enabled) return;

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
