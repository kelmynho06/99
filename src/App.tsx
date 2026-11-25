import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { AdminDashboard } from './components/AdminDashboard';
import { AnimatedSplashScreen } from './components/AnimatedSplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { CookieBanner } from './components/CookieBanner';
import { DriverView } from './components/DriverView';
import { OtaUpdateModal } from './components/OtaUpdateModal';
import { PassengerView } from './components/PassengerView';
import { PermissionsPromptModal } from './components/PermissionsPromptModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import { Receipt66PayModal } from './components/Receipt66PayModal';
import { useAppConfig } from './context/AppConfigContext';
import { useAdminAuth } from './hooks/useAdminAuth';
import { useRealtimeMobility } from './hooks/useRealtimeMobility';
import { logAuditEvent } from './lib/audit';
import { resolveBrandLogo } from './lib/brandAssets';
import {
  syncNativeFloatingBubbleActiveRide,
  syncNativeFloatingBubbleEnabled,
} from './lib/floatingBubble';
import { logoutUser, restoreSessionUser, updateUserLanguagePref } from './lib/mobilityApi';
import { useTranslation } from './lib/i18n';
import {
  checkAndApplyWebAutoUpdate,
  checkForOtaUpdate,
  type OtaUpdateInfo,
} from './lib/otaUpdate';
import { greetLoggedInUser, resetSessionGreeting, unlockAudioContext } from './lib/sound';
import { supabase } from './lib/supabase';
import {
  applyThemeToDocument,
  consumeExplicitLanguageChoice,
  getUserPreferences,
  hasSeenPermissionsPrompt,
  saveUserPreferences,
  subscribeUserPreferences,
} from './lib/userPrefs';
import type { UserProfile, WalletTransaction } from './types/mobility';

const STORAGE_KEY = 'velo99_session_user';

