import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_BRAND_LOGO } from '../lib/brandAssets';
import { fetchAppBrandConfig, PLATFORM_BRAND_CACHE_KEY } from '../lib/mobilityApi';
import { supabase } from '../lib/supabase';

export interface AppConfig {
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}

interface AppConfigContextValue {
  config: AppConfig;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  applyLocalConfig: (next: Partial<AppConfig>) => void;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  app_name: 'Velo99',
  logo_url: null,
  primary_color: '#FFD100',
  secondary_color: '#111827',
};

function readInitialCachedConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(PLATFORM_BRAND_CACHE_KEY);
    if (!raw) return DEFAULT_APP_CONFIG;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      app_name: String(parsed.site_name || parsed.app_name || 'Velo99'),
      logo_url:
        typeof parsed.app_logo_url === 'string'
          ? parsed.app_logo_url
          : typeof parsed.logo_url === 'string'
          ? parsed.logo_url
          : null,
      primary_color: String(parsed.primary_color || '#FFD100'),
      secondary_color: String(parsed.secondary_color || '#111827'),
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

function syncHeadMetadata(cfg: AppConfig) {
  if (typeof document === 'undefined') return;
  const brand = cfg.app_name.trim() || 'Velo99';
  document.title = `${brand} Mobilidade — Corridas e Entregas`;

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', brand);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && /^#[0-9A-Fa-f]{6}$/.test(cfg.primary_color)) {
    themeMeta.setAttribute('content', cfg.primary_color);
  }

  document.documentElement.style.setProperty('--brand-primary', cfg.primary_color || '#FFD100');
  document.documentElement.style.setProperty(
    '--brand-secondary',
    cfg.secondary_color || '#111827'
  );

  const resolvedIcon = cfg.logo_url || DEFAULT_BRAND_LOGO;
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
