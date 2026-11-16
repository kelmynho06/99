import type { PlatformConfig } from '../types/mobility';

export const CURRENT_APP_VERSION = '1.2.0';

export interface OtaUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  apkUrl: string;
  releaseNotes: string;
  publishedAt?: string;
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

export async function checkForOtaUpdate(
  platformConfig?: PlatformConfig | null
): Promise<OtaUpdateInfo> {
  let manifestVersion = CURRENT_APP_VERSION;
  let manifestApkUrl = '';
  let manifestNotes = '';
  let publishedAt: string | undefined;

  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as {
        version?: string;
        apk_url?: string;
        release_notes?: string;
        published_at?: string;
      };
      if (json.version) manifestVersion = String(json.version).trim();
      if (json.apk_url) manifestApkUrl = String(json.apk_url).trim();
      if (json.release_notes) manifestNotes = String(json.release_notes).trim();
      if (json.published_at) publishedAt = String(json.published_at);
    }
  } catch {
    // Offline or blocked; rely on platformConfig if available
  }

  const cfgVersion = platformConfig?.ota_latest_version?.trim() || '';
  const cfgApkUrl = platformConfig?.ota_apk_url?.trim() || '';
  const cfgNotes = platformConfig?.ota_release_notes?.trim() || '';

  const useConfig =
    Boolean(cfgVersion) && compareSemver(cfgVersion, manifestVersion) >= 0;

  const latestVersion = useConfig ? cfgVersion : manifestVersion;
  const apkUrl = (useConfig && cfgApkUrl ? cfgApkUrl : manifestApkUrl) || cfgApkUrl || '/version.json';
  const releaseNotes =
    (useConfig && cfgNotes ? cfgNotes : manifestNotes) ||
    cfgNotes ||
    'Nova versão com melhorias de mapa, desempenho e estabilidade.';

  return {
    currentVersion: CURRENT_APP_VERSION,
    latestVersion,
    hasUpdate: compareSemver(latestVersion, CURRENT_APP_VERSION) > 0,
    apkUrl,
    releaseNotes,
    publishedAt,
  };
}
