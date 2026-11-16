import { Capacitor } from '@capacitor/core';
import type { AuditLogEntry, UserProfile } from '../types/mobility';
import { CURRENT_APP_VERSION } from './otaUpdate';
import { supabase } from './supabase';

const LOCAL_AUDIT_KEY = 'velo99_local_audit_logs_v1';

export interface DeviceTelemetry {
  device_type: string;
  os_name: string;
  os_version: string;
  browser_name: string;
  browser_version: string;
  app_version: string;
  screen_size: string;
  language: string;
  timezone: string;
  user_agent: string;
}

export function collectDeviceTelemetry(): DeviceTelemetry {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isNative = Capacitor.isNativePlatform();
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);

  let osName = 'Desconhecido';
  let osVersion = '';
  const androidMatch = ua.match(/Android\s+([0-9.]+)/i);
  const iosMatch = ua.match(/(?:iPhone OS|CPU OS|iPad; CPU OS)\s+([0-9_]+)/i);
  const winMatch = ua.match(/Windows NT\s+([0-9.]+)/i);
  const macMatch = ua.match(/Mac OS X\s+([0-9_]+)/i);

  if (androidMatch) {
    osName = 'Android';
    osVersion = androidMatch[1];
  } else if (iosMatch) {
    osName = 'iOS';
    osVersion = iosMatch[1].replace(/_/g, '.');
  } else if (winMatch) {
    osName = 'Windows';
    osVersion = winMatch[1] === '10.0' ? '10/11' : winMatch[1];
  } else if (macMatch) {
    osName = 'macOS';
    osVersion = macMatch[1].replace(/_/g, '.');
  } else if (/Linux/i.test(ua)) {
    osName = 'Linux';
  }

  let browserName = 'Navegador';
  let browserVersion = '';
  const edgeMatch = ua.match(/Edg(?:A|iOS)?\/([0-9.]+)/);
  const oprMatch = ua.match(/(?:OPR|Opera)\/([0-9.]+)/);
  const chromeMatch = ua.match(/(?:Chrome|CriOS)\/([0-9.]+)/);
  const firefoxMatch = ua.match(/(?:Firefox|FxiOS)\/([0-9.]+)/);
  const safariMatch = ua.match(/Version\/([0-9.]+).*Safari/);

  if (isNative) {
    browserName = ua.includes('wv') ? 'Android WebView (APK)' : 'Capacitor Native';
    browserVersion = chromeMatch?.[1] || '';
  } else if (edgeMatch) {
    browserName = 'Microsoft Edge';
    browserVersion = edgeMatch[1];
  } else if (oprMatch) {
    browserName = 'Opera';
    browserVersion = oprMatch[1];
  } else if (chromeMatch) {
    browserName = 'Google Chrome';
    browserVersion = chromeMatch[1];
  } else if (firefoxMatch) {
    browserName = 'Mozilla Firefox';
    browserVersion = firefoxMatch[1];
  } else if (safariMatch) {
    browserName = 'Apple Safari';
    browserVersion = safariMatch[1];
  }

  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const deviceType = isNative
    ? `${Capacitor.getPlatform() === 'ios' ? 'iOS' : 'Android'} APK`
    : isStandalone
    ? 'PWA Instalado'
    : isMobileUa
    ? 'Web Mobile'
    : 'Web Desktop';

  const screenSize =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : '—';

  const language =
    typeof navigator !== 'undefined' ? navigator.language || 'pt-BR' : 'pt-BR';

  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timezone = '';
  }

  return {
    device_type: deviceType,
    os_name: osName,
    os_version: osVersion,
    browser_name: browserName,
    browser_version: browserVersion,
    app_version: CURRENT_APP_VERSION,
    screen_size: screenSize,
    language,
    timezone,
    user_agent: ua.slice(0, 360),
  };
}

export function getCachedAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_KEY);
    return raw ? (JSON.parse(raw) as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

function pushLocalAuditCache(entry: AuditLogEntry) {
  try {
    const current = getCachedAuditLogs();
    const next = [entry, ...current].slice(0, 200);
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage error
  }
}

export async function logAuditEvent(params: {
  user?: UserProfile | null;
  event_type: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const telemetry = collectDeviceTelemetry();
  const entry: AuditLogEntry = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: params.user?.id || null,
    user_name: params.user?.full_name || 'Visitante',
    user_email: params.user?.email || '',
    user_role: params.user?.role || 'passenger',
    event_type: params.event_type,
    description: params.description,
    ...telemetry,
    metadata: params.metadata || {},
    created_at: new Date().toISOString(),
  };

  pushLocalAuditCache(entry);

  try {
    await supabase.from('audit_logs').insert({
      user_id: entry.user_id,
      user_name: entry.user_name,
      user_email: entry.user_email,
      user_role: entry.user_role,
      event_type: entry.event_type,
      description: entry.description,
      device_type: entry.device_type,
      os_name: entry.os_name,
      os_version: entry.os_version,
      browser_name: entry.browser_name,
      browser_version: entry.browser_version,
      app_version: entry.app_version,
      screen_size: entry.screen_size,
      language: entry.language,
      timezone: entry.timezone,
      user_agent: entry.user_agent,
      metadata: entry.metadata,
    });
  } catch {
    // Keep local fallback seamlessly if audit_logs hasn't been created yet
  }
}

export async function fetchAuditLogsFromSupabase(limit = 300): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return getCachedAuditLogs();
  }

  return data.map((row) => ({
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    user_name: String(row.user_name || ''),
    user_email: String(row.user_email || ''),
    user_role: String(row.user_role || 'passenger'),
    event_type: String(row.event_type || 'event'),
    description: String(row.description || ''),
    device_type: String(row.device_type || 'Web'),
    os_name: String(row.os_name || ''),
    os_version: String(row.os_version || ''),
    browser_name: String(row.browser_name || ''),
    browser_version: String(row.browser_version || ''),
    app_version: String(row.app_version || CURRENT_APP_VERSION),
    screen_size: String(row.screen_size || ''),
    language: String(row.language || 'pt-BR'),
    timezone: String(row.timezone || ''),
    user_agent: String(row.user_agent || ''),
    metadata: (row.metadata as Record<string, unknown>) || {},
    created_at: String(row.created_at),
  }));
}
