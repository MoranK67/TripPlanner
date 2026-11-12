import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '@/components/ui';
import { useAuth } from './authContext';

/**
 * Route guard for everything that needs a signed-in user. Waits for `initial_session` (status
 * `loading`) so a stored session is never mistaken for "signed out". A user who came in through a
 * password-reset link is sent to the set-new-password page first.
 */
export function RequireAuth() {
  const { status, recovery, expired } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingState />;
  if (status === 'signed_out') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location, ...(expired ? { reason: 'expired' } : {}) }}
      />
    );
  }
  if (recovery) return <Navigate to="/reset-password" replace />;
  return <Outlet />;
}
