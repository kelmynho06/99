import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { DriverView } from './components/DriverView';
import { PassengerView } from './components/PassengerView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { useRealtimeMobility } from './hooks/useRealtimeMobility';
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

  const handleUserUpdated = useCallback((updated: UserProfile) => {
    setCurrentUser(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Re-validate session user against server on boot
  useEffect(() => {
    if (!currentUser?.id) return;
    fetch(`/api/users/${currentUser.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: UserProfile } | null) => {
        if (data?.user) {
          handleUserUpdated(data.user);
        } else if (data === null) {
          handleLogout();
        }
      })
      .catch(() => {});
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    rides,
    pricing,
    onlineDrivers,
    messagesByRide,
    upsertRide,
    loadRideMessages,
    emitDriverLocation,
  } = useRealtimeMobility(currentUser, handleUserUpdated);

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
          rides={rides}
          messagesByRide={messagesByRide}
          onUserUpdated={handleUserUpdated}
          onLoadMessages={loadRideMessages}
          onRideUpsert={upsertRide}
          onEmitLocation={emitDriverLocation}
          onLogout={handleLogout}
        />
      ) : (
        <PassengerView
          currentUser={currentUser}
          rides={rides}
          pricing={pricing}
          onlineDrivers={onlineDrivers}
          messagesByRide={messagesByRide}
          onUserUpdated={handleUserUpdated}
          onLoadMessages={loadRideMessages}
          onRideUpsert={upsertRide}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
