import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { DEFAULT_BRAND_LOGO, normalizeImageUrl } from '../lib/brandAssets';
import { fetchAppBrandConfig, PLATFORM_BRAND_CACHE_KEY } from '../lib/mobilityApi';
import { supabase } from '../lib/supabase';
import { applyGlobalThemePreset } from '../lib/themePresets';

export interface AppConfig {
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  theme_preset?: string | null;
  assistant_voice_default?: string | null;
  pwa_app_name?: string | null;
  pwa_icon_url?: string | null;
  apk_app_name?: string | null;
  apk_icon_url?: string | null;
}

interface AppConfigContextValue {
  config: AppConfig;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  applyLocalConfig: (next: Partial<AppConfig>) => void;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  app_name: 'Go Driver Mobilidade',
  logo_url: null,
  primary_color: '#2563EB',
  secondary_color: '#0F172A',
  theme_preset: 'electric_blue',
  assistant_voice_default: 'melissa-maps',
  pwa_app_name: null,
  pwa_icon_url: null,
  apk_app_name: null,
  apk_icon_url: null,
};

function upgradeLegacyAppName(name?: unknown): string {
  const clean = String(name || '').trim();
  const lower = clean.toLowerCase();
  if (
    !clean ||
    lower.includes('66') ||
    lower.includes('meia meia') ||
    lower.includes('boreal') ||
    lower.includes('velo99') ||
    lower === 'go driver'
  ) {
    return 'Go Driver Mobilidade';
  }
  return clean;
}

function upgradeLegacyLogoUrl(url?: unknown): string | null {
  if (typeof url !== 'string') return null;
  return normalizeImageUrl(url);
}

function upgradeLegacyPrimaryColor(color?: unknown): string {
  const clean = String(color || '').trim();
  const upper = clean.toUpperCase();
  if (!clean || upper === '#047857' || upper === '#FFD100' || upper === '#FFDD00') {
    return '#2563EB';
  }
  return clean;
}

function upgradeLegacySecondaryColor(color?: unknown): string {
  const clean = String(color || '').trim();
  const upper = clean.toUpperCase();
  if (!clean || upper === '#0F2421' || upper === '#111827') {
    return '#0F172A';
  }
  return clean;
}

function readInitialCachedConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(PLATFORM_BRAND_CACHE_KEY);
    if (!raw) return DEFAULT_APP_CONFIG;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalizedName = upgradeLegacyAppName(parsed.site_name || parsed.app_name);
    const normalizedLogo = upgradeLegacyLogoUrl(parsed.app_logo_url ?? parsed.logo_url);
    if (parsed.site_name !== normalizedName || parsed.app_logo_url !== normalizedLogo) {
      localStorage.setItem(
        PLATFORM_BRAND_CACHE_KEY,
        JSON.stringify({
          ...parsed,
          site_name: normalizedName,
          app_logo_url: normalizedLogo,
        })
      );
    }
    return {
      app_name: normalizedName,
      logo_url: normalizedLogo,
      primary_color: upgradeLegacyPrimaryColor(parsed.primary_color),
      secondary_color: upgradeLegacySecondaryColor(parsed.secondary_color),
      theme_preset: typeof parsed.theme_preset === 'string' ? parsed.theme_preset : 'electric_blue',
      assistant_voice_default:
        typeof parsed.assistant_voice_default === 'string'
          ? parsed.assistant_voice_default
          : 'melissa-maps',
      pwa_app_name: typeof parsed.pwa_app_name === 'string' ? parsed.pwa_app_name.trim() || null : null,
      pwa_icon_url: upgradeLegacyLogoUrl(parsed.pwa_icon_url),
      apk_app_name: typeof parsed.apk_app_name === 'string' ? parsed.apk_app_name.trim() || null : null,
      apk_icon_url: upgradeLegacyLogoUrl(parsed.apk_icon_url),
    };
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

const AppConfigContext = createContext<AppConfigContextValue>({
  config: DEFAULT_APP_CONFIG,
  loading: false,
  refreshConfig: async () => {},
  applyLocalConfig: () => {},
});

let dynamicManifestObjectUrl: string | null = null;

function toAbsoluteUrl(src: string): string {
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')) {
    return src;
  }
  try {
    return new URL(src, window.location.origin).href;
  } catch {
    return src;
  }
}

