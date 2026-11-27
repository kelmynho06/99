import { Capacitor } from '@capacitor/core';
import type { PlatformConfig } from '../types/mobility';
import { getInstalledNativeVersion, isNativeAndroidApp, openExternalDownloadUrl } from './floatingBubble';

export const CURRENT_APP_VERSION = '1.2.5';
const WEB_RELOAD_GUARD_KEY = 'mobilidade66_web_auto_reloaded_v';

function buildDirectDownloadHref(rawUrl: string, filename: string): string {
  try {
    const u = new URL(rawUrl, window.location.origin);
    if (u.pathname.includes('/storage/v1/object/public/')) {
      u.searchParams.set('download', filename);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export async function triggerDirectApkDownload(
  rawUrl: string,
  filename = 'GoDriver-Mobilidade.apk'
): Promise<boolean> {
  const cleanUrl = rawUrl.trim();
  if (!cleanUrl) return false;

  if (isNativeAndroidApp()) {
    const handled = await openExternalDownloadUrl(cleanUrl);
    if (handled) return true;
  }

  const safeName = filename.toLowerCase().endsWith('.apk') ? filename : `${filename}.apk`;
  const directHref = buildDirectDownloadHref(cleanUrl, safeName);

  // Trigger browser native attachment download directly without opening external tabs
  try {
    if (cleanUrl.includes('/storage/v1/object/public/')) {
      const a = document.createElement('a');
      a.href = directHref;
      a.setAttribute('download', safeName);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => a.remove(), 1000);
      return true;
    }

    const res = await fetch(cleanUrl);
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = safeName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
      return true;
    }
  } catch {
    // Fallback to direct anchor download attribute below
  }

  const a = document.createElement('a');
  a.href = directHref;
  a.setAttribute('download', safeName);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 1000);
  return true;
}

export interface OtaUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  apkUrl: string;
  webUrl: string;
  releaseNotes: string;
  publishedAt?: string;
  isNativePlatform: boolean;
}

export function compareSemver(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n.replace(/\D/g, ''), 10) || 0);
  const pb = b
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n.replace(/\D/g, ''), 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export async function checkAndApplyWebAutoUpdate(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const json = (await res.json()) as { version?: string };
    const remoteVersion = String(json.version || '').trim();
    if (!remoteVersion) return false;

    if (compareSemver(remoteVersion, CURRENT_APP_VERSION) > 0) {
      const alreadyReloaded = sessionStorage.getItem(WEB_RELOAD_GUARD_KEY);
      if (alreadyReloaded === remoteVersion) return false;
      sessionStorage.setItem(WEB_RELOAD_GUARD_KEY, remoteVersion);

      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
      }
      window.location.reload();
      return true;
    }
  } catch {
    // Offline or blocked
  }
  return false;
}

export async function checkForOtaUpdate(
  platformConfig?: PlatformConfig | null
): Promise<OtaUpdateInfo> {
  const isNative = Capacitor.isNativePlatform();
  const nativeApkVersion = await getInstalledNativeVersion(CURRENT_APP_VERSION);
  const runningVersion =
    compareSemver(CURRENT_APP_VERSION, nativeApkVersion) >= 0
      ? CURRENT_APP_VERSION
      : nativeApkVersion;

  if (!isNative) {
    return {
      currentVersion: runningVersion,
      latestVersion: runningVersion,
      hasUpdate: false,
      apkUrl: '',
      webUrl: '',
      releaseNotes: '',
      isNativePlatform: false,
    };
  }

  let manifestVersion = runningVersion;
  let manifestApkUrl = '';
  let manifestWebUrl = '';
  let manifestNotes = '';
  let publishedAt: string | undefined;

  const cfgWebUrl = (platformConfig?.ota_web_url || '').trim().replace(/\/$/, '');

  // Check hosted web /version.json first if ota_web_url is configured
  const candidateUrls: string[] = [];
  if (cfgWebUrl && (cfgWebUrl.startsWith('https://') || cfgWebUrl.startsWith('http://'))) {
    candidateUrls.push(`${cfgWebUrl}/version.json?t=${Date.now()}`);
  }
  candidateUrls.push(`/version.json?t=${Date.now()}`);

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as {
          version?: string;
          apk_url?: string;
          web_url?: string;
          release_notes?: string;
          published_at?: string;
        };
        if (json.version && compareSemver(String(json.version).trim(), manifestVersion) > 0) {
          manifestVersion = String(json.version).trim();
        }
        if (json.apk_url && !manifestApkUrl) manifestApkUrl = String(json.apk_url).trim();
        if (json.web_url && !manifestWebUrl) manifestWebUrl = String(json.web_url).trim();
        if (json.release_notes && !manifestNotes) manifestNotes = String(json.release_notes).trim();
        if (json.published_at && !publishedAt) publishedAt = String(json.published_at);
        break;
      }
    } catch {
      // Try next URL
    }
  }

  const cfgVersion = platformConfig?.ota_latest_version?.trim() || '';
  const cfgApkUrl = platformConfig?.ota_apk_url?.trim() || '';
  const cfgNotes = platformConfig?.ota_release_notes?.trim() || '';

  const useConfig =
    Boolean(cfgVersion) && compareSemver(cfgVersion, manifestVersion) >= 0;

  const latestVersion = useConfig ? cfgVersion : manifestVersion;
  const webUrl = cfgWebUrl || manifestWebUrl || '';
  const apkUrl =
    (useConfig && cfgApkUrl ? cfgApkUrl : manifestApkUrl) || cfgApkUrl || '';
  const releaseNotes =
    (useConfig && cfgNotes ? cfgNotes : manifestNotes) ||
    cfgNotes ||
    'Nova versão com melhorias de mapa, busca local rápida, carteira e visual renovado.';

  const hasValidWebLink = webUrl.startsWith('https://') || webUrl.startsWith('http://');
  const hasValidApkLink = apkUrl.startsWith('http://') || apkUrl.startsWith('https://');
  const isNewer = compareSemver(latestVersion, runningVersion) > 0;

  const hasUpdate = isNewer && (hasValidWebLink || hasValidApkLink);

  return {
    currentVersion: runningVersion,
    latestVersion,
    hasUpdate,
    apkUrl,
    webUrl,
    releaseNotes,
    publishedAt,
    isNativePlatform: true,
  };
}
