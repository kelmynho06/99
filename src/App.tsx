import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { DriverView } from './components/DriverView';
import { PassengerView } from './components/PassengerView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { useRealtimeMobility } from './hooks/useRealtimeMobility';
import { logoutUser, restoreSessionUser } from './lib/mobilityApi';
import { supabase } from './lib/supabase';
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

  if (booting && !currentUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#FFD100]">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-950 font-display text-3xl font-extrabold text-[#FFD100] shadow-lg">
            99
          </div>
          <p className="mt-3 text-sm font-extrabold text-neutral-950">Conectando ao Velo99...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineIndicator />
      {!currentUser ? (
        <AuthScreen onAuthenticated={handleUserUpdated} />
      ) : currentUser.role === 'admin' ? (
        <AdminDashboard currentUser={currentUser} onLogout={handleLogout} />
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
    </>
  );
}
