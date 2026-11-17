import { Capacitor, registerPlugin } from '@capacitor/core';

export interface FloatingBubblePermissions {
  overlay: boolean;
  batteryIgnored: boolean;
  enabled: boolean;
}

export interface NativeAppVersionInfo {
  versionName: string;
  versionCode: number;
}

interface FloatingBubblePluginInterface {
  checkPermissions(): Promise<FloatingBubblePermissions>;
  requestOverlayPermission(): Promise<{ overlay: boolean }>;
  requestBatteryOptimization(): Promise<{ batteryIgnored: boolean }>;
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  setActiveRide(options: { hasActiveRide: boolean }): Promise<void>;
  hide(): Promise<void>;
  getAppVersion(): Promise<NativeAppVersionInfo>;
  openExternalUrl(options: { url: string }): Promise<void>;
  applyWebUpdate(options: { url: string }): Promise<{ applied: boolean }>;
}

const FloatingBubbleNative = registerPlugin<FloatingBubblePluginInterface>('FloatingBubble');

export function isNativeAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getNativeBubblePermissions(): Promise<FloatingBubblePermissions> {
  if (!isNativeAndroidApp()) {
    return { overlay: false, batteryIgnored: false, enabled: true };
  }
  try {
    return await FloatingBubbleNative.checkPermissions();
  } catch {
    return { overlay: false, batteryIgnored: false, enabled: true };
  }
}

export async function requestNativeOverlayPermission(): Promise<boolean> {
  if (!isNativeAndroidApp()) return false;
  try {
    const res = await FloatingBubbleNative.requestOverlayPermission();
    return Boolean(res?.overlay);
  } catch {
    return false;
  }
}

export async function requestNativeBatteryOptimization(): Promise<boolean> {
  if (!isNativeAndroidApp()) return false;
  try {
    const res = await FloatingBubbleNative.requestBatteryOptimization();
    return Boolean(res?.batteryIgnored);
  } catch {
    return false;
  }
}

export async function syncNativeFloatingBubbleEnabled(enabled: boolean): Promise<void> {
  if (!isNativeAndroidApp()) return;
  try {
    await FloatingBubbleNative.setEnabled({ enabled });
  } catch {
    // Ignore when plugin not ready
  }
}

export async function syncNativeFloatingBubbleActiveRide(hasActiveRide: boolean): Promise<void> {
  if (!isNativeAndroidApp()) return;
  try {
    await FloatingBubbleNative.setActiveRide({ hasActiveRide });
  } catch {
    // Ignore
  }
}

export async function getInstalledNativeVersion(fallbackVersion: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return fallbackVersion;
  try {
    const res = await FloatingBubbleNative.getAppVersion();
    if (res?.versionName) return String(res.versionName).trim();
  } catch {
    // Ignore fallback
  }
  return fallbackVersion;
}

export async function openExternalDownloadUrl(url: string): Promise<boolean> {
  if (isNativeAndroidApp()) {
    try {
      await FloatingBubbleNative.openExternalUrl({ url });
      return true;
    } catch {
      // Fallback below
    }
  }
  return false;
}

export async function applyNativeWebUpdate(url: string): Promise<boolean> {
  if (!isNativeAndroidApp()) return false;
  try {
    const res = await FloatingBubbleNative.applyWebUpdate({ url });
    return Boolean(res?.applied);
  } catch {
    return false;
  }
}
