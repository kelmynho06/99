import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { CookieBanner } from './components/CookieBanner';
import { DriverView } from './components/DriverView';
import { FloatingBubble } from './components/FloatingBubble';
import { OtaUpdateModal } from './components/OtaUpdateModal';
import { PassengerView } from './components/PassengerView';
import { PermissionsPromptModal } from './components/PermissionsPromptModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import { useAppConfig } from './context/AppConfigContext';
import { useRealtimeMobility } from './hooks/useRealtimeMobility';
import { logAuditEvent } from './lib/audit';
import { resolveBrandLogo } from './lib/brandAssets';
import { logoutUser, restoreSessionUser } from './lib/mobilityApi';
import { checkForOtaUpdate, type OtaUpdateInfo } from './lib/otaUpdate';
import { supabase } from './lib/supabase';
import {
  applyThemeToDocument,
  getUserPreferences,
  hasSeenPermissionsPrompt,
  saveUserPreferences,
  subscribeUserPreferences,
} from './lib/userPrefs';
import type { UserProfile } from './types/mobility';

const STORAGE_KEY = 'velo99_session_user';

export default function App() {
  const { config: appConfig } = useAppConfig();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [booting, setBooting] = useState(true);
  const [showPermsModal, setShowPermsModal] = useState<boolean>(() => !hasSeenPermissionsPrompt());
  const [floatingBubbleEnabled, setFloatingBubbleEnabled] = useState<boolean>(
    () => getUserPreferences().floating_bubble_enabled ?? true
  );
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<OtaUpdateInfo | null>(null);
  const [otaDismissed, setOtaDismissed] = useState(false);

  const syncedLangUserIdRef = useRef<string | null>(null);
  const loggedSessionUserIdRef = useRef<string | null>(null);
  const otaCheckedRef = useRef(false);

  useEffect(() => {
    applyThemeToDocument();
    const unsub = subscribeUserPreferences((prefs) => {
      applyThemeToDocument(prefs.theme_mode, prefs.language);
      setFloatingBubbleEnabled(prefs.floating_bubble_enabled ?? true);
    });
    const timer = window.setInterval(() => {
      const prefs = getUserPreferences();
      if (prefs.theme_mode === 'auto') {
        applyThemeToDocument('auto', prefs.language);
      }
    }, 60_000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  const recordSessionAudit = useCallback(
    (user: UserProfile, eventType: 'login' | 'session_restore') => {
      if (loggedSessionUserIdRef.current === user.id) return;
      loggedSessionUserIdRef.current = user.id;
      void logAuditEvent({
        user,
        event_type: eventType,
        description:
          eventType === 'login'
            ? `Login realizado (${user.role})`
            : `Sessão restaurada (${user.role})`,
      });
    },
    []
  );

  const handleUserUpdated = useCallback(
    (updated: UserProfile) => {
      setCurrentUser(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      if (
        updated.preferred_language &&
        syncedLangUserIdRef.current !== updated.id
      ) {
        syncedLangUserIdRef.current = updated.id;
        const localPrefs = getUserPreferences();
        if (localPrefs.language !== updated.preferred_language) {
          saveUserPreferences({ language: updated.preferred_language });
        }
      }
    },
    []
  );

  const handleAuthenticated = useCallback(
    (user: UserProfile) => {
      handleUserUpdated(user);
      recordSessionAudit(user, 'login');
    },
    [handleUserUpdated, recordSessionAudit]
  );

  const handleLogout = useCallback(async () => {
    const prevUser = currentUser;
    syncedLangUserIdRef.current = null;
    loggedSessionUserIdRef.current = null;
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
    if (prevUser) {
      void logAuditEvent({
        user: prevUser,
        event_type: 'logout',
        description: `Usuário encerrou sessão (${prevUser.role})`,
      });
    }
    await logoutUser().catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    let mounted = true;
    restoreSessionUser()
      .then((user) => {
        if (!mounted) return;
        if (user) {
          handleUserUpdated(user);
          recordSessionAudit(user, 'session_restore');
        } else {
          setCurrentUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setBooting(false);
      });

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        syncedLangUserIdRef.current = null;
        loggedSessionUserIdRef.current = null;
        setCurrentUser(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [handleUserUpdated, recordSessionAudit]);

  const {
    platformConfig,
    platformEvents,
    rides,
    pricing,
    onlineDrivers,
    messagesByRide,
    upsertRide,
    appendMessage,
    loadRideMessages,
    emitDriverLocation,
  } = useRealtimeMobility(currentUser, handleUserUpdated);

  const effectivePlatformConfig = useMemo(
    () => ({
      ...platformConfig,
      site_name: appConfig.app_name || platformConfig.site_name || '66 Mobilidade',
      app_logo_url:
        appConfig.logo_url !== undefined ? appConfig.logo_url : platformConfig.app_logo_url,
      primary_color: appConfig.primary_color || platformConfig.primary_color || '#FFD100',
      secondary_color: appConfig.secondary_color || platformConfig.secondary_color || '#111827',
    }),
    [platformConfig, appConfig]
  );

  useEffect(() => {
    if (booting || otaCheckedRef.current) return;
    otaCheckedRef.current = true;
    checkForOtaUpdate(effectivePlatformConfig)
      .then((info) => {
        if (info.hasUpdate) {
          setOtaUpdateInfo(info);
        }
      })
      .catch(() => {});
  }, [booting, effectivePlatformConfig]);

  if (booting && !currentUser) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center dark:bg-neutral-950"
        style={{ backgroundColor: effectivePlatformConfig.primary_color || '#FFD100' }}
      >
        <div className="text-center">
          <img
            src={resolveBrandLogo(effectivePlatformConfig)}
            alt={effectivePlatformConfig.site_name || '66 Mobilidade'}
            className="mx-auto h-16 w-16 rounded-2xl object-cover border-2 border-neutral-950 shadow-lg"
          />
          <p className="mt-3 text-sm font-extrabold text-neutral-950">
            Conectando ao {effectivePlatformConfig.site_name || '66 Mobilidade'}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineIndicator />
      {!currentUser ? (
        <AuthScreen
          onAuthenticated={handleAuthenticated}
          platformConfig={effectivePlatformConfig}
        />
      ) : currentUser.role === 'admin' ? (
        <AdminDashboard
          currentUser={currentUser}
          initialPlatformConfig={effectivePlatformConfig}
          onLogout={handleLogout}
        />
      ) : currentUser.role === 'driver' ? (
        <DriverView
          currentUser={currentUser}
          platformConfig={effectivePlatformConfig}
          platformEvents={platformEvents}
          rides={rides}
          messagesByRide={messagesByRide}
          onUserUpdated={handleUserUpdated}
          onLoadMessages={loadRideMessages}
          onAppendMessage={appendMessage}
          onRideUpsert={upsertRide}
          onEmitLocation={emitDriverLocation}
          onLogout={handleLogout}
        />
      ) : (
        <PassengerView
          currentUser={currentUser}
          platformConfig={effectivePlatformConfig}
          rides={rides}
          pricing={pricing}
          onlineDrivers={onlineDrivers}
          messagesByRide={messagesByRide}
          onUserUpdated={handleUserUpdated}
          onLoadMessages={loadRideMessages}
          onAppendMessage={appendMessage}
          onRideUpsert={upsertRide}
          onLogout={handleLogout}
        />
      )}

      <CookieBanner siteName={effectivePlatformConfig.site_name} />

      {showPermsModal && (
        <PermissionsPromptModal
          siteName={effectivePlatformConfig.site_name}
          onClose={() => setShowPermsModal(false)}
        />
      )}

      {currentUser && floatingBubbleEnabled && (
        <FloatingBubble
          currentUser={currentUser}
          platformConfig={effectivePlatformConfig}
          hasActiveRide={rides.some(
            (r) =>
              ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status) &&
              (r.passenger_id === currentUser.id || r.driver_id === currentUser.id)
          )}
          onDismiss={() => {
            saveUserPreferences({ floating_bubble_enabled: false });
            setFloatingBubbleEnabled(false);
          }}
        />
      )}

      {otaUpdateInfo?.hasUpdate && !otaDismissed && (
        <OtaUpdateModal
          updateInfo={otaUpdateInfo}
          siteName={effectivePlatformConfig.site_name}
          onClose={() => setOtaDismissed(true)}
        />
      )}
    </>
  );
}