export default function App() {
  const { config: appConfig } = useAppConfig();
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [booting, setBooting] = useState(true);
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [showPermsModal, setShowPermsModal] = useState<boolean>(() => !hasSeenPermissionsPrompt());
  const [floatingBubbleEnabled, setFloatingBubbleEnabled] = useState<boolean>(
    () => getUserPreferences().floating_bubble_enabled ?? true
  );
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<OtaUpdateInfo | null>(null);
  const [dismissedOtaVersion, setDismissedOtaVersion] = useState<string | null>(null);
  const [walletToast, setWalletToast] = useState<{
    id: number;
    title: string;
    message: string;
    receiptTx?: WalletTransaction;
  } | null>(null);
  const [activeReceiptTx, setActiveReceiptTx] = useState<WalletTransaction | null>(null);

  const syncedLangUserIdRef = useRef<string | null>(null);
  const loggedSessionUserIdRef = useRef<string | null>(null);
  const shownOtaVersionRef = useRef<string | null>(null);

  useEffect(() => {
    applyThemeToDocument();
    const unsub = subscribeUserPreferences((prefs) => {
      applyThemeToDocument(prefs.theme_mode, prefs.language);
      const nextBubble = prefs.floating_bubble_enabled ?? true;
      setFloatingBubbleEnabled(nextBubble);
      void syncNativeFloatingBubbleEnabled(nextBubble);
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

  useEffect(() => {
    const splashTimer = window.setTimeout(() => {
      setSplashMinDone(true);
    }, 1550);
    return () => window.clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    const handleUnlock = () => {
      unlockAudioContext();
    };
    window.addEventListener('pointerdown', handleUnlock, { once: true, passive: true });
    window.addEventListener('touchstart', handleUnlock, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
    };
  }, []);

  useEffect(() => {
    let hideTimer: number | null = null;
    const handleWalletToast = (evt: Event) => {
      const detail = (
        evt as CustomEvent<{
          title?: string;
          message?: string;
          receiptTx?: WalletTransaction;
        }>
      ).detail;
      if (!detail?.message) return;
      setWalletToast({
        id: Date.now(),
        title: detail.title || 'GoPay · Transferência',
        message: detail.message,
        receiptTx: detail.receiptTx,
      });
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        setWalletToast(null);
      }, 7500);
    };
    window.addEventListener('mobilidade66:wallet-toast', handleWalletToast);
    return () => {
      window.removeEventListener('mobilidade66:wallet-toast', handleWalletToast);
      if (hideTimer) window.clearTimeout(hideTimer);
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
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage quota / private mode restrictions
      }

      if (syncedLangUserIdRef.current !== updated.id) {
        syncedLangUserIdRef.current = updated.id;
        const localPrefs = getUserPreferences();
        const choseBeforeLogin = consumeExplicitLanguageChoice();
        if (choseBeforeLogin && localPrefs.language && localPrefs.language !== updated.preferred_language) {
          void updateUserLanguagePref(updated.id, localPrefs.language);
        } else if (
          updated.preferred_language &&
          localPrefs.language !== updated.preferred_language
        ) {
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
      greetLoggedInUser(user, true);
    },
    [handleUserUpdated, recordSessionAudit]
  );

  const handleLogout = useCallback(async () => {
    const prevUser = currentUser;
    resetSessionGreeting();
    syncedLangUserIdRef.current = null;
    loggedSessionUserIdRef.current = null;
    setCurrentUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
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
          greetLoggedInUser(user, false);
        } else {
          setCurrentUser(null);
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            // Ignore
          }
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
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore
        }
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [handleUserUpdated, recordSessionAudit]);

  const { isVerifiedAdmin, verifyingAdmin } = useAdminAuth(currentUser);

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
      site_name: appConfig.app_name || platformConfig.site_name || 'Go Driver Mobilidade',
      app_logo_url:
        appConfig.logo_url !== undefined ? appConfig.logo_url : platformConfig.app_logo_url,
      primary_color: appConfig.primary_color || platformConfig.primary_color || '#2563EB',
      secondary_color: appConfig.secondary_color || platformConfig.secondary_color || '#0F172A',
    }),
    [platformConfig, appConfig]
  );

  // Sync native Android background-only bubble state & active ride badge (zero in-app overlay)
  const hasActiveRide = useMemo(
    () =>
      Boolean(
        currentUser &&
          rides.some(
            (r) =>
              ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status) &&
              (r.passenger_id === currentUser.id || r.driver_id === currentUser.id)
          )
      ),
    [currentUser, rides]
  );

  useEffect(() => {
    void syncNativeFloatingBubbleEnabled(Boolean(currentUser) && floatingBubbleEnabled);
    void syncNativeFloatingBubbleActiveRide(hasActiveRide);
  }, [currentUser, floatingBubbleEnabled, hasActiveRide]);

  // Web auto-updates silently without showing APK modal; Android APK checks OTA reactively
  useEffect(() => {
    if (booting) return;

    const runChecks = () => {
      void checkAndApplyWebAutoUpdate();
      checkForOtaUpdate(effectivePlatformConfig)
        .then((info) => {
          if (info.hasUpdate && info.isNativePlatform) {
            if (shownOtaVersionRef.current !== info.latestVersion) {
              shownOtaVersionRef.current = info.latestVersion;
              setOtaUpdateInfo(info);
            }
          } else {
            setOtaUpdateInfo(null);
          }
        })
        .catch(() => {});
    };

    runChecks();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runChecks();
      }
    };
    window.addEventListener('focus', runChecks);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', runChecks);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    booting,
    effectivePlatformConfig.ota_latest_version,
    effectivePlatformConfig.ota_apk_url,
    effectivePlatformConfig.ota_web_url,
    effectivePlatformConfig.ota_release_notes,
  ]);

  const showSplash = !splashMinDone || (booting && !currentUser);

  const showOtaModal = Boolean(
    otaUpdateInfo?.hasUpdate &&
      otaUpdateInfo.isNativePlatform &&
      dismissedOtaVersion !== otaUpdateInfo.latestVersion
  );

  return (
    <>
      <AnimatePresence>
        {showSplash && <AnimatedSplashScreen platformConfig={effectivePlatformConfig} />}
      </AnimatePresence>
      <OfflineIndicator />
      {!currentUser ? (
        <AuthScreen
          onAuthenticated={handleAuthenticated}
          platformConfig={effectivePlatformConfig}
        />
      ) : (currentUser.is_admin || currentUser.role === 'admin') && verifyingAdmin ? (
        <div
          className="flex h-screen w-screen items-center justify-center aurora-surface-flow"
        >
          <div className="text-center px-6">
            <img
              src={resolveBrandLogo(effectivePlatformConfig)}
              alt={effectivePlatformConfig.site_name || 'Go Driver Mobilidade'}
              className="mx-auto h-16 w-16 rounded-2xl object-cover border-2 border-[#2563EB]/25 bg-white shadow-lg"
            />
            <p className="mt-3 text-sm font-extrabold text-[#0F172A]">
              {t.validating_admin}
            </p>
          </div>
        </div>
      ) : isVerifiedAdmin ? (
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

      {walletToast && (
        <div
          key={walletToast.id}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[1500] w-[calc(100%-24px)] max-w-md rounded-2xl border border-[#BFDBFE] bg-white/95 text-[#0F172A] px-4 py-3 shadow-2xl backdrop-blur-md flex items-start gap-3 animate-in fade-in slide-in-from-top-3 duration-200"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563EB] to-[#0EA5E9] text-white shadow-xs">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-wider text-[#2563EB]">
              {walletToast.title}
            </p>
            <p className="mt-0.5 text-sm font-bold text-[#0F172A] leading-snug">
              {walletToast.message}
            </p>
            {walletToast.receiptTx && (
              <button
                type="button"
                onClick={() => {
                  const tx = walletToast.receiptTx;
                  setWalletToast(null);
                  if (tx) setActiveReceiptTx(tx);
                }}
                className="aurora-accent-flow mt-2 inline-flex min-h-[34px] items-center rounded-xl px-3 text-[11px] font-extrabold text-white shadow-2xs active:scale-95 transition"
              >
                {t.view_gopay_receipt}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWalletToast(null)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F4F6F9] text-[#475569] hover:bg-[#E2E8F0]"
            aria-label={t.close}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {activeReceiptTx && currentUser && (
        <Receipt66PayModal
          transaction={activeReceiptTx}
          currentUser={currentUser}
          platformConfig={effectivePlatformConfig}
          onClose={() => setActiveReceiptTx(null)}
        />
      )}

      {showOtaModal && otaUpdateInfo && (
        <OtaUpdateModal
          updateInfo={otaUpdateInfo}
          siteName={effectivePlatformConfig.site_name}
          mandatory={otaUpdateInfo.isNativePlatform}
          onClose={() => setDismissedOtaVersion(otaUpdateInfo.latestVersion)}
        />
      )}
    </>
  );
}
