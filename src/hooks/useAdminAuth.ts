import { useEffect, useState } from 'react';
import { verifyMyAdminAccess } from '../lib/mobilityApi';
import type { UserProfile } from '../types/mobility';

/**
 * Verificação de privilégio Super Admin diretamente no banco (Supabase),
 * impedindo acesso ao AdminDashboard apenas por estado local ou localStorage.
 */
export function useAdminAuth(currentUser: UserProfile | null) {
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [verifyingAdmin, setVerifyingAdmin] = useState(false);

  const userId = currentUser?.id ?? null;
  const apparentAdmin =
    Boolean(currentUser?.is_admin || currentUser?.role === 'admin') &&
    currentUser?.status === 'active' &&
    !currentUser?.is_anonymized;

  useEffect(() => {
    let active = true;

    if (!userId || !apparentAdmin) {
      setIsVerifiedAdmin(false);
      setVerifyingAdmin(false);
      return;
    }

    setVerifyingAdmin(true);
    verifyMyAdminAccess()
      .then((allowed) => {
        if (active) {
          setIsVerifiedAdmin(allowed);
        }
      })
      .catch(() => {
        if (active) {
          setIsVerifiedAdmin(false);
        }
      })
      .finally(() => {
        if (active) {
          setVerifyingAdmin(false);
        }
      });

    return () => {
      active = false;
    };
  }, [userId, apparentAdmin]);

  return {
    isVerifiedAdmin: apparentAdmin && isVerifiedAdmin,
    verifyingAdmin,
  };
}
