import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { CookieBanner } from './components/CookieBanner';
import { DriverView } from './components/DriverView';
import { PassengerView } from './components/PassengerView';
import { PermissionsPromptModal } from './components/PermissionsPromptModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import { useRealtimeMobility } from './hooks/useRealtimeMobility';
import { resolveBrandLogo } from './lib/brandAssets';
import { logoutUser, restoreSessionUser } from './lib/mobilityApi';
import { supabase } from './lib/supabase';
import { hasSeenPermissionsPrompt } from './lib/userPrefs';
import type { UserProfile } from './types/mobility';

const STORAGE_KEY = 'velo99_session_user';

export default function App() {
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

  const handleUserUpdated = useCallback((updated: UserProfile) => {
    setCurrentUser(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const handleLogout = useCallback(async () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
    await logoutUser().catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    restoreSessionUser()
      .then((user) => {
        if (!mounted) return;
        if (user) {
          handleUserUpdated(user);
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
        setCurrentUser(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [handleUserUpdated]);

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

  useEffect(() => {
    const brand = platformConfig.site_name || 'Velo99';
    document.title = `${brand} Mobilidade — Corridas e Entregas`;
  }, [platformConfig.site_name]);

  if (booting && !currentUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#FFD100]">
        <div className="text-center">
          <img
            src={resolveBrandLogo(platformConfig)}
            alt={platformConfig.site_name || 'Velo99'}
            className="mx-auto h-16 w-16 rounded-2xl object-cover border-2 border-neutral-950 shadow-lg"
          />
          <p className="mt-3 text-sm font-extrabold text-neutral-950">
            Conectando ao {platformConfig.site_name || 'Velo99'}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineIndicator />
      {!currentUser ? (
        <AuthScreen onAuthenticated={handleUserUpdated} platformConfig={platformConfig} />
      ) : currentUser.role === 'admin' ? (
        <AdminDashboard
          currentUser={currentUser}
          initialPlatformConfig={platformConfig}
          onLogout={handleLogout}
        />
      ) : currentUser.role === 'driver' ? (
        <DriverView
          currentUser={currentUser}
          platformConfig={platformConfig}
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
          platformConfig={platformConfig}
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

      <CookieBanner siteName={platformConfig.site_name} />

      {showPermsModal && (
        <PermissionsPromptModal
          siteName={platformConfig.site_name}
          onClose={() => setShowPermsModal(false)}
        />
      )}
    </>
  );
}