function syncHeadMetadata(cfg: AppConfig) {
  if (typeof document === 'undefined') return;
  const isNative = Capacitor.isNativePlatform();
  const brand =
    (isNative ? cfg.apk_app_name : cfg.pwa_app_name)?.trim() ||
    cfg.app_name.trim() ||
    'Go Driver Mobilidade';
  document.title = `${brand} — Corridas e Entregas`;

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', brand);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && /^#[0-9A-Fa-f]{6}$/.test(cfg.primary_color)) {
    themeMeta.setAttribute('content', cfg.primary_color);
  }

  applyGlobalThemePreset(cfg.theme_preset, cfg.primary_color, cfg.secondary_color);

  const resolvedIcon =
    normalizeImageUrl(isNative ? cfg.apk_icon_url : cfg.pwa_icon_url) ||
    normalizeImageUrl(cfg.logo_url) ||
    DEFAULT_BRAND_LOGO;
  if (resolvedIcon) {
    let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.removeAttribute('type');
    iconLink.href = resolvedIcon;

    let appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = resolvedIcon;
  }

  // Sync dynamic PWA Web App Manifest whenever Admin updates PWA name or icon
  if (!isNative && (cfg.pwa_app_name || cfg.pwa_icon_url || cfg.logo_url || cfg.app_name)) {
    try {
      const pwaName = (cfg.pwa_app_name || cfg.app_name || 'Go Driver Mobilidade').trim();
      const shortName = pwaName.length > 14 ? pwaName.slice(0, 14).trim() : pwaName;
      const absIcon = toAbsoluteUrl(cfg.pwa_icon_url || cfg.logo_url || '/pwa-512x512.png');
      const manifestPayload = {
        name: pwaName,
        short_name: shortName,
        description: 'Aplicativo de corridas e entregas com rastreamento em tempo real e GoPay.',
        start_url: `${window.location.origin}/`,
        scope: `${window.location.origin}/`,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: cfg.primary_color || '#2563EB',
        background_color: '#F4F6F9',
        icons: [
          { src: absIcon, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: absIcon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      };
      const blob = new Blob([JSON.stringify(manifestPayload)], {
        type: 'application/manifest+json',
      });
      if (dynamicManifestObjectUrl) {
        URL.revokeObjectURL(dynamicManifestObjectUrl);
      }
      dynamicManifestObjectUrl = URL.createObjectURL(blob);
      let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!manifestLink) {
        manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        document.head.appendChild(manifestLink);
      }
      manifestLink.href = dynamicManifestObjectUrl;
    } catch {
      // Ignore restricted Blob manifest contexts
    }
  }
}

export const AppConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AppConfig>(readInitialCachedConfig);
  const [loading, setLoading] = useState(true);

  const refreshConfig = useCallback(async () => {
    try {
      const next = await fetchAppBrandConfig();
      setConfig(next);
      syncHeadMetadata(next);
    } catch {
      // Keep cached/default config offline
    } finally {
      setLoading(false);
    }
  }, []);

  const applyLocalConfig = useCallback((partial: Partial<AppConfig>) => {
    setConfig((prev) => {
      const merged: AppConfig = {
        app_name: partial.app_name ?? prev.app_name,
        logo_url: partial.logo_url !== undefined ? partial.logo_url : prev.logo_url,
        primary_color: partial.primary_color ?? prev.primary_color,
        secondary_color: partial.secondary_color ?? prev.secondary_color,
        theme_preset:
          partial.theme_preset !== undefined ? partial.theme_preset : prev.theme_preset,
        assistant_voice_default:
          partial.assistant_voice_default !== undefined
            ? partial.assistant_voice_default
            : prev.assistant_voice_default,
        pwa_app_name: partial.pwa_app_name !== undefined ? partial.pwa_app_name : prev.pwa_app_name,
        pwa_icon_url: partial.pwa_icon_url !== undefined ? partial.pwa_icon_url : prev.pwa_icon_url,
        apk_app_name: partial.apk_app_name !== undefined ? partial.apk_app_name : prev.apk_app_name,
        apk_icon_url: partial.apk_icon_url !== undefined ? partial.apk_icon_url : prev.apk_icon_url,
      };
      syncHeadMetadata(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    syncHeadMetadata(config);
  }, [config]);

  useEffect(() => {
    void refreshConfig();

    const channel = supabase
      .channel('velo99-app-config-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'configuracoes_app' },
        () => {
          void refreshConfig();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'platform_settings' },
        () => {
          void refreshConfig();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshConfig]);

  return (
    <AppConfigContext.Provider value={{ config, loading, refreshConfig, applyLocalConfig }}>
      {children}
    </AppConfigContext.Provider>
  );
};

export function useAppConfig() {
  return useContext(AppConfigContext);
}
